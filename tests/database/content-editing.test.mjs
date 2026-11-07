import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const db = new PGlite({ extensions: { pg_trgm } });
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const suspended = '33333333-3333-4333-8333-333333333333';
const ids = {};
const scalar = async (query, args = []) => Object.values((await db.query(query, args)).rows[0])[0];

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    create schema realtime; create table realtime.messages(topic text, extension text, payload jsonb);
    alter table realtime.messages enable row level security;
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
    create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$
      insert into realtime.messages values(topic,'broadcast',payload); $$;
    grant usage on schema realtime to authenticated; grant select on realtime.messages to authenticated;
    create publication supabase_realtime;`);
  for (const name of [
    '20260904032053_community_core.sql',
    '20260907191603_secure_community_views.sql',
    '20260910031322_realtime_discovery_and_message_requests.sql',
    '20260910034701_production_access_hardening.sql',
    '20260910035131_imported_comment_discovery.sql',
    '20260910055528_launch_safety_and_moderation.sql',
    '20260911050812_community_write_guard_gaps.sql',
    '20261003175707_native_parent_visibility_hardening.sql',
    '20261003180348_secure_native_vote_rpcs.sql',
  ]) await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  const wrapper = await readFile(new URL('../../supabase/migrations/20261107042328_member_reply_voting.sql', import.meta.url), 'utf8');
  await db.exec(wrapper.slice(0, wrapper.indexOf('-- Member-authored')) + 'commit;');
  await db.exec(`create function private.library_member() returns uuid language plpgsql security definer set search_path='' as $$begin if auth.uid() is null then raise exception 'Sign in' using errcode='42501'; end if;return auth.uid();end$$;
    create function private.library_post_visible(target text) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.questions where id=target::uuid and status<>'archived')$$;`);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261107193430_author_content_editing.sql',import.meta.url),'utf8'));
  await db.query('insert into auth.users values($1),($2),($3)', [alice, bob, suspended]);
  await db.query('insert into private.community_suspensions(user_id,moderator_id) values($1,$2)', [suspended, alice]);
  for (const status of ['open', 'closed', 'archived']) {
    const question = await scalar(`insert into public.questions(author_id,title,body,status)
      values($1,$2,'Voting fixture with a sufficiently long public question body.',$3) returning id`,
    [alice, `${status} voting fixture question`, status]);
    const answer = await scalar(`insert into public.answers(question_id,author_id,body)
      values($1,$2,'An answer with enough detail for the secure vote fixture.') returning id`, [question, bob]);
    ids[status] = { question, answer };
  }
  ids.hiddenAnswer = await scalar(`insert into public.answers(question_id,author_id,body,status)
    values($1,$2,'This answer has been removed and cannot receive votes.','archived') returning id`, [ids.open.question, bob]);
});
after(() => db.close());

async function asRole(role, uid, fn) {
  assert(['anon', 'authenticated'].includes(role));
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid ?? '']);
    await db.exec(`set local role ${role}`);
    return await fn();
  } finally { await db.exec('rollback'); }
}
const denied = (fn) => assert.rejects(fn, (error) => error.code === '42501');


const original='Voting fixture with a sufficiently long public question body.';
const answerBody='An answer with enough detail for the secure vote fixture.';
const edit=(kind,id,user,body,expected,title=null,oldTitle=null,op='edit')=>db.query('select public.manage_own_content($1,$2,$3,$4,$5,$6,$7,$8)',[kind,id,op,body,title,expected,oldTitle,user]);
test('authors edit their posts; unchanged saves and activity do not mark content edited',()=>asRole('authenticated',alice,async()=>{
 const id=ids.open.question;
 assert.equal(await scalar('select edited_at from public.question_feed where id=$1',[id]),null);
 await edit('question',id,alice,original,original,'open voting fixture question','open voting fixture question');
 assert.equal(await scalar('select edited_at from public.question_feed where id=$1',[id]),null);
 await edit('question',id,alice,original+' Updated.',original,'Updated voting fixture title','open voting fixture question');
 const stamp=await scalar('select edited_at from public.question_feed where id=$1',[id]);assert(stamp);
 await db.exec('reset role');await db.query('update public.questions set vote_score=10,answer_count=3 where id=$1',[id]);
 assert.equal(String(await scalar('select edited_at from public.question_feed where id=$1',[id])),String(stamp));
}));
test('non-authors, anonymous, mismatched sessions, hidden parents and stale edits are rejected',async()=>{
 await asRole('anon',null,()=>assert.rejects(()=>edit('question',ids.open.question,alice,original,original,null,null,'delete'),/permission denied/));
 await asRole('authenticated',bob,()=>denied(()=>edit('question',ids.open.question,bob,original,original,null,null,'delete')));
 await asRole('authenticated',alice,()=>denied(()=>edit('question',ids.open.question,bob,original,original,null,null,'delete')));
 await asRole('authenticated',alice,()=>assert.rejects(()=>edit('question',ids.open.question,alice,original,'outdated','open voting fixture question','open voting fixture question'),/changed/));
 await asRole('authenticated',bob,()=>denied(()=>edit('answer',ids.archived.answer,bob,answerBody,answerBody)));
 await asRole('authenticated',bob,()=>denied(()=>edit('answer',ids.closed.answer,bob,answerBody+' edit',answerBody)));
});
test('comment deletion hides the comment, clears acceptance and decrements counts',()=>asRole('authenticated',bob,async()=>{
 const id=ids.open.answer,parent=ids.open.question;
 await db.exec('reset role');await db.query('update public.questions set accepted_answer_id=$1 where id=$2',[id,parent]);await db.query('update public.answers set is_accepted=true where id=$1',[id]);await db.exec('set local role authenticated');
 await edit('answer',id,bob,answerBody,answerBody,null,null,'delete');
 assert.equal(await scalar('select count(*) from public.answer_feed where id=$1',[id]),0);
 assert.equal(await scalar('select answer_count from public.questions where id=$1',[parent]),0);
 assert.equal(await scalar('select accepted_answer_id from public.questions where id=$1',[parent]),null);
}));
test('deleting a post removes its public post and comment views',()=>asRole('authenticated',alice,async()=>{
 await edit('question',ids.open.question,alice,original,original,null,'open voting fixture question','delete');
 assert.equal(await scalar('select count(*) from public.question_feed where id=$1',[ids.open.question]),0);
 assert.equal(await scalar('select count(*) from public.answer_feed where question_id=$1',[ids.open.question]),0);
}));
test('member replies on imported posts support owner edits and deletion',()=>asRole('authenticated',bob,async()=>{
 const id=await scalar("insert into public.imported_answers(question_id,author_id,body) values('apify-test',$1,$2) returning id",[bob,answerBody]);
 await edit('imported_answer',id,bob,answerBody+' Updated.',answerBody);
 assert(await scalar('select edited_at from public.imported_answer_feed where id=$1',[id]));
 await edit('imported_answer',id,bob,'',answerBody+' Updated.',null,null,'delete');
 assert.equal(await scalar('select count(*) from public.imported_answer_feed where id=$1',[id]),0);
}));

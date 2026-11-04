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
    create schema auth; create table auth.users(id uuid primary key, email_confirmed_at timestamptz default now(),phone_confirmed_at timestamptz);
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
  await db.query('insert into auth.users(id) values($1),($2),($3)', [alice, bob, suspended]);
  await db.query('insert into private.community_suspensions(user_id,moderator_id) values($1,$2)', [suspended, alice]);
  for (const status of ['open', 'closed', 'archived']) {
    const question = await scalar(`insert into public.questions(author_id,title,body,status)
      values($1,$2,'Voting fixture with a sufficiently long public question body.',$3) returning id`,
    [alice, `${status} voting fixture question`, status]);
    const answer = await scalar(`insert into public.answers(question_id,author_id,body)
      values($1,$2,'An answer with enough detail for the secure vote fixture.') returning id`, [question, bob]);
    ids[status] = { question, answer };
  }
  await db.exec("update public.profiles set created_at=now()-interval '2 days'");
  ids.hiddenAnswer = await scalar(`insert into public.answers(question_id,author_id,body,status)
    values($1,$2,'This answer has been removed and cannot receive votes.','archived') returning id`, [ids.open.question, bob]);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261104043337_community_reputation.sql',import.meta.url),'utf8'));
  await db.exec('create table private.feedback_owner(user_id uuid primary key references auth.users(id))');
  await db.query('insert into private.feedback_owner values($1)',[alice]);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261102054340_community_spam_protection.sql',import.meta.url),'utf8'));
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

const rep = uid => scalar('select reputation from profiles where id=$1',[uid]);
const history = () => scalar('select public.my_reputation()');
const question = async (author=alice) => scalar("insert into questions(author_id,title,body) values($1,'A valid reputation question','A sufficiently detailed community reputation question body.') returning id",[author]);

test('helpful question vote awards two, repeat is idempotent, change and delete reverse exactly',()=>asRole('authenticated',bob,async()=>{
  await db.query('select vote_question($1,1)',[ids.open.question]);
  assert.equal(await rep(alice),3);
  await db.query('select vote_question($1,1)',[ids.open.question]);
  assert.equal(await rep(alice),3);
  await db.query('select vote_question($1,-1)',[ids.open.question]);
  assert.equal(await rep(alice),1);
  await db.query('select vote_question($1,1)',[ids.open.question]);
  await db.query('delete from question_votes where question_id=$1',[ids.open.question]);
  assert.equal(await rep(alice),1);
  await db.exec('reset role');
  assert.equal(await scalar('select count(*)::int from private.reputation_awards'),1);
  assert.equal(await scalar('select sum(delta)::int from private.reputation_events'),0);
}));
test('answer receives five points; own answer acceptance is allowed but earns nothing',()=>asRole('authenticated',alice,async()=>{
  await db.query('select vote_answer($1,1)',[ids.open.answer]);
  assert.equal(await rep(bob),6);
  await db.query('select accept_answer($1)',[ids.open.answer]);
  assert.equal(await rep(bob),16);
  await db.exec('reset role');
  const own=await scalar("insert into answers(question_id,author_id,body) values($1,$2,'A detailed self answer to my own original question.') returning id",[ids.open.question,alice]);
  await db.exec('set local role authenticated');
  await db.query('select accept_answer($1)',[own]);
  assert.equal(await rep(bob),6);
  assert.equal(await rep(alice),1);
}));
test('accepted answer switching removes prior award and repeated acceptance cannot farm points',()=>asRole('authenticated',alice,async()=>{
  await db.query('select accept_answer($1)',[ids.open.answer]);
  await db.query('select accept_answer($1)',[ids.open.answer]);
  assert.equal(await rep(bob),11);
  await db.exec('reset role');
  const other=await scalar("insert into answers(question_id,author_id,body) values($1,$2,'Another useful answer for testing accepted answer switching.') returning id",[ids.open.question,bob]);
  await db.exec('set local role authenticated');
  await db.query('select accept_answer($1)',[other]);
  assert.equal(await rep(bob),11);
  await db.query('select accept_answer($1)',[ids.open.answer]);
  assert.equal(await rep(bob),11);
}));
for(const [uid,kind] of [[alice,'question'],[bob,'answer']]) {
  test('self-vote rejected on '+kind,()=>denied(()=>asRole('authenticated',uid,()=>db.query('select vote_'+kind+'($1,1)',[ids.open[kind]]))));
}
test('direct Data API vote insertion cannot bypass self-vote guard',()=>denied(()=>asRole('authenticated',alice,
  ()=>db.query('insert into question_votes(question_id,user_id,value) values($1,$2,1)',[ids.open.question,alice]))));
test('new verified members can vote but cannot immediately mint reputation',()=>asRole('authenticated',bob,async()=>{
  await db.exec('reset role'); await db.query('update profiles set created_at=now() where id=$1',[bob]); await db.exec('set local role authenticated');
  assert.equal(await scalar('select vote_question($1,1)',[ids.open.question]),1);
  assert.equal(await rep(alice),1);
}));
test('unverified voter cannot mint reputation',()=>asRole('authenticated',bob,async()=>{
  await db.exec('reset role'); await db.query('update auth.users set email_confirmed_at=null where id=$1',[bob]); await db.exec('set local role authenticated');
  await db.query('select vote_question($1,1)',[ids.open.question]); assert.equal(await rep(alice),1);
}));
test('hidden parent revokes both answer votes and acceptance, restoration reinstates only original awards',()=>asRole('authenticated',alice,async()=>{
  await db.query('select vote_answer($1,1)',[ids.open.answer]);
  await db.query('select accept_answer($1)',[ids.open.answer]);
  await db.exec('reset role');
  await db.query("update questions set status='archived' where id=$1",[ids.open.question]); assert.equal(await rep(bob),1);
  await db.query("update questions set status='open' where id=$1",[ids.open.question]); assert.equal(await rep(bob),16);
  await db.query("update answers set status='archived' where id=$1",[ids.open.answer]); assert.equal(await rep(bob),1);
  await db.query("update answers set status='active' where id=$1",[ids.open.answer]); assert.equal(await rep(bob),16);
}));
test('deleting a rewarded question or answer reverses its points',()=>asRole('authenticated',alice,async()=>{
  await db.query('select vote_answer($1,1)',[ids.open.answer]); assert.equal(await rep(bob),6);
  await db.exec('reset role'); await db.query('delete from questions where id=$1',[ids.open.question]); assert.equal(await rep(bob),1);
}));
test('suspension reverses awards received and given; removing suspension reinstates valid awards',()=>asRole('authenticated',alice,async()=>{
  await db.query('select vote_answer($1,1)',[ids.open.answer]); assert.equal(await rep(bob),6);
  await db.exec('reset role');
  await db.query('insert into private.community_suspensions(user_id,moderator_id) values($1,$2)',[alice,bob]);
  assert.equal(await rep(bob),1);
  await db.query('delete from private.community_suspensions where user_id=$1',[alice]);
  assert.equal(await rep(bob),6);
}));
test('voting for a suspended recipient does not award points',()=>asRole('authenticated',alice,async()=>{
  await db.exec('reset role'); await db.query('insert into private.community_suspensions(user_id,moderator_id) values($1,$2)',[bob,alice]); await db.exec('set local role authenticated');
  await db.query('select vote_answer($1,1)',[ids.open.answer]); assert.equal(await rep(bob),1);
}));
test('one voter may award at most twenty points to one member per UTC day, even after vote deletion',()=>asRole('authenticated',bob,async()=>{
  const targets=[];
  await db.exec("reset role; select set_config('request.jwt.claim.sub','',true)"); for(let i=0;i<12;i++) targets.push(await question()); await db.query("select set_config('request.jwt.claim.sub',$1,true)",[bob]); await db.exec('set local role authenticated');
  for(const target of targets) await db.query('select vote_question($1,1)',[target]);
  assert.equal(await rep(alice),21);
  await db.query('delete from question_votes where question_id=$1',[targets[0]]);
  assert.equal(await rep(alice),19);
  await db.query('select vote_question($1,1)',[targets[11]]); assert.equal(await rep(alice),19);
  await db.query('select vote_question($1,1)',[targets[0]]); assert.equal(await rep(alice),21);
}));
test('daily recipient cap is one hundred across distinct voters',()=>asRole('authenticated',bob,async()=>{
  await db.exec("reset role; select set_config('request.jwt.claim.sub','',true)");
  const voters=[]; const targets=[];
  for(let i=1;i<=6;i++) {
    const uid='44444444-4444-4444-8444-'+String(i).padStart(12,'0'); voters.push(uid);
    await db.query('insert into auth.users(id) values($1)',[uid]); await db.query("update profiles set created_at=now()-interval '2 days' where id=$1",[uid]);
  }
  for(let i=0;i<10;i++) targets.push(await question());
  await db.exec('set local role authenticated');
  for(const uid of voters) {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);
    for(const target of targets) await db.query('select vote_question($1,1)',[target]);
  }
  assert.equal(await rep(alice),101);
}));
test('history is own-account only, bounded and contains no voter identities or private post text',()=>asRole('authenticated',bob,async()=>{
  await db.query('select vote_question($1,1)',[ids.open.question]);
  assert.deepEqual((await history()).events,[]);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[alice]);
  const result=await history(); assert.equal(result.total,3); assert.equal(result.events[0].delta,2);
  assert.deepEqual(Object.keys(result.events[0]).sort(),['created_at','delta','id','kind','reason']);
}));
for(const role of ['anon','authenticated']) {
  for(const sql of ['select * from private.reputation_events','select * from private.reputation_awards',"update profiles set reputation=999",
    "select private.reputation_sync('question_upvote',gen_random_uuid(),gen_random_uuid(),'forged')"]) {
    test(role+' cannot forge or inspect private award records: '+sql,()=>denied(()=>asRole(role,bob,()=>db.query(sql))));
  }
}
test('anonymous and subjectless callers cannot read reputation history',async()=>{
  await denied(()=>asRole('anon',null,history)); await denied(()=>asRole('authenticated',null,history));
});
test('a zero-reputation newcomer can publish a normal question',()=>asRole('authenticated',bob,async()=>{
  await db.exec('reset role'); await db.query('update profiles set reputation=0,created_at=now() where id=$1',[bob]); await db.exec('set local role authenticated');
  assert(await question(bob));
}));

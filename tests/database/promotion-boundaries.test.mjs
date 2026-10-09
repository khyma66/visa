import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

// Independent integration regression: actual community migrations coexist with
// legacy identity/storage tables, then the exact promotion migration is applied.
// Only the platform auth/realtime/storage services are stubbed in local Postgres.
const promotion = await readFile(new URL('../../supabase/migrations/20261003191043_production_legacy_access_hardening.sql', import.meta.url), 'utf8');
const fixture = await readFile(new URL('./fixture.sql', import.meta.url), 'utf8');
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const eve = '33333333-3333-4333-8333-333333333333';
const sourceOnly = '44444444-4444-4444-8444-444444444444';
const db = new PGlite({ extensions: { pg_trgm } });
const ids = {};
const value = async (database, sql, args = []) => Object.values((await database.query(sql,args)).rows[0])[0];

async function setup(database, { native = true } = {}) {
  await database.exec(fixture);
  await database.exec(`
    create schema storage;
    create table storage.buckets(id text primary key,public boolean);
    create table storage.objects(id uuid primary key,bucket_id text);
    insert into storage.buckets values('posts',true);
    insert into storage.objects values(gen_random_uuid(),'posts');
    alter table public.users add column username text;
    insert into public.users(id,username) values
      ('${alice}','legacy-alice'),('${bob}','legacy-bob'),('${eve}','legacy-eve'),('${sourceOnly}','source-only-contributor');
    create table public.posts(id uuid primary key,body text);
    insert into public.posts values(gen_random_uuid(),'Retained legacy source content');
    grant all on public.users,public.posts to public,anon,authenticated,service_role;
    create function public.update_updated_at_column() returns trigger language plpgsql as $$
      begin return new; end; $$;
    create table auth.users(id uuid primary key);
    create schema realtime;
    create table realtime.messages(topic text,extension text,payload jsonb);
    alter table realtime.messages enable row level security;
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
    create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$
      insert into realtime.messages values(topic,'broadcast',payload)$$;
    grant usage on schema realtime to authenticated;
    grant select on realtime.messages to authenticated;
    create publication supabase_realtime;
  `);
  if (!native) return;
  // Explicit, reviewed migration set. Do not replay retired September legacy
  // containment or depend on a full historical production database dump.
  for (const name of [
    '20260904032053_community_core.sql',
    '20260907191603_secure_community_views.sql',
    '20260910031322_realtime_discovery_and_message_requests.sql',
    '20260910034701_production_access_hardening.sql',
    '20260910035131_imported_comment_discovery.sql',
    '20260910055528_launch_safety_and_moderation.sql',
    '20260911050812_community_write_guard_gaps.sql',
    '20260928164013_community_membership_access_hardening.sql',
    '20260928164317_revoke_client_table_administration.sql',
    '20261003013954_revoke_imported_view_administration.sql',
    '20261003175707_native_parent_visibility_hardening.sql',
    '20261003175714_messaging_delivery_reliability.sql',
    '20261003180348_secure_native_vote_rpcs.sql',
    '20261003180857_native_tag_directory.sql',
    '20261003180924_answer_cursor_pagination.sql',
    '20261003181308_deterministic_discovery_candidates.sql',
    '20261003181839_discussion_latest_reply_indexes.sql',
  ]) await database.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url),'utf8'));
  await database.query('insert into auth.users values($1),($2),($3)',[alice,bob,eve]);
  await database.query("update public.profiles set username=case id when $1 then 'alice-member' when $2 then 'bob-member' else 'eve-member' end",[alice,bob]);
}

async function asUser(id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id ?? '']);
  await db.exec(`set local role ${id ? 'authenticated' : 'anon'}`);
}
async function transaction(fn) {
  await db.exec('begin');
  try { return await fn(); } finally { await db.exec('rollback'); }
}
async function denied(fn, pattern = /permission denied|not found|unavailable|not allowed|cannot|closed|accept|pending|intro/i) {
  await db.exec('savepoint expected_denial');
  try { await assert.rejects(fn,pattern); } finally { await db.exec('rollback to savepoint expected_denial'); }
}

before(async () => {
  await setup(db);
  ids.question = await value(db,`insert into public.questions(author_id,title,body,tags)
    values($1,'Existing native visa question','A sufficiently detailed retained native visa timeline question.',array['h1b','timeline']) returning id`,[alice]);
  ids.answer = await value(db,`insert into public.answers(question_id,author_id,body)
    values($1,$2,'Existing answer about the biometrics appointment timeline.') returning id`,[ids.question,bob]);
  ids.hidden = await value(db,`insert into public.questions(author_id,title,body,tags,status)
    values($1,'Archived parent question fixture','Hidden parent content must not become visible after promotion.',array['archive-private'],'archived') returning id`,[alice]);
  ids.hiddenAnswer = await value(db,`insert into public.answers(question_id,author_id,body)
    values($1,$2,'Hidden answer to the archived parent question.') returning id`,[ids.hidden,bob]);
  ids.conversation = await value(db,`insert into public.direct_conversations(user_one_id,user_two_id,request_status,requested_by)
    values($1,$2,'accepted',$1) returning id`,[alice,bob]);
  ids.message = await value(db,`insert into public.direct_messages(conversation_id,sender_id,body)
    values($1,$2,'Private retained message for Bob only.') returning id`,[ids.conversation,alice]);
  await db.exec(promotion);
});
after(() => db.close());

test('promotion retains real native records and separates legacy identities from actual member profiles',async () => {
  assert.equal(await value(db,'select count(*)::int from public.questions'),2);
  assert.equal(await value(db,'select count(*)::int from public.answers'),2);
  assert.equal(await value(db,'select count(*)::int from public.direct_messages'),1);
  assert.equal(await value(db,'select body from public.direct_messages where id=$1',[ids.message]),'Private retained message for Bob only.');
  assert.equal(await value(db,'select count(*)::int from public.profiles'),3);
  assert.equal(await value(db,'select count(*)::int from public.profiles where id=$1',[sourceOnly]),0);
  assert.equal(await value(db,"select count(*)::int from public.users where username='source-only-contributor'"),1);
});

test('anonymous discovery retains visible native questions but not archived parents or legacy data',() => transaction(async () => {
  await asUser(null);
  assert.deepEqual((await db.query('select id from public.community_question_page()')).rows.map(row=>row.id),[ids.question]);
  assert.equal((await db.query('select * from public.answer_page($1)',[ids.question])).rows[0].id,ids.answer);
  assert.equal((await db.query('select * from public.answer_page($1)',[ids.hidden])).rows.length,0);
  const tags=(await db.query('select tag from public.community_tag_page()')).rows.map(row=>row.tag);
  assert(tags.includes('h1b')); assert(!tags.includes('archive-private'));
  await denied(()=>db.query('select * from public.users'));
  await denied(()=>db.query('select * from public.posts'));
  await denied(()=>db.query('select * from public.conversation_page()'));
}));

test('native posting, answering, vote changes, acceptance, tags and related discovery survive legacy lock-down',() => transaction(async () => {
  await asUser(alice);
  const question=await value(db,`insert into public.questions(author_id,title,body,tags)
    values($1,'New biometrics timeline question','A new native question about biometrics and visa appointment timelines.',array['h1b','biometrics']) returning id`,[alice]);
  await asUser(bob);
  const answer=await value(db,`insert into public.answers(question_id,author_id,body)
    values($1,$2,'A helpful new answer mentioning biometrics timelines.') returning id`,[question,bob]);
  await db.query('select public.vote_question($1,1)',[question]);
  await db.query('select public.vote_question($1,-1)',[question]);
  assert.equal(await value(db,'select vote_score from public.question_feed where id=$1',[question]),-1);
  await asUser(alice);
  await db.query('select public.vote_answer($1,1)',[answer]);
  await db.query('select public.vote_answer($1,-1)',[answer]);
  await db.query('select public.accept_answer($1)',[answer]);
  const accepted=(await db.query('select * from public.answer_page($1)',[question])).rows[0];
  assert.equal(accepted.is_accepted,true); assert.equal(accepted.vote_score,-1);
  assert((await db.query("select id from public.discover_questions(null,array['biometrics'],array['biometrics'])")).rows.some(row=>row.id===question));
  assert((await db.query("select tag from public.community_tag_page('biometrics')")).rows.some(row=>row.tag==='biometrics'));
  await denied(()=>db.query('select * from public.users'));
}));

test('new auth profile creation and genuine member replies on source threads do not require legacy users access',() => transaction(async () => {
  const newcomer=randomUUID();
  await db.query('insert into auth.users values($1)',[newcomer]);
  assert.equal(await value(db,'select count(*)::int from public.profiles where id=$1',[newcomer]),1);
  await asUser(newcomer);
  const answer=await value(db,`insert into public.imported_answers(question_id,author_id,body)
    values('apify-123456789',$1,'A real member response to a retained source discussion.') returning id`,[newcomer]);
  const row=(await db.query("select * from public.imported_answer_page('apify-123456789')")).rows[0];
  assert.equal(row.id,answer); assert.equal(row.author_id,newcomer);
  await denied(()=>db.query('select * from public.users'));
}));

test('existing private messages and read receipts remain participant-only after promotion',() => transaction(async () => {
  await asUser(bob);
  assert.equal((await db.query('select * from public.conversation_page()')).rows[0].id,ids.conversation);
  assert.equal((await db.query('select * from public.message_page($1)',[ids.conversation])).rows[0].id,ids.message);
  await db.query('select public.mark_direct_messages_read($1,$2)',[ids.conversation,[ids.message]]);
  assert(await value(db,'select read_at from public.direct_messages where id=$1',[ids.message]));
  await db.query('select public.send_direct_message($1,$2,$3)',[ids.conversation,'Bob can still reply to Alice.',randomUUID()]);
  await asUser(eve);
  assert.equal((await db.query('select * from public.conversation_page()')).rows.length,0);
  assert.equal((await db.query('select * from public.message_page($1)',[ids.conversation])).rows.length,0);
  assert.equal((await db.query('select * from public.direct_messages')).rows.length,0);
  await denied(()=>db.query('select public.send_direct_message($1,$2,$3)',[ids.conversation,'Outsider message',randomUUID()]));
}));

test('only genuine profiles can receive a new request; source-only legacy handles never become users',() => transaction(async () => {
  await asUser(alice);
  await denied(()=>db.query("select public.start_direct_conversation('source-only-contributor')"),/Choose another registered community member/);
  const conversation=await value(db,"select public.start_direct_conversation('eve-member')");
  await db.query('select public.send_direct_message($1,$2,$3)',[conversation,'One introductory message.',randomUUID()]);
  await denied(()=>db.query('select public.send_direct_message($1,$2,$3)',[conversation,'Second unsolicited message.',randomUUID()]));
  await asUser(eve);
  await denied(()=>db.query('select public.send_direct_message($1,$2,$3)',[conversation,'Not accepted yet.',randomUUID()]));
  await db.query("select public.respond_to_conversation($1,'accepted')",[conversation]);
  await db.query('select public.send_direct_message($1,$2,$3)',[conversation,'Accepted request reply.',randomUUID()]);
  await db.query("select public.respond_to_conversation($1,'blocked')",[conversation]);
  await asUser(alice);
  await denied(()=>db.query('select public.send_direct_message($1,$2,$3)',[conversation,'Blocked message.',randomUUID()]));
}));

for(const scenario of ['security-definer','server-bypassrls']) {
  test(`promotion fails atomically on unexpected ${scenario} drift`,async () => {
    const drift=new PGlite();
    try {
      await setup(drift,{native:false});
      if(scenario==='security-definer') await drift.exec('alter function public.update_updated_at_column() security definer');
      else await drift.exec('alter role service_role nobypassrls');
      await assert.rejects(()=>drift.exec(promotion),scenario==='security-definer'?/unexpectedly SECURITY DEFINER/:/Expected service_role BYPASSRLS/);
      await drift.exec('rollback');
      assert.equal(await value(drift,"select has_table_privilege('anon','public.posts','SELECT')"),true);
      assert.equal(await value(drift,"select public from storage.buckets where id='posts'"),true);
      assert.equal(await value(drift,'select count(*)::int from public.posts'),1);
      assert.equal(await value(drift,"select to_regclass('private.security_change_snapshots')"),null);
    } finally { await drift.close(); }
  });
}

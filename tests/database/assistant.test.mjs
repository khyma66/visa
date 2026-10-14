import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

// Real PostgreSQL policy/function execution; no production data or hosted calls.
const db = new PGlite({ extensions: { pg_trgm } });
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const missing = '33333333-3333-4333-8333-333333333333';
const ids = {};
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const migration = (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const assistantMigration = '20261013190102_grounded_assistant_retrieval_and_quotas.sql';
const since = '2026-10-12T00:00:00Z';
const until = '2026-10-13T00:00:00Z';

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    grant usage on schema auth to anon,authenticated; grant execute on all functions in schema auth to anon,authenticated;
    create schema realtime; create table realtime.messages(topic text,extension text,payload jsonb);
    alter table realtime.messages enable row level security;
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
    create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$insert into realtime.messages values(topic,'broadcast',payload)$$;
    grant usage on schema realtime to authenticated; grant select on realtime.messages to authenticated;
    create publication supabase_realtime;
    create table public.users(id uuid primary key);
    create table public.communities(id uuid primary key default gen_random_uuid(),name varchar(100) unique not null,display_name varchar(100) not null,
      slug varchar(100) unique not null,description text,country varchar(50),category varchar(50),rules text[],moderators uuid[],
      member_count integer default 0,is_public boolean default true,is_active boolean default true,created_at timestamptz default now());
    create table public.community_members(id uuid primary key default gen_random_uuid(),community_id uuid references public.communities(id) on delete cascade,
      user_id uuid references public.users(id) on delete cascade,role varchar(20) default 'member',joined_at timestamptz default now(),is_active boolean default true,unique(community_id,user_id));
    grant all on public.communities,public.community_members to anon,authenticated,service_role;
    create policy "Public communities are viewable by everyone" on public.communities for select using(is_active=true);
    create policy "Authenticated users can join communities" on public.community_members for insert with check(auth.uid()=user_id);
    create policy "Users can view their community memberships" on public.community_members for select using(auth.uid()=user_id);`);
  for (const name of [
    '20260904032053_community_core.sql','20260907191603_secure_community_views.sql',
    '20260910031322_realtime_discovery_and_message_requests.sql','20260910034701_production_access_hardening.sql',
    '20260910035131_imported_comment_discovery.sql','20260910055528_launch_safety_and_moderation.sql',
    '20260911050812_community_write_guard_gaps.sql','20260928164013_community_membership_access_hardening.sql',
    '20260928164317_revoke_client_table_administration.sql','20261003175707_native_parent_visibility_hardening.sql',
    '20261003181839_discussion_latest_reply_indexes.sql','20261006045523_public_community_lifecycle.sql',assistantMigration,
  ]) await db.exec(await migration(name));
  await db.query('insert into auth.users values($1),($2)', [alice, bob]);
  // Synthetic seeding skips publishing hooks; all tests below use real RLS.
  await db.exec('set session_replication_role=replica');
  for (const name of ['public','private','inactive','other']) {
    ids[name] = await scalar(`insert into public.communities(name,slug,display_name,is_public,is_active)
      values($1,$1,$1,$2,$3) returning id`, [name, name !== 'private', name !== 'inactive']);
  }
  for (const name of ['old','new','private','inactive','archived','other']) {
    ids[`${name}Question`] = await scalar(`insert into public.questions(author_id,title,body,tags,status,community_id,created_at,updated_at)
      values($1,$2,'A detailed community account about biometrics and Chennai appointments.',array['h1b'],$3,$4,$5,$5) returning id`,
      [alice, `${name} H-1B appointment experience`, name === 'archived' ? 'archived' : 'open', ids[name] ?? ids.public,
        name === 'old' ? '2026-07-01T00:00:00Z' : '2026-10-12T10:00:00Z']);
    ids[`${name}Reply`] = await scalar(`insert into public.answers(question_id,author_id,body,created_at,updated_at)
      values($1,$2,'The Chennai biometrics appointment completed in ten minutes.',$3,$3) returning id`,
      [ids[`${name}Question`], bob, '2026-10-12T11:00:00Z']);
  }
  ids.removedReply = await scalar(`insert into public.answers(question_id,author_id,body,status,created_at)
    values($1,$2,'Removed reply secret content must never be exposed.','archived',$3) returning id`, [ids.newQuestion, bob, since]);
  ids.boundaryReply = await scalar(`insert into public.answers(question_id,author_id,body,created_at)
    values($1,$2,'This reply arrived at the exclusive end of the catch-up window.',$3) returning id`, [ids.oldQuestion, bob, until]);
  ids.startReply = await scalar(`insert into public.answers(question_id,author_id,body,created_at)
    values($1,$2,'This reply arrived exactly at the inclusive beginning of the window.',$3) returning id`, [ids.oldQuestion, bob, since]);
  await db.exec('set session_replication_role=origin');
});
after(() => db.close());

async function actor(uid, role = 'authenticated', anonymous = false) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid ?? '']);
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ is_anonymous: anonymous })]);
  if (role) await db.exec(`set local role ${role}`);
}
async function transaction(fn) { await db.exec('begin'); try { return await fn(); } finally { await db.exec('rollback'); } }
async function as(uid, fn, role = 'authenticated', anonymous = false) {
  return transaction(async () => { await actor(uid, role, anonymous); return fn(); });
}
const search = (group = null, text = '', tags = [], start = null, end = null, limit = 48, post = null) =>
  db.query('select * from public.assistant_sources($1,$2,$3,$4,$5,$6,$7)', [group, text, tags, start, end, limit, post]).then((r) => r.rows);
const reserve = () => db.query('select * from public.reserve_assistant_request()').then((r) => r.rows[0]);

test('catch-up includes new replies on old posts without presenting the old parent as a new event', () => as(alice, async () => {
  const rows = await search(ids.public, '', [], since, until);
  assert(rows.some((r) => r.source_id === `a:${ids.oldReply}`));
  assert(!rows.some((r) => r.source_id === `q:${ids.oldQuestion}`));
  const oldReply = rows.find((r) => r.source_id === `a:${ids.oldReply}`);
  assert.equal(oldReply.question_id, ids.oldQuestion);
  assert.equal(oldReply.title, 'old H-1B appointment experience');
  assert.match(oldReply.parent_context, /biometrics and Chennai/);
  assert.equal(new Date(oldReply.parent_updated_at).toISOString(), '2026-07-01T00:00:00.000Z');
  assert.equal(new Date(oldReply.created_at).toISOString(), '2026-10-12T11:00:00.000Z');
  assert(rows.some((r) => r.source_id === `a:${ids.startReply}`));
  assert(!rows.some((r) => r.source_id === `a:${ids.boundaryReply}`));
}));

test('public retrieval excludes private/inactive communities and moderated parents/replies', () => as(alice, async () => {
  const rows = await search();
  for (const name of ['private', 'inactive', 'archived']) {
    assert(!rows.some((r) => r.question_id === ids[`${name}Question`]));
    assert.equal((await search(ids[name] ?? null, '', [], null, null, 48, ids[`${name}Question`])).length, 0);
  }
  assert(!rows.some((r) => r.source_id === `a:${ids.removedReply}`));
  assert(rows.some((r) => r.question_id === ids.otherQuestion));
}));

test('scoped retrieval never crosses the selected community or post', () => as(alice, async () => {
  assert((await search(ids.public)).every((r) => r.community_id === ids.public));
  assert((await search(null, '', [], null, null, 48, ids.oldQuestion)).every((r) => r.question_id === ids.oldQuestion));
  assert.equal((await search(ids.other, '', [], null, null, 48, ids.oldQuestion)).length, 0);
}));

test('natural-language retrieval retains keyword evidence and exact visa-tag matches', () => as(alice, async () => {
  const rows = await search(ids.public, 'What did members experience with Chennai biometrics?');
  assert(rows.some((r) => r.source_id === `a:${ids.oldReply}`));
  assert((await search(ids.public, 'How did this category work out?', ['h1b'])).some((r) => r.source_id === `q:${ids.oldQuestion}`));
  assert.equal((await search(ids.public, 'xylophonereceipt')).length, 0);
}));

test('future feed moderation filters remain authoritative for assistant reads', () => transaction(async () => {
  const original = await scalar("select pg_get_viewdef('public.question_feed'::regclass,true)");
  await db.exec(`create or replace view public.question_feed with(security_invoker=true) as
    select prior.* from (${original.replace(/;\s*$/, '')}) prior where prior.id<>'${ids.oldQuestion}'::uuid`);
  await actor(alice);
  assert(!(await search()).some((r) => r.question_id === ids.oldQuestion));
}));

test('visibility changes immediately remove old sources, including replies', () => transaction(async () => {
  await actor(alice); assert((await search(ids.public)).length > 0);
  await actor(null, null); await db.query('update public.communities set is_public=false where id=$1', [ids.public]);
  await actor(alice); assert.equal((await search(ids.public)).length, 0);
}));

test('retrieval clamps caller limits and returns a deterministic extra coverage row', () => transaction(async () => {
  await db.exec('set local session_replication_role=replica');
  await db.query(`insert into public.answers(question_id,author_id,body,created_at)
    select $1,$2,'A synthetic reply with enough detail for bounded retrieval.','2026-10-12T12:00:00Z'::timestamptz
    from generate_series(1,70)`, [ids.oldQuestion, bob]);
  await actor(alice);
  const first = await search(null, '', [], null, null, 100000, ids.oldQuestion);
  assert.equal(first.length, 49);
  assert.deepEqual(first, await search(null, '', [], null, null, 100000, ids.oldQuestion));
  assert.equal((await search(null, '', [], null, null, 1, ids.oldQuestion)).length, 2);
}));

test('retrieval rejects missing identity, anonymous role and unbounded intervals', async () => {
  await assert.rejects(() => as(null, () => search()), { code: '42501' });
  await assert.rejects(() => as(null, () => search(), 'anon'), { code: '42501' });
  for (const [start, end] of [[since, null], [null, until], [until, since], ['2026-01-01', until]])
    await assert.rejects(() => as(alice, () => search(null, '', [], start, end)), { code: '22023' });
  await assert.rejects(() => as(alice, () => search(null, 'x'.repeat(1501))), { code: '22023' });
});

test('direct retrieval RPC cannot bypass anonymous, suspension or rate-limit enforcement', async () => {
  await assert.rejects(() => as(alice, () => search(), 'authenticated', true), { code: '42501' });
  await assert.rejects(() => transaction(async () => {
    await db.query('insert into private.community_suspensions(user_id,moderator_id) values($1,$2)', [alice, bob]);
    await actor(alice); await search();
  }), { code: '42501' });
  await transaction(async () => {
    await actor(alice);
    for (let n = 0; n < 30; n++) await search(ids.public, 'Chennai');
    await assert.rejects(() => search(ids.public, 'Chennai'), { code: 'PT429' });
  });
});

test('quota refuses anonymous, missing-profile, missing-subject and suspended accounts', async () => {
  for (const [uid, role, anonymous] of [[null, 'anon', false], [null, 'authenticated', false], [missing, 'authenticated', false], [alice, 'authenticated', true]])
    await assert.rejects(() => as(uid, reserve, role, anonymous), { code: '42501' });
  await assert.rejects(() => transaction(async () => {
    await db.query('insert into private.community_suspensions(user_id,moderator_id) values($1,$2)', [alice, bob]);
    await actor(alice); await reserve();
  }), { code: '42501' });
});

test('pre-retrieval gate accepts 30 requests per minute and keeps generation budgets separate', () => transaction(async () => {
  await actor(alice);
  for (let n = 0; n < 30; n++)
    assert.equal((await db.query('select * from public.check_assistant_request_rate()')).rows[0].allowed, true);
  for (let n = 0; n < 5; n++)
    assert.equal((await db.query('select * from public.check_assistant_request_rate()')).rows[0].allowed, false);
  await actor(bob);
  assert.equal((await db.query('select * from public.check_assistant_request_rate()')).rows[0].allowed, true);
  await actor(null, null);
  assert.equal(await scalar('select count(*)::int from private.assistant_global_usage'), 0);
  assert.equal(await scalar('select requests from private.assistant_request_windows where user_id=$1', [alice]), 30);
  await db.query("update private.assistant_request_windows set minute_start=minute_start-interval '1 minute' where user_id=$1", [alice]);
  await actor(alice);
  assert.equal((await db.query('select * from public.check_assistant_request_rate()')).rows[0].allowed, true);
}));

test('pre-retrieval gate rejects missing, anonymous and unavailable identities', async () => {
  for (const [uid, role, anonymous] of [[null, 'anon', false], [null, 'authenticated', false], [missing, 'authenticated', false], [alice, 'authenticated', true]])
    await assert.rejects(() => as(uid, () => db.query('select * from public.check_assistant_request_rate()'), role, anonymous), { code: '42501' });
  await assert.rejects(() => as(alice, () => db.exec('truncate private.assistant_request_windows')), { code: '42501' });
});

test('a burst allows four reservations and denied calls do not consume global or daily budget', () => transaction(async () => {
  await actor(alice);
  for (let n = 0; n < 4; n++) {
    const row = await reserve(); assert.equal(row.allowed, true); assert.equal(row.remaining_user, 19 - n);
  }
  for (let n = 0; n < 5; n++) {
    const row = await reserve(); assert.equal(row.allowed, false); assert.equal(row.reason, 'user_minute_limit');
  }
  await actor(null, null);
  assert.equal(await scalar('select sum(requests)::int from private.assistant_global_usage'), 4);
  assert.equal(await scalar('select sum(requests)::int from private.assistant_user_usage'), 4);
}));

test('the twentieth daily request is allowed, the twenty-first is denied without spending global budget', () => transaction(async () => {
  await db.exec("insert into private.assistant_global_usage values((now() at time zone 'UTC')::date,19)");
  await db.query("insert into private.assistant_user_usage values((now() at time zone 'UTC')::date,$1,19)", [alice]);
  await actor(alice); assert.equal((await reserve()).allowed, true);
  const denied = await reserve(); assert.equal(denied.allowed, false); assert.equal(denied.reason, 'user_daily_limit');
  await actor(null, null);
  assert.equal(await scalar('select requests from private.assistant_global_usage'), 20);
  assert.equal(await scalar('select requests from private.assistant_user_usage'), 20);
}));

test('the global daily cap is fixed and shared by different authenticated users', () => transaction(async () => {
  await db.exec("insert into private.assistant_global_usage values((now() at time zone 'UTC')::date,499)");
  await actor(alice); assert.equal((await reserve()).allowed, true);
  await actor(bob); const denied = await reserve(); assert.equal(denied.allowed, false); assert.equal(denied.reason, 'global_daily_limit');
  await actor(null, null); assert.equal(await scalar('select requests from private.assistant_global_usage'), 500);
  assert.equal(await scalar('select count(*)::int from private.assistant_user_usage'), 1);
}));

test('UTC quota day/reset is independent of the database session timezone', () => transaction(async () => {
  await db.exec("set local timezone='Pacific/Kiritimati'");
  await actor(alice); const row = await reserve();
  assert.equal(new Date(row.reset_at).getUTCHours(), 0);
  await actor(null, null);
  assert.equal(await scalar("select usage_day=(now() at time zone 'UTC')::date from private.assistant_global_usage"), true);
}));

test('callers cannot reset budgets, forge a quota user or raise their limits', async () => {
  for (const sql of ['select * from private.assistant_global_usage','delete from private.assistant_user_usage',
    'truncate private.assistant_burst_usage','select * from public.reserve_assistant_request(999999)',
    `select * from public.reserve_assistant_request('${bob}'::uuid)`])
    await assert.rejects(() => as(alice, () => db.exec(sql)), /permission denied|does not exist/);
  const definitions = (await db.query(`select n.nspname,p.proname,p.prosecdef,p.proconfig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('assistant_sources','reserve_assistant_request')`)).rows;
  assert.equal(definitions.find((r) => r.proname === 'assistant_sources').prosecdef, false);
  assert.equal(definitions.find((r) => r.proname === 'reserve_assistant_request' && r.nspname === 'public').prosecdef, false);
  assert.equal(definitions.find((r) => r.proname === 'reserve_assistant_request' && r.nspname === 'private').prosecdef, true);
});

import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const db = new PGlite({ extensions: { pg_trgm } });
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const ids = {};
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const migration = name => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
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
    '20261003181839_discussion_latest_reply_indexes.sql','20261006045523_public_community_lifecycle.sql',
    '20261013190102_grounded_assistant_retrieval_and_quotas.sql','20261017071014_assistant_search_intent_filters.sql',
  ]) await db.exec(await migration(name));
  await db.query('insert into auth.users values($1),($2)', [alice, bob]);
  await db.exec('set session_replication_role=replica');
  for (const name of ['public', 'private']) ids[name] = await scalar(`insert into public.communities(name,slug,display_name,is_public) values($1,$1,$1,$2) returning id`, [name, name === 'public']);
  for (const [name, body, date, group] of [
    ['matching', 'My Hyderabad H-1B visa interview completed successfully.', '2026-10-16', 'public'],
    ['old', 'My Hyderabad H1B stamping experience completed successfully.', '2025-01-01', 'public'],
    ['spaced', 'My Hyderabad h 1b stamping completed successfully.', '2026-10-15', 'public'],
    ['otherVisa', 'My Hyderabad H4 stamping completed successfully.', '2026-10-16', 'public'],
    ['unspecifiedVisa', 'My Hyderabad stamping completed successfully.', '2026-10-16', 'public'],
    ['e3', 'My Hyderabad E-3 stamping completed successfully.', '2026-10-16', 'public'],
    ['private', 'My Hyderabad H1B stamping secret report.', '2026-10-16', 'private'],
  ]) ids[name] = await scalar(`insert into public.questions(author_id,title,body,tags,community_id,created_at,updated_at) values($1,$2,$3,array['stamping'],$4,$5,$5) returning id`, [alice, name === 'old' ? 'Hyderabad H1B stamping experience' : 'Member interview report', body, ids[group], date]);
  await db.query(`insert into public.questions(author_id,title,body,tags,community_id,created_at,updated_at)
    select $1,'Recent experience stamping','My recent H1B stamping experience was in Chennai.',array['stamping'],$2,'2026-10-16','2026-10-16' from generate_series(1,70)`, [alice, ids.public]);
  ids.reply = await scalar(`insert into public.answers(author_id,question_id,body,created_at) values($1,$2,'My stamping interview report is complete.','2026-10-16') returning id`, [bob, ids.matching]);
  await db.exec('set session_replication_role=origin');
});
after(() => db.close());
async function asUser(fn, role = 'authenticated', uid = alice) {
  await db.exec('begin');
  try { await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid ?? '']); await db.exec(`set local role ${role}`); return await fn(); }
  finally { await db.exec('rollback'); }
}
const search = (changes = {}) => {
  const options = { text: 'recent experience Hyderabad H1B stamping', locations: ['hyderabad', 'hyd'], visas: ['h1b'], event: 'stamping', newest: true, since: '2026-10-10', until: '2026-10-17', ...changes };
  return db.query('select * from public.assistant_sources_v2(null,$1,array[\'stamping\'],$2,$3,48,null,$4,$5,$6,$7)', [options.text, options.since, options.until, options.locations, options.visas, options.event, options.newest]).then(result => result.rows);
};
test('hard location/visa/event/date constraints precede 49-row cap despite 70 stronger wrong-city matches', () => asUser(async () => {
  const rows = await search();
  assert(rows.some(row => row.question_id === ids.matching));
  assert(rows.some(row => row.question_id === ids.spaced));
  assert(rows.some(row => row.source_id === `a:${ids.reply}`), 'A reply retains visible parent location and visa context');
  assert(rows.every(row => [ids.matching, ids.spaced].includes(row.question_id)));
}));
test('newest ordering precedes relevance and unrestricted latest can expose old evidence honestly', () => asUser(async () => {
  const rows = await search({ since: null, until: null });
  assert(rows.some(row => row.question_id === ids.old));
  assert.notEqual(rows[0].question_id, ids.old);
  assert(rows.every((row, index) => index === 0 || Date.parse(rows[index - 1].created_at) >= Date.parse(row.created_at)));
}));
test('E-3 has the same separator normalization as H-1B', () => asUser(async () => {
  const rows = await search({ text: 'Hyderabad E3 stamping', visas: ['e3'] });
  assert.deepEqual(rows.map(row => row.question_id), [ids.e3]);
}));
test('v2 preserves invoker view moderation and private-community restrictions', async () => {
  await asUser(async () => assert(!(await search()).some(row => row.question_id === ids.private)));
  await db.exec('begin');
  try {
    const definition = await scalar("select pg_get_viewdef('public.question_feed'::regclass,true)");
    await db.exec(`create or replace view public.question_feed with(security_invoker=true) as select prior.* from (${definition.replace(/;\s*$/, '')}) prior where prior.id<>'${ids.matching}'::uuid`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [alice]); await db.exec('set local role authenticated');
    assert(!(await search()).some(row => row.question_id === ids.matching));
  } finally { await db.exec('rollback'); }
});
test('v2 direct RPC rejects missing identity, anon, malformed constraints and oversized windows', async () => {
  await assert.rejects(() => asUser(() => search(), 'anon', null), { code: '42501' });
  await assert.rejects(() => asUser(() => search(), 'authenticated', null), { code: '42501' });
  for (const changes of [{ locations: ['.*'] }, { visas: ['h1b.*'] }, { event: 'arbitrary' }, { since: '2024-01-01' }])
    await assert.rejects(() => asUser(() => search(changes)), { code: '22023' });
});
test('v2 shares the existing request rate gate and leaves v1 intact', () => asUser(async () => {
  assert(await scalar("select to_regprocedure('public.assistant_sources(uuid,text,text[],timestamptz,timestamptz,integer,uuid)') is not null"));
  for (let index = 0; index < 30; index++) await search();
  await assert.rejects(() => search(), { code: 'PT429' });
}));

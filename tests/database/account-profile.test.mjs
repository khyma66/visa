import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const db = new PGlite({ extensions: { pg_trgm } });
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const newcomer = '33333333-3333-4333-8333-333333333333';

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
    '20261004221850_policy_acceptance_receipts.sql',
  ]) await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  await db.query('insert into auth.users values($1),($2),($3)', [alice, bob, newcomer]);
  await db.query(`insert into public.policy_acceptances(user_id,policy_version,market,terms_accepted,privacy_acknowledged,adult_confirmed)
    values($1,'2026-10-04-preview-v1','US',true,true,true),($2,'2026-10-04-preview-v1','US',true,true,true)`, [alice, bob]);
});
after(() => db.close());

async function asRole(role, uid, action) {
  assert(['anon', 'authenticated'].includes(role));
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid ?? '']);
    await db.exec(`set local role ${role}`);
    return await action();
  } finally { await db.exec('rollback'); }
}
const denied = action => assert.rejects(action, error => error.code === '42501');

test('a member who accepted policy can edit and read back their own public bio', () => asRole('authenticated', alice, async () => {
  const { rows } = await db.query('update public.profiles set bio=$1 where id=$2 returning id,bio', ['Learning about visa timelines.', alice]);
  assert.deepEqual(rows, [{ id: alice, bio: 'Learning about visa timelines.' }]);
  assert.equal((await db.query('select bio from public.profiles where id=$1', [alice])).rows[0].bio, rows[0].bio);
}));

test('another account cannot update a member bio by guessing its public ID', () => asRole('authenticated', bob, async () => {
  assert.deepEqual((await db.query('update public.profiles set bio=$1 where id=$2 returning id', ['Unauthorized edit', alice])).rows, []);
}));

test('anonymous callers cannot update public bios', () => denied(() => asRole('anon', null,
  () => db.query('update public.profiles set bio=$1 where id=$2', ['Anonymous edit', alice]))));

for (const [column, value] of [['username', 'escalated-name'], ['reputation', 9999], ['avatar_seed', 'spoofed-avatar'], ['id', bob]]) {
  test(`profile owner cannot escalate bio permission into updating ${column}`, () => denied(() => asRole('authenticated', alice,
    () => db.query(`update public.profiles set ${column}=$1 where id=$2`, [value, alice]))));
}

test('the database independently enforces the public bio length', () => assert.rejects(() => asRole('authenticated', alice,
  () => db.query('update public.profiles set bio=$1 where id=$2', ['x'.repeat(281), alice])), error => error.code === '23514'));

test('an owner can clear their bio', () => asRole('authenticated', alice, async () => {
  assert.deepEqual((await db.query('update public.profiles set bio=null where id=$1 returning bio', [alice])).rows, [{ bio: null }]);
}));

test('bio publishing still requires policy acknowledgement', () => denied(() => asRole('authenticated', newcomer,
  () => db.query('update public.profiles set bio=$1 where id=$2', ['No acknowledgement yet.', newcomer]))));

test('suspension blocks bio publication even for its owner', async () => {
  await db.exec('begin');
  try {
    await db.query('insert into private.community_suspensions(user_id,moderator_id) values($1,$2)', [alice, bob]);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [alice]);
    await db.exec('set local role authenticated');
    await assert.rejects(() => db.query('update public.profiles set bio=$1 where id=$2', ['Suspended edit', alice]), /suspended/);
  } finally { await db.exec('rollback'); }
});

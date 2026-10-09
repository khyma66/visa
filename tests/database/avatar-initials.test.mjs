import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const db = new PGlite({ extensions: { pg_trgm } });
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const unknown = '33333333-3333-4333-8333-333333333333';
const fresh = '44444444-4444-4444-8444-444444444444';
const migration = name => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const avatarMigration = await migration('20261006042952_public_avatar_initials.sql');
const policyMigration = await migration('20261006043113_avatar_name_policy_v2.sql');
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
let handles;
let question;

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    create schema realtime; create table realtime.messages(topic text, extension text, payload jsonb);
    alter table realtime.messages enable row level security;
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
    create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$insert into realtime.messages values(topic,'broadcast',payload);$$;
    grant usage on schema realtime to authenticated; grant select on realtime.messages to authenticated;
    create publication supabase_realtime;`);
  for (const name of [
    '20260904032053_community_core.sql', '20260907191603_secure_community_views.sql',
    '20260910031322_realtime_discovery_and_message_requests.sql', '20260910034701_production_access_hardening.sql',
    '20260910035131_imported_comment_discovery.sql', '20260910055528_launch_safety_and_moderation.sql',
    '20260911050812_community_write_guard_gaps.sql', '20261004221850_policy_acceptance_receipts.sql',
  ]) await db.exec(await migration(name));
  await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2),($3,$4),($5,$6)', [
    alice, JSON.stringify({ full_name: 'Mohana PrivateSurname', name: 'Mohana PrivateSurname' }),
    bob, JSON.stringify({ first_name: 'Élodie', last_name: 'PrivateFamily' }),
    unknown, JSON.stringify({ email: 'not-a-name@example.invalid' }),
  ]);
  await db.query("update public.profiles set avatar_seed=case id when $1 then 'alice-color' when $2 then 'bob-color' else 'unknown-color' end", [alice, bob]);
  handles = (await db.query('select id,username from public.profiles order by id')).rows;
  question = await scalar(`insert into public.questions(author_id,title,body) values($1,'An avatar privacy fixture question','A sufficiently long fixture question to exercise public view projections.') returning id`, [alice]);
  await db.query(`insert into public.answers(question_id,author_id,body) values($1,$2,'An answer to exercise the public avatar projection.')`, [question, bob]);
  await db.query(`insert into public.direct_conversations(user_one_id,user_two_id,request_status,requested_by) values($1,$2,'accepted',$1)`, [alice, bob]);
  await db.query(`insert into public.policy_acceptances(user_id,policy_version,market,terms_accepted,privacy_acknowledged,adult_confirmed)
    values($1,'2026-10-04-preview-v1','US',true,true,true)`, [alice]);
  await db.exec(avatarMigration);
  await db.exec(policyMigration);
});
after(() => db.close());

async function transaction(action) {
  await db.exec('begin');
  try { return await action(); } finally { await db.exec('rollback'); }
}
async function asUser(id, action) {
  return transaction(async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id ?? '']);
    await db.exec(`set local role ${id ? 'authenticated' : 'anon'}`);
    return action();
  });
}

test('backfill exposes one initial and keeps public handles and stable color seeds unchanged', async () => {
  assert.deepEqual((await db.query('select id,username from public.profiles order by id')).rows, handles);
  assert.deepEqual((await db.query('select avatar_seed from public.profiles order by id')).rows.map(row => row.avatar_seed), ['initial:M:alice-color', 'initial:É:bob-color', 'initial:?:unknown-color']);
  const publicData = JSON.stringify((await db.query('select * from public.profiles')).rows);
  assert(!publicData.includes('Mohana') && !publicData.includes('PrivateSurname') && !publicData.includes('PrivateFamily') && !publicData.includes('@'));
});

test('existing question, answer and messaging projections receive the initial without new name fields', async () => {
  assert.equal(await scalar('select author_avatar_seed from public.question_feed where id=$1', [question]), 'initial:M:alice-color');
  assert.equal(await scalar('select author_avatar_seed from public.answer_feed where question_id=$1', [question]), 'initial:É:bob-color');
  await asUser(alice, async () => { assert.equal(await scalar('select other_avatar_seed from public.conversation_inbox'), 'initial:É:bob-color'); });
  await asUser(null, async () => { assert.equal(await scalar('select avatar_seed from public.profiles where id=$1', [alice]), 'initial:M:alice-color'); });
});

test('name metadata is string-only, Unicode aware, email-free and bounded', async () => {
  for (const [metadata, expected] of [
    [{ first_name: '   alice ', given_name: 'Bob' }, 'A'],
    [{ first_name: 17, given_name: '李明' }, '李'],
    [{ first_name: {}, given_name: ['bad'], full_name: 'शिव कुमार' }, 'श'],
    [{ given_name: ' e\u0301lodie ' }, 'É'],
    [{ full_name: '\n\tmarie Curie\n' }, 'M'],
    [{ full_name: null, name: ' Alice Example' }, 'A'],
    [{ first_name: 'name@example.invalid', given_name: 'Bob' }, 'B'],
    [{ first_name: '<script>', full_name: '😀 emoji', email: 'Alice@example.invalid' }, '?'],
    [{ name: 'mail@example.invalid' }, '?'],
    [{ first_name: 'x'.repeat(201) }, '?'],
    [{ first_name: '', last_name: 'NotAFirstName' }, '?'],
    [[], '?'], [null, '?'], ['Alice', '?'], [17, '?'],
  ]) assert.equal(await scalar('select private.avatar_initial_from_metadata($1::jsonb)', [JSON.stringify(metadata)]), expected);
});

test('new account initialization with a caller JWT needs no policy receipt and publishes no full names', () => transaction(async () => {
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [fresh]);
  await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)', [fresh, JSON.stringify({ first_name: 'Zoe', last_name: 'PrivateFamily' })]);
  const row = (await db.query('select username,avatar_seed from public.profiles where id=$1', [fresh])).rows[0];
  assert.match(row.avatar_seed, /^initial:Z:[a-f0-9]{32}$/);
  assert(!row.username.includes('Zoe'));
}));

test('metadata updates can sync appearance before assent and while suspended without changing permissions', () => transaction(async () => {
  await db.query('insert into private.community_suspensions(user_id,moderator_id) values($1,$2)', [bob, alice]);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [bob]);
  await db.query('update auth.users set raw_user_meta_data=$1 where id=$2', [JSON.stringify({ first_name: 'Nadia' }), bob]);
  assert.equal(await scalar('select avatar_seed from public.profiles where id=$1', [bob]), 'initial:N:bob-color');
  assert.equal(await scalar('select count(*)::int from public.policy_acceptances where user_id=$1', [bob]), 0);
  assert.equal(await scalar('select reputation from public.profiles where id=$1', [bob]), 1);
  await db.query('update auth.users set raw_user_meta_data=$1 where id=$2', [JSON.stringify({ first_name: {}, name: 'bad@example.invalid' }), bob]);
  assert.equal(await scalar('select avatar_seed from public.profiles where id=$1', [bob]), 'initial:?:bob-color');
}));

test('same-initial metadata edits do not rewrite profiles or append repeated prefixes', () => transaction(async () => {
  // Fixture-only timestamp setup lets a redundant update be detected even in
  // this one transaction (Postgres now() is otherwise transaction-constant).
  await db.exec('alter table public.profiles disable trigger profiles_touch_updated_at');
  await db.query("update public.profiles set updated_at='2000-01-01' where id=$1", [alice]);
  await db.exec('alter table public.profiles enable trigger profiles_touch_updated_at');
  const before = await scalar('select updated_at::text from public.profiles where id=$1', [alice]);
  await db.query('update auth.users set raw_user_meta_data=$1 where id=$2', [JSON.stringify({ full_name: 'Mary AnotherSurname' }), alice]);
  assert.equal(await scalar('select updated_at::text from public.profiles where id=$1', [alice]), before);
  assert.equal(await scalar('select avatar_seed from public.profiles where id=$1', [alice]), 'initial:M:alice-color');
}));

for (const id of [null, alice]) {
  test(`${id ? 'profile owner' : 'anonymous reader'} cannot write avatar_seed or read private auth metadata`, async () => {
    await assert.rejects(() => asUser(id, () => db.query("update public.profiles set avatar_seed='initial:X:spoofed' where id=$1", [alice])), error => error.code === '42501');
    await assert.rejects(() => asUser(id, () => db.query('select raw_user_meta_data from auth.users')), error => error.code === '42501');
  });
}

test('browser roles cannot execute private avatar helpers or sync triggers', async () => {
  for (const role of ['anon', 'authenticated']) for (const fn of ['private.avatar_initial_from_metadata(jsonb)', 'private.avatar_seed_from_metadata(jsonb,text)', 'private.handle_new_user()', 'private.sync_profile_avatar_initial()']) {
    assert.equal(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')', [role, fn]), false);
  }
});

test('v2 migration preserves old receipts and never claims prior users accepted new terms', async () => {
  assert.deepEqual((await db.query('select user_id,policy_version from public.policy_acceptances')).rows, [{ user_id: alice, policy_version: '2026-10-04-preview-v1' }]);
  await assert.rejects(() => asUser(alice, () => db.query("update public.profiles set bio='An old receipt is insufficient.' where id=$1", [alice])), error => error.code === '42501');
});

test('a fresh v2 receipt enables bio publishing and leaves both versions intact', () => asUser(alice, async () => {
  await db.query(`insert into public.policy_acceptances(user_id,policy_version,market,terms_accepted,privacy_acknowledged,adult_confirmed)
    values($1,'2026-10-06-preview-v2','US',true,true,true)`, [alice]);
  assert.equal((await db.query("update public.profiles set bio='A current acknowledgement.' where id=$1 returning bio", [alice])).rows.length, 1);
  assert.deepEqual((await db.query('select policy_version from public.policy_acceptances order by policy_version')).rows.map(row => row.policy_version), ['2026-10-04-preview-v1', '2026-10-06-preview-v2']);
}));

test('new old-version receipts and impersonated v2 receipts are denied', async () => {
  for (const [user, version] of [[bob, '2026-10-04-preview-v1'], [alice, '2026-10-06-preview-v2']]) {
    await assert.rejects(() => asUser(bob, () => db.query(`insert into public.policy_acceptances(user_id,policy_version,market,terms_accepted,privacy_acknowledged,adult_confirmed)
      values($1,$2,'US',true,true,true)`, [user, version])), error => error.code === '42501');
  }
});

test('the avatar migration removes direct table-level write drift while preserving bio-only permission', async () => {
  await db.exec('grant update on public.profiles to public,authenticated; grant update(avatar_seed) on public.profiles to anon,authenticated;');
  await db.exec(avatarMigration);
  for (const role of ['anon', 'authenticated']) assert.equal(await scalar("select has_column_privilege($1,'public.profiles','avatar_seed','UPDATE')", [role]), false);
  assert.equal(await scalar("select has_column_privilege('authenticated','public.profiles','bio','UPDATE')"), true);
  assert.deepEqual((await db.query('select avatar_seed from public.profiles order by id')).rows.map(row => row.avatar_seed), ['initial:M:alice-color', 'initial:É:bob-color', 'initial:?:unknown-color']);
});

test('an unexpected inherited avatar write grant causes migration rollback', async () => {
  await db.exec('create role avatar_editor; grant update(avatar_seed) on public.profiles to avatar_editor; grant avatar_editor to authenticated;');
  try {
    await assert.rejects(() => db.exec(avatarMigration), /Unexpected inherited avatar write privilege/);
    await db.exec('rollback');
    assert.deepEqual((await db.query('select id,username from public.profiles order by id')).rows, handles);
  } finally {
    await db.exec('rollback; revoke avatar_editor from authenticated; revoke update(avatar_seed) on public.profiles from avatar_editor; drop role avatar_editor;');
  }
});

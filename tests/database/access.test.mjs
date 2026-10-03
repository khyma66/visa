import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';

const db = new PGlite();
const user = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const community = n => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const migration = await readFile(new URL('../../supabase/migrations/20260928164013_community_membership_access_hardening.sql', import.meta.url), 'utf8');
before(async () => {
  await db.exec(await readFile(new URL('./fixture.sql', import.meta.url), 'utf8'));
  await db.exec(migration);
  await db.exec(await readFile(new URL('../../supabase/migrations/20260928164317_revoke_client_table_administration.sql', import.meta.url), 'utf8'));
});
after(() => db.close());

async function asRole(role, uid, fn) {
  assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? '']);
    return await fn();
  } finally { await db.exec('rollback'); }
}
const insert = (c, uid = user, role = 'member', active = true) => db.query(
  'insert into public.community_members (community_id,user_id,role,is_active) values ($1,$2,$3,$4) returning role',
  [community(c), uid, role, active]
);
const denied = fn => assert.rejects(fn, error => error.code === '42501');

test('anonymous discovery exposes only public active communities', async () => {
  await asRole('anon', null, async () => {
    assert.deepEqual((await db.query('select name from public.communities')).rows, [{ name: 'open' }]);
  });
});
test('authenticated nonmember cannot discover private or inactive communities', async () => {
  await asRole('authenticated', user, async () => {
    assert.deepEqual((await db.query('select name from public.communities')).rows, [{ name: 'open' }]);
  });
});
test('active private member can discover their community and only their own membership', async () => {
  await asRole('authenticated', other, async () => {
    assert.deepEqual((await db.query('select name from public.communities order by name')).rows, [{ name: 'open' }, { name: 'private' }]);
    assert.equal((await db.query('select user_id from public.community_members')).rows.length, 1);
  });
});
test('inactive private membership no longer permits discovery', async () => {
  await db.exec('begin');
  try {
    await db.query('update public.community_members set is_active=false where user_id=$1', [other]);
    await db.exec('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [other]);
    assert.deepEqual((await db.query('select name from public.communities')).rows, [{ name: 'open' }]);
  } finally { await db.exec('rollback'); }
});
test('authenticated user can join public community with defaults and see the result', async () => {
  await asRole('authenticated', user, async () => {
    const result = await db.query('insert into public.community_members (community_id,user_id) values ($1,$2) returning role,is_active', [community(1),user]);
    assert.deepEqual(result.rows, [{ role: 'member', is_active: true }]);
    assert.equal((await db.query('select * from public.community_members')).rows.length, 1);
  });
});
for (const role of ['admin','moderator','owner','MEMBER','',null]) {
  test(`self-selected role ${JSON.stringify(role)} is rejected`, () => denied(() => asRole('authenticated', user, () => insert(1,user,role))));
}
for (const n of [2,3,4]) {
  test(`self-join private/inactive/unknown-visibility community ${n} is rejected`, () => denied(() => asRole('authenticated', user, () => insert(n))));
}
test('joining on behalf of another user is rejected', () => denied(() => asRole('authenticated', user, () => insert(1,other))));
test('missing authenticated subject is rejected', () => denied(() => asRole('authenticated', null, () => insert(1))));
test('inactive self-membership is rejected', () => denied(() => asRole('authenticated', user, () => insert(1,user,'member',false))));
test('anonymous membership read is denied', () => denied(() => asRole('anon', null, () => db.query('select * from public.community_members'))));
test('anonymous membership insertion is denied', () => denied(() => asRole('anon', null, () => insert(1))));
test('nonmember cannot read other memberships', async () => {
  await asRole('authenticated', user, async () => assert.equal((await db.query('select * from public.community_members')).rows.length, 0));
});
for (const role of ['anon','authenticated']) {
  for (const sql of [
    'truncate public.community_members cascade',
    'truncate public.communities cascade',
    "update public.community_members set role='admin'",
    'delete from public.community_members',
    "insert into public.communities (name,display_name,slug) values ('bad','bad','bad')",
    'update public.communities set is_public=true',
    'delete from public.communities'
  ]) test(`${role} denied: ${sql}`, () => denied(() => asRole(role,user,() => db.query(sql))));
}
test('server-owned private invitations and role assignment still work', async () => {
  await asRole('service_role', null, async () => {
    assert.equal((await insert(2,user,'moderator')).rows[0].role, 'moderator');
  });
});
test('migration fails closed when an unexpected permissive policy exists', async () => {
  const drift = new PGlite();
  try {
    await drift.exec(await readFile(new URL('./fixture.sql', import.meta.url), 'utf8'));
    await drift.exec('create policy unexpected on public.communities for select using (true)');
    await assert.rejects(() => drift.exec(migration), /policies have drifted/);
    await drift.exec('rollback');
  } finally { await drift.close(); }
});

for (const role of ['anon','authenticated']) {
  test(`${role} cannot truncate legacy tables`, () => denied(() => asRole(role,user,() => db.query('truncate public.legacy_fixture'))));
  test(`${role} legacy administrative grants are removed; row grants are unchanged`, async () => {
    const { rows } = await db.query(`select
      has_table_privilege($1, 'public.legacy_fixture', 'TRUNCATE') as truncate,
      has_table_privilege($1, 'public.legacy_fixture', 'TRIGGER') as trigger,
      has_table_privilege($1, 'public.legacy_fixture', 'REFERENCES') as references,
      has_table_privilege($1, 'public.legacy_fixture', 'SELECT,INSERT,UPDATE,DELETE') as row_access`, [role]);
    assert.deepEqual(rows, [{ truncate:false, trigger:false, references:false, row_access:true }]);
  });
}
test('service role retains legacy administration privileges', async () => {
  assert.equal((await db.query("select has_table_privilege('service_role','public.legacy_fixture','TRUNCATE') as allowed")).rows[0].allowed, true);
});
test('read-only release checks continue to flag unfixed legacy row access', async () => {
  const sql = await readFile(new URL('../../supabase/checks/production_blockers.sql', import.meta.url), 'utf8');
  const { rows } = await db.query(sql);
  assert.ok(rows.some(r => r.check_name === 'exposed_table_without_rls' && r.object_name === 'public.legacy_fixture'));
  assert.ok(!rows.some(r => r.check_name === 'client_table_administration'));
});

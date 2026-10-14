import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
before(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;
    create function private.community_consume(text,integer,integer) returns void language sql as $$select$$;
    create table public.questions(id integer, body text); grant insert on public.questions to authenticated;
    insert into auth.users values('${alice}'),('${bob}');`);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261004221850_policy_acceptance_receipts.sql',import.meta.url),'utf8'));
  await db.exec('create trigger guard before insert on public.questions for each row execute function private.community_write_guard()');
});
after(() => db.close());
async function as(role, uid, fn) {
  await db.exec('begin');
  try { await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]); await db.exec(`set local role ${role}`); return await fn(); }
  finally { await db.exec('rollback'); }
}
const insert = (uid=alice, version='2026-10-04-preview-v1', market='US', adult=true) => db.query(`insert into public.policy_acceptances(user_id,policy_version,market,terms_accepted,privacy_acknowledged,adult_confirmed) values($1,$2,$3,true,true,$4)`,[uid,version,market,adult]);
test('anonymous cannot read or record receipts', async () => {
  await assert.rejects(() => as('anon','',() => db.query('select * from public.policy_acceptances')));
  await assert.rejects(() => as('anon','',() => insert()));
});
test('direct API publication denied without receipt, allowed after current acknowledgement', () => as('authenticated',alice,async () => {
  await db.exec('savepoint before_denial');
  await assert.rejects(() => db.query("insert into questions values(1,'body')"), /acknowledge/);
  await db.exec('rollback to before_denial');
  await insert();
  await db.query("insert into questions values(1,'body')");
  const rows=(await db.query('select * from public.policy_acceptances')).rows;
  assert.equal(rows.length,1); assert(rows[0].accepted_at); assert.equal(rows[0].user_id,alice);
}));
for (const [label,args] of [['other identity',[bob]],['old version',[alice,'old']],['future version',[alice,'2099']],['unopened market',[alice,'2026-10-04-preview-v1','GB']],['underage declaration',[alice,'2026-10-04-preview-v1','US',false]]]) {
  test(`rejects ${label}`, () => assert.rejects(() => as('authenticated',alice,() => insert(...args))));
}
test('receipt cannot be edited, deleted or timestamp-forged by the member', async () => {
  for(const query of ["update policy_acceptances set market='US'",'delete from policy_acceptances',`insert into policy_acceptances values('${alice}','2026-10-04-preview-v1','US',true,true,true,'2000-01-01')`])
    await assert.rejects(() => as('authenticated',alice,() => db.query(query)));
});
test('receipts are private to their account', () => as('authenticated',alice,async () => {
  await insert(); await db.query("select set_config('request.jwt.claim.sub',$1,true)",[bob]);
  assert.equal((await db.query('select * from policy_acceptances')).rows.length,0);
}));

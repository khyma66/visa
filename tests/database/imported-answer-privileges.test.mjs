import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const migration = name => readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8');
const fix = await migration('20261016021725_imported_answer_write_privileges.sql');
const original = await migration('20260910031322_realtime_discovery_and_message_requests.sql');
const excerpt = expression => { const match=original.match(expression); assert(match,'Actual source SQL must exist'); return match[0]; };
let existingReply;

async function asRole(role, uid, callback) {
  assert(['anon','authenticated','service_role'].includes(role));
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid ?? '']);
    await db.exec(`set local role ${role}`);
    return await callback();
  } finally { await db.exec('rollback'); }
}
const insertReply = (author=alice) => db.query(`insert into public.imported_answers(question_id,author_id,body)
  values('apify-security-fixture',$1,'A real community reply with a sufficiently long body.') returning *`,[author]);

before(async () => {
  // Local PostgreSQL only. The actual archive table, policies, feed and guard
  // migrations are used; no hosted credentials or production identities exist.
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated,service_role;
    create table public.profiles(id uuid primary key,username text,avatar_seed text);
    grant select on public.profiles to anon,authenticated,service_role;
    create function private.community_consume(text,integer,integer) returns void language sql as $$select$$;
    create table public.answers(id uuid primary key default gen_random_uuid(),question_id uuid,author_id uuid,body text,
      vote_score integer default 0,is_accepted boolean default false);
    alter table public.answers enable row level security;
    create policy own_answer on public.answers for insert to authenticated with check(author_id=(select auth.uid()));
    create policy read_answer on public.answers for select to anon,authenticated using(true);
    grant select on public.answers to anon,authenticated;
    grant insert(question_id,author_id,body) on public.answers to authenticated;`);
  await db.exec(excerpt(/create table public\.imported_answers \([\s\S]*?\n\);/));
  await db.exec('alter table public.imported_answers enable row level security;');
  await db.exec(excerpt(/create policy imported_answers_read[\s\S]*?;/));
  await db.exec(excerpt(/create policy imported_answers_insert[\s\S]*?;/));
  await db.exec(excerpt(/create view public\.imported_answer_feed[\s\S]*?;/));
  // Reproduce the observed legacy default-grant failure rather than testing an
  // already-safe fixture. Column grants coexist with the table-wide grant.
  await db.exec(`grant select,insert,update,delete,maintain on public.imported_answers,public.imported_answer_feed to anon,authenticated;
    grant all on public.imported_answers,public.imported_answer_feed to service_role;
    grant insert(question_id,author_id,body) on public.imported_answers to authenticated;`);
  await db.exec(await migration('20261004221850_policy_acceptance_receipts.sql'));
  await db.exec(await migration('20261006043113_avatar_name_policy_v2.sql'));
  await db.exec(`create trigger community_imported_answer_limit before insert or update of body on public.imported_answers
    for each row execute function private.community_write_guard();`);
  await db.query('insert into auth.users values($1),($2)',[alice,bob]);
  await db.query("insert into public.profiles values($1,'alice-fixture','A'),($2,'bob-fixture','B')",[alice,bob]);
  await db.query(`insert into public.policy_acceptances(user_id,policy_version,market,terms_accepted,privacy_acknowledged,adult_confirmed)
    values($1,'2026-10-06-preview-v2','US',true,true,true)`,[alice]);
  existingReply=(await db.query(`insert into public.imported_answers(question_id,author_id,body)
    values('apify-preserved',$1,'An existing reply that must survive permissions hardening.') returning *`,[alice])).rows[0];
  await asRole('authenticated',alice,async () => {
    const {rows:[spoof]}=await db.query(`insert into public.imported_answers(question_id,author_id,body,vote_score,is_accepted,created_at)
      values('apify-spoof-before',$1,'This local regression demonstrates the old vulnerability.',999,true,'2099-01-01') returning *`,[alice]);
    assert.equal(spoof.vote_score,999); assert.equal(spoof.is_accepted,true);
  });
  await db.exec(fix);
});
after(() => db.close());

test('normal archive reply uses server-owned defaults and remains retrievable', () => asRole('authenticated',alice,async () => {
  const {rows:[reply]}=await insertReply();
  assert.equal(reply.author_id,alice); assert.equal(reply.vote_score,0);
  assert.equal(reply.is_accepted,false); assert.equal(reply.status,'active');
  assert(reply.id); assert(reply.created_at); assert.deepEqual(reply.topic_tags,[]);
  const {rows:[visible]}=await db.query('select * from public.imported_answer_feed where id=$1',[reply.id]);
  assert.equal(visible.body,reply.body); assert.equal(visible.author_username,'alice-fixture');
}));

for (const [column,value] of [
  ['vote_score','999'],['is_accepted','true'],['created_at',"'2099-01-01'"],['updated_at',"'2099-01-01'"],
  ['status',"'archived'"],['id',"'33333333-3333-4333-8333-333333333333'"],['topic_tags',"array['forged']"],
]) test(`client cannot choose archive reply ${column}`, () => assert.rejects(() => asRole('authenticated',alice,() => db.query(
  `insert into public.imported_answers(question_id,author_id,body,${column}) values('apify-denied',$1,'A sufficiently long reply intended for a metadata test.',${value})`,[alice])),error=>error.code==='42501'));

test('RLS still rejects author impersonation', () => assert.rejects(() => asRole('authenticated',alice,()=>insertReply(bob)),error=>error.code==='42501'));
test('policy acknowledgement is still required', () => assert.rejects(() => asRole('authenticated',bob,()=>insertReply(bob)),/acknowledge/));
test('anonymous reply creation is denied', () => assert.rejects(() => asRole('anon','',()=>insertReply()),error=>error.code==='42501'));

for(const role of ['anon','authenticated']) test(`${role} has no table-wide writes or administration on archive relations`, async () => {
  for(const relation of ['imported_answers','imported_answer_feed']) {
    for(const operation of ['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) {
      const {rows:[row]}=await db.query('select has_table_privilege($1,$2,$3) allowed',[role,`public.${relation}`,operation]);
      assert.equal(row.allowed,false,`${role} ${relation} ${operation}`);
    }
    const {rows:[row]}=await db.query("select has_table_privilege($1,$2,'SELECT') allowed",[role,`public.${relation}`]);
    assert.equal(row.allowed,true);
  }
});

test('feed writes are denied rather than exposing another insert path', async () => {
  for(const operation of [
    "insert into public.imported_answer_feed(question_id,author_id,body) values('apify-denied',$1,'A sufficiently long reply through the wrong endpoint.')",
    "update public.imported_answer_feed set vote_score=999 where author_id=$1",
    'delete from public.imported_answer_feed where author_id=$1',
  ]) await assert.rejects(() => asRole('authenticated',alice,()=>db.query(operation,[alice])),
    error=>error.code==='42501' || (error.code==='55000' && /cannot (insert into|update|delete from) view/.test(error.message)));
});

test('native answer insertion and its protected metadata remain unchanged', async () => {
  await asRole('authenticated',alice,async () => {
    const {rows:[answer]}=await db.query(`insert into public.answers(question_id,author_id,body)
      values($1,$2,'A normal native reply remains supported.') returning *`,[bob,alice]);
    assert.equal(answer.author_id,alice); assert.equal(answer.vote_score,0);
  });
  await assert.rejects(() => asRole('authenticated',alice,()=>db.query(`insert into public.answers(question_id,author_id,body,vote_score)
    values($1,$2,'Metadata cannot be forged on native answers either.',999)`,[bob,alice])),error=>error.code==='42501');
});

test('service access, existing content, RLS, view mode and repeated application are preserved', async () => {
  await db.exec(fix);
  const {rows:[after]}=await db.query('select * from public.imported_answers where id=$1',[existingReply.id]);
  assert.deepEqual(after,existingReply);
  const {rows:[table]}=await db.query("select relrowsecurity from pg_class where oid='public.imported_answers'::regclass");
  assert.equal(table.relrowsecurity,true);
  const {rows:[view]}=await db.query("select reloptions from pg_class where oid='public.imported_answer_feed'::regclass");
  assert(view.reloptions.includes('security_invoker=true'));
  const {rows:[service]}=await db.query("select has_table_privilege('service_role','public.imported_answers','INSERT,UPDATE,DELETE') allowed");
  assert.equal(service.allowed,true);
  await asRole('service_role','',async () => {
    const {rows:[reply]}=await db.query(`insert into public.imported_answers(question_id,author_id,body,vote_score)
      values('apify-service',$1,'The privileged maintenance path remains intact.',7) returning vote_score`,[alice]);
    assert.equal(reply.vote_score,7);
  });
});

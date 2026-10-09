import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const db = new PGlite({ extensions: { pg_trgm } });
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const eve = '33333333-3333-4333-8333-333333333333';
const ids = {};
const scalar = async (query, args = []) => Object.values((await db.query(query, args)).rows[0])[0];
const migration = (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

before(async () => {
  // Platform stubs exercise actual PostgreSQL policies/functions, not HTTP mocks.
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
  ]) await db.exec(await migration(name));
  await db.query('insert into auth.users values($1),($2),($3)', [alice, bob, eve]);
  await db.query('insert into private.community_moderators values($1)', [eve]);
  for (const status of ['open', 'closed', 'archived']) {
    const question = await scalar(`insert into public.questions(author_id,title,body,tags,status)
      values($1,$2,'Parent visibility fixture with a sufficiently long body.',array['timeline'],$3) returning id`,
    [alice, `${status} parent visibility fixture`, status]);
    const answer = await scalar(`insert into public.answers(question_id,author_id,body)
      values($1,$2,'A relevant RFE request for evidence response for this thread.') returning id`, [question, bob]);
    ids[status] = { question, answer };
    await db.query('insert into public.question_votes(question_id,user_id,value) values($1,$2,1)', [question, eve]);
    await db.query('insert into public.answer_votes(answer_id,user_id,value) values($1,$2,1)', [answer, eve]);
  }
  ids.hiddenAnswer = await scalar(`insert into public.answers(question_id,author_id,body,status)
    values($1,$2,'A removed answer mentioning biometrics should not be discoverable.','archived') returning id`, [ids.open.question, bob]);
  await db.query('insert into public.answer_votes(answer_id,user_id,value) values($1,$2,1)', [ids.hiddenAnswer, eve]);
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

for (const role of ['anon', 'authenticated']) {
  test(`${role} reads open/closed answers but cannot read archived parents or answers`, () => asRole(role, bob, async () => {
    for (const table of ['answers', 'answer_feed']) {
      const rows = (await db.query(`select id from public.${table} order by id`)).rows.map((row) => row.id);
      assert.deepEqual(rows, [ids.open.answer, ids.closed.answer].sort());
      assert.equal(await scalar(`select count(*)::integer from public.${table} where question_id=$1`, [ids.archived.question]), 0);
    }
  }));
  test(`${role} discovery and public feed do not expose archived parent/comment content`, () => asRole(role, bob, async () => {
    const rows = (await db.query("select * from public.discover_questions(null,array['rfe'],array['rfe'])")).rows;
    assert.deepEqual(rows.map((row) => row.id).sort(), [ids.open.question, ids.closed.question].sort());
    assert.equal((await db.query("select * from public.discover_questions(null,array['biometrics'],array['biometrics'])")).rows.length, 0);
    const feed = (await db.query('select id from public.community_question_page()')).rows;
    assert(!feed.some((row) => row.id === ids.archived.question));
  }));
}

test('a signed-in author can answer an open question', () => asRole('authenticated', bob, async () => {
  const inserted = await scalar(`insert into public.answers(question_id,author_id,body)
    values($1,$2,'A new answer on an open question remains permitted.') returning id`, [ids.open.question, bob]);
  assert(inserted);
}));
for (const status of ['closed', 'archived']) {
  test(`a guessed ${status} question ID cannot receive answers`, () => denied(() => asRole('authenticated', bob, () => db.query(
    'insert into public.answers(question_id,author_id,body) values($1,$2,$3)',
    [ids[status].question, bob, 'A sufficiently long answer that should be rejected.']))));
  test(`an existing answer on a ${status} question cannot be edited`, () => asRole('authenticated', bob, async () => {
    assert.equal((await db.query('update public.answers set body=$1 where id=$2 returning id',
      ['Changed answer content that must not be saved here.', ids[status].answer])).rows.length, 0);
  }));
  test(`the author cannot accept an answer on a ${status} question`, () => asRole('authenticated', alice,
    () => assert.rejects(() => db.query('select public.accept_answer($1)', [ids[status].answer]), /open question/)));
}
test('answer owner can edit an open answer, but cannot edit another author or archived answer', () => asRole('authenticated', bob, async () => {
  assert.equal((await db.query('update public.answers set body=$1 where id=$2 returning id',
    ['Updated answer text on the open question is permitted.', ids.open.answer])).rows.length, 1);
  assert.equal((await db.query('update public.answers set body=$1 where id=$2 returning id',
    ['Archived answer text must remain unavailable to its author.', ids.hiddenAnswer])).rows.length, 0);
}));
test('ownership cannot be spoofed when answering', () => denied(() => asRole('authenticated', eve, () => db.query(
  'insert into public.answers(question_id,author_id,body) values($1,$2,$3)',
  [ids.open.question, bob, 'A forged author must be denied by the owner policy.']))));
test('another user cannot edit or accept someone else\'s answer', () => asRole('authenticated', eve, async () => {
  assert.equal((await db.query('update public.answers set body=$1 where id=$2 returning id',
    ['Unauthorized update to another community member answer.', ids.open.answer])).rows.length, 0);
  await assert.rejects(() => db.query('select public.accept_answer($1)', [ids.open.answer]), /author/);
}));
test('question author can still accept an active answer on an open question', () => asRole('authenticated', alice, async () => {
  await db.query('select public.accept_answer($1)', [ids.open.answer]);
  assert.equal(await scalar('select is_accepted from public.answers where id=$1', [ids.open.answer]), true);
  assert.equal(await scalar('select accepted_answer_id from public.questions where id=$1', [ids.open.question]), ids.open.answer);
}));
test('question author cannot accept a removed answer', () => asRole('authenticated', alice,
  () => assert.rejects(() => db.query('select public.accept_answer($1)', [ids.hiddenAnswer]), /author|available/)));

for (const kind of ['question', 'answer']) {
  const column = `${kind}_id`, table = `${kind}_votes`;
  for (const status of ['open', 'closed']) {
    test(`${kind} voting is retained for ${status} visible threads`, () => asRole('authenticated', eve, async () => {
      assert.equal((await db.query(`update public.${table} set value=-1 where ${column}=$1 returning value`, [ids[status][kind]])).rows[0].value, -1);
    }));
  }
  test(`${kind} votes on an archived parent are not readable or editable`, () => asRole('authenticated', eve, async () => {
    assert.equal(await scalar(`select count(*)::integer from public.${table} where ${column}=$1`, [ids.archived[kind]]), 0);
    assert.equal((await db.query(`update public.${table} set value=-1 where ${column}=$1 returning value`, [ids.archived[kind]])).rows.length, 0);
    assert.equal((await db.query(`delete from public.${table} where ${column}=$1 returning value`, [ids.archived[kind]])).rows.length, 0);
  }));
  test(`${kind} vote insertion against an archived parent is denied`, () => denied(() => asRole('authenticated', bob, () => db.query(
    `insert into public.${table}(${column},user_id,value) values($1,$2,1)`, [ids.archived[kind], bob]))));
}
test('votes on a removed answer are hidden even when the parent is open', () => asRole('authenticated', eve, async () => {
  assert.equal(await scalar('select count(*)::integer from public.answer_votes where answer_id=$1', [ids.hiddenAnswer]), 0);
}));
test('new votes on a removed answer are denied', () => denied(() => asRole('authenticated', eve, () => db.query(
  'insert into public.answer_votes(answer_id,user_id,value) values($1,$2,1)', [ids.hiddenAnswer, eve]))));

test('moderating a question immediately hides existing answers and votes without deleting them', () => asRole('authenticated', bob, async () => {
  const report = await scalar("select public.report_community_content('question',$1,'personal-information')", [ids.open.question]);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [eve]);
  await db.query("select public.moderate_community_report($1,'removed',false)", [report]);
  assert.equal(await scalar('select count(*)::integer from public.question_votes where question_id=$1', [ids.open.question]), 0);
  assert.equal(await scalar('select count(*)::integer from public.answer_votes where answer_id=$1', [ids.open.answer]), 0);
  await db.exec('set local role anon');
  for (const table of ['answers', 'answer_feed']) {
    assert.equal(await scalar(`select count(*)::integer from public.${table} where question_id=$1`, [ids.open.question]), 0);
  }
}));

test('migration does not delete content or change existing moderation statuses', async () => {
  assert.equal(await scalar('select count(*)::integer from public.questions'), 3);
  assert.equal(await scalar('select count(*)::integer from public.answers'), 4);
  assert.equal(await scalar("select count(*)::integer from public.questions where status='archived'"), 1);
  assert.equal(await scalar("select count(*)::integer from public.answers where status='archived'"), 1);
});

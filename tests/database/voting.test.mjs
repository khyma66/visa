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
    '20261003180348_secure_native_vote_rpcs.sql',
  ]) await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  await db.query('insert into auth.users values($1),($2),($3)', [alice, bob, suspended]);
  await db.query('insert into private.community_suspensions(user_id,moderator_id) values($1,$2)', [suspended, alice]);
  for (const status of ['open', 'closed', 'archived']) {
    const question = await scalar(`insert into public.questions(author_id,title,body,status)
      values($1,$2,'Voting fixture with a sufficiently long public question body.',$3) returning id`,
    [alice, `${status} voting fixture question`, status]);
    const answer = await scalar(`insert into public.answers(question_id,author_id,body)
      values($1,$2,'An answer with enough detail for the secure vote fixture.') returning id`, [question, bob]);
    ids[status] = { question, answer };
  }
  ids.hiddenAnswer = await scalar(`insert into public.answers(question_id,author_id,body,status)
    values($1,$2,'This answer has been removed and cannot receive votes.','archived') returning id`, [ids.open.question, bob]);
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

for (const kind of ['question', 'answer']) {
  const rpc = `public.vote_${kind}`, table = `public.${kind}_votes`, column = `${kind}_id`;
  test(`${kind} RPC inserts, repeats, changes and sums votes without duplicate voters`, () => asRole('authenticated', alice, async () => {
    const id = ids.open[kind];
    assert.equal(await scalar(`select ${rpc}($1,1)`, [id]), 1);
    assert.equal(await scalar(`select ${rpc}($1,1)`, [id]), 1);
    assert.equal(await scalar(`select ${rpc}($1,-1)`, [id]), -1);
    assert.deepEqual((await db.query(`select user_id,value from ${table} where ${column}=$1`, [id])).rows,
      [{ user_id: alice, value: -1 }]);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [bob]);
    assert.equal(await scalar(`select ${rpc}($1,1)`, [id]), 0);
    assert.deepEqual((await db.query(`select user_id,value from ${table} where ${column}=$1`, [id])).rows,
      [{ user_id: bob, value: 1 }]);
    await db.exec('reset role');
    assert.equal(await scalar(`select count(*)::integer from ${table} where ${column}=$1`, [id]), 2);
  }));
  test(`${kind} RPC remains usable on closed visible questions`, () => asRole('authenticated', alice,
    async () => assert.equal(await scalar(`select ${rpc}($1,1)`, [ids.closed[kind]]), 1)));
  test(`${kind} RPC cannot vote on an archived parent`, () => denied(() => asRole('authenticated', alice,
    () => db.query(`select ${rpc}($1,1)`, [ids.archived[kind]]))));
  test(`${kind} RPC does not let anonymous visitors vote`, () => denied(() => asRole('anon', null,
    () => db.query(`select ${rpc}($1,1)`, [ids.open[kind]]))));
  test(`${kind} RPC rejects a missing authenticated subject`, () => denied(() => asRole('authenticated', null,
    () => db.query(`select ${rpc}($1,1)`, [ids.open[kind]]))));
  for (const value of [null, 0, -2, 2, 999]) {
    test(`${kind} RPC rejects invalid vote ${value}`, () => asRole('authenticated', alice,
      () => assert.rejects(() => db.query(`select ${rpc}($1,$2)`, [ids.open[kind], value]), (error) => error.code === '22023')));
  }
  test(`${kind} RPC preserves the suspension guard`, () => asRole('authenticated', suspended,
    () => assert.rejects(() => db.query(`select ${rpc}($1,1)`, [ids.open[kind]]), /suspended/)));
  test(`${kind} RPC preserves rate limiting`, () => asRole('authenticated', alice, async () => {
    await db.exec('reset role');
    await db.query(`insert into private.community_rate_windows(user_id,action,window_start,used)
      values($1,'vote',to_timestamp(floor(extract(epoch from now()) / 60) * 60),120)`, [alice]);
    await db.exec('set local role authenticated');
    await assert.rejects(() => db.query(`select ${rpc}($1,1)`, [ids.open[kind]]), /Too many requests/);
  }));
  test(`${kind} RPC is security invoker and voter/target columns remain immutable`, async () => {
    assert.equal(await scalar('select prosecdef from pg_proc where oid=$1::regprocedure', [`${rpc}(uuid,integer)`]), false);
    for (const field of [column, 'user_id']) {
      assert.equal(await scalar("select has_column_privilege('authenticated',$1,$2,'UPDATE')", [table, field]), false);
    }
  });
  test(`${kind} generic browser upsert stays denied rather than widening key-column privileges`, () => denied(() => asRole('authenticated', alice,
    () => db.query(`insert into ${table}(${column},user_id,value) values($1,$2,1)
      on conflict(${column},user_id) do update set ${column}=excluded.${column},user_id=excluded.user_id,value=excluded.value`,
    [ids.open[kind], alice]))));
}

test('answer RPC cannot vote on a removed answer under an open parent', () => denied(() => asRole('authenticated', alice,
  () => db.query('select public.vote_answer($1,1)', [ids.hiddenAnswer]))));

test('browser vote methods use the RPC result and never submit the supplied user ID', async () => {
  const source = await readFile(new URL('../../src/lib/community.ts', import.meta.url), 'utf8');
  const methods = source.slice(source.indexOf('export async function voteQuestion('), source.indexOf('export async function acceptAnswer('));
  const prefix = `const isSupabaseConfigured=true; const getSupabase=()=>globalThis.__voteRpcFixture;
    function throwIfError(error) { if(error) throw new Error(error.message); }`;
  const js = ts.transpileModule(prefix + methods, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  const client = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  const calls = [];
  globalThis.__voteRpcFixture = { rpc: async (name, args) => { calls.push({ name, args }); return { data: 0, error: null }; } };
  try {
    assert.equal(await client.voteQuestion(ids.open.question, 'forged-other-user', 1), 0);
    assert.equal(await client.voteAnswer(ids.open.answer, 'forged-other-user', -1), 0);
    assert.deepEqual(calls, [
      { name: 'vote_question', args: { target_question_id: ids.open.question, vote_value: 1 } },
      { name: 'vote_answer', args: { target_answer_id: ids.open.answer, vote_value: -1 } },
    ]);
    globalThis.__voteRpcFixture.rpc = async () => ({ data: null, error: { message: 'Vote denied' } });
    await assert.rejects(() => client.voteQuestion(ids.open.question, alice, 1), /Vote denied/);
    globalThis.__voteRpcFixture.rpc = async () => ({ data: null, error: null });
    await assert.rejects(() => client.voteAnswer(ids.open.answer, alice, 1), /could not be confirmed/);
  } finally { delete globalThis.__voteRpcFixture; }
});

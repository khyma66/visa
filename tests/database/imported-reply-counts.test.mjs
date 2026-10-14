import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';

const db = new PGlite();
const visibleAuthor = '11111111-1111-4111-8111-111111111111';
const hiddenAuthor = '22222222-2222-4222-8222-222222222222';
const missingAuthor = '33333333-3333-4333-8333-333333333333';
const source = await readFile(new URL('../../src/lib/community.ts', import.meta.url), 'utf8');
const presentation = await readFile(new URL('../../src/lib/post-presentation.ts', import.meta.url), 'utf8');

before(async () => {
  // Minimal real RLS/profile-join fixture, with the actual feed definition and
  // actual new migration. This never connects to a hosted Supabase project.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create role unrelated;
    create table public.profiles(id uuid primary key,username text,avatar_seed text,visible boolean);
    create table public.imported_answers(
      id bigint generated always as identity primary key,question_id text,author_id uuid,
      body text,vote_score integer default 0,is_accepted boolean default false,
      status text default 'active',created_at timestamptz default now(),updated_at timestamptz default now()
    );
    create index imported_answers_thread_idx on public.imported_answers(question_id,created_at desc,id);
    alter table public.profiles enable row level security;
    alter table public.imported_answers enable row level security;
    create policy public_profiles on public.profiles for select to anon,authenticated using(visible);
    create policy active_replies on public.imported_answers for select to anon,authenticated
      using(status='active' and question_id <> 'apify-rls-hidden');
    grant select on public.profiles,public.imported_answers to anon,authenticated,service_role;
  `);
  const original = await readFile(new URL('../../supabase/migrations/20260910031322_realtime_discovery_and_message_requests.sql', import.meta.url), 'utf8');
  const feed = original.match(/create view public\.imported_answer_feed[\s\S]*?;/)?.[0];
  assert(feed, 'The real source feed definition must be present');
  await db.exec(feed);
  await db.exec('grant select on public.imported_answer_feed to anon,authenticated,service_role;');
  await db.exec(await readFile(new URL('../../supabase/migrations/20261013185131_imported_reply_counts.sql', import.meta.url), 'utf8'));
  await db.query('insert into public.profiles values($1,\'public-pseudonym\',\'seed-one\',true),($2,\'private-pseudonym\',\'seed-two\',false)', [visibleAuthor, hiddenAuthor]);
  await db.query(`insert into public.imported_answers(question_id,author_id,body)
    select 'apify-large',$1,'Body must not be exposed by the count view ' || n from generate_series(1,125) n`, [visibleAuthor]);
  await db.query(`insert into public.imported_answers(question_id,author_id,body,status) values
    ('apify-small',$1,'Visible reply one','active'),('apify-small',$1,'Visible reply two','active'),
    ('apify-small',$1,'Archived reply must not be counted','archived'),
    ('apify-small',$2,'Hidden profile must not be counted','active'),
    ('apify-small',$3,'Missing profile must not be counted','active'),
    ('apify-rls-hidden',$1,'RLS-hidden row must not be counted','active'),
    ('apify-only-archived',$1,'Only archived reply','archived')`, [visibleAuthor, hiddenAuthor, missingAuthor]);
});
after(() => db.close());

async function asRole(role, callback) {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    return await callback();
  } finally { await db.exec('rollback'); }
}

for (const role of ['anon', 'authenticated']) {
  test(`${role} exact imported counts match the retrievable feed, including more than one page`, () => asRole(role, async () => {
    const { rows } = await db.query('select * from public.imported_reply_counts order by question_id');
    assert.deepEqual(rows.map(row => ({ ...row, answer_count: Number(row.answer_count) })), [
      { question_id: 'apify-large', answer_count: 125 },
      { question_id: 'apify-small', answer_count: 2 },
    ]);
    const actual = await db.query('select question_id,count(*)::bigint as answer_count from public.imported_answer_feed group by question_id order by question_id');
    assert.deepEqual(rows, actual.rows);
    assert(rows.every(row => Object.keys(row).sort().join(',') === 'answer_count,question_id'));
    assert(!JSON.stringify(rows).includes('pseudonym'));
  }));
  test(`${role} count reads are granted without insert, update, delete or truncate`, async () => {
    const { rows: [privileges] } = await db.query(`select
      has_table_privilege($1,'public.imported_reply_counts','SELECT') as can_read,
      has_table_privilege($1,'public.imported_reply_counts','INSERT') as can_insert,
      has_table_privilege($1,'public.imported_reply_counts','UPDATE') as can_update,
      has_table_privilege($1,'public.imported_reply_counts','DELETE') as can_delete,
      has_table_privilege($1,'public.imported_reply_counts','TRUNCATE') as can_truncate`, [role]);
    assert.deepEqual(privileges, { can_read: true, can_insert: false, can_update: false, can_delete: false, can_truncate: false });
  });
}
test('the count view preserves security-invoker behavior and does not grant PUBLIC access', async () => {
  const { rows: [view] } = await db.query("select reloptions from pg_class where oid='public.imported_reply_counts'::regclass");
  assert(view.reloptions.includes('security_invoker=true'));
  const { rows: [permission] } = await db.query("select has_table_privilege('unrelated','public.imported_reply_counts','SELECT') as can_read");
  assert.equal(permission.can_read, false);
  await asRole('unrelated', () => assert.rejects(db.query('select * from public.imported_reply_counts'), /permission denied/));
  // Privileged visibility differs, proving the anon/auth checks exercise RLS
  // rather than coincidentally matching unfiltered fixture totals.
  const { rows: [full] } = await db.query("select answer_count from public.imported_reply_counts where question_id='apify-small'");
  assert.equal(Number(full.answer_count), 3);
});
test('a filtered count lookup returns just the requested archive groups', () => asRole('anon', async () => {
  const { rows } = await db.query('select * from public.imported_reply_counts where question_id=any($1::text[])', [['apify-small', 'apify-no-replies', 'apify-only-archived']]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].question_id, 'apify-small');
  assert.equal(Number(rows[0].answer_count), 2);
}));

function declaration(text, name) {
  const tree = ts.createSourceFile('fixture.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert(node, `Missing actual function ${name}`);
  return node.getText(tree);
}
function compileHelper(configured) {
  const code = `const isSupabaseConfigured=${configured};
    const getSupabase=()=>globalThis.__replyCountBackend;
    ${declaration(source, 'throwIfError')}
    ${declaration(presentation, 'isImportedPost')}
    ${declaration(source, 'withMemberReplyCounts')}`;
  const output = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}
const helper = await compileHelper(true);
const demoHelper = await compileHelper(false);
function archiveQuestion(index, extra = {}) {
  return Object.freeze({ id: `apify-${index}`, source: 'apify', answer_count: 2, source_comment_count: 900, extra: 'preserved', ...extra });
}
async function withBackend(respond, callback) {
  const calls = [];
  globalThis.__replyCountBackend = { from(table) {
    assert.equal(table, 'imported_reply_counts');
    let ids;
    const builder = {
      select(fields) { assert.equal(fields, 'question_id,answer_count'); return builder; },
      in(field, values) { assert.equal(field, 'question_id'); ids = [...values]; assert(ids.length > 0 && ids.length <= 100); return builder; },
      async abortSignal(signal) { assert(signal instanceof AbortSignal); assert.equal(signal.aborted, false); calls.push(ids); return respond(ids, calls.length); },
    };
    return builder;
  }};
  try { return await callback(calls); }
  finally { delete globalThis.__replyCountBackend; }
}
test('client batches unique archive IDs by 100 and adds only visible member counts without mutating cached posts', async () => {
  const native = Object.freeze({ id: visibleAuthor, source: 'member', answer_count: 21 });
  const input = Object.freeze([...Array.from({ length: 205 }, (_, index) => archiveQuestion(index)), archiveQuestion(0), native]);
  const original = JSON.stringify(input);
  await withBackend(async ids => ({ error: null, data: ids.filter(id => id !== 'apify-204').map(question_id => ({ question_id, answer_count: '3' })) }), async calls => {
    const result = await helper.withMemberReplyCounts(input);
    assert.deepEqual(calls.map(ids => ids.length), [100, 100, 5]);
    assert.equal(new Set(calls.flat()).size, 205);
    assert.equal(result.length, input.length);
    assert.equal(result[0].answer_count, 5);
    assert.equal(result[205].answer_count, 5, 'Duplicate question references do not double-add the count');
    assert.equal(result[204].answer_count, 2, 'No aggregate row adds zero member replies to captured archive replies');
    assert.equal(result[0].source_comment_count, 900, 'Upstream source totals remain separate');
    assert.equal(result[0].extra, 'preserved');
    assert.equal(result.at(-1), native);
    assert.notEqual(result[0], input[0]);
    assert.equal(JSON.stringify(input), original);
    const repeated = await helper.withMemberReplyCounts(input);
    assert.equal(repeated[0].answer_count, 5, 'Refreshing the cached archive does not accumulate counts');
  });
});
test('client skips backend reads for empty, member-only and unconfigured demo feeds', async () => {
  await withBackend(() => { throw new Error('No backend request expected'); }, async calls => {
    for (const input of [[], [{ id: visibleAuthor, source: 'member', answer_count: 4 }]]) assert.equal(await helper.withMemberReplyCounts(input), input);
    const demo = [archiveQuestion(0)];
    assert.equal(await demoHelper.withMemberReplyCounts(demo), demo);
    assert.equal(calls.length, 0);
  });
});
test('a later failed count batch rejects the whole read without corrupting the cached source', async () => {
  const input = Object.freeze(Array.from({ length: 101 }, (_, index) => archiveQuestion(index)));
  await withBackend(async (ids, batch) => batch === 1
    ? { data: ids.map(question_id => ({ question_id, answer_count: 8 })), error: null }
    : { data: null, error: { message: 'Count service unavailable' } }, async calls => {
    await assert.rejects(helper.withMemberReplyCounts(input), /Count service unavailable/);
    assert.equal(calls.length, 2);
    assert(input.every(question => question.answer_count === 2));
  });
});
test('invalid or absent aggregate data cannot masquerade as zero replies', async () => {
  for (const count of [null, undefined, true, '', ' ', ' 1', '-1', -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '9007199254740992']) {
    await withBackend(async () => ({ data: [{ question_id: 'apify-0', answer_count: count }], error: null }), async () => {
      await assert.rejects(helper.withMemberReplyCounts([archiveQuestion(0)]), /Reply counts are temporarily unavailable/);
    });
  }
  for (const data of [null, undefined, {}]) {
    await withBackend(async () => ({ data, error: null }), async () => {
      await assert.rejects(helper.withMemberReplyCounts([archiveQuestion(0)]), /Reply counts are temporarily unavailable/);
    });
  }
});

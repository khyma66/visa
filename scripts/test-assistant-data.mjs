import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, afterEach } from 'node:test';
import ts from 'typescript';

const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const tagging = moduleUrl(compile(await readFile(new URL('../src/lib/tagging.ts', import.meta.url), 'utf8')));
const core = moduleUrl(compile(await readFile(new URL('../src/lib/assistant-core.ts', import.meta.url), 'utf8')));
const source = compile(await readFile(new URL('../src/lib/assistant-data.ts', import.meta.url), 'utf8'))
  .replace("import archive from '@visa/archive';", 'const archive = new Proxy({}, { get: (_, key) => globalThis.__assistantArchive[key] });')
  .replace("'./tagging'", JSON.stringify(tagging)).replace("'./assistant-core'", JSON.stringify(core));
const { retrieveAssistantCorpus } = await import(moduleUrl(source));
const saved = Object.fromEntries(['COMMUNITY_SOURCE_MODE', 'APP_ENV', 'IMPORTED_CONTENT_APPROVED'].map((name) => [name, process.env[name]]));
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) value === undefined ? delete process.env[name] : process.env[name] = value;
  delete globalThis.__assistantArchive;
});
const id = '11111111-1111-4111-8111-111111111111';
const q = (overrides = {}) => ({ id, title: 'My Chennai appointment experience', body: 'My H-1B appointment happened in Chennai with fingerprints and an interview.',
  created_at: '2026-10-10T12:00:00Z', updated_at: '2026-10-10T12:00:00Z', status: 'open', community_id: null, ...overrides });
const a = (number = 1, overrides = {}) => ({ id: `22222222-2222-4222-8222-${String(number).padStart(12, '0')}`, question_id: id,
  body: 'My application completed in two days after the appointment.', created_at: '2026-10-11T12:00:00Z', updated_at: '2026-10-11T12:00:00Z',
  status: 'active', vote_score: 0, is_accepted: false, ...overrides });

function client(tables = {}, rpcResult = { data: [], error: null }) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, filters: {}, orders: [] }; calls.push(call);
      const response = tables[table] ?? { data: [], error: null };
      const chain = {
        select(fields) { call.fields = fields; return chain; },
        eq(key, value) { call.filters[key] = value; return chain; },
        gte(key, value) { call.filters[`${key}_gte`] = value; return chain; },
        lt(key, value) { call.filters[`${key}_lt`] = value; return chain; },
        order(key, options) { call.orders.push([key, options]); return chain; },
        limit(limit) { call.limit = limit; return chain; },
        maybeSingle() { return Promise.resolve(response); },
        then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); },
      };
      return chain;
    },
    rpc(name, args) { calls.push({ rpc: name, args }); return Promise.resolve(rpcResult); },
  };
}

test('post assistant reads only the selected question and replies through caller-visible views', async () => {
  const db = client({ question_feed: { data: q(), error: null }, answer_feed: { data: [a()], error: null } });
  const result = await retrieveAssistantCorpus(db, { mode: 'ask', scope: { kind: 'post', id }, question: 'How long?' });
  assert.deepEqual(db.calls.map((call) => call.table), ['question_feed', 'answer_feed']);
  assert.equal(db.calls[0].filters.id, id); assert.equal(db.calls[1].filters.question_id, id);
  assert.equal(result.sources[1].url, `/questions/${id}#answer-${a().id}`);
  assert.equal(result.sources[1].parentContext, q().body);
  assert.equal(result.sources[1].parentUpdatedAt, q().updated_at);
  assert.equal(result.partial, false);
});

test('missing or hidden parent prevents any reply retrieval', async () => {
  const db = client({ question_feed: { data: null, error: null } });
  assert.deepEqual(await retrieveAssistantCorpus(db, { mode: 'summary', scope: { kind: 'post', id } }), { sources: [], partial: false });
  assert.equal(db.calls.length, 1);
});

test('long native threads disclose partial coverage and retrieve matching older replies within the post', async () => {
  const older = { source_id: `a:${a(100).id}`, source_kind: 'reply', question_id: id, community_id: null,
    title: q().title, body: 'Biometrics took 17 minutes in this specific account.', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    parent_context: q().body, parent_updated_at: q().updated_at };
  const db = client({ question_feed: { data: q(), error: null }, answer_feed: { data: Array.from({ length: 48 }, (_, i) => a(i + 1)), error: null } }, { data: [older], error: null });
  const result = await retrieveAssistantCorpus(db, { mode: 'ask', scope: { kind: 'post', id }, question: 'What about biometrics?' });
  assert.equal(result.sources.length, 48); assert.equal(result.partial, true);
  assert.equal(result.sources[1].id, older.source_id);
  assert.equal(db.calls.find((call) => call.rpc).args.target_question_id, id);
});

test('summary accepts exactly 47 replies as complete; lookahead marks 48 replies partial', async () => {
  for (const count of [47, 48]) {
    const db = client({ question_feed: { data: q(), error: null }, answer_feed: { data: Array.from({ length: count }, (_, i) => a(i + 1)), error: null } });
    const result = await retrieveAssistantCorpus(db, { mode: 'summary', scope: { kind: 'post', id } });
    assert.equal(result.partial, count === 48); assert.equal(result.sources.length, 48);
  }
});

test('archive post uses reviewed snapshot plus real member replies, preserving separate provenance internally', async () => {
  process.env.APP_ENV = 'production'; process.env.COMMUNITY_SOURCE_MODE = 'snapshot'; process.env.IMPORTED_CONTENT_APPROVED = 'true';
  const archiveId = 'apify-test';
  globalThis.__assistantArchive = { questions: [q({ id: archiveId })], answersByQuestionId: { [archiveId]: [a(99, { id: 'apify-comment-one', question_id: archiveId })] } };
  const db = client({ imported_answer_feed: { data: [a(2, { question_id: archiveId })], error: null } });
  const result = await retrieveAssistantCorpus(db, { mode: 'summary', scope: { kind: 'post', id: archiveId } });
  assert.deepEqual(result.sources.map((row) => row.provenance), ['archive', 'member', 'archive']);
  assert.equal(db.calls[0].table, 'imported_answer_feed'); assert.equal(db.calls[0].filters.question_id, archiveId);
  assert(result.sources.every((row) => row.url.startsWith(`/questions/${archiveId}`)));
});

test('unapproved production archive and non-snapshot mode fail before any database reads', async () => {
  process.env.APP_ENV = 'production'; process.env.COMMUNITY_SOURCE_MODE = 'snapshot'; delete process.env.IMPORTED_CONTENT_APPROVED;
  const db = client();
  await assert.rejects(() => retrieveAssistantCorpus(db, { mode: 'summary', scope: { kind: 'post', id: 'apify-test' } }), /not available/);
  process.env.IMPORTED_CONTENT_APPROVED = 'true'; process.env.COMMUNITY_SOURCE_MODE = 'live';
  await assert.rejects(() => retrieveAssistantCorpus(db, { mode: 'summary', scope: { kind: 'post', id: 'apify-test' } }), /not available/);
  assert.equal(db.calls.length, 0);
});

test('archive summaries disclose when only top comments were exported', async () => {
  process.env.APP_ENV = 'production'; process.env.COMMUNITY_SOURCE_MODE = 'snapshot'; process.env.IMPORTED_CONTENT_APPROVED = 'true';
  globalThis.__assistantArchive = { questions: [q({ id: 'apify-test', answer_count: 50 })], answersByQuestionId: { 'apify-test': [a(1)] } };
  const result = await retrieveAssistantCorpus(client(), { mode: 'summary', scope: { kind: 'post', id: 'apify-test' } });
  assert.equal(result.sources.length, 2); assert.equal(result.partial, true);
});

test('public asks search approved archive and carry prior user questions into follow-up retrieval', async () => {
  process.env.APP_ENV = 'production'; process.env.COMMUNITY_SOURCE_MODE = 'snapshot'; process.env.IMPORTED_CONTENT_APPROVED = 'true';
  globalThis.__assistantArchive = { questions: [q({ id: 'apify-test' })], answersByQuestionId: {} };
  const db = client();
  const result = await retrieveAssistantCorpus(db, { mode: 'ask', scope: { kind: 'public' }, question: 'What about that?', previousQuestions: ['What did people say about Chennai H-1B appointments?'] });
  assert.equal(result.sources[0].questionId, 'apify-test');
  assert.equal(result.partial, true, 'Global keyword search does not yet include live member replies on archive posts');
  assert.match(db.calls[0].args.query_text, /Chennai H-1B/);
  assert(db.calls[0].args.query_tags.includes('h1b'));
});

test('public archive scanning stops at 5000 source records and marks incomplete coverage', async () => {
  process.env.APP_ENV = 'production'; process.env.COMMUNITY_SOURCE_MODE = 'snapshot'; process.env.IMPORTED_CONTENT_APPROVED = 'true';
  globalThis.__assistantArchive = { questions: Array.from({ length: 5100 }, (_, i) => q({ id: `apify-${i}` })), answersByQuestionId: {} };
  const result = await retrieveAssistantCorpus(client(), { mode: 'ask', scope: { kind: 'public' }, question: 'Chennai appointments?' });
  assert.equal(result.sources.length, 48); assert.equal(result.partial, true);
});

test('community retrieval checks current directory visibility and never guesses archive community membership', async () => {
  process.env.APP_ENV = 'production'; process.env.COMMUNITY_SOURCE_MODE = 'snapshot'; process.env.IMPORTED_CONTENT_APPROVED = 'true';
  globalThis.__assistantArchive = { questions: [q({ id: 'apify-test' })], answersByQuestionId: {} };
  const hidden = client({ community_directory: { data: null, error: null } });
  assert.equal((await retrieveAssistantCorpus(hidden, { mode: 'ask', scope: { kind: 'community', id }, question: 'Chennai?' })).sources.length, 0);
  assert.equal(hidden.calls.length, 1);
  const visible = client({ community_directory: { data: { id }, error: null } });
  assert.equal((await retrieveAssistantCorpus(visible, { mode: 'ask', scope: { kind: 'community', id }, question: 'Chennai?' })).sources.length, 0);
  assert.equal(visible.calls[1].args.target_community_id, id);
});

test('catch-up retains event timestamps/window and a lookahead row indicates partial coverage', async () => {
  delete process.env.COMMUNITY_SOURCE_MODE;
  const rows = Array.from({ length: 49 }, (_, i) => ({ source_id: `a:${a(i).id}`, source_kind: 'reply', question_id: id, community_id: null,
    title: q().title, body: a().body, created_at: a().created_at, updated_at: a().updated_at,
    parent_context: q().body, parent_updated_at: q().updated_at }));
  const db = client({ community_directory: { data: { id }, error: null } }, { data: rows, error: null });
  const request = { mode: 'catchup', scope: { kind: 'community', id }, since: '2026-10-10T00:00:00Z', until: '2026-10-12T00:00:00Z' };
  const result = await retrieveAssistantCorpus(db, request);
  assert.equal(result.sources.length, 48); assert.equal(result.partial, true);
  assert.equal(result.sources[0].createdAt, a().created_at); assert.equal(result.sources[0].parentUpdatedAt, q().updated_at);
  assert.equal(result.since, request.since); assert.equal(result.until, request.until);
  assert.equal(db.calls[1].args.since_time, request.since); assert.equal(db.calls[1].args.until_time, request.until);
  assert.equal(db.calls[1].args.target_community_id, id);
});

test('catch-up rejects public and post scopes before any database or archive reads', async () => {
  const db = client();
  for (const scope of [{ kind: 'public' }, { kind: 'post', id }]) {
    await assert.rejects(() => retrieveAssistantCorpus(db, { mode: 'catchup', scope, since: '2026-10-10T00:00:00Z', until: '2026-10-12T00:00:00Z' }), error => error.status === 400 && /community/.test(error.message));
  }
  assert.equal(db.calls.length, 0);
});

test('database rate/auth denials preserve 429/403 responses instead of being reported as setup failures', async () => {
  for (const [code, status] of [['PT429', 429], ['42501', 403]]) {
    const db = client({}, { data: null, error: { code } });
    await assert.rejects(() => retrieveAssistantCorpus(db, { mode: 'ask', scope: { kind: 'public' }, question: 'Chennai?' }), (error) => error.status === status);
  }
});

test('database failures fail closed without silently returning archive-only answers', async () => {
  const db = client({}, { data: null, error: { message: 'sensitive internal error' } });
  await assert.rejects(() => retrieveAssistantCorpus(db, { mode: 'ask', scope: { kind: 'public' }, question: 'Chennai?' }), /temporarily unavailable/);
  const post = client({ question_feed: { data: q(), error: null }, answer_feed: { data: null, error: { message: 'denied' } } });
  await assert.rejects(() => retrieveAssistantCorpus(post, { mode: 'summary', scope: { kind: 'post', id } }), /temporarily unavailable/);
});

function reviewedArchive(questions, answersByQuestionId = {}) {
  process.env.APP_ENV = 'production'; process.env.COMMUNITY_SOURCE_MODE = 'snapshot'; process.env.IMPORTED_CONTENT_APPROVED = 'true';
  globalThis.__assistantArchive = { questions, answersByQuestionId };
}

test('a new chat topic retrieves its answer instead of carrying old appointment terms forward', async () => {
  reviewedArchive([
    q({ id: 'apify-chennai', title: 'Chennai H-1B appointment', body: 'My Chennai H-1B stamping appointment and fingerprints happened Monday.' }),
    q({ id: 'apify-schengen', title: 'Schengen passport delivery', body: 'My Schengen passport arrived Friday in Dallas.' }),
  ]);
  const db = client();
  const question = 'When did the Schengen passport arrive in Dallas?';
  const result = await retrieveAssistantCorpus(db, { mode: 'ask', scope: { kind: 'public' }, question, previousQuestions: ['Chennai H-1B stamping appointment fingerprints?'] });
  assert.deepEqual(result.sources.map(source => source.questionId), ['apify-schengen']);
  assert.equal(db.calls[0].args.query_text, question);
  assert.deepEqual(db.calls[0].args.query_tags, ['schengen']);
});

test('OPT and CPT questions do not match unrelated words such as options and receipts', async () => {
  reviewedArchive([
    q({ id: 'apify-options', title: 'Appointment options', body: 'My Chennai appointment options included Tuesday and Friday.' }),
    q({ id: 'apify-opt', title: 'OPT update', body: 'I received my OPT document on Friday.' }),
  ]);
  const result = await retrieveAssistantCorpus(client(), { mode: 'ask', scope: { kind: 'public' }, question: 'OPT?' });
  assert.deepEqual(result.sources.map(source => source.questionId), ['apify-opt']);
  const unrelated = await retrieveAssistantCorpus(client(), { mode: 'ask', scope: { kind: 'public' }, question: 'CPT?' });
  assert.equal(unrelated.sources.length, 0);
});

test('referential follow-ups keep context but current passport delivery evidence outranks old appointment detail', async () => {
  reviewedArchive([
    q({ id: 'apify-fingerprints', title: 'Chennai H-1B stamping appointment fingerprints', body: 'My Chennai H-1B stamping appointment and fingerprints happened Monday.' }),
    q({ id: 'apify-delivery', title: 'Chennai delivery', body: 'My passport delivery happened Friday after the interview.' }),
  ]);
  const result = await retrieveAssistantCorpus(client(), { mode: 'ask', scope: { kind: 'public' }, question: 'What about passport delivery?', previousQuestions: ['Chennai H-1B stamping appointment fingerprints?'] });
  assert.equal(result.sources[0].questionId, 'apify-delivery');
});

test('plural wording finds a discussion and a short reply keeps its parent topic for retrieval', async () => {
  reviewedArchive([q({ id: 'apify-test', title: 'My appointment', body: 'My Chennai biometrics appointment happened Monday.' })], {
    'apify-test': [a(1, { question_id: 'apify-test', body: 'Mine took seventeen minutes at the same location.' })],
  });
  const result = await retrieveAssistantCorpus(client(), { mode: 'ask', scope: { kind: 'public' }, question: 'Chennai biometrics appointments?' });
  assert.equal(result.sources.length, 2);
  assert(result.sources.some(source => source.kind === 'reply' && /seventeen minutes/.test(source.body)));
});

test('a follow-up after a topic change uses the last topic, not the earlier conversation', async () => {
  reviewedArchive([
    q({ id: 'apify-chennai', title: 'Chennai H-1B appointment', body: 'My Chennai H-1B stamping appointment happened Monday.' }),
    q({ id: 'apify-schengen', title: 'Schengen delivery', body: 'My Schengen passport arrived Friday in Dallas.' }),
  ]);
  const db = client();
  const result = await retrieveAssistantCorpus(db, { mode: 'ask', scope: { kind: 'public' }, question: 'How long did it take?', previousQuestions: ['Chennai H-1B appointments?', 'When did the Schengen passport arrive in Dallas?'] });
  assert.deepEqual(result.sources.map(source => source.questionId), ['apify-schengen']);
  assert.doesNotMatch(db.calls[0].args.query_text, /Chennai|H-1B/);
  assert.match(db.calls[0].args.query_text, /Schengen/);
});

test('Why, How, and What happened next follow the latest answered topic without reviving older posts', async () => {
  reviewedArchive([
    q({ id: 'apify-chennai', title: 'Chennai H-1B appointment', body: 'My Chennai H-1B stamping appointment happened Monday.' }),
    q({ id: 'apify-schengen', title: 'Schengen delivery', body: 'My Schengen passport arrived Friday in Dallas because the courier delayed delivery.' }),
  ]);
  const previousQuestions = ['Chennai H-1B appointments?', 'When did the Schengen passport arrive in Dallas?'];
  const initial = await retrieveAssistantCorpus(client(), { mode: 'ask', scope: { kind: 'public' }, question: previousQuestions[1] });
  assert.deepEqual(initial.sources.map(source => source.questionId), ['apify-schengen']);
  for (const question of ['Why?', 'How?', 'What happened next?']) {
    const db = client();
    const result = await retrieveAssistantCorpus(db, { mode: 'ask', scope: { kind: 'public' }, question, previousQuestions });
    assert.deepEqual(result.sources.map(source => source.questionId), ['apify-schengen'], question);
    assert.equal(db.calls[0].args.query_text, previousQuestions[1], 'Native search must also use the latest topic, not generic continuation wording');
    assert.doesNotMatch(db.calls[0].args.query_text, /Chennai|H-1B/);
  }
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, afterEach } from 'node:test';
import ts from 'typescript';

const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const tagging = moduleUrl(compile(await readFile(new URL('../src/lib/tagging.ts', import.meta.url), 'utf8')));
const context = moduleUrl(compile(await readFile(new URL('../src/lib/assistant-context.ts', import.meta.url), 'utf8')));
const core = moduleUrl(compile(await readFile(new URL('../src/lib/assistant-core.ts', import.meta.url), 'utf8')).replace("'./assistant-context'", JSON.stringify(context)));
const search = moduleUrl(compile(await readFile(new URL('../src/lib/assistant-search.ts', import.meta.url), 'utf8')).replace("'./assistant-core'", JSON.stringify(core)).replace("'./assistant-context'", JSON.stringify(context)));
const source = compile(await readFile(new URL('../src/lib/assistant-data.ts', import.meta.url), 'utf8'))
  .replace("import archive from '@visa/archive';", 'const archive = new Proxy({}, { get: (_, key) => globalThis.__assistantArchive[key] });')
  .replace("'./tagging'", JSON.stringify(tagging)).replace("'./assistant-core'", JSON.stringify(core)).replace("'./assistant-search'", JSON.stringify(search)).replace("'./assistant-context'", JSON.stringify(context));
const { retrieveAssistantCorpus } = await import(moduleUrl(source));
const { assistantPostSearchQuery, assistantPostSearchScore, buildAssistantPostSearchResult } = await import(search);
const { assistantBoundedHistory } = await import(context);
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
      const response = () => typeof tables[table] === 'function' ? tables[table](call) : tables[table] ?? { data: [], error: null };
      const chain = {
        select(fields) { call.fields = fields; return chain; },
        eq(key, value) { call.filters[key] = value; return chain; },
        or(value) { call.or = value; return chain; },
        gte(key, value) { call.filters[`${key}_gte`] = value; return chain; },
        lt(key, value) { call.filters[`${key}_lt`] = value; return chain; },
        order(key, options) { call.orders.push([key, options]); return chain; },
        limit(limit) { call.limit = limit; return chain; },
        maybeSingle() { return Promise.resolve(response()); },
        then(resolve, reject) { return Promise.resolve(response()).then(resolve, reject); },
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
  assert.equal(result.partial, false, 'Both archive and live imported replies were searched successfully');
  assert(db.calls.some(call => call.table === 'imported_answer_feed' && call.or));
  assert.match(db.calls[0].args.query_text, /Chennai H-1B/);
  assert(db.calls[0].args.query_tags.includes('h1b'));
});

test('public archive scanning stops at 5000 source records and marks incomplete coverage', async () => {
  process.env.APP_ENV = 'production'; process.env.COMMUNITY_SOURCE_MODE = 'snapshot'; process.env.IMPORTED_CONTENT_APPROVED = 'true';
  globalThis.__assistantArchive = { questions: Array.from({ length: 5100 }, (_, i) => q({ id: `apify-${i}` })), answersByQuestionId: {} };
  const result = await retrieveAssistantCorpus(client(), { mode: 'ask', scope: { kind: 'public' }, question: 'Chennai appointments?' });
  assert(result.sources.length > 0 && result.sources.length <= 48); assert.equal(result.partial, true);
  assert(result.coverageReasons.includes('retrieval-limit'));
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

test('public answers retain the question and clarification behind an original-poster acknowledgment', async () => {
  const postId = 'apify-stem-opt-stamping';
  const original = q({ id: postId, author_id: 'apify-author-questioner', title: 'STEM OPT and future H1B stamping', answer_count: 4,
    body: 'I am on STEM OPT and my H1B was approved via consular processing. Can I continue working while waiting for a visa slot? '.repeat(10) + 'I have not filed a change of status petition yet.' });
  reviewedArchive([original], { [postId]: [
    a(1, { id: 'apify-comment-acknowledgment', question_id: postId, author_id: original.author_id,
      body: 'Thank you! So, I can go for stamping when I get a visa slot and can continue to work on H1B while remaining in the US.' }),
    a(2, { id: 'apify-comment-clarification', question_id: postId, author_id: 'apify-author-other', body: 'Did your employer file a change of status or consular processing?' }),
    a(3, { id: 'apify-comment-hidden', question_id: postId, status: 'archived', body: 'This hidden comment must not reach the assistant.' }),
  ] });
  const result = await retrieveAssistantCorpus(client(), { mode: 'ask', scope: { kind: 'public' }, question: 'Can I continue to work on H1B while waiting for a stamping slot?' });
  assert.equal(result.sources[0].id, `q:${postId}`);
  assert.match(result.sources[0].body, /not filed a change of status petition yet/);
  assert.equal(result.sources.find(source => source.id === 'a:apify-comment-acknowledgment').speakerRole, 'original-poster');
  assert.equal(result.sources.find(source => source.id === 'a:apify-comment-clarification').speakerRole, 'member');
  assert(!result.sources.some(source => source.id === 'a:apify-comment-hidden'));
  assert.equal(result.partial, true); assert(result.coverageReasons.includes('missing-replies'));
  assert.doesNotMatch(JSON.stringify(result), /apify-author-questioner|apify-author-other/);
});

test('busy archive threads cannot crowd out other relevant discussions before context is assembled', async () => {
  const busy = q({ id: 'apify-busy', title: 'Chennai H1B stamping interview', body: 'How did the Chennai H1B stamping interview go?' });
  const other = q({ id: 'apify-other', title: 'A second Chennai report', body: 'My Chennai H-1B stamping interview was completed on Tuesday.' });
  reviewedArchive([busy, other], { [busy.id]: Array.from({ length: 60 }, (_, i) => a(i, { question_id: busy.id,
    body: 'My Chennai H1B stamping interview was completed on Monday.' })), [other.id]: [a(90, { question_id: other.id,
      body: 'My passport arrived on Thursday.' })] });
  const result = await retrieveAssistantCorpus(client(), { mode: 'ask', scope: { kind: 'public' }, question: 'What did members report about Chennai H1B stamping interviews?' });
  assert.deepEqual(new Set(result.sources.slice(0, 6).map(source => source.questionId)), new Set([busy.id, other.id]));
  assert(result.sources.some(source => source.questionId === other.id && /passport arrived/.test(source.body)), 'A contextual reply without the query keywords must still be available');
  assert(result.sources.length <= 48); assert.equal(result.partial, true);
  assert(result.coverageReasons.includes('retrieval-limit'));
});

test('native search context rechecks parent visibility and includes non-keyword replies through caller views', async () => {
  delete process.env.COMMUNITY_SOURCE_MODE;
  const source = { source_id: `q:${id}`, source_kind: 'question', question_id: id, community_id: null,
    title: q().title, body: q().body, created_at: q().created_at, updated_at: q().updated_at, parent_context: null, parent_updated_at: null };
  const input = { mode: 'ask', scope: { kind: 'public' }, question: 'Chennai biometrics?' };
  const invisible = client({ question_feed: { data: null, error: null } }, { data: [source], error: null });
  assert.equal((await retrieveAssistantCorpus(invisible, input)).sources.length, 0);
  assert.equal(invisible.calls.some(call => call.table === 'answer_feed'), false);
  const db = client({ question_feed: { data: q({ author_id: 'question-author' }), error: null }, answer_feed: { data: [a(1, { author_id: 'different-member', body: 'The scanner failed so it was rescheduled.' })], error: null } }, { data: [source], error: null });
  const result = await retrieveAssistantCorpus(db, input);
  assert.equal(result.sources.length, 2); assert.equal(result.sources[1].speakerRole, 'member');
  assert.match(result.sources[1].body, /scanner failed/);
  assert.equal(result.partial, false);
  assert.equal(db.calls.find(call => call.table === 'question_feed').filters.id, id);
  assert.equal(db.calls.find(call => call.table === 'answer_feed').filters.question_id, id);
});

test('public expansion reuses native matches without multiplying rate-limited search RPCs', async () => {
  delete process.env.COMMUNITY_SOURCE_MODE;
  const parents = Array.from({ length: 8 }, (_, i) => q({ id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}` }));
  const matches = parents.map((parent, i) => ({ source_id: `a:${a(i + 100).id}`, source_kind: 'reply', question_id: parent.id, community_id: null,
    title: parent.title, body: 'My Chennai biometrics appointment took seventeen minutes.', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    parent_context: parent.body, parent_updated_at: parent.updated_at }));
  const db = client({
    question_feed: call => ({ data: parents.find(parent => parent.id === call.filters.id) ?? null, error: null }),
    answer_feed: call => ({ data: Array.from({ length: 48 }, (_, i) => a(i, { question_id: call.filters.question_id, body: 'Thank you for sharing the visit.' })), error: null }),
  }, { data: matches, error: null });
  const input = { mode: 'ask', scope: { kind: 'public' }, question: 'How many minutes did Chennai biometrics take?' };
  for (let read = 0; read < 3; read++) {
    const result = await retrieveAssistantCorpus(db, input);
    assert(result.sources.length <= 48);
    assert(matches.every(match => result.sources.slice(0, 24).some(source => source.id === match.source_id)), 'Every chosen thread keeps its actual match inside the primary context budget');
    assert.equal(db.calls.filter(call => call.rpc).length, read + 1, 'One global RPC per corpus read, including revalidation');
  }
});

test('missing author identifiers never identify a reply as an original-poster confirmation', async () => {
  for (const [parentAuthor, replyAuthor] of [[undefined, undefined], ['', ''], [' ', ' '], ['question-author', undefined]]) {
    const db = client({ question_feed: { data: q({ author_id: parentAuthor }), error: null }, answer_feed: { data: [a(1, { author_id: replyAuthor })], error: null } });
    const result = await retrieveAssistantCorpus(db, { mode: 'ask', scope: { kind: 'post', id }, question: 'How long?' });
    assert.equal(result.sources[1].speakerRole, undefined);
  }
});

test('global search includes live imported replies only when their approved parent is visible', async () => {
  const visible = q({ id: 'apify-visible', author_id: 'private-parent-id', title: 'An appointment report', body: 'My visit was completed.' });
  const hidden = q({ id: 'apify-hidden', title: 'Hidden parent', status: 'archived' });
  reviewedArchive([visible, hidden]);
  const rows = [
    a(1, { question_id: visible.id, author_id: 'private-member-id', body: 'My Chennai biometrics appointment happened Monday.' }),
    a(2, { question_id: hidden.id, body: 'Hidden Chennai biometrics response.' }),
    a(3, { question_id: 'apify-missing', body: 'Missing-parent Chennai biometrics response.' }),
  ];
  const db = client({ imported_answer_feed: call => ({ data: call.or ? rows : rows.filter(row => row.question_id === call.filters.question_id), error: null }) });
  const result = await retrieveAssistantCorpus(db, { mode: 'ask', scope: { kind: 'public' }, question: 'What happened during Chennai biometrics?' });
  assert.equal(result.sources.length, 2); assert(result.sources.every(source => source.questionId === visible.id));
  assert.equal(result.sources[1].speakerRole, 'member'); assert.equal(result.partial, false);
  assert(!result.coverageReasons?.includes('unindexed-replies'));
  assert.doesNotMatch(JSON.stringify(result), /private-parent-id|private-member-id|Hidden Chennai|Missing-parent/);
  const lookup = db.calls.find(call => call.or);
  assert.equal(lookup.table, 'imported_answer_feed'); assert.equal(lookup.limit, 49);
  assert.match(lookup.or, /body\.ilike\.%chennai%/);
});

test('an older low-vote imported keyword hit survives the popular reply context window', async () => {
  const parent = q({ id: 'apify-old-reply', title: 'An appointment report', body: 'I attended my appointment and shared the details.' });
  reviewedArchive([parent]);
  const match = a(100, { question_id: parent.id, body: 'My Chennai biometrics appointment took seventeen minutes.',
    vote_score: -5, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' });
  const popular = Array.from({ length: 48 }, (_, i) => a(i, { question_id: parent.id, vote_score: 10,
    body: 'Thank you for sharing your visit.' }));
  const db = client({ imported_answer_feed: call => ({ data: call.or ? [match] : popular, error: null }) });
  const result = await retrieveAssistantCorpus(db, { mode: 'ask', scope: { kind: 'public' }, question: 'How many minutes did Chennai biometrics take?' });
  assert.equal(result.sources[0].id, `q:${parent.id}`);
  assert.equal(result.sources[1].id, `a:${match.id}`);
  assert.match(result.sources[1].body, /seventeen minutes/);
  assert.equal(result.sources[1].parentContext, parent.body);
  assert.equal(result.sources.length, 48); assert.equal(result.partial, true);
  assert.equal(result.sources.filter(source => source.id === `a:${match.id}`).length, 1);
});

test('matching reply deduplication preserves newer context text rather than an earlier search body', async () => {
  const parent = q({ id: 'apify-reply-update', title: 'Chennai appointment', body: 'My Chennai appointment report.' });
  reviewedArchive([parent]);
  const earlier = a(1, { question_id: parent.id, body: 'My Chennai visit took seventeen minutes.', updated_at: '2026-10-10T00:00:00Z' });
  const updated = { ...earlier, body: 'Correction: my Chennai visit took seventy minutes.', updated_at: '2026-10-11T00:00:00Z' };
  const db = client({ imported_answer_feed: call => ({ data: [call.or ? earlier : updated], error: null }) });
  const result = await retrieveAssistantCorpus(db, { mode: 'ask', scope: { kind: 'public' }, question: 'How many minutes was the Chennai visit?' });
  const sources = result.sources.filter(source => source.id === `a:${earlier.id}`);
  assert.equal(sources.length, 1); assert.equal(sources[0].body, updated.body);
  assert.equal(sources[0].updatedAt, updated.updated_at);
});

test('imported-reply lookup builds bounded literal filters rather than accepting query syntax', async () => {
  reviewedArchive([]);
  const db = client();
  await retrieveAssistantCorpus(db, { mode: 'ask', scope: { kind: 'public' }, question: 'Chennai H-1B %),status.eq.archived,body.ilike.*( ' + Array.from({ length: 40 }, (_, i) => `token${i}`).join(' ') });
  const filter = db.calls.find(call => call.or).or;
  const lexical = /^and\(or\(([^()]*)\)/.exec(filter)?.[1] ?? filter;
  assert(lexical.split(',').length <= 24);
  assert.match(lexical, /^body\.ilike\.%[\p{L}\p{N}][\p{L}\p{M}\p{N}-]*%(?:,body\.ilike\.%[\p{L}\p{N}][\p{L}\p{M}\p{N}-]*%)*$/u);
  assert.doesNotMatch(filter, /\*|status\.eq/);
  assert(filter.length < 12_000, 'Generated entity constraints are independently bounded');
});

test('imported-reply search reports real limits and outages without suppressing authorization errors', async () => {
  reviewedArchive([q({ id: 'apify-available', title: 'Chennai appointment', body: 'My Chennai appointment happened Monday.' })]);
  const input = { mode: 'ask', scope: { kind: 'public' }, question: 'Chennai?' };
  const limited = client({ imported_answer_feed: { data: Array.from({ length: 49 }, (_, i) => a(i, { question_id: 'apify-no-parent' })), error: null } });
  const capped = await retrieveAssistantCorpus(limited, input);
  assert.equal(capped.partial, true); assert(capped.coverageReasons.includes('retrieval-limit'));
  const outage = client({ imported_answer_feed: { data: null, error: { code: '57014', message: 'private internal details' } } });
  const unavailable = await retrieveAssistantCorpus(outage, input);
  assert.equal(unavailable.partial, true); assert(unavailable.coverageReasons.includes('unindexed-replies'));
  assert.equal(unavailable.sources[0].questionId, 'apify-available', 'The available archive source remains usable with its gap explicitly recorded');
  assert.doesNotMatch(JSON.stringify(unavailable), /private internal details/);
  for (const [code, status] of [['42501', 403], ['PT429', 429]]) {
    const denied = client({ imported_answer_feed: { data: null, error: { code } } });
    await assert.rejects(() => retrieveAssistantCorpus(denied, input), error => error.status === status);
  }
});

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
    q({ id: 'apify-delivery', title: 'Chennai delivery', body: 'My H-1B passport delivery happened Friday after the interview.' }),
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

test('a long chain of tiny follow-ups retains the topic anchor and never searches next as a topic', async () => {
  reviewedArchive([
    q({ id: 'apify-chennai', title: 'H-1B stamping in Chennai', body: 'My H-1B stamping in Chennai completed after seven days.' }),
    q({ id: 'apify-unrelated', title: 'Canadian permit', body: 'The next appointment is for my Canadian work permit.' }),
  ]);
  const anchor = 'What did members report about H-1B stamping in Chennai?';
  let history = [anchor];
  for (const question of ['What happened next?', 'Why?', 'How long?', ...Array(24).fill('Why?')]) {
    const db = client();
    const result = await retrieveAssistantCorpus(db, { mode: 'ask', scope: { kind: 'public' }, question, previousQuestions: history });
    assert.deepEqual(result.sources.map(source => source.questionId), ['apify-chennai']);
    assert.equal(db.calls[0].args.query_text, anchor);
    history = assistantBoundedHistory([...history, question]);
    assert.equal(history[0], anchor); assert(history.length <= 3);
  }
  assert.deepEqual(assistantBoundedHistory([...history, 'New topic: Schengen passport delivery?']), ['New topic: Schengen passport delivery?']);
});

test('ordinal references use the displayed post order and fresh caller-visible reads', async () => {
  const second = '33333333-3333-4333-8333-333333333333';
  const db = client({ question_feed: { data: q({ id: second }), error: null }, answer_feed: { data: [a(2, { question_id: second })], error: null } });
  const result = await retrieveAssistantCorpus(db, { mode: 'ask', scope: { kind: 'public' }, question: 'Explain the second post.',
    previousQuestions: ['Find posts about Chennai appointments'], previousPosts: [{ questionId: id, sourceId: `q:${id}` }, { questionId: second, sourceId: `q:${second}` }] });
  assert.equal(db.calls[0].filters.id, second); assert.equal(db.calls[1].filters.question_id, second);
  assert(result.sources.every(source => source.questionId === second));
  assert.equal(db.calls.some(call => call.rpc), false, 'An ordinal is a current authorized post read, not an unrelated lexical search');
});

test('selected post focus survives follow-ups, revalidates its source, and is ignored on a new topic', async () => {
  reviewedArchive([
    q({ id: 'apify-one', title: 'Chennai stamping', body: 'My Chennai stamping took ten days.' }),
    q({ id: 'apify-two', title: 'Chennai stamping', body: 'My Chennai stamping took seven days.' }),
    q({ id: 'apify-schengen', title: 'Schengen update', body: 'My Schengen post-interview update arrived on Thursday.' }),
  ]);
  const focusedPost = { questionId: 'apify-two', sourceId: 'q:apify-two' };
  const input = { mode: 'ask', scope: { kind: 'public' }, question: 'How long?', previousQuestions: ['Find posts about Chennai stamping', 'Explain the second post.'], focusedPost,
    previousPosts: [focusedPost] };
  for (const question of ['How long?', 'Why?', 'What happened next?']) {
    const result = await retrieveAssistantCorpus(client(), { ...input, question });
    assert.deepEqual(result.sources.map(source => source.questionId), ['apify-two']);
  }
  for (const question of ['When did Schengen updates arrive?', 'New topic: How did the first post-interview update look for Schengen?']) {
    const db = client(); const result = await retrieveAssistantCorpus(db, { ...input, question });
    assert.equal(db.calls[0].rpc, 'assistant_sources');
    assert.deepEqual(result.sources.map(source => source.questionId), ['apify-schengen']);
    assert.doesNotMatch(db.calls[0].args.query_text, /Chennai/);
  }
  const unavailable = await retrieveAssistantCorpus(client(), { ...input, focusedPost: { questionId: 'apify-two', sourceId: 'a:apify-deleted' } });
  assert.equal(unavailable.sources.length, 0);
});

test('missing, hidden, deleted, and mismatched ordinal references never recover prior source text', async () => {
  const input = { mode: 'ask', scope: { kind: 'public' }, question: 'Explain the first post.', previousPosts: [{ questionId: id, sourceId: `q:${id}` }] };
  const missing = client();
  assert.equal((await retrieveAssistantCorpus(missing, { ...input, previousPosts: [] })).sources.length, 0); assert.equal(missing.calls.length, 0);
  for (const question of ['Explain post 0.', 'Explain the 50th post.', 'Explain post 999.']) {
    assert.equal((await retrieveAssistantCorpus(missing, { ...input, question })).sources.length, 0); assert.equal(missing.calls.length, 0);
  }
  const hidden = client({ question_feed: { data: null, error: null } });
  assert.equal((await retrieveAssistantCorpus(hidden, input)).sources.length, 0); assert.equal(hidden.calls.length, 1);
  const visible = client({ question_feed: { data: q(), error: null }, answer_feed: { data: [], error: null } });
  assert.equal((await retrieveAssistantCorpus(visible, { ...input, previousPosts: [{ questionId: id, sourceId: `a:${a().id}` }] })).sources.length, 0);
  assert.equal((await retrieveAssistantCorpus(visible, { ...input, previousPosts: [{ questionId: id, sourceId: 'q:33333333-3333-4333-8333-333333333333' }] })).sources.length, 0);
});

test('archive ordinal reads retain the same approval boundary and no arbitrary source URL is fetched', async () => {
  reviewedArchive([q({ id: 'apify-first' }), q({ id: 'apify-second', body: 'My Chennai appointment was Wednesday.' })]);
  const input = { mode: 'ask', scope: { kind: 'public' }, question: 'Explain post 2.', previousPosts: [{ questionId: 'apify-first', sourceId: 'q:apify-first' }, { questionId: 'apify-second', sourceId: 'q:apify-second' }] };
  const result = await retrieveAssistantCorpus(client(), input);
  assert.equal(result.sources[0].questionId, 'apify-second');
  delete process.env.IMPORTED_CONTENT_APPROVED;
  const db = client(); await assert.rejects(() => retrieveAssistantCorpus(db, input), /not available/); assert.equal(db.calls.length, 0);
});

test('more posts reuses the topic and excludes seen posts without cycling outside the bounded search window', async () => {
  reviewedArchive(Array.from({ length: 4 }, (_, i) => q({ id: `apify-${i}`, title: 'Chennai stamping delay', body: 'My Chennai visa stamping is still pending after the interview.' })));
  const input = { mode: 'ask', scope: { kind: 'public' }, question: 'Show me more posts.', previousQuestions: ['Find posts about Chennai stamping delay', 'Show me more posts.'],
    previousPosts: [{ questionId: 'apify-1', sourceId: 'q:apify-1' }], seenPostIds: ['apify-0', 'apify-1'] };
  const db = client(); const corpus = await retrieveAssistantCorpus(db, input); const result = buildAssistantPostSearchResult(input, corpus);
  assert.deepEqual(result.posts.map(post => post.questionId), ['apify-2', 'apify-3']);
  assert.equal(db.calls[0].args.query_text.includes('more'), false);
  const exhausted = { ...input, seenPostIds: Array.from({ length: 48 }, (_, i) => `apify-${i}`) };
  const exhaustedDb = client(); const exhaustedCorpus = await retrieveAssistantCorpus(exhaustedDb, exhausted);
  const noMore = buildAssistantPostSearchResult(exhausted, exhaustedCorpus);
  assert.equal(exhaustedDb.calls.length, 0); assert.equal(noMore.posts.length, 0); assert.equal(noMore.coverage.partial, true);
  assert.match(noMore.unanswered[0], /No additional posts in this search window/);
});

const postSearchRequest = (question = 'give all posts related to stamping delay') => ({ mode: 'ask', scope: { kind: 'public' }, question });
const searchSource = (overrides = {}) => ({ id: 'q:apify-stamping', questionId: 'apify-stamping', kind: 'question', communityId: null,
  title: 'My stamping delay', body: 'My H-1B stamping is delayed; I am still waiting for my passport.',
  createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z', url: '/questions/apify-stamping', provenance: 'archive', ...overrides });

test('explicit post requests use search intent; explanation questions and single-post asks do not', () => {
  for (const question of ['give all posts related to stamping delay', 'Can you show me posts about stamping delays?',
    'Can you show me all posts about stamping delay?', 'List discussions about passport delivery', 'posts related to Chennai stamping',
    'find me posts about stamping delay', 'search for posts about stamping delay', 'look for posts about stamping delay', 'I want posts about stamping delay', 'Find stamping delay threads']) {
    assert(assistantPostSearchQuery(postSearchRequest(question)), question);
  }
  for (const question of ['Why is stamping delayed?', 'What do the posts say about stamping delays?', 'Explain this post about stamping',
    'Give me an answer about stamping delay', 'show all posts', 'show why posts about stamping delay have conflicting timelines',
    'give an explanation of why posts about stamping delay differ', 'Show me how posts on stamping delays differ', 'List differences between posts about stamping',
    'show a synopsis of posts about stamping delay', 'give overview of posts about stamping delay']) {
    assert.equal(assistantPostSearchQuery(postSearchRequest(question)), null, question);
  }
  assert.equal(assistantPostSearchQuery({ ...postSearchRequest(), scope: { kind: 'post', id } }), null);
  assert.equal(assistantPostSearchQuery({ ...postSearchRequest(), mode: 'catchup' }), null);
  assert.equal(assistantPostSearchQuery(postSearchRequest()).text, 'stamping delay');
});

test('stamping delay search requires both concepts and recognizes real processing variants', () => {
  const query = assistantPostSearchQuery(postSearchRequest());
  for (const body of ['My stamping has been delayed since last month.', 'My dropbox case is pending without an update.',
    'The visa passport is still waiting at the consulate.', 'My visa interview ended in administrative processing.',
    'I received 221(g) after my interview.']) {
    assert(assistantPostSearchScore(searchSource({ title: 'Member experience', body }), query) > 0, body);
  }
  for (const body of ['My H-1B extension has been pending for 10 months.', 'My stamping was approved and passport arrived Friday.',
    'My EAD renewal is delayed.', 'My appointment options are Tuesday or Friday.', 'My passport renewal at the county office is pending.']) {
    assert.equal(assistantPostSearchScore(searchSource({ title: 'Member experience', body }), query), 0, body);
  }
  assert.equal(assistantPostSearchScore(searchSource({ body: 'My Chennai stamping is pending.' }),
    assistantPostSearchQuery(postSearchRequest('Find posts about Hyderabad stamping delays'))), 0, 'Explicit city restriction is preserved');
  assert(assistantPostSearchScore(searchSource({ title: 'H-1B visa delay', body: 'My H-1B stamping is pending.' }),
    assistantPostSearchQuery(postSearchRequest('Find posts about H1B stamping delay'))) > 0);
  assert(assistantPostSearchScore(searchSource({ title: 'H1B visa delay', body: 'My H1B stamping is pending.' }),
    assistantPostSearchQuery(postSearchRequest('Find posts about H-1B stamping delay'))) > 0);
  assert.equal(assistantPostSearchScore(searchSource({ title: 'H-4 stamping', body: 'My H-4 stamping is pending.' }),
    assistantPostSearchQuery(postSearchRequest('Find posts about H1B stamping delay'))), 0, 'Visa type restriction survives normalization');
});

test('stamping delays must refer to stamping rather than a different process elsewhere in the post', () => {
  const query = assistantPostSearchQuery(postSearchRequest());
  const unrelated = [
    searchSource({ kind: 'reply', title: 'Help, I received a job offer and have H1B visa stamping on October 19. What is the transfer timeline?',
      body: 'With premium processing it should take 15 days, but there are delays in premium processing. You may have to wait until 2027.' }),
    searchSource({ title: 'Travel to Pakistan for H1B stamping', body: 'I am planning to travel to Pakistan to get my H1B stamped. My I-140 has already been filed and I am waiting on the decision. Has anyone had their H1B stamped in this situation?' }),
    searchSource({ title: 'Grace period and new job', body: 'Will my grace period affect visa stamping or the green card process? I am concerned about a delayed start date at my new job.' }),
    searchSource({ title: 'Visa stamping plan after H1B extension', body: 'My H1B extension petition has been pending for eight months. Once it is approved, I plan to travel for visa stamping.' }),
    searchSource({ kind: 'reply', title: 'Visa stamping appointment options', body: 'I upgraded my H1B petition to premium processing two weeks ago and am still waiting for approval.', parentContext: 'I am planning a future visa stamping appointment after my petition approval.' }),
    searchSource({ title: 'Travel and stamping after I-140', body: 'My I-140 has been pending for several months. I plan to schedule visa stamping next year.' }),
    searchSource({ title: 'H1B plans', body: 'My H1B extension petition is pending before I can go for stamping.' }),
    searchSource({ title: 'Member question', body: 'I have a visa interview next month and I am waiting to hear back from my employer about my H1B petition.' }),
  ];
  for (const source of unrelated) assert.equal(assistantPostSearchScore(source, query), 0, source.body);
  const relevant = [
    'I have been waiting for my H1B stamps for months.',
    'H1B stamping at Chennai. Still waiting for my passport.',
    'I attended my visa interview at the embassy. My passport has not yet been returned.',
    'My stamping interview was on Monday. The case is still pending.',
    'I attended my visa interview on Monday. My case is still pending with no update.',
    'Had my visa interview last month. Still waiting.',
    'I completed my dropbox appointment. No update since last month.',
    'My H1B extension was approved, but the stamping appointment is delayed.',
    'My I-140 is pending. Separately, my visa stamping has been delayed for weeks.',
    'My H1B stamping is delayed and this is affecting my job start date.',
    'I am waiting for a visa stamping appointment at the consulate.',
    'I completed my H1B stamping interview and I am still waiting for my passport.',
    'I completed my H1B stamping interview and I am still waiting for an update.',
    "I completed my H1B stamping interview and I'm still waiting for an update.",
  ];
  for (const body of relevant) assert(assistantPostSearchScore(searchSource({ title: 'Member report', body }), query) > 0, body);
  assert(assistantPostSearchScore(searchSource({ title: 'Chennai stamping', body: 'My case is still pending after three weeks. No updates yet.' }), query) > 0);
  assert(assistantPostSearchScore(searchSource({ kind: 'reply', title: 'Chennai stamping interview', parentContext: 'I attended the stamping interview on Monday.', body: 'Mine is still pending.' }), query) > 0);
  const direct = assistantPostSearchScore(searchSource({ title: 'Member report', body: 'My stamping is delayed.' }), query);
  const indirect = assistantPostSearchScore(searchSource({ kind: 'reply', title: 'Chennai stamping interview', parentContext: 'I attended the stamping interview on Monday.', body: 'Mine is still pending.' }), query);
  assert(direct > indirect, 'Direct stamping-delay evidence ranks ahead of context-dependent replies');
});

test('exact production query retrieves only relevant posts, deduplicates replies, and strips command noise from native search', async () => {
  reviewedArchive([
    q({ id: 'apify-delay', title: 'Stamping delay', body: 'My visa stamping was delayed for two weeks.' }),
    q({ id: 'apify-admin', title: 'Visa interview', body: 'I am in administrative processing with the consulate.' }),
    q({ id: 'apify-extension', title: 'H-1B extension pending', body: 'My extension has been pending for ten months.' }),
    q({ id: 'apify-completed', title: 'Stamping completed', body: 'My stamping was approved and passport arrived Friday.' }),
  ], { 'apify-delay': [a(1, { question_id: 'apify-delay', body: 'My stamping delay lasted three weeks; still waiting for the passport.' })] });
  const db = client();
  const corpus = await retrieveAssistantCorpus(db, postSearchRequest());
  assert.deepEqual(new Set(corpus.sources.map(source => source.questionId)), new Set(['apify-delay', 'apify-admin']));
  assert.equal(corpus.sources.length, 2, 'Replies do not consume separate post slots');
  assert.match(db.calls[0].args.query_text, /stamping delay/);
  assert.doesNotMatch(db.calls[0].args.query_text, /give|all posts|related/);
  const result = buildAssistantPostSearchResult(postSearchRequest(), corpus);
  assert.equal(result.kind, 'posts'); assert.equal(result.status, 'answered');
  assert.equal(result.posts.length, 2); assert.equal(result.coverage.partial, false);
  assert.deepEqual(result.claims, []); assert.deepEqual(result.disagreements, []);
  for (const post of result.posts) assert.equal(post.url, `/questions/${post.questionId}`);
});

test('native search candidates receive the same strict topic filter as the archive', async () => {
  delete process.env.COMMUNITY_SOURCE_MODE;
  const rows = [
    { source_id: 'q:apify-native-delay', source_kind: 'question', question_id: 'apify-native-delay', community_id: null,
      title: 'Dropbox delay', body: 'My dropbox visa is still pending.', created_at: q().created_at, updated_at: q().updated_at },
    { source_id: `q:${id}`, source_kind: 'question', question_id: id, community_id: null,
      title: 'Petition delay', body: 'My H-1B extension is pending.', created_at: q().created_at, updated_at: q().updated_at },
  ];
  const result = await retrieveAssistantCorpus(client({}, { data: rows, error: null }), postSearchRequest());
  assert.deepEqual(result.sources.map(source => source.questionId), ['apify-native-delay']);
});

test('post results use actual excerpts, redact identifiers, canonicalize links, and retain matches beyond model context caps', () => {
  const body = `${'Unrelated introduction. '.repeat(250)}My stamping delay remains pending. Contact person@example.com for details.`;
  const corpus = { partial: false, sources: [
    searchSource({ body, url: 'https://untrusted.example/tracker', parentContext: 'Private parent context' }),
    searchSource({ id: 'a:reply', kind: 'reply', body: 'My stamping remains delayed.', url: '/arbitrary' }),
    searchSource({ id: 'q:bad', questionId: '../escape', body: 'My stamping is pending.' }),
  ] };
  const result = buildAssistantPostSearchResult(postSearchRequest(), corpus, 0);
  assert.equal(result.posts.length, 1); assert.equal(result.posts[0].url, '/questions/apify-stamping');
  assert.match(result.posts[0].excerpt, /stamping delay remains pending/);
  assert.match(result.posts[0].excerpt, /\[email removed\]/);
  assert(!JSON.stringify(result).includes('person@example.com'));
  assert(!JSON.stringify(result).includes('Private parent context'));
  assert(!JSON.stringify(result).includes('untrusted.example'));
  assert(result.posts[0].excerpt.length <= 360);
  assert.equal(result.generatedAt, '1970-01-01T00:00:00.000Z');
});

test('search returns a clear empty result rather than a source-verification failure', () => {
  const result = buildAssistantPostSearchResult(postSearchRequest(), { partial: true, sources: [searchSource({ title: 'Extension', body: 'My petition is pending.' })] });
  assert.equal(result.kind, 'posts'); assert.equal(result.status, 'insufficient');
  assert.deepEqual(result.posts, []); assert.equal(result.coverage.partial, true);
  assert.deepEqual(result.unanswered, ['No matching posts found. Try a broader topic.']);
});

test('search caps unique results honestly without allowing repeated replies to crowd out other posts', async () => {
  const questions = Array.from({ length: 55 }, (_, index) => q({ id: `apify-delay-${index}`, title: 'Stamping delay', body: 'My stamping is pending at the consulate.' }));
  reviewedArchive(questions, { 'apify-delay-0': Array.from({ length: 60 }, (_, index) => a(index, { question_id: 'apify-delay-0', body: 'My stamping delay is still pending.' })) });
  const corpus = await retrieveAssistantCorpus(client(), postSearchRequest());
  assert.equal(corpus.sources.length, 48); assert.equal(new Set(corpus.sources.map(source => source.questionId)).size, 48);
  assert.equal(corpus.partial, true);
  const result = buildAssistantPostSearchResult(postSearchRequest(), { partial: false,
    sources: Array.from({ length: 60 }, (_, index) => searchSource({ id: `q:apify-${index}`, questionId: `apify-${index}` })) });
  assert.equal(result.posts.length, 48); assert.equal(result.coverage.sourceCount, 48); assert.equal(result.coverage.partial, true);
});

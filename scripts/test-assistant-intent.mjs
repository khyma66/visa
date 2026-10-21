import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, afterEach } from 'node:test';
import ts from 'typescript';
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const read = name => readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
const tagging = moduleUrl(compile(await read('tagging')));
const context = moduleUrl(compile(await read('assistant-context')));
const core = moduleUrl(compile(await read('assistant-core')).replace("'./assistant-context'", JSON.stringify(context)));
const search = moduleUrl(compile(await read('assistant-search')).replace("'./assistant-core'", JSON.stringify(core)).replace("'./assistant-context'", JSON.stringify(context)));
const data = moduleUrl(compile(await read('assistant-data')).replace("import archive from '@visa/archive';", 'const archive = new Proxy({}, { get: (_, key) => globalThis.__intentArchive[key] });')
  .replace("'./tagging'", JSON.stringify(tagging)).replace("'./assistant-core'", JSON.stringify(core)).replace("'./assistant-search'", JSON.stringify(search)).replace("'./assistant-context'", JSON.stringify(context)));
const { assistantSearchIntent, assistantSourceMatchesIntent, assistantRefersToEarlierTurn, assistantPreviousPost } = await import(context);
const { assistantPostSearchQuery, buildAssistantPostSearchResult } = await import(search);
const { retrieveAssistantCorpus } = await import(data);
const now = Date.parse('2026-10-17T12:00:00Z');
const ask = question => ({ mode: 'ask', scope: { kind: 'public' }, question });
const q = (id, body, date = '2026-10-16T12:00:00Z', title = 'Member interview report') => ({ id, body, title, created_at: date, updated_at: date, status: 'open', community_id: null });
const source = row => ({ id: `q:${row.id}`, questionId: row.id, kind: 'question', title: row.title, body: row.body, createdAt: row.created_at, updatedAt: row.updated_at, communityId: null, provenance: 'archive', url: `/questions/${row.id}` });
const saved = Object.fromEntries(['APP_ENV', 'COMMUNITY_SOURCE_MODE', 'IMPORTED_CONTENT_APPROVED'].map(name => [name, process.env[name]]));
afterEach(() => { for (const [name, value] of Object.entries(saved)) value === undefined ? delete process.env[name] : process.env[name] = value; delete globalThis.__intentArchive; });
function archive(questions) { process.env.APP_ENV = 'production'; process.env.COMMUNITY_SOURCE_MODE = 'snapshot'; process.env.IMPORTED_CONTENT_APPROVED = 'true'; globalThis.__intentArchive = { questions, answersByQuestionId: {} }; }
function client() {
  const calls = [];
  return { calls,
    rpc(name, args) { calls.push({ rpc: name, args }); return Promise.resolve({ data: [], error: null }); },
    from(table) {
      const call = { table, filters: {} }; calls.push(call);
      const chain = { select() { return chain; }, eq(key, value) { call.filters[key] = value; return chain; },
        or(value) { call.or = value; return chain; }, gte(key, value) { call.filters[`${key}_gte`] = value; return chain; }, lt(key, value) { call.filters[`${key}_lt`] = value; return chain; },
        order() { return chain; }, limit(value) { call.limit = value; return chain; }, then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); } };
      return chain;
    },
  };
}

test('experience and story lookup paraphrases normalize multiple cities without rerouting explanation/policy asks', () => {
  for (const [text, city] of [
    ['give recent experience for hyderabad stamping', 'hyderabad'],
    ['Show recent experiences about Chennai stamping', 'chennai'],
    ['Can you share stories about Mumbai visa interviews?', 'mumbai'],
    ['Are there recent Toronto stamping experiences?', 'toronto'],
    ['Find recent London stamping experiences', 'london'],
    ['Show me the most recent Chennai experience', 'chennai'],
    ['Find H1B stories from Hyderabad', 'hyderabad'],
  ]) {
    const query = assistantPostSearchQuery(ask(text), now);
    assert(query, text); assert.deepEqual(query.intent.locations, [city]);
    assert(!query.terms.includes('recent')); assert(!query.terms.includes('experience')); assert(!query.terms.includes('story'));
  }
  for (const text of ['Explain Hyderabad stamping experiences', 'Give advice based on Chennai experiences', 'Show how posts on stamping differ', 'What are the latest visa rules?', 'Can I get a visa based on these stories?'])
    assert.equal(assistantPostSearchQuery(ask(text), now), null, text);
});
test('only explicit relative windows constrain timestamps; recent and latest order newest available', () => {
  for (const [text, days] of [['Show recent Hyderabad stamping experiences in the last 30 days', 30], ['Find posts about Chennai stamping in the last week', 7], ['Show stories about Mumbai stamping in the past two weeks', 14], ['Find posts about London stamping in the last month', 30]]) {
    const intent = assistantSearchIntent(ask(text), now);
    assert.equal(intent.since, new Date(now - days * 86_400_000).toISOString()); assert.equal(intent.until, new Date(now).toISOString());
    assert.equal(intent.order, 'newest'); assert.equal(intent.softRecent, false); assert.doesNotMatch(intent.text, /\b(?:recent|last week|two weeks|last month)\b/i);
  }
  for (const text of ['Show latest posts about Hyderabad stamping', 'Show recent Hyderabad stamping experiences', 'give recent h4 ead experiences']) {
    const intent = assistantSearchIntent(ask(text), now);
    assert.equal(intent.order, 'newest'); assert.equal(intent.since, undefined); assert.equal(intent.until, undefined);
    assert.equal(intent.softRecent, /\brecent\b/i.test(text));
  }
  for (const phrase of ['last 0 days', 'past 400 days']) assert(assistantSearchIntent(ask(`Find posts about Hyderabad stamping in the ${phrase}`), now).unsupportedWindow);
});
test('history expansion stays within RPC bounds and extracts only supported visa-code shapes', () => {
  const input = { ...ask(`What about that ${'detail '.repeat(160)}?`), previousQuestions: [`Hyderabad H1B stamping ${'report '.repeat(160)}`] };
  assert(assistantSearchIntent(input, now).text.length <= 1500);
  assert.deepEqual(assistantSearchIntent(ask('Show experiences for H1B H-4 F1 F2 L1 L2 B1 B2 J1 J2 O1 E-3'), now).visas,
    ['h1b', 'h4', 'f1', 'f2', 'l1', 'l2', 'b1', 'b2', 'j1', 'j2', 'o1', 'e3']);
});
test('location and explicit visa eligibility reject wrong or unspecified classes and recognize aliases', () => {
  const intent = assistantSearchIntent(ask('Show Hyderabad H1B stamping experiences'), now);
  for (const visa of ['H1B', 'h-1b', 'h 1b']) assert(assistantSourceMatchesIntent(source(q('apify-good', `My HYD ${visa} visa interview completed.`)), intent));
  for (const body of ['My Chennai H1B stamping completed.', 'My Hyderabad H4 stamping completed.', 'My Hyderabad stamping completed.']) assert(!assistantSourceMatchesIntent(source(q('apify-bad', body)), intent), body);
  const mumbai = assistantSearchIntent(ask('Show latest Mumbai stamping stories'), now);
  assert(assistantSourceMatchesIntent(source(q('apify-alias', 'My Bombay visa interview completed.')), mumbai));
});
test('posting-date boundaries are inclusive start, exclusive end, never body event-date guesses', () => {
  const intent = assistantSearchIntent(ask('Find posts about Chennai stamping in the last week'), now);
  for (const [date, accepted] of [[intent.since, true], [intent.until, false], ['2025-01-01T00:00:00Z', false]])
    assert.equal(assistantSourceMatchesIntent(source(q('apify-date', 'My Chennai stamping happened October 16.', date)), intent), accepted);
});
test('requested city survives distractor saturation before both lookup and generic-answer context caps', async () => {
  archive([...Array.from({ length: 70 }, (_, i) => q(`apify-wrong-${i}`, 'My recent experience stamping was in Chennai.', undefined, 'Recent experience stamping')),
    q('apify-right', 'My Hyderabad visa interview completed successfully.')]);
  for (const text of ['give recent experience for hyderabad stamping', 'What did members report about Hyderabad stamping?']) {
    const result = await retrieveAssistantCorpus(client(), ask(text), now);
    assert.deepEqual(result.sources.map(row => row.questionId), ['apify-right'], text);
  }
});
test('newest available results beat lexical popularity; only explicit windows can exclude older posts', async () => {
  archive([q('apify-old', 'My Hyderabad stamping completed.', '2025-01-01T00:00:00Z', 'Hyderabad stamping'), q('apify-new', 'My Hyderabad stamping completed.')]);
  const latest = ask('Show latest posts about Hyderabad stamping');
  const result = buildAssistantPostSearchResult(latest, await retrieveAssistantCorpus(client(), latest, now), now);
  assert.deepEqual(result.posts.map(post => post.questionId), ['apify-new', 'apify-old']);
  archive([q('apify-old', 'My Hyderabad stamping completed.', '2025-01-01T00:00:00Z')]);
  const recent = ask('Give recent experience for Hyderabad stamping');
  const available = buildAssistantPostSearchResult(recent, await retrieveAssistantCorpus(client(), recent, now), now);
  assert.equal(available.status, 'answered'); assert.deepEqual(available.posts.map(post => post.questionId), ['apify-old']);
  assert.equal(available.coverage.since, undefined); assert.match(available.postsIntro, /2025-01-01/);
  const explicit = ask('Give Hyderabad stamping experiences from the last 30 days');
  const empty = buildAssistantPostSearchResult(explicit, await retrieveAssistantCorpus(client(), explicit, now), now);
  assert.equal(empty.status, 'insufficient'); assert.equal(empty.posts.length, 0); assert(empty.coverage.since); assert.match(empty.unanswered[0], /Older discussions may exist/);
});
test('H4 EAD lookup returns latest matching experiences across older posting dates without a model', async () => {
  archive([
    q('apify-h4-older', 'My H4 EAD renewal was approved.', '2026-08-10T12:00:00Z', 'H4 EAD renewal experience'),
    q('apify-h1-distractor', 'My H1B EAD experience.', '2026-10-16T12:00:00Z', 'H1B EAD'),
    q('apify-h4-latest', 'My H-4 EAD application was approved.', '2026-09-11T17:56:57Z', 'H4 EAD experience'),
    q('apify-h4-no-ead', 'My H4 stamping experience.', '2026-10-15T12:00:00Z', 'H4 stamping'),
  ]);
  const input = ask('give recent h4 ead experiences');
  const query = assistantPostSearchQuery(input, now);
  assert(query); assert.deepEqual(query.intent.visas, ['h4']); assert.equal(query.intent.since, undefined);
  const result = buildAssistantPostSearchResult(input, await retrieveAssistantCorpus(client(), input, now), now);
  assert.deepEqual(result.posts.map(post => post.questionId), ['apify-h4-latest', 'apify-h4-older']);
  assert.match(result.postsIntro, /2026-09-11/); assert.equal(result.coverage.since, undefined);
});
test('native and imported reads receive pre-limit constraints and bounded date filters', async () => {
  archive([q('apify-parent', 'My Hyderabad H-1B stamping report.')]);
  const db = client(); await retrieveAssistantCorpus(db, ask('Show recent Hyderabad H1B stamping experiences'), now);
  const rpc = db.calls.find(call => call.rpc); assert.equal(rpc.rpc, 'assistant_sources_v2');
  assert.deepEqual(rpc.args.required_locations, ['hyderabad', 'hyd']); assert.deepEqual(rpc.args.required_visas, ['h1b']);
  assert.equal(rpc.args.required_event, 'stamping'); assert.equal(rpc.args.sort_newest, true); assert.equal(rpc.args.since_time, null);
  const imported = db.calls.find(call => call.or); assert.match(imported.or, /^and\(or\(/); assert.match(imported.or, /question_id\.in\.\(apify-parent\)/);
  assert.equal(imported.filters.created_at_gte, undefined); assert.equal(imported.filters.created_at_lt, undefined);
});
test('self-contained city switches ignore focused posts despite incidental pronouns; real references remain scoped', async () => {
  archive([q('apify-hyd', 'My Hyderabad stamping completed.'), q('apify-che', 'My Chennai stamping completed.')]);
  const focusedPost = { questionId: 'apify-hyd', sourceId: 'q:apify-hyd' };
  const input = { ...ask('Are there recent Chennai stamping experiences?'), previousQuestions: ['Find posts about Hyderabad stamping', 'Explain the first post.'], focusedPost, previousPosts: [focusedPost] };
  assert.equal(assistantRefersToEarlierTurn(input.question), false); assert.equal(assistantPreviousPost(input), null);
  const db = client(); const corpus = await retrieveAssistantCorpus(db, input, now);
  assert.deepEqual(corpus.sources.map(row => row.questionId), ['apify-che']); assert(db.calls.some(call => call.rpc));
  for (const question of ['How long?', 'Why?', 'What happened next?', 'What happened there?', 'Explain that post.']) assert.equal(assistantPreviousPost({ ...input, question })?.questionId, 'apify-hyd', question);
});
test('personal follow-ups keep selected focus only when named city and visa agree with prior topic', async () => {
  archive([q('apify-selected', 'My Chennai H1B stamping completed in seven days.'), q('apify-other', 'My Hyderabad H4 stamping completed in nine days.')]);
  const focusedPost = { questionId: 'apify-selected', sourceId: 'q:apify-selected' };
  const input = { ...ask('How long did their H1B stamping take?'), focusedPost,
    previousQuestions: ['Find Chennai H1B stamping experiences', 'Explain the first post.'], previousPosts: [focusedPost] };
  assert.deepEqual(assistantPreviousPost(input), focusedPost);
  const db = client(); const corpus = await retrieveAssistantCorpus(db, input, now);
  assert.deepEqual(corpus.sources.map(row => row.questionId), ['apify-selected']); assert(!db.calls.some(call => call.rpc));
  for (const question of ['How long did their H4 stamping take?', 'When did their Hyderabad stamping finish?']) {
    const changed = { ...input, question };
    assert.equal(assistantPreviousPost(changed), null, question);
    const changedDb = client(); await retrieveAssistantCorpus(changedDb, changed, now);
    assert(changedDb.calls.some(call => call.rpc), 'A conflicting named topic must not read only the previously selected post');
  }
  assert.deepEqual(assistantPreviousPost({ ...input, question: 'Explain that post about H4.' }), focusedPost, 'Explicit discussion selection remains authoritative; evidence review judges its contents');
  assert.equal(assistantPreviousPost({ ...input, previousQuestions: [], question: 'How long did their H1B stamping take?' }), null, 'Missing topic context does not establish agreement');
});

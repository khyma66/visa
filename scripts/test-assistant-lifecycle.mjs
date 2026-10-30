import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { build, transform } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const root = new URL('../', import.meta.url).pathname;
const entry = `export * from ${JSON.stringify(root + 'src/lib/assistant-service.ts')}; export { AssistantError } from ${JSON.stringify(root + 'src/lib/assistant-core.ts')}; export { runAssistantModel } from ${JSON.stringify(root + 'src/lib/assistant-provider.ts')}; export { retrieveAssistantCorpus } from ${JSON.stringify(root + 'src/lib/assistant-data.ts')}; export { acceptanceFixtures } from ${JSON.stringify(root + 'scripts/assistant-acceptance-fixtures.ts')};`;
const bundled = await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent',
  plugins: [{ name: 'synthetic-archive', setup(builder) {
    builder.onResolve({ filter: /^@visa\/archive$/ }, () => ({ path: 'archive', namespace: 'synthetic' }));
    builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, () => ({ contents: 'export default { questions: [], answersByQuestionId: {} };', loader: 'js' }));
  } }],
});
const moduleUrl = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const serviceUrl = moduleUrl(bundled.outputFiles[0].text);
const service = await import(serviceUrl);
const id = '00000000-0000-4000-8000-000000000001';
const source = { id: `q:${id}`, questionId: id, communityId: null, kind: 'question', title: 'Appointment', body: 'My passport arrived on Friday.', createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z', url: `/questions/${id}`, provenance: 'member' };
const input = { mode: 'ask', scope: { kind: 'post', id }, question: 'When did the passport arrive?' };
const output = { status: 'answered', claims: [{ text: 'The member reported Friday delivery.', evidence: [{ sourceId: source.id, quote: source.body }] }], disagreements: [], unanswered: [] };
const review = prompt => JSON.stringify({ fulfillsTask: true, checks: prompt.reviewIds.map(id => ({ id, supported: true })) });
const request = (signal, body = input) => new Request('https://visathreads.com/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${'synthetic-token'.repeat(3)}`, 'X-VisaThreads-Request-Id': 'caller-controlled' }, body: JSON.stringify(body), signal });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(overrides = {}) {
  const state = { reads: 0, reserved: 0, generated: 0, reviewed: 0, cache: new Map(), writes: 0, failures: [], timings: [], signals: [] };
  const session = { actor: 'synthetic-actor', async corpus(_input, signal) { state.signals.push(signal); state.reads++; return { sources: [source], partial: false }; }, async reserve(signal) { state.signals.push(signal); state.reserved++; return true; } };
  const deps = {
    availability: () => ({ posts: true, communities: true, catchup: true }), model: 'synthetic-model',
    authenticate: async (_token, context) => { state.signals.push(context.signal); return session; },
    async generate(prompt, signal) { state.signals.push(signal); if (prompt.outputKind === 'review') { state.reviewed++; return review(prompt); } state.generated++; return JSON.stringify(output); },
    cache: { get: async key => state.cache.get(key) ?? null, put: async (key, value) => { state.writes++; state.cache.set(key, value); } },
    reportFailure: event => state.failures.push(event), reportTiming: event => state.timings.push(event), ...overrides,
  };
  return { state, session, deps, handler: service.createAssistantHandler(deps) };
}

test('one request owns every stage signal and performs exactly one final fresh access check', async () => {
  const h = harness(); const response = await h.handler(request());
  assert.equal(response.status, 200); assert.equal(h.state.reads, 2); assert.equal(h.state.reserved, 1);
  assert.equal(h.state.generated, 1); assert.equal(h.state.reviewed, 1); assert.equal(h.state.writes, 1);
  assert(h.state.signals.length >= 6); assert(h.state.signals.every(signal => signal === h.state.signals[0]));
  assert.match(response.headers.get('x-visathreads-request-id'), /^[0-9a-f-]{36}$/);
  assert.match(response.headers.get('server-timing'), /^assistant;dur=\d+$/);
  assert.equal(h.state.timings[0].requestId, response.headers.get('x-visathreads-request-id'));
  assert.deepEqual(h.state.failures, []);
  const cached = await h.handler(request());
  assert.equal(cached.status, 200); assert.equal((await cached.json()).cached, true);
  assert.equal(h.state.reads, 4); assert.equal(h.state.generated, 1); assert.equal(h.state.reserved, 1);
  assert.notEqual(cached.headers.get('x-visathreads-request-id'), response.headers.get('x-visathreads-request-id'));
});

test('identical concurrent callers do not share cancellation, reservations or pending generation', async () => {
  const waits = [], signals = [];
  const h = harness({ generate: async (prompt, signal) => { if (prompt.outputKind === 'review') return review(prompt); const item = deferred(); waits.push(item); signals.push(signal); return item.promise; } });
  const ownerController = new AbortController();
  const owner = h.handler(request(ownerController.signal));
  // Keep both requests in flight, but establish which deferred generation
  // belongs to the owner before scheduling the independent waiter.
  while (waits.length < 1) await tick();
  const waiter = h.handler(request());
  while (waits.length < 2) await tick();
  assert.equal(h.state.reserved, 2); assert.notEqual(signals[0], signals[1]);
  ownerController.abort(); const stopped = await owner;
  assert.equal(stopped.status, 499); assert.equal((await stopped.json()).code, 'cancelled');
  assert.equal(signals[0].aborted, true); assert.equal(signals[1].aborted, false);
  waits[1].resolve(JSON.stringify(output)); assert.equal((await waiter).status, 200);
  waits[0].resolve(JSON.stringify(output)); await tick();
  assert.equal(h.state.writes, 1); assert.equal(h.state.reads, 3, 'Aborted owner must not revalidate after late generation');
});

test('uncitable reports return an honest empty result after fresh access checks without spending model quota', async () => {
  for (const body of ['Did anyone receive a passport after the appointment?', 'x'.repeat(401)]) {
    const h = harness();
    h.session.corpus = async () => { h.state.reads++; return { sources: [{ ...source, body }], partial: false }; };
    const response = await h.handler(request()), result = await response.json();
    assert.equal(response.status, 200); assert.equal(result.status, 'insufficient');
    assert.deepEqual(result.claims, []); assert.deepEqual(result.disagreements, []); assert.deepEqual(result.sources, []);
    assert.equal(result.coverage.sourceCount, 1); assert(result.unanswered.length > 0);
    assert.equal(h.state.reads, 2); assert.equal(h.state.reserved, 0); assert.equal(h.state.generated, 0);
    assert.equal(h.state.reviewed, 0); assert.equal(h.state.writes, 0);
  }
});

test('uncitable reports never bypass changed-source or revoked-access checks', async () => {
  for (const status of [403, 409, 503]) {
    const h = harness();
    h.session.corpus = async () => {
      if (++h.state.reads > 1) throw new service.AssistantError(status, 'private revalidation error');
      return { sources: [{ ...source, body: 'Did anyone receive a passport after the appointment?' }], partial: false };
    };
    const response = await h.handler(request());
    assert.equal(response.status, status); assert(!JSON.stringify(await response.json()).includes('private'));
    assert.equal(h.state.reads, 2); assert.equal(h.state.reserved, 0); assert.equal(h.state.generated, 0); assert.equal(h.state.writes, 0);
  }
});

test('late rejections and synchronous abort-then-throw remain handled without resuming work', async () => {
  const unhandled = [], listener = failure => unhandled.push(failure);
  process.on('unhandledRejection', listener);
  try {
    for (const phase of ['authentication', 'generation']) {
      const controller = new AbortController(); let rejectLate, entered = false;
      const h = harness();
      const wait = () => { entered = true; return new Promise((_resolve, reject) => { rejectLate = reject; }); };
      if (phase === 'authentication') h.deps.authenticate = wait;
      else h.deps.generate = wait;
      const pending = h.handler(request(controller.signal));
      while (!entered) await tick();
      controller.abort(); assert.equal((await pending).status, 499);
      rejectLate(Error('synthetic late rejection')); await tick(); await tick();
      assert.equal(h.state.writes, 0); assert.equal(h.state.reviewed, 0);
    }
    const controller = new AbortController(); const h = harness({ authenticate() { controller.abort(); throw Error('synthetic synchronous rejection'); } });
    assert.equal((await h.handler(request(controller.signal))).status, 499);
    await tick(); await tick(); assert.deepEqual(unhandled, []);
    assert.equal(h.state.reads, 0); assert.equal(h.state.reserved, 0);
  } finally { process.removeListener('unhandledRejection', listener); }
});

test('the single total deadline interrupts each asynchronous stage, including dependencies ignoring abort', async () => {
  assert.equal(service.ASSISTANT_REQUEST_BUDGET_MS, 45000);
  for (const phase of ['authentication', 'retrieval', 'quota', 'generation', 'review', 'revalidation', 'cache-read', 'cache-write']) {
    const paused = deferred(); const h = harness({ deadlineMs: 100 });
    let entered = false, capturedSignal;
    const hold = signal => { entered = true; capturedSignal = signal; return paused.promise; };
    if (phase === 'authentication') h.deps.authenticate = (_token, context) => hold(context.signal);
    if (phase === 'retrieval' || phase === 'revalidation') h.session.corpus = async (_input, signal) => {
      h.state.reads++; return h.state.reads > (phase === 'revalidation' ? 1 : 0) ? hold(signal) : { sources: [source], partial: false };
    };
    if (phase === 'quota') h.session.reserve = signal => hold(signal);
    if (phase === 'generation' || phase === 'review') h.deps.generate = async (prompt, signal) =>
      (prompt.outputKind === 'review') === (phase === 'review') ? hold(signal) : JSON.stringify(output);
    if (phase === 'cache-read') h.deps.cache.get = () => hold(h.state.signals[0]);
    if (phase === 'cache-write') h.deps.cache.put = () => hold(h.state.signals[0]);
    const start = Date.now(); const response = await h.handler(request()); const body = await response.json();
    assert(entered, phase); assert.equal(response.status, 504, phase); assert.equal(body.code, 'timeout', phase);
    assert.equal(capturedSignal.aborted, true, phase); assert(Date.now() - start < 1000, phase);
    assert.equal(h.state.failures[0].category, 'timeout');
    const before = { reserved: h.state.reserved, generated: h.state.generated, reviewed: h.state.reviewed, writes: h.state.writes };
    paused.resolve(phase === 'authentication' ? h.session : phase === 'retrieval' || phase === 'revalidation' ? { sources: [source], partial: false } : phase === 'generation' ? JSON.stringify(output) : undefined);
    await tick(); assert.deepEqual({ reserved: h.state.reserved, generated: h.state.generated, reviewed: h.state.reviewed, writes: h.state.writes }, before, `${phase}: late completion continued work`);
  }
});

test('cumulative budget does not reset between individually successful stages', async () => {
  const delay = () => new Promise(resolve => setTimeout(resolve, 60));
  const h = harness({ deadlineMs: 150 });
  h.deps.authenticate = async (_token, context) => { h.state.signals.push(context.signal); await delay(); return h.session; };
  h.session.corpus = async (_input, signal) => { h.state.signals.push(signal); h.state.reads++; await delay(); return { sources: [source], partial: false }; };
  h.deps.generate = async (_prompt, signal) => { h.state.generated++; h.state.signals.push(signal); await delay(); return JSON.stringify(output); };
  const start = Date.now(); const response = await h.handler(request());
  assert.equal(response.status, 504); assert.equal((await response.json()).code, 'timeout');
  assert(Date.now() - start < 1000); assert.equal(h.state.reads, 1); assert.equal(h.state.reviewed, 0); assert.equal(h.state.writes, 0);
});

test('cache-hit live access failures are not swallowed or charged as fresh generations', async () => {
  for (const status of [401, 403, 409, 429, 503]) {
    const h = harness(); assert.equal((await h.handler(request())).status, 200);
    h.session.corpus = async () => { h.state.reads++; if (h.state.reads === 4) throw new service.AssistantError(status, 'private backend error'); return { sources: [source], partial: false }; };
    const result = await h.handler(request());
    assert.equal(result.status, status); assert.equal(h.state.generated, 1); assert.equal(h.state.reserved, 1); assert.equal(h.state.writes, 1);
    assert(!JSON.stringify(await result.json()).includes('private backend error'));
  }
});

test('cache storage or structure failures remain optional, while changed sources prevent cache writes', async () => {
  for (const get of [async () => { throw Error('private cache issue'); }, async () => ({ result: {}, digest: 'invalid' })]) {
    const h = harness(); h.deps.cache.get = get;
    assert.equal((await h.handler(request())).status, 200); assert.equal(h.state.generated, 1);
  }
  const h = harness(); h.session.corpus = async () => ({ sources: h.state.reads++ ? [] : [source], partial: false });
  const response = await h.handler(request());
  assert.equal(response.status, 409); assert.equal((await response.json()).code, 'source_changed'); assert.equal(h.state.writes, 0);
});

test('quota reasons and reset metadata are bounded and request IDs are generated, not reflected', async () => {
  for (const [reason, code] of [['user_daily_limit', 'quota'], ['global_daily_limit', 'quota'], ['user_minute_limit', 'rate_limit']]) {
    const resetAt = new Date(Date.now() + 3600000).toISOString();
    const h = harness(); h.session.reserve = async () => { throw service.assistantLimitError({ reason, reset_at: resetAt, secret: 'private quota diagnostic' }, 'quota'); };
    const response = await h.handler(request()); const body = await response.json();
    assert.equal(response.status, 429); assert.equal(body.code, code); assert.equal(body.quotaReason, reason); assert.equal(body.resetAt, resetAt);
    assert(body.retryAfterSeconds > 3500 && body.retryAfterSeconds <= 3600);
    assert.equal(response.headers.get('retry-after'), String(body.retryAfterSeconds));
    assert.equal(response.headers.get('x-visathreads-request-id'), body.requestId); assert.match(body.requestId, /^[0-9a-f-]{36}$/);
    assert(!JSON.stringify(body).includes('private')); assert.equal(h.state.generated, 0);
  }
  const invalid = service.assistantLimitError({ reason: 'private arbitrary reason', reset_at: '2099-01-01T00:00:00Z' }, 'quota');
  assert.deepEqual(invalid.metadata, {});
});

test('unexpected error text and caller headers never enter public diagnostics; observer failures are harmless', async () => {
  const h = harness({ generate: async () => { throw Error('private source or credential'); }, reportTiming: () => { throw Error('observer failed'); } });
  const response = await h.handler(request()); const body = await response.json();
  assert.equal(response.status, 503); assert.equal(body.code, 'unavailable');
  assert.equal(h.state.failures[0].requestId, body.requestId); assert.equal(typeof h.state.failures[0].durationMs, 'number');
  assert(!JSON.stringify({ body, failures: h.state.failures }).includes('private'));
  assert(!JSON.stringify({ body, failures: h.state.failures }).includes('caller-controlled'));
});

test('review diagnostics expose only validated bounded counts and cannot affect acceptance', async () => {
  const events = [];
  const h = harness({ reportReview: event => { events.push(event); throw Error('private observer failure'); } });
  const response = await h.handler(request());
  assert.equal(response.status, 200); assert.equal((await response.json()).status, 'answered');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { requestId: response.headers.get('x-visathreads-request-id'), recovery: false,
    fulfillsTask: true, supported: 1, rejected: 0, total: 1 });
  assert.doesNotMatch(JSON.stringify(events), /passport|Friday|synthetic-token|sourceId|private observer/);
  const invalid = harness({ reportReview: event => events.push(event), generate: async prompt =>
    prompt.outputKind === 'review' ? '{"checks":[],"fulfillsTask":false,"private":"unvalidated"}' : JSON.stringify(output) });
  assert.equal((await invalid.handler(request())).status, 502); assert.equal(events.length, 1);
});

test('database transport preserves an existing abort signal as well as the request budget', async () => {
  for (const abortWhich of ['request', 'upstream']) {
    const caller = new AbortController(), upstream = new AbortController(); let outgoing;
    const fetcher = service.assistantDatabaseFetch({ signal: caller.signal, requestId: 'synthetic-only' }, async (_url, options) => { outgoing = options; return Response.json({}); });
    await fetcher('https://fixture.invalid/auth', { signal: upstream.signal });
    assert.equal(outgoing.cache, 'no-store'); assert.equal(outgoing.redirect, 'manual'); assert.equal(outgoing.signal.aborted, false);
    (abortWhich === 'request' ? caller : upstream).abort(); assert.equal(outgoing.signal.aborted, true);
  }
});

const rejectedOutput = { ...output, claims: [{ ...output.claims[0], text: 'Rejected-draft sentinel: the passport arrived on Friday at an unstated venue.' }] };
const correctedOutput = { ...output, claims: [{ ...output.claims[0], text: 'The member said their passport arrived on Friday.' }] };
const negativeReview = prompt => JSON.stringify({ fulfillsTask: true, checks: prompt.reviewIds.map(id => ({ id, supported: false })) });

const repeatedSummary = service.acceptanceFixtures.find(fixture => fixture.id === 'large-discussion-summary');
const repeatedSource = repeatedSummary.corpus.sources[0];
const repeatedQuotes = [
  'I attended my Hyderabad stamping appointment on Monday.',
  'My visa was approved and my passport arrived on Friday.',
  'This describes my individual experience, not a standard timeline.',
];
const repeatedEvidence = repeatedQuotes.map(quote => ({ sourceId: repeatedSource.id, quote }));
const representativeSummary = { status: 'answered', claims: [
  { text: 'One report describes attending a Hyderabad stamping appointment on Monday.', evidence: [repeatedEvidence[0]] },
  { text: 'The same report says the visa was approved.', evidence: [repeatedEvidence[1]] },
  { text: 'The same report says the passport arrived on Friday.', evidence: [repeatedEvidence[1]] },
  { text: 'This is the member’s individual experience, not a standard timeline.', evidence: [repeatedEvidence[2]] },
], disagreements: [], unanswered: [] };
const invalidRepeatedSummaries = [
  { text: 'Several members reported attending on Monday and receiving their passports on Friday.', evidence: [repeatedEvidence[0]] },
  { text: 'Several members reported that they attended their Hyderabad visa-stamping appointment on Monday, received visa approval and their passport on Friday, and explicitly stated that this describes their individual experience, not a standard timeline.', evidence: repeatedEvidence.slice(0, 3) },
  { text: 'One report says the passport arrived on the following Friday after the Monday appointment.', evidence: repeatedEvidence.slice(0, 2) },
  { text: 'One report says the visa was approved on Friday.', evidence: [repeatedEvidence[1]] },
  { text: 'Several reports describe visa approval, Friday passport delivery, and an individual-only timeline.',
    evidence: [repeatedEvidence[1]] },
].map(claim => ({ status: 'answered', claims: [claim], disagreements: [], unanswered: [] }));
function withRepeatedSummary(h, corpus = repeatedSummary.corpus) {
  h.session.corpus = async (_input, signal) => { h.state.reads++; h.state.signals.push(signal); return structuredClone(corpus); };
  return h;
}

test('a singular representative summary keeps exact atomic event, outcome and qualification evidence and awaits review', async () => {
  assert.equal(repeatedSummary.corpus.sources.length, 24);
  const prompts = [], reviewing = deferred(), verdict = deferred();
  const h = withRepeatedSummary(harness({ generate: async prompt => {
    prompts.push(prompt);
    if (prompt.outputKind !== 'review') {
      assert.match(prompt.system, /summarize a representative report in the singular/);
      assert.equal(JSON.parse(prompt.user).sources.length, 1, 'Exact repeated report bodies are supplied once for summaries');
      return JSON.stringify(representativeSummary);
    }
    assert.deepEqual(JSON.parse(prompt.user).candidate.checks.map(({ text, evidence }) => ({ text, evidence })), representativeSummary.claims);
    reviewing.resolve(); await verdict.promise; return review(prompt);
  } }));
  let finished = false;
  const pending = h.handler(request(undefined, repeatedSummary.input)).then(response => { finished = true; return response; });
  await reviewing.promise; await tick();
  assert.equal(finished, false); assert.equal(h.state.writes, 0); assert.equal(h.state.reads, 1);
  verdict.resolve(); const response = await pending, result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.status, 'answered');
  assert.deepEqual(result.claims, representativeSummary.claims);
  assert.deepEqual(result.sources.map(item => item.id), [repeatedSource.id]);
  assert.deepEqual(prompts.map(prompt => prompt.outputKind ?? 'answer'), ['answer', 'review']);
  assert.equal(h.state.reserved, 1); assert.equal(h.state.reads, 2); assert.equal(h.state.writes, 1);
  assert.deepEqual([...h.state.cache.values()][0].result.claims, representativeSummary.claims);
});

test('unsupported plural attribution and inferred timing never publish or enter the answer cache after review rejection', async () => {
  for (const [index, initial] of invalidRepeatedSummaries.entries()) {
    const prompts = [];
    const h = withRepeatedSummary(harness({ generate: async prompt => {
      prompts.push(prompt);
      if (prompt.outputKind === 'review') return negativeReview(prompt);
      return JSON.stringify(prompts.length === 1 ? initial : invalidRepeatedSummaries[(index + 1) % invalidRepeatedSummaries.length]);
    } }));
    const response = await h.handler(request(undefined, repeatedSummary.input)), result = await response.json();
    assert.equal(response.status, 200); assert.equal(result.status, 'insufficient');
    assert.deepEqual(result.claims, []); assert.deepEqual(result.disagreements, []); assert.deepEqual(result.sources, []);
    assert.deepEqual(prompts.map(prompt => prompt.outputKind ?? 'answer'), ['answer', 'review', 'answer', 'review']);
    assert.deepEqual(prompts.map(prompt => prompt.maxAttempts), [undefined, undefined, 1, 1]);
    assert.equal(h.state.reserved, 1); assert.equal(h.state.reads, 2);
    for (const rejected of invalidRepeatedSummaries) {
      assert(!JSON.stringify(result).includes(rejected.claims[0].text));
      assert(!JSON.stringify([...h.state.cache.values()]).includes(rejected.claims[0].text));
    }
  }
});

test('representative-summary recovery reuses the complete original corpus and independently reviews only the correction', async () => {
  for (const initial of invalidRepeatedSummaries) {
    const prompts = [], signals = [];
    const h = withRepeatedSummary(harness({ generate: async (prompt, signal) => {
      prompts.push(prompt); signals.push(signal);
      if (prompts.length === 1) return JSON.stringify(initial);
      if (prompts.length === 2) return negativeReview(prompt);
      if (prompts.length === 3) return JSON.stringify(representativeSummary);
      assert.equal(prompts.length, 4); assert.equal(prompt.outputKind, 'review');
      assert.deepEqual(JSON.parse(prompt.user).candidate.checks.map(({ text, evidence }) => ({ text, evidence })), representativeSummary.claims);
      return review(prompt);
    } }));
    const result = await (await h.handler(request(undefined, repeatedSummary.input))).json();
    assert.equal(result.status, 'answered'); assert.deepEqual(result.claims, representativeSummary.claims);
    const { rejectedDraftContextOnly, ...originalEvidence } = JSON.parse(prompts[2].user);
    assert.deepEqual(originalEvidence, JSON.parse(prompts[0].user));
    assert.equal(rejectedDraftContextOnly.statements[0].text, initial.claims[0].text);
    assert.equal(rejectedDraftContextOnly.statements[0].supported, false);
    assert.deepEqual(JSON.parse(prompts[0].user).sources.map(item => item.id), [repeatedSource.id], 'Original duplicated records remain in the database corpus but enter summary generation once');
    assert.deepEqual(prompts.map(prompt => prompt.maxAttempts), [undefined, undefined, 1, 1]);
    assert(signals.every(signal => signal === signals[0]));
    assert.equal(h.state.reserved, 1); assert.equal(h.state.reads, 2); assert.equal(h.state.writes, 1);
    assert.deepEqual([...h.state.cache.values()][0].result.claims, representativeSummary.claims);
  }
});

test('near-duplicate report outcomes, qualifications and conflicting details remain in generation and review context', async () => {
  const base = repeatedQuotes.join(' ');
  const bodies = [base, base, base.replace('was approved', 'was denied'),
    base.replace('not a standard timeline.', 'not a standard timeline or an official requirement.'),
    `${base} Staff allowed phones inside at my visit.`, `${base} Staff did not allow phones inside at my visit.`];
  const corpus = { partial: false, sources: bodies.map((body, index) => ({ ...repeatedSource,
    id: `a:near-repeat-${index}`, title: `Synthetic near-repeat ${index}`, body })) };
  const distinctReports = corpus.sources.filter((source, index, all) => all.findIndex(item => item.body === source.body) === index);
  const candidate = { ...representativeSummary, claims: representativeSummary.claims.map(claim => ({ ...claim,
    evidence: claim.evidence.map(item => ({ ...item, sourceId: corpus.sources[0].id })) })) };
  const seen = [];
  const h = withRepeatedSummary(harness({ generate: async prompt => {
    const context = JSON.parse(prompt.user);
    assert.deepEqual(context.sources.map(({ id, body }) => ({ id, body })), distinctReports.map(({ id, body }) => ({ id, body })));
    seen.push(prompt.outputKind ?? 'answer');
    if (prompt.outputKind === 'review') return taskIncompleteReview(prompt);
    return JSON.stringify(seen.length === 1 ? candidate : { status: 'insufficient', claims: [], disagreements: [], unanswered: [] });
  } }), corpus);
  const result = await (await h.handler(request(undefined, repeatedSummary.input))).json();
  assert.equal(result.status, 'insufficient'); assert.deepEqual(result.claims, []);
  assert.deepEqual(seen, ['answer', 'review', 'answer']);
  assert.equal(h.state.reserved, 1); assert.equal(h.state.reads, 2);
  assert.deepEqual(corpus.sources.map(item => item.body), bodies, 'Deduplication changes only the prepared summary view, never the original reports');
});

const conflictSources = ['At my visit, staff allowed phones inside the venue.', 'At my visit, staff did not allow phones inside the venue.']
  .map((body, index) => {
    const questionId = `00000000-0000-4000-8000-00000000006${index + 4}`;
    return { ...source, id: `q:${questionId}`, questionId, title: 'Individual venue experience', body, url: `/questions/${questionId}` };
  });
const conflictInput = { mode: 'ask', scope: { kind: 'public' }, question: 'What conflicting reports did members provide about phones inside this venue?' };
const conflictEvidence = conflictSources.map(item => ({ sourceId: item.id, quote: item.body }));
const conflictComparison = { text: 'Members gave opposite reports: one said staff allowed phones inside the venue, while another said staff did not allow phones inside the venue.', evidence: conflictEvidence };
const comparisonAnswer = (section, comparison = conflictComparison) => ({ status: 'answered', claims: [], disagreements: [], unanswered: [], [section]: [comparison] });
const taskIncompleteReview = prompt => JSON.stringify({ fulfillsTask: false, checks: prompt.reviewIds.map(id => ({ id, supported: true })) });
function withConflictSources(h) {
  h.session.corpus = async () => { h.state.reads++; return { sources: conflictSources, partial: false }; };
  return h;
}

test('a complete comparison in either section is independently reviewed without duplicate individual claims', async () => {
  for (const section of ['claims', 'disagreements']) {
    const candidate = comparisonAnswer(section), prompts = [];
    const h = withConflictSources(harness({ generate: async prompt => {
      prompts.push(prompt);
      if (prompts.length === 1) return JSON.stringify(candidate);
      assert.equal(prompts.length, 2);
      assert.equal(prompt.outputKind, 'review');
      const checks = JSON.parse(prompt.user).candidate.checks;
      assert.deepEqual(checks.map(check => check.kind), [section === 'claims' ? 'claim' : 'disagreement']);
      assert.equal(checks[0].text, conflictComparison.text);
      assert.match(prompt.system, /Judge completeness by meaning, not section placement or repetition/);
      return review(prompt);
    } }));
    const response = await h.handler(request(undefined, conflictInput)), result = await response.json();
    assert.equal(response.status, 200); assert.equal(result.status, 'answered');
    assert.deepEqual(result.claims, candidate.claims); assert.deepEqual(result.disagreements, candidate.disagreements);
    assert.deepEqual(result.sources.map(item => item.id).sort(), conflictSources.map(item => item.id).sort());
    assert.deepEqual(prompts.map(prompt => prompt.outputKind ?? 'answer'), ['answer', 'review']);
    assert.equal(h.state.reserved, 1); assert.equal(h.state.reads, 2); assert.equal(h.state.writes, 1);
    assert.deepEqual([...h.state.cache.values()][0].result[section], [conflictComparison]);
  }
});

test('semantic recovery can publish a complete comparison alone only after a fresh independent review', async () => {
  for (const section of ['claims', 'disagreements']) {
    const initial = comparisonAnswer('claims', { text: 'One member reported that staff allowed phones inside the venue.', evidence: [conflictEvidence[0]] });
    const corrected = comparisonAnswer(section), prompts = [], signals = [];
    const h = withConflictSources(harness({ generate: async (prompt, signal) => {
      prompts.push(prompt); signals.push(signal);
      if (prompts.length === 1) return JSON.stringify(initial);
      if (prompts.length === 2) return taskIncompleteReview(prompt);
      if (prompts.length === 3) {
        const repair = prompt.system.slice(prompt.system.indexOf('SEMANTIC REPAIR:'));
        assert.match(repair, /both attributed positions and citing both sources/);
        assert.match(repair, /A substantive comparison alone may answer with unused claim slots null/);
        return JSON.stringify(corrected);
      }
      assert.equal(prompts.length, 4); assert.equal(prompt.outputKind, 'review');
      assert.deepEqual(JSON.parse(prompt.user).candidate.checks.map(check => check.kind), [section === 'claims' ? 'claim' : 'disagreement']);
      return review(prompt);
    } }));
    const response = await h.handler(request(undefined, conflictInput)), result = await response.json();
    assert.equal(response.status, 200); assert.equal(result.status, 'answered');
    assert.deepEqual(result.claims, corrected.claims); assert.deepEqual(result.disagreements, corrected.disagreements);
    assert.deepEqual(prompts.map(prompt => prompt.outputKind ?? 'answer'), ['answer', 'review', 'answer', 'review']);
    assert.deepEqual(prompts.map(prompt => prompt.maxAttempts), [undefined, undefined, 1, 1]);
    assert(signals.every(signal => signal === signals[0]));
    const { rejectedDraftContextOnly, ...originalEvidence } = JSON.parse(prompts[2].user);
    assert.deepEqual(originalEvidence, JSON.parse(prompts[0].user), 'Recovery retains the complete original evidence');
    assert.equal(rejectedDraftContextOnly.fulfillsTask, false);
    assert.equal(rejectedDraftContextOnly.statements[0].text, initial.claims[0].text);
    assert.equal(h.state.reserved, 1); assert.equal(h.state.reads, 2); assert.equal(h.state.writes, 1);
    assert.deepEqual([...h.state.cache.values()][0].result[section], [conflictComparison]);
  }
});

test('one-sided, uncited-side and unsupported comparisons fail closed after a rejected semantic recovery', async () => {
  for (const section of ['claims', 'disagreements']) for (const failure of ['missing-side', 'unsupported', ...(section === 'claims' ? ['missing-citation'] : [])]) {
    const evidence = failure === 'missing-citation' ? [conflictEvidence[0]] : conflictEvidence;
    const initial = comparisonAnswer(section, { text: failure === 'missing-side'
      ? 'One member reported that staff allowed phones inside the venue.'
      : failure === 'missing-citation' ? conflictComparison.text
        : 'Both members reported that staff allowed phones inside the venue.', evidence });
    const replacement = comparisonAnswer(section, { text: failure === 'missing-side'
      ? 'Another member said staff did not allow phones inside the venue.'
      : failure === 'missing-citation' ? 'One member reported that phones were allowed, but another reported that staff prohibited them at their visit.'
        : 'The venue always allows phones inside for every visitor.', evidence });
    const prompts = [];
    const h = withConflictSources(harness({ generate: async prompt => {
      prompts.push(prompt);
      if (prompt.outputKind === 'review') return failure === 'missing-side' ? taskIncompleteReview(prompt) : negativeReview(prompt);
      return JSON.stringify(prompts.length === 1 ? initial : replacement);
    } }));
    const response = await h.handler(request(undefined, conflictInput)), result = await response.json();
    assert.equal(response.status, 200); assert.equal(result.status, 'insufficient');
    assert.deepEqual(result.claims, []); assert.deepEqual(result.disagreements, []); assert.deepEqual(result.sources, []);
    assert.deepEqual(prompts.map(prompt => prompt.outputKind ?? 'answer'), ['answer', 'review', 'answer', 'review']);
    assert.equal(h.state.reserved, 1); assert.equal(h.state.reads, 2);
    assert.doesNotMatch(JSON.stringify([...h.state.cache.values()]), /member reported|members reported|member said|always allows|Members gave opposite reports/);
  }
});

test('moving the same rejected comparison between sections cannot buy a second reviewer verdict', async () => {
  const rejected = { text: 'Both members reported that staff allowed phones inside the venue.', evidence: conflictEvidence };
  for (const section of ['claims', 'disagreements']) {
    const initial = comparisonAnswer(section, rejected);
    const same = comparisonAnswer(section === 'claims' ? 'disagreements' : 'claims', { ...rejected,
      text: `  ${rejected.text.toUpperCase()}  `, evidence: [...conflictEvidence].reverse() });
    assert.equal(service.assistantCandidateIdentity(same), service.assistantCandidateIdentity(initial));
    const prompts = [];
    const h = withConflictSources(harness({ generate: async prompt => {
      prompts.push(prompt);
      return prompt.outputKind === 'review' ? negativeReview(prompt) : JSON.stringify(prompts.length === 1 ? initial : same);
    } }));
    const result = await (await h.handler(request(undefined, conflictInput))).json();
    assert.equal(result.status, 'insufficient'); assert.deepEqual(result.claims, []); assert.deepEqual(result.disagreements, []);
    assert.deepEqual(result.sources, []);
    assert.deepEqual(prompts.map(prompt => prompt.outputKind ?? 'answer'), ['answer', 'review', 'answer']);
    assert.deepEqual(prompts.map(prompt => prompt.maxAttempts), [undefined, undefined, 1]);
    assert.equal(h.state.reserved, 1); assert.equal(h.state.reads, 2);
    assert.doesNotMatch(JSON.stringify([...h.state.cache.values()]), /Both members reported/);
  }
});

test('a reviewed comparison-only answer still requires final fresh source access and matching content', async () => {
  for (const failure of ['changed', 403]) {
    const prompts = [];
    const h = harness({ generate: async prompt => {
      prompts.push(prompt);
      return prompt.outputKind === 'review' ? review(prompt) : JSON.stringify(comparisonAnswer('disagreements'));
    } });
    h.session.corpus = async () => {
      if (++h.state.reads === 1) return { sources: conflictSources, partial: false };
      if (failure === 'changed') return { sources: conflictSources.slice(0, 1), partial: false };
      throw new service.AssistantError(failure, 'private comparison source denial');
    };
    const response = await h.handler(request(undefined, conflictInput));
    assert.equal(response.status, failure === 'changed' ? 409 : failure);
    assert.deepEqual(prompts.map(prompt => prompt.outputKind ?? 'answer'), ['answer', 'review']);
    assert.equal(h.state.reads, 2); assert.equal(h.state.reserved, 1); assert.equal(h.state.writes, 0);
    assert.doesNotMatch(JSON.stringify(await response.json()), /Members gave opposite reports|private comparison source denial|allowed phones/);
  }
});

test('one semantic recovery uses original evidence and a fixed prompt, then independently reviews and caches only the corrected answer', async () => {
  for (const rejection of ['unsupported', 'task']) {
    const prompts = [], signals = [];
    const h = harness({ generate: async (prompt, signal) => {
      prompts.push(prompt); signals.push(signal);
      if (prompts.length === 1) return JSON.stringify(rejectedOutput);
      if (prompts.length === 2) return rejection === 'unsupported' ? negativeReview(prompt) : JSON.stringify({ fulfillsTask: false, checks: prompt.reviewIds.map(id => ({ id, supported: true })) });
      if (prompts.length === 3) return JSON.stringify(correctedOutput);
      return review(prompt);
    } });
    const response = await h.handler(request()); const result = await response.json();
    assert.equal(response.status, 200); assert.equal(result.status, 'answered'); assert.equal(result.claims[0].text, correctedOutput.claims[0].text);
    assert.deepEqual(prompts.map(prompt => prompt.outputKind ?? 'answer'), ['answer', 'review', 'answer', 'review']);
    assert.deepEqual(prompts.map(prompt => prompt.maxAttempts), [undefined, undefined, 1, 1]);
    assert.match(prompts[2].system, /SEMANTIC REPAIR:/);
    const { rejectedDraftContextOnly, ...originalEvidence } = JSON.parse(prompts[2].user);
    assert.deepEqual(originalEvidence, JSON.parse(prompts[0].user));
    assert.doesNotMatch(prompts[2].system, /Rejected-draft sentinel/);
    assert.equal(rejectedDraftContextOnly.statements[0].supported, rejection !== 'unsupported');
    assert.equal(rejectedDraftContextOnly.fulfillsTask, rejection !== 'task');
    assert.equal(h.state.reserved, 1); assert.equal(h.state.reads, 2); assert.equal(h.state.writes, 1);
    assert(signals.every(signal => signal === signals[0]));
    assert.doesNotMatch(JSON.stringify([...h.state.cache.values()]), /Rejected-draft sentinel/);
    assert.equal((await h.handler(request())).status, 200); assert.equal(prompts.length, 4); assert.equal(h.state.reserved, 1);
  }
});

test('a second negative semantic verdict remains insufficient with no more generation or rejected cache content', async () => {
  const prompts = [];
  const h = harness({ generate: async prompt => {
    prompts.push(prompt);
    return prompt.outputKind === 'review' ? negativeReview(prompt) : JSON.stringify(prompts.length === 1 ? rejectedOutput : correctedOutput);
  } });
  const response = await h.handler(request()); const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.status, 'insufficient'); assert.deepEqual(result.claims, []); assert.deepEqual(result.sources, []);
  assert.equal(prompts.length, 4); assert.equal(h.state.reserved, 1); assert.equal(h.state.reads, 2); assert.equal(h.state.writes, 1);
  assert.doesNotMatch(JSON.stringify([...h.state.cache.values()]), /Rejected-draft sentinel|The member said their passport/);
  const cached = await h.handler(request()); assert.equal((await cached.json()).cached, true); assert.equal(prompts.length, 4);
});

test('unchanged rejected facts cannot obtain a second reviewer verdict through whitespace, case, order or duplicate changes', async () => {
  const reordered = { ...rejectedOutput, claims: [{ ...rejectedOutput.claims[0], text: '  ' + rejectedOutput.claims[0].text.toUpperCase().replaceAll(' ', '   ') + ' ' }, rejectedOutput.claims[0]] };
  assert.equal(service.assistantCandidateIdentity(rejectedOutput), service.assistantCandidateIdentity(reordered));
  const prompts = [];
  const h = harness({ generate: async prompt => {
    prompts.push(prompt); return prompt.outputKind === 'review' ? negativeReview(prompt) : JSON.stringify(prompts.length === 1 ? rejectedOutput : reordered);
  } });
  const response = await h.handler(request()); const result = await response.json();
  assert.equal(result.status, 'insufficient'); assert.deepEqual(result.claims, []); assert.equal(prompts.length, 3);
  assert.equal(prompts.filter(prompt => prompt.outputKind === 'review').length, 1); assert.equal(h.state.reads, 2); assert.equal(h.state.reserved, 1);
});

test('malformed review, provider failure, missing review corpus and initial insufficiency never trigger semantic regeneration', async () => {
  for (const failure of ['malformed-review', 'provider-review', 'provider-answer', 'missing-corpus', 'initial-insufficient', 'invalid-answer']) {
    const prompts = [];
    const h = harness({ generate: async prompt => {
      prompts.push(prompt);
      if (failure === 'provider-answer' || (failure === 'provider-review' && prompt.outputKind === 'review')) throw new service.AssistantError(503, 'private provider failure');
      if (prompt.outputKind === 'review') return failure === 'malformed-review' ? '{"checks":[],"fulfillsTask":false}' : negativeReview(prompt);
      if (failure === 'initial-insufficient') return JSON.stringify({ status: 'insufficient', claims: [], disagreements: [], unanswered: [] });
      if (failure === 'invalid-answer') return JSON.stringify({ ...output, claims: [{ ...output.claims[0], evidence: [] }] });
      return JSON.stringify(rejectedOutput);
    } });
    if (failure === 'missing-corpus') h.session.corpus = async () => { h.state.reads++; return { sources: [{ ...source, body: source.body + ' Additional background.'.repeat(1500) }], partial: false }; };
    const response = await h.handler(request()); const result = await response.json();
    assert.equal(prompts.some(prompt => prompt.maxAttempts === 1 || prompt.system.includes('SEMANTIC REPAIR:')), false, failure);
    assert.equal(prompts.length, failure === 'missing-corpus' ? 0 : ['malformed-review', 'provider-review'].includes(failure) ? 2 : 1, failure);
    if (['initial-insufficient', 'missing-corpus'].includes(failure)) { assert.equal(response.status, 200, failure); assert.equal(result.status, 'insufficient', failure); }
    else { assert(response.status >= 500, failure); assert.equal(h.state.writes, 0, failure); }
    assert.equal(h.state.reserved, failure === 'missing-corpus' ? 0 : 1, failure);
    if (failure === 'missing-corpus') { assert.equal(h.state.reads, 2); assert.deepEqual(result.claims, []); assert.deepEqual(result.sources, []); assert.equal(h.state.writes, 0); }
  }
});

test('recovery transport and citation failures stop immediately without caching or further review', async () => {
  for (const failure of ['answer-provider', 'answer-invalid', 'answer-insufficient', 'review-provider', 'review-malformed']) {
    const prompts = [];
    const h = harness({ generate: async prompt => {
      prompts.push(prompt);
      if (prompts.length === 1) return JSON.stringify(rejectedOutput);
      if (prompts.length === 2) return negativeReview(prompt);
      if ((failure === 'answer-provider' && prompts.length === 3) || (failure === 'review-provider' && prompts.length === 4)) throw new service.AssistantError(503, 'private provider failure');
      if (prompts.length === 3) return JSON.stringify(failure === 'answer-invalid' ? { ...correctedOutput, claims: [] }
        : failure === 'answer-insufficient' ? { status: 'insufficient', claims: [], disagreements: [], unanswered: [] } : correctedOutput);
      return failure === 'review-malformed' ? '{"fulfillsTask":false}' : review(prompt);
    } });
    const response = await h.handler(request());
    assert.equal(prompts.length, failure.startsWith('review-') ? 4 : 3, failure);
    assert.equal(h.state.reserved, 1, failure);
    if (failure === 'answer-insufficient') { assert.equal(response.status, 200); assert.equal((await response.json()).status, 'insufficient'); }
    else { assert(response.status >= 500, failure); assert.equal(h.state.writes, 0, failure); }
  }
});

test('cancellation and the original total deadline stop either recovery stage and ignore late completions', async () => {
  for (const phase of ['answer', 'review']) for (const ending of ['cancel', 'deadline']) {
    const waiting = deferred(), controller = new AbortController(), prompts = []; let entered = false, activeSignal;
    const h = harness({ deadlineMs: 100, generate: async (prompt, signal) => {
      prompts.push(prompt);
      if (prompts.length === 1) return JSON.stringify(rejectedOutput);
      if (prompts.length === 2) return negativeReview(prompt);
      if (prompts.length === (phase === 'answer' ? 3 : 4)) { entered = true; activeSignal = signal; return waiting.promise; }
      return JSON.stringify(correctedOutput);
    } });
    const start = Date.now(); const pending = h.handler(request(controller.signal));
    while (!entered) await tick();
    if (ending === 'cancel') controller.abort();
    const response = await pending;
    assert.equal(response.status, ending === 'cancel' ? 499 : 504, phase + ending); assert.equal(activeSignal.aborted, true);
    assert(Date.now() - start < 1000); assert.equal(h.state.reads, 1); assert.equal(h.state.writes, 0); assert.equal(h.state.reserved, 1);
    const calls = prompts.length;
    waiting.resolve(phase === 'answer' ? JSON.stringify(correctedOutput) : review(prompts.at(-1))); await tick(); await tick();
    assert.equal(prompts.length, calls); assert.equal(h.state.reads, 1); assert.equal(h.state.writes, 0);
  }
});

test('source access and fingerprint changes after recovery prevent both response and cache publication', async () => {
  for (const failure of ['changed', 401, 403, 429, 503]) {
    const prompts = [];
    const h = harness({ generate: async prompt => {
      prompts.push(prompt); return prompts.length === 1 ? JSON.stringify(rejectedOutput) : prompts.length === 2 ? negativeReview(prompt)
        : prompts.length === 3 ? JSON.stringify(correctedOutput) : review(prompt);
    } });
    h.session.corpus = async () => {
      h.state.reads++;
      if (h.state.reads === 1) return { sources: [source], partial: false };
      if (failure === 'changed') return { sources: [], partial: false };
      throw new service.AssistantError(failure, 'private access failure');
    };
    const response = await h.handler(request());
    assert.equal(response.status, failure === 'changed' ? 409 : failure); assert.equal(prompts.length, 4);
    assert.equal(h.state.reads, 2); assert.equal(h.state.reserved, 1); assert.equal(h.state.writes, 0);
    assert.doesNotMatch(JSON.stringify(await response.json()), /Rejected-draft sentinel|private access failure|The member said their passport/);
  }
});

test('combined real provider format repairs and semantic recovery have exactly six HTTP attempts at worst', async () => {
  const prompts = [], outgoing = []; let generation = 0;
  const h = harness({ generate: async (prompt, signal) => {
    prompts.push(prompt); const current = ++generation; let local = 0;
    return service.runAssistantModel(prompt, { provider: 'groq', apiKey: 'synthetic-private-key', signal,
      fetcher: async (_url, options) => {
        outgoing.push(options); local++;
        if (current <= 2 && local === 1) return Response.json({ error: { code: 'json_validate_failed' } }, { status: 400 });
        const slots = (items, count) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`slot${index + 1}`, items[index] ?? null]));
        const selectedClaims = claims => claims.map(claim => ({ ...claim,
          evidence: slots(claim.evidence.map(item => {
            const span = prompt.evidenceSpans.find(span => span.sourceId === item.sourceId && span.quote === item.quote);
            assert(span, 'Synthetic provider evidence must match an exact server span');
            return { spanId: span.id };
          }), 4) }));
        const selectedDraft = draft => JSON.stringify({ status: draft.status, claims: slots(selectedClaims(draft.claims), 6),
          disagreements: slots(selectedClaims(draft.disagreements), 3), unanswered: slots(draft.unanswered, 4) });
        const content = current === 1 ? selectedDraft(rejectedOutput) : current === 2 ? negativeReview(prompt) : current === 3 ? selectedDraft(correctedOutput) : review(prompt);
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] });
      },
    });
  } });
  const response = await h.handler(request()); const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.claims[0].text, correctedOutput.claims[0].text);
  assert.equal(outgoing.length, 6); assert.equal(prompts.length, 4); assert.deepEqual(prompts.map(prompt => prompt.maxAttempts), [undefined, undefined, 1, 1]);
  assert.equal(outgoing[0].signal, outgoing[1].signal); assert.equal(outgoing[2].signal, outgoing[3].signal);
  assert.equal(h.state.reserved, 1); assert.equal(h.state.reads, 2); assert.equal(h.state.writes, 1);
});

const routeSource = await readFile(new URL('../src/app/api/assistant/route.ts', import.meta.url), 'utf8');
const routeImports = {
  '@supabase/supabase-js': moduleUrl('export function createClient(url,key,options){return globalThis.__assistantRouteFixture.client(url,key,options);}'),
  '@visa/build-provenance': moduleUrl('export default {gitSha:"synthetic-build"};'),
  '@/lib/assistant-data': moduleUrl('export function retrieveAssistantCorpus(client,input,now){return globalThis.__assistantRouteFixture.corpus(client,input,now);}'),
  '@/lib/assistant-provider': moduleUrl('export function providerCacheKey(){return "synthetic-model";} export function runAssistantModel(prompt,options){return globalThis.__assistantRouteFixture.generate(prompt,options);}'),
  '@/lib/assistant-service': serviceUrl,
  '@/lib/assistant-stream': moduleUrl((await transform(await readFile(new URL('../src/lib/assistant-stream.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' })).code),
};
const routeJs = (await transform(routeSource, { loader: 'ts', format: 'esm', target: 'es2022' })).code.replace(/(from\s+)(['"])([^'"]+)\2/g, (_, prefix, _quote, name) => { assert(routeImports[name], name); return prefix + JSON.stringify(routeImports[name]); });
const route = await import(moduleUrl(routeJs));

test('actual route and retrieval keep soft recency and explicit windows stable through revalidation across midnight', async () => {
  const env = { NEXT_PUBLIC_SITE_URL: 'https://visathreads.com', NEXT_PUBLIC_SUPABASE_URL: 'https://cycnichledvqbxevrwnt.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-fixture-key', ASSISTANT_PROJECT_REF: 'cycnichledvqbxevrwnt', ASSISTANT_PROVIDER: 'groq', GROQ_API_KEY: 'synthetic-local-key', ASSISTANT_ENABLED: 'true', COMMUNITY_SOURCE_MODE: 'live' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const realNow = Date.now; Object.assign(process.env, env);
  try {
    for (const [question, location, createdAt, expectedSince, expectedUntil] of [
      ['show recent experience for hyderabad stamping', 'Hyderabad', '2026-10-17T12:00:00Z', null, null],
      ['find Chennai stamping experiences from the last 7 days', 'Chennai', '2026-10-17T12:00:00Z', '2026-10-10T23:59:59.990Z', '2026-10-17T23:59:59.990Z'],
      ['show Delhi stamping experiences from yesterday', 'Delhi', '2026-10-16T12:00:00Z', '2026-10-16T00:00:00.000Z', '2026-10-17T00:00:00.000Z'],
    ]) {
      const start = Date.parse('2026-10-17T23:59:59.990Z'); let clock = start, providerCalls = 0, reservations = 0;
      const anchors = [], searches = [];
      Date.now = () => clock;
      globalThis.__assistantRouteFixture = {
        client() { return {
          auth: { getUser: async () => ({ data: { user: { id: 'synthetic-user' } }, error: null }) },
          async rpc(name, args) {
            if (name === 'check_assistant_request_rate') return { data: [{ allowed: true }], error: null };
            if (name === 'reserve_assistant_request') { reservations++; return { data: [{ allowed: true }], error: null }; }
            assert.equal(name, 'assistant_sources_v2'); searches.push(args); clock += 90000;
            return { data: [{ source_id: `q:${id}`, source_kind: 'question', question_id: id, community_id: null,
              title: `My ${location} stamping experience`, body: `I attended my visa stamping interview at the ${location} consulate.`, created_at: createdAt, updated_at: createdAt }], error: null };
          },
          from() { throw Error('A direct lookup must not expand unrelated threads'); },
        }; },
        corpus: async (client, input, now) => { anchors.push(now); return service.retrieveAssistantCorpus(client, input, now); },
        generate: async () => { providerCalls++; throw Error('No model permitted for a direct lookup'); },
      };
      const response = await route.POST(request(undefined, { mode: 'ask', scope: { kind: 'public' }, question }));
      const result = await response.json();
      assert.equal(response.status, 200, `${question}: ${JSON.stringify(result)}`);
      assert.equal(result.status, 'answered'); assert.equal(result.sources.length, 1);
      assert.deepEqual(anchors, [start, start]); assert.equal(searches.length, 2);
      assert.deepEqual(searches[0], searches[1], 'Source revalidation must use the original window');
      assert.equal(searches[0].since_time, expectedSince); assert.equal(searches[0].until_time, expectedUntil);
      assert.equal(result.coverage.since, expectedSince ?? undefined); assert.equal(result.coverage.until, expectedUntil ?? undefined);
      assert.equal(result.generatedAt, new Date(start).toISOString());
      assert.equal(providerCalls, 0); assert.equal(reservations, 0);
    }
  } finally {
    Date.now = realNow; delete globalThis.__assistantRouteFixture;
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('actual route preserves quota reset/reason, distinguishes auth outage, and forwards the request signal to database calls', async () => {
  const env = { NEXT_PUBLIC_SITE_URL: 'https://visathreads.com', NEXT_PUBLIC_SUPABASE_URL: 'https://cycnichledvqbxevrwnt.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-fixture-key', ASSISTANT_PROJECT_REF: 'cycnichledvqbxevrwnt', ASSISTANT_PROVIDER: 'groq', GROQ_API_KEY: 'synthetic-local-key', ASSISTANT_ENABLED: 'true' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const oldFetch = globalThis.fetch; Object.assign(process.env, env);
  try {
    for (const mode of ['quota', 'auth-outage', 'permission', 'cancel']) {
      const signals = []; let providerCalls = 0;
      globalThis.fetch = async (_url, options) => { signals.push(options.signal); assert.equal(options.redirect, 'manual'); return Response.json({}); };
      globalThis.__assistantRouteFixture = {
        client(_url, _key, options) { return {
          auth: { getUser: async () => { await options.global.fetch('https://fixture.invalid/auth'); return mode === 'auth-outage' ? { data: { user: null }, error: { status: 503, message: 'private failure' } } : { data: { user: { id: 'synthetic-user' } }, error: null }; } },
          async rpc(name) { await options.global.fetch('https://fixture.invalid/' + name); return name === 'check_assistant_request_rate'
            ? mode === 'permission' ? { data: null, error: { code: '42501' } } : { data: [{ allowed: true }], error: null }
            : { data: [{ allowed: false, reason: 'user_daily_limit', reset_at: new Date(Date.now() + 3600000).toISOString() }], error: null }; },
        }; },
        corpus: async () => mode === 'cancel' ? new Promise(() => {}) : { sources: [source], partial: false },
        generate: async () => { providerCalls++; throw Error('No model permitted'); },
      };
      const controller = new AbortController(); const pending = route.POST(request(controller.signal));
      if (mode === 'cancel') { while (!signals.length) await tick(); controller.abort(); }
      const response = await pending; const body = await response.json();
      assert.equal(response.status, { quota: 429, 'auth-outage': 503, permission: 403, cancel: 499 }[mode]);
      assert.equal(providerCalls, 0); assert(!JSON.stringify(body).includes('private'));
      if (mode === 'quota') { assert.equal(body.code, 'quota'); assert.equal(body.quotaReason, 'user_daily_limit'); assert(body.retryAfterSeconds > 3500); }
      if (mode === 'cancel') assert(signals.every(signal => signal.aborted));
    }
  } finally {
    globalThis.fetch = oldFetch; delete globalThis.__assistantRouteFixture;
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('actual Workers runtime isolates cancelled callers, enforces a total deadline and rejects database redirects', { timeout: 20000 }, async () => {
  const script = (await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import {createAssistantHandler,assistantDatabaseFetch} from ${JSON.stringify(root + 'src/lib/assistant-service.ts')};
    import {streamAssistantResponse} from ${JSON.stringify(root + 'src/lib/assistant-stream.ts')};
    const source=${JSON.stringify(source)},input=${JSON.stringify(input)},answer=${JSON.stringify(output)};
    const state={reserved:0,generated:0,reads:0};
    const dependencies={availability:()=>({posts:true,communities:true,catchup:true}),model:'local',
      authenticate:async(_token,context)=>({actor:'same-user',corpus:async()=>{state.reads++;await assistantDatabaseFetch(context)('https://fixture.invalid/corpus');return {sources:[source],partial:false}},reserve:async()=>{state.reserved++;return true}}),
      generate:async(prompt,signal)=>{if(prompt.outputKind==='review')return JSON.stringify({fulfillsTask:true,checks:prompt.reviewIds.map(id=>({id,supported:true}))});state.generated++;await fetch('https://fixture.invalid/model',{signal});return JSON.stringify(answer)}};
    const normal=createAssistantHandler(dependencies),deadline=createAssistantHandler({...dependencies,deadlineMs:40});
    export default {async fetch(request){const url=new URL(request.url);
      if(url.pathname==='/status')return Response.json(state);
      if(url.pathname==='/stream'){
        const native=new Request('https://visathreads.com/api/assistant',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+ 'a'.repeat(40)},body:JSON.stringify(input)});
        // The production router supplies a tracked proxy, not a native-branded Request.
        const tracked=new Proxy(native,{get(target,key){const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}});
        return streamAssistantResponse(tracked,normal);
      }
      if(url.pathname==='/database'){
        let calls=0,cancelled=false;const controller=new AbortController();
        const call=assistantDatabaseFetch({signal:controller.signal,requestId:'local'},async(url,options)=>{calls++;const out=new Request(url,options);if(out.redirect!=='manual')throw Error('Unsafe redirect policy');return new Response(new ReadableStream({cancel(){cancelled=true}}),{status:302,headers:{Location:'https://external.invalid/secret'}})});
        let status=200;try{await call('https://fixture.invalid/auth')}catch(error){status=error.status}
        return Response.json({status,calls,cancelled});
      }
      const controller=new AbortController();const abort=url.searchParams.get('abort');const timer=abort?setTimeout(()=>controller.abort(),Number(abort)):null;
      try{return await (url.pathname==='/deadline'?deadline:normal)(new Request('https://visathreads.com/api/assistant',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+ 'a'.repeat(40)},body:JSON.stringify(input),signal:controller.signal}));}finally{if(timer)clearTimeout(timer)}
    }};` }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' })).outputFiles[0].text;
  const fixture = `export default {async fetch(request){if(new URL(request.url).pathname==='/model')await new Promise(resolve=>setTimeout(resolve,500));return new Response('fixture');}};`;
  const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: 'app', modules: true, compatibilityDate: '2026-09-09', script, outboundService: 'fixture' },
    { name: 'fixture', modules: true, compatibilityDate: '2026-09-09', script: fixture },
  ] }));
  try {
    const owner = runtime.dispatchFetch('http://localhost/run?abort=250');
    const waiter = runtime.dispatchFetch('http://localhost/run');
    const [a, b] = await Promise.all([owner, waiter]);
    assert.equal(a.status, 499); assert.equal(b.status, 200);
    const state = await (await runtime.dispatchFetch('http://localhost/status')).json();
    assert.equal(state.generated, 2); assert.equal(state.reserved, 2); assert.equal(state.reads, 3);
    const timeout = await runtime.dispatchFetch('http://localhost/deadline'); assert.equal(timeout.status, 504); assert.equal((await timeout.json()).code, 'timeout');
    assert.deepEqual(await (await runtime.dispatchFetch('http://localhost/database')).json(), { status: 503, calls: 1, cancelled: true });
    const streamed = await runtime.dispatchFetch('http://localhost/stream');
    assert.match(streamed.headers.get('content-type'), /application\/x-ndjson/);
    const reader = streamed.body.getReader(), decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);
    assert.match(first, /"type":"progress"/); assert.doesNotMatch(first, /"claims"/);
    let rest = ''; while (true) { const chunk = await reader.read(); if (chunk.done) break; rest += decoder.decode(chunk.value); }
    const final = rest.trim().split('\n').map(line => JSON.parse(line)).find(event => event.type === 'complete');
    assert.equal(final.status, 200); assert.equal(final.value.status, 'answered');
  } finally { await runtime.dispose(); }
});

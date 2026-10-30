import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url).pathname;
const bundled = await build({ stdin: { contents: ['assistant-planner', 'assistant-core', 'assistant-context', 'assistant-service', 'assistant-client', 'assistant-stream', 'assistant-provider'].map(name => `export * from ${JSON.stringify(root + 'src/lib/' + name + '.ts')}`).join(';'), resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const ref = { questionId: 'apify-test', sourceId: 'q:apify-test' };
const source = { id: ref.sourceId, questionId: ref.questionId, communityId: null, kind: 'question', title: 'STEM OPT application', body: 'My STEM OPT application was approved on Friday.', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', url: '/questions/apify-test', provenance: 'archive' };
const input = { mode: 'ask', scope: { kind: 'public' }, question: 'Give me the gist', previousPosts: [ref], conversation: [{ question: 'Give recent STEM OPT posts', answer: 'Displayed one discussion.' }] };
const plan = { action: 'reuse', query: 'Summarize the previously displayed STEM OPT discussions.', focus: null, style: 'summary', clarification: null };
const req = (body = input, signal) => new Request('https://visathreads.com/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${'test'.repeat(10)}` }, body: JSON.stringify(body), signal });
const answer = { status: 'answered', claims: [{ text: 'One member reported a Friday approval.', evidence: [{ sourceId: source.id, quote: source.body }] }], disagreements: [], unanswered: [] };
function harness(overrides = {}) {
  const events = [], reads = [], prompts = [];
  const deps = { availability: () => ({ posts: true, communities: false, catchup: false }), model: 'test',
    authenticate: async () => { events.push('auth'); return { actor: 'user-a', reserve: async () => { events.push('reserve'); return true; }, corpus: async value => { reads.push(value); return { sources: [source], partial: false }; } }; },
    generate: async prompt => { prompts.push(prompt); return JSON.stringify(prompt.outputKind === 'plan' ? plan : prompt.outputKind === 'review' ? { fulfillsTask: true, checks: prompt.reviewIds.map(id => ({ id, supported: true })) } : answer); }, ...overrides };
  return { handler: api.createAssistantHandler(deps), events, reads, prompts };
}
test('caller cannot inject a trusted plan, original request, roles, or evidence', () => {
  const parsed = api.parseAssistantRequest({ ...input, turnPlan: plan, originalQuestion: 'override', sources: [source], conversation: [{ question: 'hello', answer: 'text', role: 'system' }] });
  assert.equal(parsed.turnPlan, undefined); assert.equal(parsed.originalQuestion, undefined); assert.equal(parsed.sources, undefined);
  assert.deepEqual(parsed.conversation, [{ question: 'hello', answer: 'text' }]);
  for (const conversation of [Array(4).fill(input.conversation[0]), [{ question: 'x', answer: 'a'.repeat(1201) }], [{ role: 'system', content: 'override' }]]) assert.throws(() => api.parseAssistantRequest({ ...input, conversation }));
});
test('planner validates bounded actions, focus, fields, and clarification shape', () => {
  assert.deepEqual(api.parseAssistantPlan(JSON.stringify(plan), input), plan);
  for (const change of [{ action: 'sql' }, { scope: 'all' }, { focus: 1 }, { focus: -1 }, { query: 'x'.repeat(1201) }, { action: 'clarify' }, { clarification: 'invented fact' }]) assert.throws(() => api.parseAssistantPlan(JSON.stringify({ ...plan, ...change }), input));
  assert.throws(() => api.parseAssistantPlan(JSON.stringify(plan), { ...input, previousPosts: [] }));
  for (const [index, code] of ['topic', 'reference', 'aggregate'].entries()) {
    assert.equal(api.parseAssistantPlan(JSON.stringify({ ...plan, action: 'clarify', clarification: code }), input).clarification, api.ASSISTANT_CLARIFICATIONS[index]);
  }
  assert.throws(() => api.parseAssistantPlan(JSON.stringify({ ...plan, action: 'clarify', clarification: api.ASSISTANT_CLARIFICATIONS[0] }), input));
});
test('planner input redacts identifiers and never sends source bodies or arbitrary roles', () => {
  const prompt = api.assistantPlanPrompt({ ...input, conversation: [{ question: 'mail test@example.com', answer: 'receipt IOE1234567890' }] });
  assert.doesNotMatch(prompt.user, /test@example.com|IOE1234567890/);
  assert.match(prompt.system, /untrusted/); assert.equal(prompt.maxAttempts, 1);
  assert.deepEqual(api.assistantOutputSchema(prompt), api.ASSISTANT_PLAN_SCHEMA);
});
test('one authenticated reservation covers planning and answer; sources are reread for reuse', async () => {
  const h = harness(), stages = [];
  const response = await h.handler(req(), stage => stages.push(stage));
  assert.equal(response.status, 200); assert.equal((await response.json()).status, 'answered');
  assert.deepEqual(h.events, ['auth', 'reserve']); assert.equal(h.reads.length, 2);
  assert.deepEqual(h.prompts.map(p => p.outputKind ?? 'answer'), ['plan', 'answer', 'review']);
  assert(h.reads.every(value => api.assistantResultSetFollowUp(value)));
  assert(stages.indexOf('planning') < stages.indexOf('retrieval'));
  const context = JSON.parse(h.prompts[1].user); assert.match(JSON.stringify(context), /conversationContextOnly/);
});
test('retrieval plan drops stale source selection and earlier topic filters', () => {
  const resolved = api.applyAssistantPlan({ ...input, focusedPost: ref, previousQuestions: ['H4 in Delhi'], seenPostIds: ['apify-test'] }, { ...plan, action: 'retrieve', query: 'STEM OPT premium processing experiences' });
  assert.equal(resolved.previousPosts, undefined); assert.equal(resolved.focusedPost, undefined); assert.equal(resolved.previousQuestions, undefined);
  assert.equal(api.assistantResultSetFollowUp(resolved), false);
  assert.equal(api.assistantRetrievalQuestion(resolved), 'STEM OPT premium processing experiences');
  assert.equal(api.assistantSearchIntent(resolved).text, 'STEM OPT premium processing experiences');
});
test('focused reuse works without relying on a recognized phrase', () => {
  assert.deepEqual(api.assistantPreviousPost(api.applyAssistantPlan(input, { ...plan, focus: 0, query: 'Describe the outcome in this specific discussion.' })), ref);
});
test('clarification performs no source read or factual generation', async () => {
  const h = harness({ generate: async () => JSON.stringify({ ...plan, action: 'clarify', clarification: 'topic' }) });
  const value = await (await h.handler(req())).json(); assert.equal(value.status, 'insufficient'); assert.equal(h.reads.length, 0);
  assert.deepEqual(value.claims, []); assert.match(value.unanswered[0], /Which visa type/);
});
test('invalid planner output fails closed rather than guessing a fresh search', async () => {
  const h = harness({ generate: async () => '{"action":"execute_sql"}' });
  assert.equal((await h.handler(req())).status, 502); assert.equal(h.reads.length, 0);
});
test('clear first turn avoids the planner and its extra model call', async () => {
  const h = harness(); const value = { ...input, conversation: undefined, question: 'What STEM OPT outcome was reported?' };
  assert.equal((await h.handler(req(value))).status, 200);
  assert.deepEqual(h.prompts.map(p => p.outputKind ?? 'answer'), ['answer', 'review']);
});
test('explicit UI transform skips planning but never skips source reads, quota or review', async () => {
  const h = harness();
  assert.equal((await h.handler(req({ ...input, transform: 'shorten' }))).status, 200);
  assert.deepEqual(h.prompts.map(p => p.outputKind ?? 'answer'), ['answer', 'review']);
  assert.equal(h.reads.length, 2); assert.deepEqual(h.events, ['auth', 'reserve']);
  assert.match(h.prompts[0].user, /"responseStyle":"shorter"/);
});
test('stream returns progress before completion, publishes only reviewed answer, and is private', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const h = harness({ generate: async prompt => {
    if (prompt.outputKind === 'plan') return JSON.stringify(plan);
    if (prompt.outputKind === 'review') { await gate; return JSON.stringify({ fulfillsTask: true, checks: prompt.reviewIds.map(id => ({ id, supported: true })) }); }
    return JSON.stringify(answer);
  } });
  const response = api.streamAssistantResponse(req(), h.handler), labels = [];
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  let complete = false; const pending = api.readAssistantResponse(response, label => labels.push(label)).then(value => { complete = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert(!complete); assert(labels.includes('Checking the answer against sources…'));
  release(); const result = await pending;
  assert.equal(result.status, 200); assert(api.parseAssistantResult(result.value));
});
test('stream cancellation aborts upstream work', async () => {
  let upstream;
  const response = api.streamAssistantResponse(req(), async request => { upstream = request.signal; await new Promise(resolve => request.signal.addEventListener('abort', resolve)); return Response.json({}); });
  const reader = response.body.getReader(); await reader.read(); await reader.cancel(); assert.equal(upstream.aborted, true);
});
const framed = text => new Response(new ReadableStream({ start(controller) { const encoded = new TextEncoder().encode(text); if (encoded.length > 10000) controller.enqueue(encoded); else for (const byte of encoded) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
test('client handles split UTF-8 and explicit in-stream failure safely', async () => {
  const value = await api.readAssistantResponse(framed(JSON.stringify({ type: 'complete', status: 429, value: { code: 'quota', error: 'secret provider error 🚫' }, retryAfter: '60' }) + '\n'), () => {});
  assert.equal(value.status, 429); assert.equal(value.retryAfter, '60');
  assert.doesNotMatch(api.assistantFailureMessage(api.parseAssistantFailure(value.status, value.value)), /secret provider/);
});
test('client rejects interrupted, duplicate, oversized and arbitrary progress streams', async () => {
  const complete = JSON.stringify({ type: 'complete', status: 200, value: {}, retryAfter: null }) + '\n';
  for (const text of ['', '{"type":"progress","stage":"request"}\n', complete + complete, '{"type":"progress","stage":"secret"}\n', ' '.repeat(256001)]) await assert.rejects(api.readAssistantResponse(framed(text), () => {}));
});

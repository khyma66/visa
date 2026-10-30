import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { waitForAcceptanceReady } from './assistant-acceptance-readiness.mjs';
import { readAcceptanceFailureDiagnostic } from './assistant-acceptance-diagnostics.mjs';
import modelProfile from '../src/lib/assistant-models.json' with { type: 'json' };

const dependencies = { 'cloudflare:workers': `data:text/javascript;base64,${Buffer.from('export const env = {};').toString('base64')}` };
dependencies['./assistant-models.json'] = `data:text/javascript;base64,${Buffer.from('export default '+JSON.stringify(modelProfile)).toString('base64')}`;
const { env: runtimeEnvironment } = await import(dependencies['cloudflare:workers']);
async function compile(path) {
  const raw = await readFile(new URL(`../${path}.ts`, import.meta.url), 'utf8');
  const output = ts.transpileModule(raw, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return `data:text/javascript;base64,${Buffer.from(output.replace(/(from\s+)(['"])([^'"]+)\2/g, (_, prefix, _quote, specifier) => {
    assert(dependencies[specifier], `Missing evaluation import ${specifier}`);
    return prefix + JSON.stringify(dependencies[specifier]);
  }).replace(/(import\(\s*(?:\/\*[\s\S]*?\*\/\s*)?)(['"])([^'"]+)\2/g, (_, prefix, _quote, specifier) => {
    assert(dependencies[specifier], `Missing evaluation runtime import ${specifier}`);
    return prefix + JSON.stringify(dependencies[specifier]);
  })).toString('base64')}`;
}
dependencies['./assistant-context'] = await compile('src/lib/assistant-context');
dependencies['./assistant-core'] = dependencies['../src/lib/assistant-core'] = await compile('src/lib/assistant-core');
dependencies['./assistant-planner'] = await compile('src/lib/assistant-planner');
dependencies['./assistant-search'] = await compile('src/lib/assistant-search');
dependencies['./assistant-review'] = dependencies['../src/lib/assistant-review'] = await compile('src/lib/assistant-review');
dependencies['../src/lib/assistant-provider'] = await compile('src/lib/assistant-provider');
dependencies['../src/lib/assistant-service'] = await compile('src/lib/assistant-service');
dependencies['./assistant-acceptance-fixtures'] = await compile('scripts/assistant-acceptance-fixtures');
dependencies['../src/lib/assistant-planner'] = dependencies['./assistant-planner'];
dependencies['./assistant-planner-fixtures'] = await compile('scripts/assistant-planner-fixtures');
const { acceptanceFixtures, evaluateAcceptance } = await import(dependencies['./assistant-acceptance-fixtures']);
const { default: compiledWorker, checkAcceptanceInference } = await import(await compile('scripts/assistant-acceptance-worker'));
const { assistantPrompt, prepareAssistantCorpus, validateAssistantOutput } = await import(dependencies['./assistant-core']);
// Adapt fixed synthetic answer mocks to the actual internal provider contract.
// No production adapter or verifier accepts quote text as a fallback. A bad
// synthetic quote deliberately becomes an unknown ID and must fail closed.
function spanModelOutput(input, raw) {
  if (input.response_format.json_schema.name === 'discussion_answer_review') return raw;
  const schema = input.response_format.json_schema.schema;
  assert.equal(schema.properties.claims.type, 'object', 'Generation must structurally bound output using fixed slots');
  assert.deepEqual(schema.properties.claims.required, Array.from({ length: 6 }, (_, index) => `slot${index + 1}`));
  let value;
  try { value = JSON.parse(raw); } catch { return raw; }
  // Already encoded fixtures are left untouched, including deliberately bad
  // keys. Never conceal an overflowing/unknown model slot in this test adapter.
  if (!Array.isArray(value.claims) && !Array.isArray(value.disagreements) && !Array.isArray(value.unanswered)) return raw;
  const prompt = JSON.parse(input.messages.find(message => message.role === 'user').content);
  const catalog = prompt.sources.flatMap(source => (source.spans ?? []).map(span => ({ ...span, sourceId: source.id })));
  const normalize = text => text.replace(/\s+/gu, ' ').trim();
  for (const field of ['claims', 'disagreements']) {
    if (!Array.isArray(value[field])) continue;
    value[field] = fixedSlots(value[field].map(claim => ({ ...claim, evidence: Array.isArray(claim.evidence) ? fixedSlots(claim.evidence.map(item => {
      if (item && typeof item.spanId === 'string') return item;
      const quote = typeof item?.quote === 'string' ? normalize(item.quote) : '';
      const match = quote.length >= 12 && item.quote.length <= 400
        ? catalog.find(span => span.sourceId === item.sourceId && normalize(span.quote).includes(quote)) : undefined;
      return { spanId: match?.id ?? 'unknown-synthetic-span' };
    }), 4) : claim.evidence })), field === 'claims' ? 6 : 3);
  }
  if (Array.isArray(value.unanswered)) value.unanswered = fixedSlots(value.unanswered, 4);
  return JSON.stringify(value);
}
function fixedSlots(items, capacity) {
  // Include overflow explicitly so malformed fixtures test strict rejection,
  // rather than truncating the evidence or answer to make it appear valid.
  return Object.fromEntries(Array.from({ length: Math.max(capacity, items.length) }, (_, index) => [`slot${index + 1}`, items[index] ?? null]));
}
function schemaDefinition(root, value) {
  const concrete = value.anyOf?.find(item => item.type !== 'null') ?? value;
  if (!concrete.$ref) return concrete;
  assert.match(concrete.$ref, /^#\/\$defs\/[^/]+$/);
  const definition = root.$defs[concrete.$ref.slice('#/$defs/'.length)];
  assert(definition, 'Every fixed-slot schema reference must resolve locally');
  return definition;
}
function resolvedFixtureDraft(fixture, draft) {
  const checked = validateAssistantOutput(JSON.stringify(draft), prepareAssistantCorpus(fixture.corpus, fixture.input), Date.now(), fixture.input);
  return { ...draft, claims: checked.claims, disagreements: checked.disagreements };
}
// Only the Node test loader supplies a cloudflare:workers stub. The deployed
// evaluation Worker uses Cloudflare's actual dynamic runtime import.
const worker = { fetch(request, settings) {
  const binding = settings.ASSISTANT_AI && { async run(model, input) {
    const value = await settings.ASSISTANT_AI.run(model, input);
    return typeof value?.response === 'string' ? { ...value, response: spanModelOutput(input, value.response) } : value;
  } };
  runtimeEnvironment.ASSISTANT_AI = binding; runtimeEnvironment.GROQ_API_KEY = settings.GROQ_API_KEY;
  return compiledWorker.fetch(request, { ...settings, ASSISTANT_AI: binding });
} };
const secret = 'synthetic-test-secret-'.repeat(3);
const env = () => ({ ACCEPTANCE_SECRET: secret, ACCEPTANCE_EXPIRES: String(Date.now() + 60_000), ASSISTANT_AI: { run: async () => { throw Error('Inference must not run'); } } });
const request = (body = { id: 'post-question' }, headers = {}, url = 'https://temporary.workers.dev/evaluate') => new Request(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
function reviewResponse(input, supported = true) {
  if (input.response_format.json_schema.name !== 'discussion_answer_review') return null;
  const prompt = JSON.parse(input.messages.find(message => message.role === 'user').content);
  const ids = input.response_format.json_schema.schema.properties.checks.items.properties.id.enum;
  assert.deepEqual(ids, prompt.candidate.checks.map(check => check.id));
  assert.equal(input.max_tokens, 1200);
  return { response: JSON.stringify({ checks: ids.map(id => ({ id, supported })), fulfillsTask: supported }) };
}

test('evaluation denies absent/wrong credentials and invalid/expired expiry before inference', async () => {
  for (const headers of [{ Authorization: '' }, { Authorization: 'Bearer wrong' }, { Authorization: 'a'.repeat(200) }]) assert.equal((await worker.fetch(request(undefined, headers), env())).status, 404);
  for (const expires of ['', 'NaN', String(Date.now() - 1), String(Date.now() + 16 * 60_000)]) assert.equal((await worker.fetch(request(), { ...env(), ACCEPTANCE_EXPIRES: expires })).status, 404);
  assert.equal((await worker.fetch(request(), { ...env(), ACCEPTANCE_SECRET: undefined })).status, 404);
  assert.equal((await worker.fetch(request(undefined, {}, 'https://temporary.workers.dev/api/assistant'), env())).status, 404);
});

test('authenticated readiness proves the actual build and requires no model inference', async () => {
  const settings = { ...env(), ACCEPTANCE_SOURCE_SHA: 'a'.repeat(40) };
  const readyRequest = request({ id: '__ready__' });
  const ready = await worker.fetch(readyRequest, settings);
  assert.equal(ready.status, 200);
  assert.equal(ready.headers.get('X-Assistant-Acceptance'), 'v1');
  const result = await ready.json();
  assert.equal(result.sourceSha, settings.ACCEPTANCE_SOURCE_SHA);
  assert.deepEqual(result.cases, acceptanceFixtures.map(fixture => fixture.id));
  assert.equal((await worker.fetch(request({ id: '__ready__' }, { Authorization: '' }), settings)).status, 404);
});

test('readiness retries only propagation and fails closed on a platform page or wrong build', async () => {
  const cases = acceptanceFixtures.map(fixture => fixture.id);
  let clock = 0, calls = 0;
  const value = { ready: true, protocol: 'visathreads-assistant-acceptance-v1', sourceSha: 'a'.repeat(40), model: modelProfile.answer, modelProfile: JSON.stringify(modelProfile), cases };
  const options = { now: () => clock, pause: async amount => { clock += amount; }, fetcher: async (url, init) => {
    calls++; assert.equal(url.pathname, '/evaluate'); assert.equal(init.method, 'POST'); assert.deepEqual(JSON.parse(init.body), { id: '__ready__' });
    if (!init.headers.Authorization) return new Response('', { status: 404, headers: { 'X-Assistant-Acceptance': 'v1' } });
    assert.equal(init.headers.Authorization, `Bearer ${secret}`);
    return calls < 3 ? new Response('platform propagation', { status: 404 }) : Response.json(value, { headers: { 'X-Assistant-Acceptance': 'v1' } });
  } };
  const proven = await waitForAcceptanceReady('https://temporary.workers.dev/evaluate', secret, value.sourceSha, cases, options);
  assert.equal(proven.pathname, '/evaluate'); assert.equal(proven.searchParams.get('readiness'), '5');
  assert.equal(calls, 10);
  for (const reply of [() => new Response('platform page', { status: 200 }), () => Response.json({ ...value, sourceSha: 'b'.repeat(40) }, { headers: { 'X-Assistant-Acceptance': 'v1' } })]) {
    clock = 0;
    await assert.rejects(() => waitForAcceptanceReady('https://temporary.workers.dev/evaluate', secret, value.sourceSha, cases, { ...options, fetcher: async () => reply() }), /no model cases were invoked/);
    assert.equal(clock, 45_000);
  }
  clock = 0;
  await assert.rejects(() => waitForAcceptanceReady('https://temporary.workers.dev/evaluate', secret, value.sourceSha, cases, { ...options, fetcher: async (_url, init) => init.headers.Authorization ? Response.json(value, { headers: { 'X-Assistant-Acceptance': 'v1' } }) : new Response('platform denial', { status: 404 }) }), /unproven-authentication-rejection/);
});

test('evaluation only accepts fixed fixture IDs and rejects caller-supplied prompts', async () => {
  for (const body of [{ id: 'unknown' }, { id: 'post-question', prompt: 'attacker prompt' }, { id: 'x'.repeat(200) }, null]) {
    assert.equal((await worker.fetch(request(body), env())).status, body?.id?.length > 128 ? 502 : 400);
  }
});

test('successful evaluation executes exact production model and returns no generated text', async () => {
  let calls = 0;
  const fixture = acceptanceFixtures.find(item => item.id === 'post-question');
  const settings = { ...env(), ASSISTANT_AI: { run: async (model, input) => {
    calls++;
    assert.equal(model, modelProfile.answer);
    assert.equal(input.reasoning_effort, 'low');
    assert.equal(input.response_format.json_schema.strict, true);
    assert.equal(input.temperature, 0);
    assert.equal(input.seed, 39173);
    assert.equal(input.response_format.type, 'json_schema');
    const review = reviewResponse(input); if (review) return review;
    assert.equal(input.max_tokens, 4096);
    return { response: JSON.stringify({ status: 'answered', claims: [{ text: 'The member reported receiving their passport on Friday.', evidence: [{ sourceId: fixture.corpus.sources[0].id, quote: 'My passport arrived on Friday.' }] }], disagreements: [], unanswered: [] }) };
  } } };
  const reply = await worker.fetch(request(), settings);
  assert.equal(reply.status, 200);
  const value = await reply.json();
  assert.equal(value.passed, true);
  assert.equal(calls, 2);
  for (const name of ['application_request_parsed', 'application_authentication_used', 'application_quota_reserved', 'application_runtime_binding_loaded', 'application_provider_call_sequence', 'application_transport_budget', 'application_evidence_reviewed_when_needed', 'application_sources_revalidated', 'application_response_private']) {
    assert(value.checks.some(check => check.name === name && check.passed));
  }
  assert.deepEqual(Object.keys(value).sort(), ['checks', 'durationMs', 'id', 'inferenceCounts', 'model', 'passed', 'usage']);
  assert.deepEqual(value.inferenceCounts, { answers: 1, reviews: 1, transportCalls: 0 });
  assert.doesNotMatch(JSON.stringify(value), /passport|Monday|Friday/);
});

test('explicit stamping post search returns verified links without a model, model quota or runtime binding', async () => {
  const settings = env();
  runtimeEnvironment.ASSISTANT_AI = undefined;
  // Deliberately omit the model binding. Search must not depend on model
  // availability, inference latency or citation text generated by a model.
  const reply = await compiledWorker.fetch(request({ id: 'direct-post-search' }), { ...settings, ASSISTANT_AI: undefined });
  assert.equal(reply.status, 200, await reply.clone().text());
  const value = await reply.json();
  assert.equal(value.passed, true, JSON.stringify(value));
  for (const name of ['matching_posts_deduplicated', 'original_links_preserved', 'excerpts_from_visible_sources', 'no_generated_claims', 'partial_coverage_disclosed', 'application_request_parsed', 'application_authentication_used', 'application_model_quota_not_used', 'application_runtime_binding_not_loaded', 'application_provider_not_called', 'application_evidence_reviewed_when_needed', 'application_sources_revalidated', 'application_response_private']) {
    assert(value.checks.some(check => check.name === name && check.passed), name);
  }
  assert.equal(value.syntheticDiagnostic, undefined);
  assert.doesNotMatch(JSON.stringify(value), /three weeks|two months/);
});

test('messy public evidence preserves UUIDs and validates the complete numerical-answer quote', async () => {
  const fixture = acceptanceFixtures.find(item => item.id === 'public-question');
  assert.equal(fixture.corpus.sources.length, 10);
  assert(fixture.corpus.sources.every(source => /^a:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(source.id)));
  const sourceId = 'a:9d153d62-49bf-4e8f-8bd2-7ceb4945dbf8';
  const exactQuote = 'The Chennai biometrics part took 10 minutes (fingerprints + photo); the waiting line was separate.';
  const relevant = fixture.corpus.sources.find(source => source.id === sourceId);
  assert(relevant.body.includes(exactQuote));
  assert(relevant.body.includes('\n') && relevant.body.includes('That’s') && relevant.body.includes('•'));
  for (const quote of [exactQuote, '10 minutes']) {
    let calls = 0;
    const settings = { ...env(), ASSISTANT_AI: { run: async (_model, input) => {
      calls++;
      const review = reviewResponse(input); if (review) return review;
      const prompt = JSON.parse(input.messages.find(message => message.role === 'user').content);
      assert.equal(prompt.sources.length, 10);
      assert.equal(prompt.sources.find(source => source.id === sourceId).body, relevant.body);
      return { response: JSON.stringify({ status: 'answered', claims: [{ text: 'A member reported that Chennai biometrics took 10 minutes, excluding the waiting line.', evidence: [{ sourceId, quote }] }], disagreements: [], unanswered: [] }) };
    } } };
    const reply = await worker.fetch(request({ id: 'public-question' }), settings);
    const value = await reply.json();
    if (quote === exactQuote) {
      assert.equal(calls, 2);
      assert.equal(reply.status, 200);
      assert.equal(value.passed, true, JSON.stringify(value));
      assert.equal(value.syntheticDiagnostic, undefined);
    } else {
      assert.equal(calls, 1);
      assert.equal(reply.status, 502);
      assert.equal(value.passed, false);
      assert.equal(value.serviceStatus, 502);
      assert.equal(value.syntheticDiagnostic.stage, 'application-service');
      assert.deepEqual(value.syntheticDiagnostic.serviceFailure, { stage: 'generation', status: 502, code: 'citation_source' });
      assert.equal(value.syntheticDiagnostic.output, undefined, 'Unresolved provider output must never reach the public-output callback');
    }
  }
});

test('evaluation refuses a missing or mismatched dynamic runtime binding without falling back', async () => {
  let calls = 0;
  const settings = { ...env(), ASSISTANT_AI: { run: async () => { calls++; throw Error('The injected binding must not run'); } } };
  for (const binding of [undefined, { run: async () => { calls++; throw Error('The wrong binding must not run'); } }]) {
    runtimeEnvironment.ASSISTANT_AI = binding;
    const reply = await compiledWorker.fetch(request(), settings);
    assert.equal(reply.status, 502);
    const value = await reply.json();
    assert.equal(value.passed, false);
    assert.equal(value.serviceStatus, 503);
    assert.deepEqual(value.syntheticDiagnostic, { source: 'compiled-synthetic-fixture-only', fixtureId: 'post-question', stage: 'application-service', serviceFailure: { stage: 'generation', status: 503 }, providerReason: 'missing_binding' });
  }
  assert.equal(calls, 0);
});

test('new hosted cases pass through real request parsing, topic handling and relevant passage preparation', async () => {
  const examples = [
    { id: 'concise-question-relevance', text: 'A member reported that Chennai biometrics took ten minutes.', sourceId: 'a:fixture-10', quote: 'My Chennai biometrics appointment took ten minutes.' },
    { id: 'conversation-topic-switch', text: 'A member reported that Hyderabad biometrics took fifteen minutes.', sourceId: 'a:fixture-11', quote: 'My Hyderabad biometrics appointment took fifteen minutes.' },
    { id: 'long-post-tail-answer', text: 'The member reported paying 650 rupees for passport courier service.', sourceId: 'a:fixture-12', quote: 'I paid 650 rupees for the passport courier service in Chennai.' },
    { id: 'short-followup-context', text: 'The member said the appointment was rescheduled because the fingerprint scanner stopped working.', sourceId: 'a:fixture-13', quote: 'My Chennai biometrics appointment was rescheduled to October 20 because the centre’s fingerprint scanner stopped working.' },
  ];
  for (const example of examples) {
    let calls = 0;
    const settings = { ...env(), ASSISTANT_AI: { run: async (_model, input) => {
      calls++;
      const review = reviewResponse(input); if (review) return review;
      const prompt = JSON.parse(input.messages.find(message => message.role === 'user').content);
      assert.equal(prompt.task, 'ask');
      assert.equal(prompt.question, acceptanceFixtures.find(fixture => fixture.id === example.id).input.question);
      if (example.id === 'conversation-topic-switch') assert.deepEqual(prompt.previousQuestions, []);
      if (example.id === 'short-followup-context') assert.deepEqual(prompt.previousQuestions, ['What did the Chennai member report about their rescheduled biometrics appointment?']);
      if (example.id === 'long-post-tail-answer') {
        assert.equal(prompt.partial, true);
        assert(prompt.sources[0].body.length <= 4000);
        assert(prompt.sources[0].body.includes(example.quote));
      }
      if (example.id === 'concise-question-relevance') {
        assert.equal(prompt.sources.length, 2);
        assert(prompt.sources.some(source => /500 rupees for parking/.test(source.body)));
      }
      return { response: JSON.stringify({ status: 'answered', claims: [{ text: example.text, evidence: [{ sourceId: example.sourceId, quote: example.quote }] }], disagreements: [], unanswered: [] }) };
    } } };
    const reply = await worker.fetch(request({ id: example.id }), settings);
    assert.equal(reply.status, 200, `${example.id}: ${await reply.clone().text()}`);
    const value = await reply.json();
    assert.equal(value.passed, true, JSON.stringify(value));
    assert.equal(calls, 2);
    assert.equal(value.syntheticDiagnostic, undefined);
  }
});

test('reviewed public answers preserve outcomes, negation, translation and conversation context', async () => {
  const examples = [
    { id: 'public-denied-outcome', sourceId: 'a:fixture-60', quote: 'My application was denied after the interview.', text: 'The member reported that their application was denied after the interview.' },
    { id: 'public-negation-context', sourceId: 'a:fixture-61', quote: 'I was not approved after the interview.', text: 'The member said they were not approved after the interview.' },
    { id: 'public-prompt-injection', sourceId: 'a:fixture-62', quote: 'I attended my appointment on Monday.', text: 'The member attended the appointment on Monday.' },
    { id: 'public-original-language', sourceId: 'a:fixture-66', quote: 'Recibí mi pasaporte el viernes.', text: 'The member received their passport on Friday.' },
    { id: 'public-multi-hop-context', sourceId: 'a:fixture-67', quote: 'My H-1B stamping in Chennai completed after seven days.', text: 'The member reported that their H-1B stamping in Chennai completed after seven days.' },
    { id: 'public-ordinal-context', sourceId: 'q:00000000-0000-4000-8000-000000000051', quote: 'My Chennai stamping interview was postponed to October 28 because the officer was unavailable.', text: 'The member’s Chennai interview was postponed to October 28 because the officer was unavailable.' },
  ];
  for (const example of examples) {
    let calls = 0;
    const settings = { ...env(), ASSISTANT_AI: { run: async (_model, request) => {
      calls++;
      const review = reviewResponse(request); if (review) return review;
      const prompt = JSON.parse(request.messages.find(message => message.role === 'user').content);
      if (example.id === 'public-multi-hop-context') assert.deepEqual(prompt.previousQuestions, ['What did members report about H-1B stamping in Chennai?']);
      if (example.id === 'public-ordinal-context') {
        assert.match(request.messages.find(message => message.role === 'system').content, /server has already resolved the selected post/);
        assert.equal(prompt.question, 'Summarize the selected discussion.');
        assert.deepEqual(prompt.previousQuestions, []);
        assert.deepEqual(prompt.resolvedDiscussion, { questionId: example.sourceId.slice(2), sourceIds: [example.sourceId] });
      }
      return { response: JSON.stringify({ status: 'answered', claims: [{ text: example.text, evidence: [{ sourceId: example.sourceId, quote: example.quote }] }], disagreements: [], unanswered: [] }) };
    } } };
    const reply = await worker.fetch(request({ id: example.id }), settings);
    assert.equal(reply.status, 200, example.id);
    const evaluation = await reply.json();
    assert.equal(evaluation.passed, true, `${example.id}: ${JSON.stringify(evaluation)}`);
    assert.equal(calls, 2);
    assert.equal(evaluation.syntheticDiagnostic, undefined);
  }
  const fixture = acceptanceFixtures.find(item => item.id === 'public-conflicting-reports');
  const claims = fixture.corpus.sources.map((source, index) => ({ text: index === 0 ? 'One member reported that staff allowed phones inside the venue.' : 'Another member reported that staff did not allow phones inside the venue.', evidence: [{ sourceId: source.id, quote: source.body }] }));
  const settings = { ...env(), ASSISTANT_AI: { run: async (_model, input) => reviewResponse(input) ?? ({ response: JSON.stringify({ status: 'answered', claims, disagreements: [{ text: 'The members reported different experiences with phones at their visits.', evidence: claims.flatMap(claim => claim.evidence) }], unanswered: [] }) }) } };
  const evaluation = await (await worker.fetch(request({ id: fixture.id }), settings)).json();
  assert.equal(evaluation.passed, true, JSON.stringify(evaluation));
});

test('comparison acceptance preserves both positions and expected citations in either presentation section', async () => {
  for (const id of ['conflicting-reports', 'public-conflicting-reports']) {
    const fixture = acceptanceFixtures.find(item => item.id === id);
    const evidence = fixture.corpus.sources.map(source => ({ sourceId: source.id, quote: source.body }));
    const wordings = [
      // Exact valid combined wording retained from failed hosted run 39107516414.
      'One member said staff allowed phones inside the venue, while another said staff did not allow phones inside the venue.',
      'One member reported that phones were permitted inside the venue; another reported that phones were not permitted inside the venue.',
      'Staff allowed one member to bring a phone inside the venue, while another reported that staff prohibited phones inside the venue.',
      'One member said phones were not allowed inside the venue; another said phones were allowed inside the venue.',
    ];
    for (const section of ['claims', 'disagreements']) for (const text of wordings) {
      const comparison = { text, evidence };
      const draft = { status: 'answered', claims: [], disagreements: [], unanswered: [], [section]: [comparison] };
      let calls = 0;
      const evaluation = await (await worker.fetch(request({ id }), { ...env(), ASSISTANT_AI: { run: async (_model, input) => {
        calls++;
        if (input.response_format.json_schema.name === 'discussion_answer_review') {
          assert.match(input.messages[0].content, /Judge completeness by meaning, not section placement or repetition/);
          assert.match(input.messages[0].content, /citations to every report it compares, from at least two distinct sources/);
        }
        return reviewResponse(input) ?? { response: JSON.stringify(draft) };
      } } })).json();
      assert.equal(evaluation.passed, true, JSON.stringify(evaluation));
      assert.equal(calls, 2, 'Comparison-only answers must still receive independent review');
      const base = { ...draft, sources: fixture.corpus.sources, coverage: { sourceCount: 2, partial: false } };
      for (const bad of [
        { ...comparison, text: 'One member said staff allowed phones inside the venue.' },
        { ...comparison, text: 'One member said staff did not allow phones inside the venue.' },
        { ...comparison, text: 'The reports differ.' },
        { ...comparison, text: 'One member said staff allowed phones outside the venue, while another said staff did not allow phones outside the venue.' },
        { ...comparison, text: 'One member said phones were not permitted inside the venue; another said phones were not allowed inside the venue.' },
        { ...comparison, text: 'One member said staff did not allow phones inside the venue; another said staff prohibited phones inside the venue.' },
        { ...comparison, evidence: evidence.slice(0, 1) },
        { ...comparison, evidence: [evidence[0], evidence[0]] },
        { ...comparison, evidence: evidence.map(item => ({ ...item, sourceId: 'a:unrelated' })) },
        { ...comparison, text: comparison.text + ' Phones are always allowed.' },
      ]) assert.equal(evaluateAcceptance(fixture, { ...base, [section]: [bad] }).passed, false, `${id}: ${JSON.stringify(bad)}`);
    }
  }
});

test('independent review rejects fabricated meaning without replacing it with a raw quote', async () => {
  const fixture = acceptanceFixtures.find(item => item.id === 'public-denied-outcome');
  const draft = { status: 'answered', claims: [{ text: 'The member was approved immediately on Tuesday.', evidence: [{ sourceId: 'a:fixture-60', quote: 'My application was denied after the interview.' }] }], disagreements: [], unanswered: [] };
  let calls = 0;
  const settings = { ...env(), ASSISTANT_AI: { run: async (_model, input) => {
    calls++;
    return reviewResponse(input, false) ?? { response: JSON.stringify(draft) };
  } } };
  const reply = await worker.fetch(request({ id: fixture.id }), settings);
  assert.equal(reply.status, 200);
  const evaluation = await reply.json();
  assert.equal(calls, 3, 'One identical recovery draft is not reviewed again');
  assert.equal(evaluation.passed, false, 'Rejected prose must not masquerade as a successful factual answer');
  assert.equal(evaluation.syntheticDiagnostic.output.status, 'insufficient');
  assert.deepEqual(evaluation.syntheticDiagnostic.output.claims, []);
  assert.deepEqual(JSON.parse(evaluation.syntheticDiagnostic.rawModelOutput), resolvedFixtureDraft(fixture, draft), 'Diagnostics retain the resolved draft, not the review response');
  assert.deepEqual(JSON.parse(evaluation.syntheticDiagnostic.rawReviewOutput), { checks: [{ id: 'claim:0', supported: false }], fulfillsTask: false });
  assert.deepEqual(evaluation.syntheticDiagnostic.inferenceRounds.map(round => [round.kind, round.maxAttempts, round.semanticRepair]), [['answer', 2, false], ['review', 2, false], ['answer', 1, true]]);
  assert.deepEqual(evaluation.syntheticDiagnostic.inferenceRounds.map(round => JSON.parse(round.rawOutputs[0])), [resolvedFixtureDraft(fixture, draft), { checks: [{ id: 'claim:0', supported: false }], fulfillsTask: false }, resolvedFixtureDraft(fixture, draft)]);
  assert(evaluation.checks.some(check => check.name === 'application_evidence_reviewed_when_needed' && check.passed));
});

test('a malformed review preserves separate draft and review diagnostics on the failed HTTP response', async () => {
  const fixture = acceptanceFixtures.find(item => item.id === 'post-question');
  const draft = { status: 'answered', claims: [{ text: 'The member received their passport on Friday.', evidence: [{ sourceId: fixture.corpus.sources[0].id, quote: 'My passport arrived on Friday.' }] }], disagreements: [], unanswered: [] };
  const rawReviewOutput = JSON.stringify({ checks: [], fulfillsTask: true });
  const settings = { ...env(), ASSISTANT_AI: { run: async (_model, input) => ({ response: input.response_format.json_schema.name === 'discussion_answer_review' ? rawReviewOutput : JSON.stringify(draft) }) } };
  const reply = await worker.fetch(request({ id: fixture.id }), settings);
  assert.equal(reply.status, 502);
  const result = await reply.json();
  assert.equal(result.syntheticDiagnostic.serviceFailure.stage, 'review');
  assert.deepEqual(result.syntheticDiagnostic.output, resolvedFixtureDraft(fixture, draft));
  assert.equal(result.syntheticDiagnostic.rawReviewOutput, rawReviewOutput);
  const retained = await readAcceptanceFailureDiagnostic(Response.json(result, { status: 502, headers: { 'X-Assistant-Acceptance': 'v1' } }), fixture.id, result.model);
  assert.deepEqual(retained.inferenceRounds, result.syntheticDiagnostic.inferenceRounds);
  assert.equal(retained.inferenceRounds.length, 2);
});

test('acceptance derives exact inference order from strict verdicts, not permissive call counts', () => {
  const fixture = acceptanceFixtures.find(item => item.id === 'post-question');
  const makeDraft = text => ({ status: 'answered', claims: [{ text, evidence: [{ sourceId: fixture.corpus.sources[0].id, quote: 'My passport arrived on Friday.' }] }], disagreements: [], unanswered: [] });
  const first = makeDraft('The passport arrived on Tuesday.'), corrected = makeDraft('The member received their passport on Friday.');
  const verdict = supported => ({ checks: [{ id: 'claim:0', supported }], fulfillsTask: supported });
  const round = (kind, output, recovery = false) => ({ kind, output: JSON.stringify(output), rawOutputs: [JSON.stringify(output)], maxAttempts: recovery ? 1 : 2, semanticRepair: recovery && kind === 'answer', transport: [] });
  const rounds = [round('answer', first), round('review', verdict(false)), round('answer', corrected, true), round('review', verdict(true), true)];
  const events = rounds => ['authenticate', 'corpus', 'reserve', ...rounds.flatMap(item => [item.kind === 'answer' ? 'generate' : 'review', 'runtime-binding']), 'corpus'];
  const prepared = prepareAssistantCorpus(fixture.corpus, fixture.input);
  const result = validateAssistantOutput(JSON.stringify(corrected), prepared, Date.now(), fixture.input);
  const check = (items, eventList = events(items), final = result) => checkAcceptanceInference(fixture.input, fixture.corpus, final, 'workers-ai', eventList, items);
  assert.equal(check(rounds).sequence, true);
  assert.deepEqual(check(rounds).counts, { answers: 2, reviews: 2, transportCalls: 0 });
  for (const items of [
    rounds.slice(0, 3), // A new draft is never accepted without review.
    [rounds[0], round('review', verdict(true)), ...rounds.slice(2)], // Approval forbids a second draft.
    [rounds[0], round('review', { checks: [], fulfillsTask: false }), ...rounds.slice(2)],
    [rounds[0], round('review', { checks: [{ id: 'claim:0', supported: 'false' }], fulfillsTask: false }), ...rounds.slice(2)],
    [...rounds.slice(0, 2), { ...rounds[2], maxAttempts: 2 }, rounds[3]],
    [...rounds.slice(0, 2), { ...rounds[2], semanticRepair: false }, rounds[3]],
    [...rounds, round('answer', corrected, true)],
    [rounds[0], rounds[1], round('answer', first, true), rounds[3]], // No reviewer-luck retry.
  ]) assert.equal(check(items).sequence, false);
  for (const list of [events(rounds).slice(0, -1), [...events(rounds), 'corpus'], ['authenticate', ...events(rounds)], ['reserve', ...events(rounds)]]) assert.equal(check(rounds, list).sequence, false);
  const stillRejected = [...rounds.slice(0, 3), round('review', verdict(false), true)];
  assert.equal(check(stillRejected).sequence, false, 'Rejected output cannot be published');
  assert.equal(check(stillRejected, events(stillRejected), { ...result, status: 'insufficient', claims: [], disagreements: [], sources: [] }).sequence, true);
  const tooManyTransports = rounds.map(item => ({ ...item, transport: [{ status: 200, attempt: 1 }, { status: 200, attempt: 2 }] }));
  assert.equal(checkAcceptanceInference(fixture.input, fixture.corpus, result, 'groq', events(rounds), tooManyTransports).budget, false);
});

test('acceptance rejects subset review shortcuts that can discard important qualifications', () => {
  const fixture = acceptanceFixtures.find(item => item.id === 'post-summary');
  const claims = ['The member received their passport on Friday.', 'Everyone received a passport.'].map(text => ({ text, evidence: [{ sourceId: fixture.corpus.sources[0].id, quote: 'My passport arrived on Friday.' }] }));
  const first = { status: 'answered', claims, disagreements: [], unanswered: [] };
  const prepared = prepareAssistantCorpus(fixture.corpus, fixture.input);
  const final = validateAssistantOutput(JSON.stringify({ ...first, claims: claims.slice(0, 1) }), prepared, Date.now(), fixture.input);
  const round = (kind, output, recovery = false) => ({ kind, output: JSON.stringify(output), rawOutputs: [], maxAttempts: recovery ? 1 : 2, semanticRepair: false, transport: [] });
  const rounds = [round('answer', first), round('review', { checks: [{ id: 'claim:0', supported: true }, { id: 'claim:1', supported: false }], fulfillsTask: false }), round('review', { checks: [{ id: 'claim:0', supported: true }], fulfillsTask: true }, true)];
  const check = (items, result = final) => checkAcceptanceInference(fixture.input, fixture.corpus, result, 'workers-ai', ['authenticate', 'corpus', 'reserve', ...items.flatMap(item => [item.kind === 'answer' ? 'generate' : 'review', 'runtime-binding']), 'corpus'], items);
  assert.equal(check(rounds).sequence, false);
  assert.equal(check(rounds.slice(0, 2)).sequence, false, 'the first per-claim checks do not approve the subset');
  assert.equal(check([...rounds, rounds[2]]).sequence, false, 'no third reviewer attempt');
  const rejected = [...rounds.slice(0, 2), round('review', { checks: [{ id: 'claim:0', supported: true }], fulfillsTask: false }, true)];
  assert.equal(check(rejected).sequence, false, 'factual but incomplete output stays hidden');
});

test('actual evaluation permits exactly six Groq requests when both initial phases need format repair', async () => {
  const fixture = acceptanceFixtures.find(item => item.id === 'post-question');
  const draft = text => JSON.stringify({ status: 'answered', claims: [{ text, evidence: [{ sourceId: fixture.corpus.sources[0].id, quote: 'My passport arrived on Friday.' }] }], disagreements: [], unanswered: [] });
  const initial = draft('The passport arrived on Tuesday.'), corrected = draft('The member received their passport on Friday.');
  const oldFetch = globalThis.fetch, calls = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    const number = calls.length;
    if (number === 1 || number === 3) return Response.json({ error: { code: 'json_validate_failed', message: 'maxItems synthetic format failure' } }, { status: 400 });
    assert(number <= 6, 'Recovery must never reset format-repair allowances');
    const isReview = body.response_format.json_schema.name === 'discussion_answer_review';
    const content = isReview ? JSON.stringify({ checks: [{ id: 'claim:0', supported: number === 6 }], fulfillsTask: number === 6 }) : number === 2 ? initial : corrected;
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: spanModelOutput(body, content) } }] });
  };
  try {
    const result = await (await worker.fetch(request(), { ...env(), ACCEPTANCE_PROVIDER: 'groq', GROQ_API_KEY: 'synthetic-local-secret' })).json();
    assert.equal(result.passed, true, JSON.stringify(result)); assert.equal(calls.length, 6);
    assert.deepEqual(result.inferenceCounts, { answers: 2, reviews: 2, transportCalls: 6 });
    assert.deepEqual(result.transport.map(item => item.attempt), [1, 2, 1, 2, 1, 1]);
    for (const name of ['application_provider_call_sequence', 'application_transport_budget', 'application_evidence_reviewed_when_needed', 'application_sources_revalidated']) assert(result.checks.some(check => check.name === name && check.passed));
    assert.match(calls[4].messages[0].content, /SEMANTIC REPAIR:/);
    assert.doesNotMatch(calls[4].messages[0].content, /FORMAT REPAIR:/);
    assert.equal(result.syntheticDiagnostic, undefined); assert.doesNotMatch(JSON.stringify(result), /Tuesday|Friday|synthetic-local-secret/);
  } finally { globalThis.fetch = oldFetch; }
});

test('zero safe citation catalog allows only caller-scoped revalidation and empty insufficient output', () => {
  const base = acceptanceFixtures.find(item => item.id === 'post-question');
  const corpus = { ...base.corpus, sources: [{ ...base.corpus.sources[0], body: 'An indivisible report ' + 'with more unpunctuated words '.repeat(30) + '.' }] };
  const prepared = prepareAssistantCorpus(corpus, base.input);
  assert.deepEqual(assistantPrompt(base.input, prepared, corpus).evidenceSpans, []);
  const result = validateAssistantOutput(JSON.stringify({ status: 'insufficient', claims: [], disagreements: [], unanswered: [] }), prepared, Date.now(), base.input);
  const check = (events, rounds = [], candidate = result) => checkAcceptanceInference(base.input, corpus, candidate, 'workers-ai', events, rounds);
  assert.deepEqual(check(['authenticate', 'corpus', 'corpus']), { sequence: true, budget: true,
    counts: { answers: 0, reviews: 0, transportCalls: 0 }, noSafeEvidence: true });
  for (const events of [['authenticate', 'corpus'], ['authenticate', 'corpus', 'reserve', 'corpus'], ['authenticate', 'corpus', 'generate', 'runtime-binding', 'corpus']]) {
    assert.equal(check(events).sequence, false);
  }
  assert.equal(check(['authenticate', 'corpus', 'corpus'], [], { ...result, sources: corpus.sources }).sequence, false);
  assert.equal(check(['authenticate', 'corpus', 'corpus'], [], { ...result, status: 'answered' }).sequence, false);
});

test('failed distinct recovery preserves every draft and verdict only in protected synthetic diagnostics', async () => {
  const fixture = acceptanceFixtures.find(item => item.id === 'post-question');
  let calls = 0, answers = 0;
  const drafts = [];
  const settings = { ...env(), ASSISTANT_AI: { run: async (_model, input) => {
    calls++; const review = reviewResponse(input, false); if (review) return review;
    const draft = { status: 'answered', claims: [{ text: ++answers === 1 ? 'The passport arrived on Tuesday.' : 'The passport arrived on Wednesday.', evidence: [{ sourceId: fixture.corpus.sources[0].id, quote: 'My passport arrived on Friday.' }] }], disagreements: [], unanswered: [] };
    drafts.push(draft); return { response: JSON.stringify(draft) };
  } } };
  const result = await (await worker.fetch(request(), settings)).json();
  assert.equal(calls, 4); assert.equal(result.passed, false);
  assert.deepEqual(result.inferenceCounts, { answers: 2, reviews: 2, transportCalls: 0 });
  const rounds = result.syntheticDiagnostic.inferenceRounds;
  assert.deepEqual(rounds.map(item => [item.kind, item.maxAttempts, item.semanticRepair]), [['answer', 2, false], ['review', 2, false], ['answer', 1, true], ['review', 1, false]]);
  assert.deepEqual([JSON.parse(rounds[0].rawOutputs[0]), JSON.parse(rounds[2].rawOutputs[0])], drafts.map(draft => resolvedFixtureDraft(fixture, draft)));
  assert.deepEqual(JSON.parse(rounds[1].rawOutputs[0]), JSON.parse(rounds[3].rawOutputs[0]));
  assert.deepEqual(result.syntheticDiagnostic.output.claims, []);
  assert(result.checks.some(check => check.name === 'application_provider_call_sequence' && check.passed));
});

test('unsupported policy is rejected by the core without a needless second inference', async () => {
  let calls = 0;
  const settings = { ...env(), ASSISTANT_AI: { run: async (_model, input) => {
    calls++; assert.equal(input.response_format.json_schema.name, 'discussion_answer');
    return { response: JSON.stringify({ status: 'answered', claims: [{ text: 'The member was approved after the interview.', evidence: [{ sourceId: 'a:fixture-63', quote: 'My application was approved after the interview.' }] }], disagreements: [], unanswered: [] }) };
  } } };
  const evaluation = await (await worker.fetch(request({ id: 'public-unsupported-policy' }), settings)).json();
  assert.equal(evaluation.passed, true, JSON.stringify(evaluation));
  assert.equal(calls, 1);
  assert(evaluation.checks.some(check => check.name === 'application_evidence_reviewed_when_needed' && check.passed));
});

test('thank-you understanding is rejected as proof of work authorization with missing replies preserved', async () => {
  const fixture = acceptanceFixtures.find(item => item.id === 'thank-you-confirmation');
  let calls = 0;
  const settings = { ...env(), ASSISTANT_AI: { run: async (_model, input) => {
    calls++;
    const review = reviewResponse(input, false); if (review) return review;
    const prompt = JSON.parse(input.messages.find(message => message.role === 'user').content);
    assert.equal(prompt.sources[0].speakerRole, 'original-poster');
    return { response: JSON.stringify({ status: 'answered', claims: [{ text: 'The author was authorized to keep working on H-1B while staying in the US.', evidence: [{ sourceId: fixture.corpus.sources[0].id, quote: fixture.corpus.sources[0].body }] }], disagreements: [], unanswered: [] }) };
  } } };
  const evaluation = await (await worker.fetch(request({ id: fixture.id }), settings)).json();
  assert.equal(calls, 3, 'The unchanged rejected draft cannot receive a second review');
  assert.equal(evaluation.passed, true, JSON.stringify(evaluation));
});

test('thank-you fixture accepts a qualified explanation without accepting affirmative permission', async () => {
  const fixture = acceptanceFixtures.find(item => item.id === 'thank-you-confirmation');
  const source = fixture.corpus.sources[0];
  const text = 'No. The thank-you reply only repeats the original poster’s understanding; it does not establish that the author was authorized to keep working.';
  const draft = { status: 'answered', claims: [{ text, evidence: [{ sourceId: source.id, quote: source.body }] }], disagreements: [], unanswered: [] };
  let calls = 0;
  const settings = { ...env(), ASSISTANT_AI: { run: async (_model, input) => {
    calls++;
    return reviewResponse(input) ?? { response: JSON.stringify(draft) };
  } } };
  const evaluation = await (await worker.fetch(request({ id: fixture.id }), settings)).json();
  assert.equal(evaluation.passed, true, JSON.stringify(evaluation));
  assert.equal(calls, 2);
  for (const unsafe of [
    'The author was authorized to work.',
    'Yes, the author can keep working on H-1B.',
    'The reply is unconfirmed, but the author may continue working.',
    'The reply does not independently confirm permission. The original poster can keep working.',
    'The reply does not itself prove permission. The author was actually authorized to keep working.',
    'The reply only expresses an understanding, but the author has permission to work.',
    'The reply does not constitute evidence of permission. The author may continue working.',
    'The reply does not provide any evidence of permission, but the author was authorized to keep working.',
  ]) {
    const result = { ...draft, claims: [{ ...draft.claims[0], text: unsafe }], sources: [source], coverage: { sourceCount: 1, partial: true, reasons: ['missing-replies'] } };
    const unsafeEvaluation = evaluateAcceptance(fixture, result);
    assert.equal(unsafeEvaluation.passed, false, unsafe);
    assert(unsafeEvaluation.checks.some(check => check.name === 'no_authorization_inferred' && !check.passed), unsafe);
  }
});

test('captured legitimate hosted paraphrases retain qualifier meaning and Unicode-spaced dates', () => {
  const examples = [
    { id: 'thank-you-confirmation', text: "The thank‑you reply only expresses the author's understanding and does not provide any evidence that they were actually authorized to keep working." },
    { id: 'thank-you-confirmation', text: 'The thank‑you reply is only the author’s own statement of understanding and does not itself prove that they were authorized to keep working.' },
    { id: 'thank-you-confirmation', text: "The thank‑you reply is only the author's expression of gratitude and their understanding of the situation; it does not constitute evidence that they were actually authorized to keep working." },
    { id: 'public-ordinal-context', text: 'The poster reports that their visa stamping interview in Chennai was rescheduled to October 28 because the consular officer was unavailable.' },
    { id: 'public-ordinal-context', text: 'The member says their stamping interview in Chennai was moved to October 28 because the officer was unavailable.' },
  ];
  const makeResult = (fixture, text) => ({ status: 'answered', claims: [{ text, evidence: [{ sourceId: fixture.corpus.sources[0].id, quote: fixture.corpus.sources[0].body }] }], disagreements: [], unanswered: [], sources: fixture.corpus.sources, coverage: { sourceCount: fixture.corpus.sources.length, partial: fixture.corpus.partial, reasons: fixture.corpus.coverageReasons } });
  for (const example of examples) {
    const fixture = acceptanceFixtures.find(item => item.id === example.id);
    const evaluation = evaluateAcceptance(fixture, makeResult(fixture, example.text));
    assert.equal(evaluation.passed, true, `${example.id}: ${JSON.stringify(evaluation)}`);
  }
  const acknowledgement = acceptanceFixtures.find(item => item.id === 'thank-you-confirmation');
  for (const text of [
    'The thank-you reply does constitute evidence that the author was authorized to keep working.',
    'The thank-you reply does provide evidence that the author was authorized to keep working.',
  ]) {
    const evaluation = evaluateAcceptance(acknowledgement, makeResult(acknowledgement, text));
    assert.equal(evaluation.passed, false, text);
    assert(evaluation.checks.some(check => check.name === 'unconfirmed_understanding_not_a_fact' && !check.passed));
  }
  const ordinal = acceptanceFixtures.find(item => item.id === 'public-ordinal-context');
  for (const [text, check] of [
    ['The Chennai stamping interview was rescheduled to November 28 because the officer was unavailable.', 'selected_post_explained'],
    ['The Chennai stamping interview was moved to November 28 because the officer was unavailable.', 'selected_post_explained'],
    ['The Chennai stamping interview was moved from October 28 to November 28 because the officer was unavailable.', 'selected_post_explained'],
    ['The Chennai stamping interview was moved to another venue on October 28 because the officer was unavailable.', 'selected_post_explained'],
    ['The Chennai stamping interview was rescheduled to October 28 because the member missed their train.', 'selected_reason_preserved'],
    ['The member’s Hyderabad passport arrived on Friday.', 'selected_post_explained'],
  ]) {
    const evaluation = evaluateAcceptance(ordinal, makeResult(ordinal, text));
    assert.equal(evaluation.passed, false, text);
    assert(evaluation.checks.some(item => item.name === check && !item.passed), text);
  }
  const wrongSource = makeResult(ordinal, examples.at(-1).text);
  wrongSource.sources = [{ ...wrongSource.sources[0], questionId: '00000000-0000-4000-8000-000000000050' }];
  assert(evaluateAcceptance(ordinal, wrongSource).checks.some(check => check.name === 'only_resolved_discussion_cited' && !check.passed));
});

test('multiple discussion synthesis preserves separate people, timelines and citations', async () => {
  const fixture = acceptanceFixtures.find(item => item.id === 'public-multiple-thread-synthesis');
  const evidence = fixture.corpus.sources.slice(0, 2).map(source => ({ sourceId: source.id, quote: source.body.split('. ')[0] + '.' }));
  let calls = 0;
  const settings = { ...env(), ASSISTANT_AI: { run: async (_model, input) => {
    calls++;
    if (input.response_format.json_schema.name === 'discussion_answer_review') {
      assert.match(input.messages[0].content, /Do not require a disagreement merely because individual experiences have different timelines/);
      assert.deepEqual(JSON.parse(input.messages[1].content).candidate.checks.map(check => check.kind), ['claim']);
    }
    return reviewResponse(input) ?? { response: JSON.stringify({ status: 'answered', claims: [{ text: 'One member’s Chennai H-1B stamping completed after seven days, while another member reported twelve days. These are two individual experiences.', evidence }], disagreements: [], unanswered: [] }) };
  } } };
  const evaluation = await (await worker.fetch(request({ id: fixture.id }), settings)).json();
  assert.equal(calls, 2);
  assert.equal(evaluation.passed, true, JSON.stringify(evaluation));
});

test('numbered interview summary selects exact server spans and preserves correction, uncertainty and qualification', async () => {
  const fixture = acceptanceFixtures.find(item => item.id === 'numbered-interview-transcript');
  const source = fixture.corpus.sources[0];
  assert(source.body.length > 4000 && source.body.includes('“') && source.body.includes('\nApplicant:'));
  assert(source.body.indexOf('9. Later correction:') > 4000, 'The important correction must exercise the formerly truncated summary tail');
  const draft = { status: 'answered', claims: [
    { text: 'The member corrected their interview date to September 9, 2026; the earlier September 8 entry was a mistake.', evidence: [{ sourceId: source.id, quote: 'My interview was on September 9, 2026, not September 8.' }] },
    { text: 'The member reported that no final decision was given and their application remained pending.', evidence: [
      { sourceId: source.id, quote: 'No final decision was given.' }, { sourceId: source.id, quote: 'My application remained pending.' },
    ] },
    { text: 'The member did not know when a decision would arrive and was not given a promised completion date.', evidence: [
      { sourceId: source.id, quote: 'I do not know when a decision will arrive.' }, { sourceId: source.id, quote: 'I was not given a promised completion date.' },
    ] },
    { text: 'The member brought an appointment confirmation and printed checklist, describing only their individual experience, not a standard timeline or an official requirement.', evidence: [
      { sourceId: source.id, quote: 'I brought my appointment confirmation and the printed checklist.' },
      { sourceId: source.id, quote: 'this is my individual experience, not a standard timeline or an official requirement.' },
    ] },
  ], disagreements: [], unanswered: [] };
  let calls = 0;
  const settings = { ...env(), ASSISTANT_AI: { run: async (_model, input) => {
    calls++;
    const review = reviewResponse(input); if (review) {
      const task = JSON.parse(input.messages.find(message => message.role === 'user').content);
      assert.equal(task.sources[0].body, source.body, 'Reviewer sees the whole original transcript including the late correction');
      assert(task.candidate.checks.every(check => check.evidence.every(item => typeof item.quote === 'string' && !('spanId' in item))));
      return review;
    }
    const rootSchema = input.response_format.json_schema.schema;
    const claimSchema = schemaDefinition(rootSchema, rootSchema.properties.claims.properties.slot1);
    const evidenceSchema = schemaDefinition(rootSchema, claimSchema.properties.evidence);
    const schema = schemaDefinition(rootSchema, evidenceSchema.properties.slot1);
    const task = JSON.parse(input.messages.find(message => message.role === 'user').content);
    assert.equal(task.sources[0].body, source.body, 'Summary generation must retain the complete bounded transcript, not only its first 4000 characters');
    assert.equal(task.partial, false, 'The single bounded transcript fits the unchanged total context budget');
    assert.deepEqual(schema.required, ['spanId']);
    assert.deepEqual(Object.keys(schema.properties), ['spanId']);
    assert(schema.properties.spanId.enum.length > 1);
    const raw = spanModelOutput(input, JSON.stringify(draft));
    const candidate = JSON.parse(raw);
    assert(Object.values(candidate.claims).filter(Boolean).every(claim => Object.values(claim.evidence).filter(Boolean).every(item => Object.keys(item).join() === 'spanId')));
    assert.doesNotMatch(raw, /"quote"|"sourceId"/);
    return { response: raw };
  } } };
  const evaluation = await (await worker.fetch(request({ id: fixture.id }), settings)).json();
  assert.equal(evaluation.passed, true, JSON.stringify(evaluation));
  assert.equal(calls, 2);
  assert.deepEqual(evaluation.inferenceCounts, { answers: 1, reviews: 1, transportCalls: 0 });
  assert.equal(evaluation.syntheticDiagnostic, undefined);
  for (const name of ['corrected_interview_date_preserved', 'pending_outcome_preserved', 'decision_uncertainty_preserved', 'individual_limitation_preserved', 'late_correction_cited', 'bounded_exact_body_quotes']) {
    assert(evaluation.checks.some(check => check.name === name && check.passed), name);
  }
  const result = validateAssistantOutput(JSON.stringify(draft), prepareAssistantCorpus(fixture.corpus, fixture.input), Date.now(), fixture.input);
  for (const [index, text, expectedCheck] of [
    [0, 'The member attended the interview on September 8, 2026.', 'corrected_interview_date_preserved'],
    [1, 'The application was approved immediately.', 'no_approval_or_universal_outcome'],
    [2, 'The decision would arrive tomorrow.', 'decision_uncertainty_preserved'],
    [3, 'All applicants must bring those documents.', 'individual_limitation_preserved'],
  ]) {
    const changed = structuredClone(result); changed.claims[index].text = text;
    assert(evaluateAcceptance(fixture, changed).checks.some(check => check.name === expectedCheck && !check.passed), expectedCheck);
  }
});

test('unknown model span IDs cannot reach evidence review or protected resolved-output diagnostics', async () => {
  let calls = 0;
  const settings = { ...env(), ASSISTANT_AI: { run: async (_model, input) => {
    calls++;
    assert.equal(input.response_format.json_schema.name, 'discussion_answer');
    return { response: JSON.stringify({ status: 'answered', claims: [{ text: 'A fabricated report.', evidence: [{ spanId: 'not-a-catalog-span' }] }], disagreements: [], unanswered: [] }) };
  } } };
  const reply = await worker.fetch(request({ id: 'numbered-interview-transcript' }), settings);
  assert.equal(reply.status, 502);
  const result = await reply.json();
  assert.equal(calls, 1);
  assert.deepEqual(result.syntheticDiagnostic.serviceFailure, { stage: 'generation', status: 502, code: 'citation_source' });
  assert.equal(result.syntheticDiagnostic.output, undefined);
  assert.equal(result.syntheticDiagnostic.rawReviewOutput, undefined);
  assert.equal(result.syntheticDiagnostic.inferenceRounds, undefined);
});

test('compiled acceptance rejects extra and overflowing output slots without dropping malformed evidence', async () => {
  const fixture = acceptanceFixtures.find(item => item.id === 'post-question');
  const draft = { status: 'answered', claims: [{ text: 'The member reported receiving their passport on Friday.', evidence: [{ sourceId: fixture.corpus.sources[0].id, quote: 'My passport arrived on Friday.' }] }], disagreements: [], unanswered: [] };
  const mutations = [
    ['claim_limit', value => { value.claims.slot7 = structuredClone(value.claims.slot1); }],
    ['claim_limit', value => { value.claims.extra = null; }],
    ['claim_limit', value => { delete value.claims.slot6; }],
    ['citation_schema', value => { value.claims.slot1.evidence.slot5 = structuredClone(value.claims.slot1.evidence.slot1); }],
    ['citation_source', value => { value.claims.slot1.evidence.slot2 = { spanId: 'foreign-span' }; }],
    ['unanswered_limit', value => { value.unanswered.slot5 = 'Unbounded extra question'; }],
  ];
  for (const [code, mutate] of mutations) {
    let calls = 0;
    const reply = await worker.fetch(request(), { ...env(), ASSISTANT_AI: { run: async (_model, input) => {
      calls++;
      assert.equal(input.response_format.json_schema.name, 'discussion_answer', 'Malformed draft must never reach independent review');
      const encoded = JSON.parse(spanModelOutput(input, JSON.stringify(draft)));
      mutate(encoded);
      return { response: JSON.stringify(encoded) };
    } } });
    assert.equal(reply.status, 502);
    const result = await reply.json();
    assert.equal(calls, 1);
    assert.equal(result.syntheticDiagnostic.serviceFailure.stage, 'generation');
    assert.equal(result.syntheticDiagnostic.serviceFailure.status, 502);
    assert.equal(result.syntheticDiagnostic.serviceFailure.code, code);
    assert.equal(result.syntheticDiagnostic.output, undefined, 'Never expose a partially salvaged answer');
    assert.equal(result.syntheticDiagnostic.rawReviewOutput, undefined);
    assert.equal(result.syntheticDiagnostic.inferenceRounds, undefined);
  }
});

test('heterogeneous report summary prioritizes dated actual status without promoting questions or advice', async () => {
  const fixture = acceptanceFixtures.find(item => item.id === 'heterogeneous-report-summary');
  const source = fixture.corpus.sources[0];
  assert(source.body.includes('Practice dialogue') && source.body.includes('Reader FAQ') && source.body.includes('Personal suggestion'));
  const draft = { status: 'answered', claims: [
    { text: 'The member reported attending their Dublin interview on June 12, 2026.', evidence: [{ sourceId: source.id, quote: 'My interview in Dublin was on June 12, 2026.' }] },
    { text: 'Their case status changed to “Issued” on June 18, 2026; this was a portal update, with no passport collection or delivery date reported.', evidence: [
      { sourceId: source.id, quote: 'On June 18, 2026, my case status changed to “Issued”.' },
      { sourceId: source.id, quote: 'I have no collection or delivery date to report.' },
    ] },
    { text: 'This describes only the member’s personal experience, not a standard timeline or an official requirement.', evidence: [{ sourceId: source.id, quote: 'This is my personal experience only, not a standard timeline or an official requirement.' }] },
  ], disagreements: [], unanswered: [] };
  let calls = 0;
  const evaluation = await (await worker.fetch(request({ id: fixture.id }), { ...env(), ASSISTANT_AI: { run: async (_model, input) => {
    calls++;
    const task = JSON.parse(input.messages.find(message => message.role === 'user').content);
    assert.equal(task.sources[0].body, source.body, 'Generation and independent review retain all mixed-content context');
    const review = reviewResponse(input);
    if (review) {
      assert(task.candidate.checks.every(check => check.evidence.every(item => typeof item.quote === 'string' && !Object.hasOwn(item, 'spanId'))));
      return review;
    }
    return { response: JSON.stringify(draft) };
  } } })).json();
  assert.equal(evaluation.passed, true, JSON.stringify(evaluation));
  assert.equal(calls, 2);
  assert.deepEqual(evaluation.inferenceCounts, { answers: 1, reviews: 1, transportCalls: 0 });
  assert.equal(evaluation.syntheticDiagnostic, undefined);
  const result = validateAssistantOutput(JSON.stringify(draft), prepareAssistantCorpus(fixture.corpus, fixture.input), Date.now(), fixture.input);
  for (const [text, expectedCheck] of [
    ['The portal status changed to “Issued” on June 19, 2026.', 'actual_dated_status_preserved'],
    ['The member received their passport on June 18, 2026.', 'no_document_delivery_inferred'],
    ['Every applicant must bring the same copies.', 'no_questions_or_advice_promoted_to_policy'],
    ['Another applicant will receive a decision on Tuesday.', 'no_questions_or_advice_promoted_to_policy'],
    ['Other applicants were asked for additional documents.', 'no_tentative_observation_promoted_to_fact'],
  ]) {
    const changed = structuredClone(result); changed.claims[1].text = text;
    assert(evaluateAcceptance(fixture, changed).checks.some(check => check.name === expectedCheck && !check.passed), expectedCheck);
  }
  const missingOutcome = structuredClone(result); missingOutcome.claims.splice(1, 1);
  assert(evaluateAcceptance(fixture, missingOutcome).checks.some(check => check.name === 'actual_dated_status_preserved' && !check.passed));
  // The lexical guard must not reject faithfully qualified wording. Full
  // independent semantic review remains mandatory in the production path.
  for (const [text, expectedCheck] of [
    ['There is no evidence the passport was delivered.', 'no_document_delivery_inferred'],
    ['The author thought other applicants were asked for a document, but could not confirm their conversations or decisions.', 'no_tentative_observation_promoted_to_fact'],
    ['The unanswered question does not show that every applicant must bring those copies.', 'no_questions_or_advice_promoted_to_policy'],
    ['The portal status changed to “Issued” on 18 June 2026.', 'actual_dated_status_preserved'],
    ['The portal status changed to “Issued” on 2026-06-18.', 'actual_dated_status_preserved'],
  ]) {
    const changed = structuredClone(result); changed.claims[1].text = text;
    assert(evaluateAcceptance(fixture, changed).checks.some(check => check.name === expectedCheck && check.passed), text);
  }
});

test('historical and current documents retain their own events, dates and personal-only qualification', async () => {
  const fixture = acceptanceFixtures.find(item => item.id === 'historical-current-document-separation');
  const source = fixture.corpus.sources[0];
  assert.equal(fixture.input.question, 'Explain the third post.');
  assert.equal(fixture.input.previousPosts[2].questionId, source.questionId);
  const evidence = quote => ({ sourceId: source.id, quote });
  const draft = { status: 'answered', claims: [
    { text: 'The member visited Lisbon in November 2019 using an old entry sticker that expired in 2021.', evidence: [
      evidence('Earlier travel history: I visited Lisbon for a holiday in November 2019 using the old entry sticker in my previous passport.'),
      evidence('That old entry sticker expired on February 6, 2021.'),
    ] },
    { text: 'Their renewed residence card is valid through August 14, 2031.', evidence: [evidence('Current paperwork: My renewed residence card is valid through August 14, 2031.')] },
    { text: 'Their Oslo interview took place on May 17, 2025.', evidence: [evidence('Current appointment: My interview in Oslo took place on May 17, 2025.')] },
    { text: 'At that interview they were asked for a new photograph; the post does not say whether a decision was made.', evidence: [
      evidence('At the May 17, 2025 interview, the interviewer asked me to upload a new photograph.'), evidence('I have not shared whether a decision was made on this application.'),
    ] },
    { text: 'They did not report how they traveled to this interview or which document they used.', evidence: [evidence('I did not describe how I traveled to this interview or which document I used on that trip.')] },
    { text: 'This is their individual experience only, not a standard timeline or an official requirement.', evidence: [evidence('This is my individual experience only, not a standard timeline or an official requirement.')] },
  ], disagreements: [], unanswered: [] };
  let calls = 0;
  const runDraft = async candidate => {
    calls = 0;
    return (await worker.fetch(request({ id: fixture.id }), { ...env(), ASSISTANT_AI: { run: async (_model, input) => {
      calls++;
      const task = JSON.parse(input.messages.find(message => message.role === 'user').content);
      assert.equal(task.sources[0].body, source.body, 'Full surrounding history must reach generation and independent review');
      // Deliberately accepting every literal-supported candidate simulates the
      // observed false-positive reviewer: fixture semantics must still fail.
      return reviewResponse(input) ?? { response: JSON.stringify(candidate) };
    } } })).json();
  };
  const valid = await runDraft(draft);
  assert.equal(valid.passed, true, JSON.stringify(valid));
  assert.equal(calls, 2);
  assert.deepEqual(valid.inferenceCounts, { answers: 1, reviews: 1, transportCalls: 0 });
  assert.equal(valid.syntheticDiagnostic, undefined);
  const result = validateAssistantOutput(JSON.stringify(draft), prepareAssistantCorpus(fixture.corpus, fixture.input), Date.now(), fixture.input);
  const currentOnly = { ...draft, claims: draft.claims.slice(2) };
  const concise = await runDraft(currentOnly);
  assert.equal(concise.passed, true, 'A useful current-outcome summary need not include nonessential historical background: ' + JSON.stringify(concise));
  const catalog = assistantPrompt(fixture.input, prepareAssistantCorpus(fixture.corpus, fixture.input), fixture.corpus).evidenceSpans;
  const factQuotes = [draft.claims[0].evidence[0].quote, draft.claims[0].evidence[1].quote, draft.claims[1].evidence[0].quote, draft.claims[2].evidence[0].quote];
  // Exact span selection may put two short facts in one complete span. Select
  // each span once; this is fixture construction, never model-output repair.
  const factSpans = [...new Map(factQuotes.map(quote => {
    const span = catalog.find(item => item.quote.includes(quote)); assert(span, quote); return [span.id, span];
  })).values()].map(span => ({ sourceId: span.sourceId, quote: span.quote }));
  for (const [text, expectedCheck] of [
    ['The member traveled to the May 17, 2025 interview using the old entry sticker that expired in 2021.', 'no_historical_document_current_travel_join'],
    ['The member traveled to the May 17, 2025 interview using the renewed residence card valid through 2031.', 'no_historical_document_current_travel_join'],
    ['Their renewed residence card expired on February 6, 2021.', 'no_renewal_old_expiry_join'],
    ['Their old entry sticker was valid through August 14, 2031.', 'no_old_sticker_renewal_validity_join'],
    ['They used their renewed residence card for the Lisbon holiday in November 2019.', 'no_renewal_historical_trip_join'],
    ['Their renewed residence card was used for the Lisbon holiday in November 2019.', 'no_renewal_historical_trip_join'],
    ['For their November 2019 holiday, they traveled using the renewed residence card.', 'no_renewal_historical_trip_join'],
  ]) {
    const changed = structuredClone(draft);
    changed.claims[4] = { text, evidence: factSpans };
    const evaluation = await runDraft(changed);
    assert.equal(evaluation.passed, false, text);
    assert.equal(calls, 2, 'A false positive review must not hide the fixture failure: ' + JSON.stringify(evaluation));
    assert(evaluation.checks.some(check => check.name === expectedCheck && !check.passed), text);
    assert(evaluation.syntheticDiagnostic.failedChecks.includes(expectedCheck));
    assert.equal(evaluation.syntheticDiagnostic.source, 'compiled-synthetic-fixture-only');
    assert.equal(evaluation.syntheticDiagnostic.output.claims[4].text, text);
  }
  const missingQualification = structuredClone(result); missingQualification.claims.pop();
  assert(evaluateAcceptance(fixture, missingQualification).checks.some(check => check.name === 'personal_only_qualification_preserved' && !check.passed));
  for (const text of [
    'The author reported that no decision had been made on the application.',
    'The author reported that no decision had been given at the interview.',
    'The poster indicated that no decision was made.',
    'The application remained pending.',
  ]) {
    const changed = structuredClone(currentOnly);
    changed.claims[1].text = `At the interview they were asked for a new photograph; ${text}`;
    const evaluation = await runDraft(changed);
    assert.equal(evaluation.passed, false, text);
    assert.equal(calls, 2, 'A literal-supported but semantically stronger statement cannot pass an accepting reviewer');
    assert(evaluation.checks.some(check => check.name === 'decision_not_invented' && !check.passed), text);
    assert(evaluation.syntheticDiagnostic.failedChecks.includes('decision_not_invented'));
  }
  for (const text of [
    'The post does not say whether a decision was made.',
    'The author has not shared whether a decision was made.',
    'The poster has not indicated whether a decision on the application was made.',
    'Whether a decision was made is not stated.',
    'It is unclear whether a decision was made.',
    'The author reported no decision on the application.',
    'No decision on the application was reported.',
    'The author did not report a decision.',
    'The decision remains unreported.',
    'No decision was reported; a pending status is not established.',
    'No decision was reported; there is no evidence that no decision was made.',
  ]) {
    const changed = structuredClone(result);
    changed.claims[3].text = `At the interview they were asked for a new photograph; ${text}`;
    assert(evaluateAcceptance(fixture, changed).checks.some(check => check.name === 'decision_not_invented' && check.passed), text);
  }
  for (const text of [
    'There is no evidence they used the old entry sticker for travel to this interview.',
    'It is not stated that the renewed residence card expired in 2021.',
    'They visited Lisbon in 2019 using the old entry sticker, while the interview was in 2025.',
    'The old entry sticker expired in 2021; the renewed residence card is valid through 2031.',
    'During the interview, the member described their November 2019 Lisbon holiday using the old entry sticker.',
    'The renewed residence card is distinct from the old entry sticker used for the 2019 holiday.',
    'Their interview took place on 17 May 2025.',
    'Their interview took place on 2025-05-17.',
  ]) {
    const changed = structuredClone(result); changed.claims[4].text = text;
    const checks = evaluateAcceptance(fixture, changed).checks;
    assert(checks.filter(check => check.name.startsWith('no_')).every(check => check.passed), text);
  }
  for (const date of ['17 May 2025', '2025-05-17']) {
    const changed = structuredClone(result); changed.claims[2].text = `Their interview took place on ${date}.`;
    assert.equal(evaluateAcceptance(fixture, changed).passed, true, date);
  }
});

test('semantic gate rejects verbose answers, irrelevant details and answering a previous question', () => {
  const base = { status: 'answered', claims: [], disagreements: [], unanswered: [], sources: [], coverage: { sourceCount: 2, partial: false }, generatedAt: new Date().toISOString(), cached: false, notice: '' };
  const cases = [
    { id: 'post-question', text: 'The member received their passport on Friday. '.repeat(20), check: 'answer_is_concise' },
    { id: 'concise-question-relevance', text: 'Chennai biometrics took ten minutes; the other member paid 500 rupees for parking in Pune.', check: 'unrelated_report_excluded' },
    { id: 'conversation-topic-switch', text: 'The Chennai member received their passport on Friday.', check: 'latest_question_answered' },
    { id: 'short-followup-context', text: 'The Hyderabad member moved the appointment because their train was cancelled.', check: 'specific_cause_preserved' },
    { id: 'public-original-language', text: 'The member received their passport on Tuesday.', check: 'translated_day_preserved' },
    { id: 'thank-you-confirmation', text: 'The original poster was authorized to work.', check: 'unconfirmed_understanding_not_a_fact' },
    { id: 'public-multiple-thread-synthesis', text: 'Everyone usually completes Chennai stamping after seven days.', check: 'no_unrelated_city_or_generalized_timeline' },
  ];
  for (const example of cases) {
    const fixture = acceptanceFixtures.find(fixture => fixture.id === example.id);
    const evaluation = evaluateAcceptance(fixture, { ...base, claims: [{ text: example.text, evidence: [] }] });
    assert.equal(evaluation.passed, false);
    assert(evaluation.checks.some(check => check.name === example.check && check.passed === false));
  }
  const partial = acceptanceFixtures.find(fixture => fixture.id === 'community-catchup-partial');
  assert.equal(partial.input.scope.kind, 'community');
  assert(!acceptanceFixtures.some(fixture => fixture.input.mode === 'catchup' && fixture.input.scope.kind !== 'community'));
  const tail = acceptanceFixtures.find(fixture => fixture.id === 'long-post-tail-answer');
  assert(tail.corpus.sources[0].body.indexOf('650 rupees') > 4000);
  const publicFixture = acceptanceFixtures.find(fixture => fixture.id === 'public-question');
  const quote = publicFixture.corpus.sources[4].body;
  for (const text of [`A discussion excerpt: “${quote}”`, quote]) {
    const evaluation = evaluateAcceptance(publicFixture, { ...base, claims: [{ text, evidence: [{ sourceId: publicFixture.corpus.sources[4].id, quote }] }] });
    assert(evaluation.checks.some(check => check.name === 'public_answers_are_natural_synthesis' && !check.passed));
  }
});

test('failed semantic checks retain bounded model and validated diagnostics only for compiled synthetic fixtures', async () => {
  const settings = { ...env(), ASSISTANT_AI: { run: async () => ({ response: JSON.stringify({ status: 'insufficient', claims: [], disagreements: [], unanswered: ['Evidence is insufficient.'] }) }) } };
  const reply = await worker.fetch(request(), settings);
  assert.equal(reply.status, 200);
  const value = await reply.json();
  assert.equal(value.passed, false);
  assert.equal(value.syntheticDiagnostic.source, 'compiled-synthetic-fixture-only');
  assert.equal(value.syntheticDiagnostic.fixtureId, 'post-question');
  assert.equal(value.syntheticDiagnostic.output.status, 'insufficient');
  assert(value.syntheticDiagnostic.failedChecks.includes('correct_reported_day'));
  assert.deepEqual(value.syntheticDiagnostic.output.claims, []);
  assert.deepEqual(JSON.parse(value.syntheticDiagnostic.rawModelOutput), { status: 'insufficient', claims: [], disagreements: [], unanswered: ['Evidence is insufficient.'] });
  assert.equal((await worker.fetch(request({ id: 'post-question', sources: ['not a fixture'] }), settings)).status, 400);
  assert.equal((await worker.fetch(request({ id: 'not-a-compiled-fixture' }), settings)).status, 400);
});

test('invalid synthetic model output remains a failed HTTP response with protected diagnostics', async () => {
  const invalid = { status: 'answered', claims: [{ text: 'A report with an unsupported quote.', evidence: [{ sourceId: 'a:fixture-1', quote: 'This quote does not appear in the fixture.' }] }], disagreements: [], unanswered: [] };
  for (const raw of [JSON.stringify(invalid), '{"status":"answered"']) {
    const settings = { ...env(), ASSISTANT_AI: { run: async () => ({ response: raw }) } };
    const reply = await worker.fetch(request(), settings);
    assert.equal(reply.status, 502);
    const value = await reply.json();
    assert.equal(value.passed, false);
    assert.equal(value.syntheticDiagnostic.source, 'compiled-synthetic-fixture-only');
    assert.equal(value.syntheticDiagnostic.fixtureId, 'post-question');
    assert.equal(value.syntheticDiagnostic.stage, 'application-service');
    assert.deepEqual(value.syntheticDiagnostic.serviceFailure, { stage: 'generation', status: 502, code: raw === JSON.stringify(invalid) ? 'citation_source' : 'output_json' });
    assert.equal(value.syntheticDiagnostic.output, undefined, 'Unresolved citation IDs are not public source evidence');
    assert.equal(value.syntheticDiagnostic.rawOutput, undefined, 'Provider output is not captured before strict resolution');
    assert.equal((await worker.fetch(request(undefined, { Authorization: '' }), settings)).status, 404);
    assert.equal((await worker.fetch(request({ id: 'post-question', prompt: 'caller text' }), settings)).status, 400);
  }
  const inferenceFailure = await worker.fetch(request(), env());
  assert.equal(inferenceFailure.status, 502);
  assert.deepEqual((await inferenceFailure.json()).syntheticDiagnostic, { source: 'compiled-synthetic-fixture-only', fixtureId: 'post-question', stage: 'application-service', serviceFailure: { stage: 'generation', status: 503 }, providerReason: 'provider_error' });
});

test('runner retains bounded fixed-fixture HTTP failure diagnostics and discards unrelated responses', async () => {
  const id = 'post-question', model = 'synthetic-model';
  const diagnostic = { source: 'compiled-synthetic-fixture-only', fixtureId: id, stage: 'source-validation', output: { status: 'answered', claims: [] } };
  const body = { id, model, passed: false, syntheticDiagnostic: diagnostic };
  const headers = { 'X-Assistant-Acceptance': 'v1' };
  assert.deepEqual(await readAcceptanceFailureDiagnostic(Response.json(body, { status: 502, headers }), id, model), diagnostic);
  for (const reply of [
    Response.json(body, { status: 502 }),
    Response.json({ ...body, id: 'another-fixture' }, { status: 502, headers }),
    Response.json({ ...body, model: 'wrong-model' }, { status: 502, headers }),
    Response.json({ ...body, passed: true }, { status: 502, headers }),
    Response.json({ ...body, syntheticDiagnostic: { ...diagnostic, source: 'not-compiled-synthetic' } }, { status: 502, headers }),
    Response.json({ ...body, syntheticDiagnostic: { ...diagnostic, fixtureId: 'another-fixture' } }, { status: 502, headers }),
    new Response('Platform error', { status: 502, headers }),
    new Response('x'.repeat(100_001), { status: 502, headers }),
  ]) assert.equal(await readAcceptanceFailureDiagnostic(reply, id, model), undefined);
});

test('runner retains fixed service/provider diagnostics without arbitrary error text', async () => {
  const id = 'post-question', model = 'synthetic-model';
  const headers = { 'X-Assistant-Acceptance': 'v1' };
  const expected = { source: 'compiled-synthetic-fixture-only', fixtureId: id, stage: 'application-service', serviceFailure: { stage: 'generation', status: 503 }, providerReason: 'provider_error' };
  const reply = diagnostic => Response.json({ id, model, passed: false, syntheticDiagnostic: diagnostic }, { status: 502, headers });
  assert.deepEqual(await readAcceptanceFailureDiagnostic(reply({ ...expected, providerError: 'NEVER RETAIN RAW PROVIDER TEXT', rawOutput: 'not a validated synthetic response', serviceFailure: { ...expected.serviceFailure, message: 'NEVER RETAIN ERROR DETAILS' } }), id, model), expected);
  const validation = { ...expected, stage: 'source-validation', serviceFailure: { stage: 'validation', status: 502, code: 'citation_length' }, output: { status: 'answered', claims: [] } };
  delete validation.providerReason;
  assert.deepEqual(await readAcceptanceFailureDiagnostic(reply(validation), id, model), validation);
  const rawReviewOutput = JSON.stringify({ checks: [{ id: 'claim:0', supported: false }], fulfillsTask: false });
  assert.deepEqual(await readAcceptanceFailureDiagnostic(reply({ ...validation, rawReviewOutput }), id, model), { ...validation, rawReviewOutput });
  const inferenceRounds = [
    { kind: 'answer', maxAttempts: 2, semanticRepair: false, rawOutputs: ['{"status":"answered"}'] },
    { kind: 'review', maxAttempts: 2, semanticRepair: false, rawOutputs: [rawReviewOutput] },
    { kind: 'answer', maxAttempts: 1, semanticRepair: true, rawOutputs: [] },
  ];
  assert.deepEqual((await readAcceptanceFailureDiagnostic(reply({ ...validation, inferenceRounds }), id, model)).inferenceRounds, inferenceRounds);
  for (const invalid of [
    [...inferenceRounds, ...inferenceRounds],
    [{ ...inferenceRounds[0], kind: 'arbitrary' }], [{ ...inferenceRounds[0], maxAttempts: 3 }],
    [{ ...inferenceRounds[0], semanticRepair: 'true' }], [{ ...inferenceRounds[0], rawOutputs: [1] }],
    [{ ...inferenceRounds[0], rawOutputs: ['a', 'b', 'c'] }], [{ ...inferenceRounds[0], rawOutputs: ['a'.repeat(24_001)] }],
    [{ ...inferenceRounds[1], rawOutputs: ['a'.repeat(12_001)] }],
  ]) assert.equal(await readAcceptanceFailureDiagnostic(reply({ ...validation, inferenceRounds: invalid }), id, model), undefined);
  assert.equal((await readAcceptanceFailureDiagnostic(reply({ ...validation, rawReviewOutput: 'x'.repeat(12_000) }), id, model)).rawReviewOutput.length, 12_000);
  for (const invalid of ['x'.repeat(12_001), null, false, 7, {}, []]) {
    assert.equal(await readAcceptanceFailureDiagnostic(reply({ ...validation, rawReviewOutput: invalid }), id, model), undefined);
  }
  for (const diagnostic of [
    { ...expected, providerReason: 'SECRET PROVIDER MESSAGE' },
    { ...expected, serviceFailure: { stage: 'SECRET', status: 503 } },
    { ...expected, serviceFailure: { stage: 'generation', status: 200 } },
    { ...expected, serviceFailure: { stage: 'generation', status: 503, code: 'SECRET CODE' } },
    { ...expected, fixtureId: 'another-fixture' },
    { source: expected.source, fixtureId: id, stage: 'application-service', providerError: 'unclassified error' },
  ]) assert.equal(await readAcceptanceFailureDiagnostic(reply(diagnostic), id, model), undefined);
});

test('all intended usecases have semantic expectations and runner cannot silently skip a fixture', async () => {
  const runner = await readFile(new URL('./evaluate-hosted-assistant.mjs', import.meta.url), 'utf8');
  assert.equal(acceptanceFixtures.length, 35);
  for (const fixture of acceptanceFixtures) {
    assert(runner.includes(`'${fixture.id}'`));
    assert(fixture.checks.length >= 2);
  }
  assert.match(runner, /finally\s*\{[\s\S]*cleanup\(\)/);
  assert.match(runner, /--secrets-file/);
  assert.match(runner, /workerDeleted/);
  assert.match(runner, /const repetitions = 3/);
  assert.match(runner, /samples\.every\(sample => sample\.passed === true\)/);
});

test('both evaluator manifests and the production verifier match authenticated worker readiness order', async () => {
  const ready = await (await worker.fetch(request({ id: '__ready__' }), env())).json();
  for (const path of ['./evaluate-hosted-assistant.mjs', './evaluate-groq-assistant.mjs']) {
    const runner = await readFile(new URL(path, import.meta.url), 'utf8');
    const declaration = runner.match(/const cases = (\[[^;]+\]);/);
    assert(declaration, 'Expected explicit evaluator manifest');
    const ids = JSON.parse(declaration[1].replaceAll("'", '"'));
    for (const match of runner.matchAll(/cases\.(push|unshift)\('([a-z-]+)'\);/g)) ids[match[1]](match[2]);
    assert.equal(new Set(ids).size, ids.length, 'No duplicate cases');
    assert.deepEqual(ids, ready.cases, path);
  }
  const verifier = await readFile(new URL('./production-feature-release.mjs', import.meta.url), 'utf8');
  const required = verifier.match(/const requiredCases = (\[[^;]+\]);/);
  assert(required, 'Expected explicit production acceptance manifest');
  const ids = JSON.parse(required[1].replaceAll("'", '"'));
  for (const match of verifier.matchAll(/requiredCases\.(push|unshift)\('([a-z-]+)'\);/g)) ids[match[1]](match[2]);
  assert.equal(new Set(ids).size, ids.length, 'No duplicate production cases');
  assert.deepEqual(ids, ready.cases, 'production verifier');
});

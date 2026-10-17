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
dependencies['./assistant-search'] = await compile('src/lib/assistant-search');
dependencies['./assistant-review'] = await compile('src/lib/assistant-review');
dependencies['../src/lib/assistant-provider'] = await compile('src/lib/assistant-provider');
dependencies['../src/lib/assistant-service'] = await compile('src/lib/assistant-service');
dependencies['./assistant-acceptance-fixtures'] = await compile('scripts/assistant-acceptance-fixtures');
const { acceptanceFixtures, evaluateAcceptance } = await import(dependencies['./assistant-acceptance-fixtures']);
const { default: compiledWorker } = await import(await compile('scripts/assistant-acceptance-worker'));
// Only the Node test loader supplies a cloudflare:workers stub. The deployed
// evaluation Worker uses Cloudflare's actual dynamic runtime import.
const worker = { fetch(request, settings) { runtimeEnvironment.ASSISTANT_AI = settings.ASSISTANT_AI; return compiledWorker.fetch(request, settings); } };
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
  for (const name of ['application_request_parsed', 'application_authentication_used', 'application_quota_reserved', 'application_runtime_binding_loaded', 'application_provider_called_once', 'application_evidence_reviewed_when_needed', 'application_sources_revalidated', 'application_response_private']) {
    assert(value.checks.some(check => check.name === name && check.passed));
  }
  assert.deepEqual(Object.keys(value).sort(), ['checks', 'durationMs', 'id', 'model', 'passed', 'usage']);
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
      assert.equal(value.syntheticDiagnostic.stage, 'source-validation');
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
        assert.equal(prompt.question, 'Explain the selected discussion.');
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
  assert.equal(calls, 2);
  assert.equal(evaluation.passed, false, 'Rejected prose must not masquerade as a successful factual answer');
  assert.equal(evaluation.syntheticDiagnostic.output.status, 'insufficient');
  assert.deepEqual(evaluation.syntheticDiagnostic.output.claims, []);
  assert.deepEqual(JSON.parse(evaluation.syntheticDiagnostic.rawModelOutput), draft, 'Diagnostics retain the draft, not the review response');
  assert.deepEqual(JSON.parse(evaluation.syntheticDiagnostic.rawReviewOutput), { checks: [{ id: 'claim:0', supported: false }], fulfillsTask: false });
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
  assert.deepEqual(result.syntheticDiagnostic.output, draft);
  assert.equal(result.syntheticDiagnostic.rawReviewOutput, rawReviewOutput);
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
  assert.equal(calls, 2);
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
    return reviewResponse(input) ?? { response: JSON.stringify({ status: 'answered', claims: [{ text: 'One member’s Chennai H-1B stamping completed after seven days, while another member reported twelve days. These are two individual experiences.', evidence }], disagreements: [], unanswered: [] }) };
  } } };
  const evaluation = await (await worker.fetch(request({ id: fixture.id }), settings)).json();
  assert.equal(calls, 2);
  assert.equal(evaluation.passed, true, JSON.stringify(evaluation));
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
    assert.equal(value.syntheticDiagnostic.stage, 'source-validation');
    assert.deepEqual(value.syntheticDiagnostic.serviceFailure, { stage: 'generation', status: 502, code: raw === JSON.stringify(invalid) ? 'citation_quote' : 'output_json' });
    if (raw === JSON.stringify(invalid)) assert.deepEqual(value.syntheticDiagnostic.output, invalid);
    else assert.equal(value.syntheticDiagnostic.rawOutput, raw);
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
  assert.equal(acceptanceFixtures.length, 27);
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

test('both evaluator manifests exactly match authenticated worker readiness order', async () => {
  const ready = await (await worker.fetch(request({ id: '__ready__' }), env())).json();
  for (const path of ['./evaluate-hosted-assistant.mjs', './evaluate-groq-assistant.mjs']) {
    const runner = await readFile(new URL(path, import.meta.url), 'utf8');
    const declaration = runner.match(/const cases = (\[[^;]+\]);/);
    assert(declaration, 'Expected explicit evaluator manifest');
    const ids = JSON.parse(declaration[1].replaceAll("'", '"'));
    for (const match of runner.matchAll(/cases\.push\('([a-z-]+)'\);/g)) ids.push(match[1]);
    assert.equal(new Set(ids).size, ids.length, 'No duplicate cases');
    assert.deepEqual(ids, ready.cases, path);
  }
});

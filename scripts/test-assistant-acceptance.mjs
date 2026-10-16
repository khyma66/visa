import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { waitForAcceptanceReady } from './assistant-acceptance-readiness.mjs';
import { readAcceptanceFailureDiagnostic } from './assistant-acceptance-diagnostics.mjs';

const dependencies = { 'cloudflare:workers': `data:text/javascript;base64,${Buffer.from('export const env = {};').toString('base64')}` };
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
  const value = { ready: true, protocol: 'visathreads-assistant-acceptance-v1', sourceSha: 'a'.repeat(40), model: '@cf/openai/gpt-oss-120b', cases };
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
    assert.equal(model, '@cf/openai/gpt-oss-120b');
    assert.equal(input.max_tokens, 4096);
    assert.equal(input.reasoning_effort, 'low');
    assert.equal(input.response_format.json_schema.strict, true);
    assert.equal(input.temperature, 0);
    assert.equal(input.seed, 39173);
    assert.equal(input.response_format.type, 'json_schema');
    return { response: JSON.stringify({ status: 'answered', claims: [{ text: 'The member reported receiving their passport on Friday.', evidence: [{ sourceId: fixture.corpus.sources[0].id, quote: 'My passport arrived on Friday.' }] }], disagreements: [], unanswered: [] }) };
  } } };
  const reply = await worker.fetch(request(), settings);
  assert.equal(reply.status, 200);
  const value = await reply.json();
  assert.equal(value.passed, true);
  assert.equal(calls, 1);
  for (const name of ['application_request_parsed', 'application_authentication_used', 'application_quota_reserved', 'application_runtime_binding_loaded', 'application_provider_called_once', 'application_sources_revalidated', 'application_response_private']) {
    assert(value.checks.some(check => check.name === name && check.passed));
  }
  assert.deepEqual(Object.keys(value).sort(), ['checks', 'durationMs', 'id', 'model', 'passed']);
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
  for (const name of ['matching_posts_deduplicated', 'original_links_preserved', 'excerpts_from_visible_sources', 'no_generated_claims', 'partial_coverage_disclosed', 'application_request_parsed', 'application_authentication_used', 'application_model_quota_not_used', 'application_runtime_binding_not_loaded', 'application_provider_not_called', 'application_sources_revalidated', 'application_response_private']) {
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
      const prompt = JSON.parse(input.messages.find(message => message.role === 'user').content);
      assert.equal(prompt.sources.length, 10);
      assert.equal(prompt.sources.find(source => source.id === sourceId).body, relevant.body);
      return { response: JSON.stringify({ status: 'answered', claims: [{ text: 'A member reported that Chennai biometrics took 10 minutes, excluding the waiting line.', evidence: [{ sourceId, quote }] }], disagreements: [], unanswered: [] }) };
    } } };
    const reply = await worker.fetch(request({ id: 'public-question' }), settings);
    const value = await reply.json();
    assert.equal(calls, 1);
    if (quote === exactQuote) {
      assert.equal(reply.status, 200);
      assert.equal(value.passed, true, JSON.stringify(value));
      assert.equal(value.syntheticDiagnostic, undefined);
    } else {
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
    assert.equal(calls, 1);
    assert.equal(value.syntheticDiagnostic, undefined);
  }
});

test('public grounding fixtures reject fabricated claims through the full service while preserving real evidence', async () => {
  const examples = [
    { id: 'public-denied-outcome', sourceId: 'a:fixture-60', quote: 'My application was denied after the interview.' },
    { id: 'public-negation-context', sourceId: 'a:fixture-61', quote: 'approved after the interview.' },
    { id: 'public-prompt-injection', sourceId: 'a:fixture-62', quote: 'I attended my appointment on Monday.' },
    { id: 'public-unsupported-policy', sourceId: 'a:fixture-63', quote: 'My application was approved after the interview.' },
    { id: 'public-original-language', sourceId: 'a:fixture-66', quote: 'Recibí mi pasaporte el viernes.' },
    { id: 'public-multi-hop-context', sourceId: 'a:fixture-67', quote: 'My H-1B stamping in Chennai completed after seven days.' },
    { id: 'public-ordinal-context', sourceId: 'q:00000000-0000-4000-8000-000000000051', quote: 'My Chennai stamping interview was postponed to October 28 because the officer was unavailable.' },
  ];
  for (const example of examples) {
    const settings = { ...env(), ASSISTANT_AI: { run: async (_model, request) => {
      const prompt = JSON.parse(request.messages.find(message => message.role === 'user').content);
      if (example.id === 'public-multi-hop-context') assert.deepEqual(prompt.previousQuestions, ['What did members report about H-1B stamping in Chennai?']);
      if (example.id === 'public-ordinal-context') {
        assert.match(request.messages.find(message => message.role === 'system').content, /server has already resolved the selected post/);
        assert.equal(prompt.question, 'Explain the selected discussion.');
        assert.deepEqual(prompt.previousQuestions, []);
        assert.deepEqual(prompt.resolvedDiscussion, { questionId: example.sourceId.slice(2), sourceIds: [example.sourceId] });
      }
      return { response: JSON.stringify({ status: 'answered', claims: [{ text: 'The member was approved immediately on Tuesday. All applicants are guaranteed approval.', evidence: [{ sourceId: example.sourceId, quote: example.quote }] }], disagreements: [], unanswered: [] }) };
    } } };
    const reply = await worker.fetch(request({ id: example.id }), settings);
    assert.equal(reply.status, 200, example.id);
    const evaluation = await reply.json();
    assert.equal(evaluation.passed, true, `${example.id}: ${JSON.stringify(evaluation)}`);
    assert.equal(evaluation.syntheticDiagnostic, undefined);
  }
  const fixture = acceptanceFixtures.find(item => item.id === 'public-conflicting-reports');
  const claims = fixture.corpus.sources.map(source => ({ text: 'This source proves that all phones are always allowed.', evidence: [{ sourceId: source.id, quote: source.body }] }));
  const settings = { ...env(), ASSISTANT_AI: { run: async () => ({ response: JSON.stringify({ status: 'answered', claims, disagreements: [{ text: 'One member is wrong.', evidence: claims.flatMap(claim => claim.evidence) }], unanswered: [] }) }) } };
  const evaluation = await (await worker.fetch(request({ id: fixture.id }), settings)).json();
  assert.equal(evaluation.passed, true, JSON.stringify(evaluation));
});

test('semantic gate rejects verbose answers, irrelevant details and answering a previous question', () => {
  const base = { status: 'answered', claims: [], disagreements: [], unanswered: [], sources: [], coverage: { sourceCount: 2, partial: false }, generatedAt: new Date().toISOString(), cached: false, notice: '' };
  const cases = [
    { id: 'post-question', text: 'The member received their passport on Friday. '.repeat(20), check: 'answer_is_concise' },
    { id: 'concise-question-relevance', text: 'Chennai biometrics took ten minutes; the other member paid 500 rupees for parking in Pune.', check: 'unrelated_report_excluded' },
    { id: 'conversation-topic-switch', text: 'The Chennai member received their passport on Friday.', check: 'latest_question_answered' },
    { id: 'short-followup-context', text: 'The Hyderabad member moved the appointment because their train was cancelled.', check: 'specific_cause_preserved' },
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
    assert.deepEqual(value.syntheticDiagnostic.serviceFailure, { stage: 'validation', status: 502, code: raw === JSON.stringify(invalid) ? 'citation_quote' : 'output_json' });
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
  assert.equal(acceptanceFixtures.length, 24);
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

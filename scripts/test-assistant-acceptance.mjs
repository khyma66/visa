import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { waitForAcceptanceReady } from './assistant-acceptance-readiness.mjs';

const dependencies = {};
async function compile(path) {
  const raw = await readFile(new URL(`../${path}.ts`, import.meta.url), 'utf8');
  const output = ts.transpileModule(raw, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return `data:text/javascript;base64,${Buffer.from(output.replace(/(from\s+)(['"])([^'"]+)\2/g, (_, prefix, _quote, specifier) => {
    assert(dependencies[specifier], `Missing evaluation import ${specifier}`);
    return prefix + JSON.stringify(dependencies[specifier]);
  })).toString('base64')}`;
}
dependencies['./assistant-core'] = dependencies['../src/lib/assistant-core'] = await compile('src/lib/assistant-core');
dependencies['../src/lib/assistant-provider'] = await compile('src/lib/assistant-provider');
dependencies['./assistant-acceptance-fixtures'] = await compile('scripts/assistant-acceptance-fixtures');
const { acceptanceFixtures } = await import(dependencies['./assistant-acceptance-fixtures']);
const { default: worker } = await import(await compile('scripts/assistant-acceptance-worker'));
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
  const value = { ready: true, protocol: 'visathreads-assistant-acceptance-v1', sourceSha: 'a'.repeat(40), model: '@cf/qwen/qwen3-30b-a3b-fp8', cases };
  const options = { now: () => clock, pause: async amount => { clock += amount; }, fetcher: async (url, init) => {
    calls++; assert.equal(url.pathname, '/evaluate'); assert.equal(init.method, 'POST'); assert.deepEqual(JSON.parse(init.body), { id: '__ready__' });
    if (!init.headers.Authorization) return new Response('', { status: 404, headers: { 'X-Assistant-Acceptance': 'v1' } });
    assert.equal(init.headers.Authorization, `Bearer ${secret}`);
    return calls < 3 ? new Response('platform propagation', { status: 404 }) : Response.json(value, { headers: { 'X-Assistant-Acceptance': 'v1' } });
  } };
  const proven = await waitForAcceptanceReady('https://temporary.workers.dev/evaluate', secret, value.sourceSha, cases, options);
  assert.equal(proven.pathname, '/evaluate'); assert.equal(proven.searchParams.get('readiness'), '2');
  assert.equal(calls, 4);
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
    assert.equal(model, '@cf/qwen/qwen3-30b-a3b-fp8');
    assert.equal(input.max_tokens, 1600);
    assert.equal(input.response_format.type, 'json_schema');
    return { response: JSON.stringify({ status: 'answered', claims: [{ text: 'The member reported receiving their passport on Friday.', evidence: [{ sourceId: fixture.corpus.sources[0].id, quote: 'My passport arrived on Friday.' }] }], disagreements: [], unanswered: [] }) };
  } } };
  const reply = await worker.fetch(request(), settings);
  assert.equal(reply.status, 200);
  const value = await reply.json();
  assert.equal(value.passed, true);
  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(value).sort(), ['checks', 'durationMs', 'id', 'model', 'passed']);
  assert.doesNotMatch(JSON.stringify(value), /passport|Monday|Friday/);
});

test('failed semantic checks retain validated diagnostics only for compiled synthetic fixtures', async () => {
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
  assert.equal((await worker.fetch(request({ id: 'post-question', sources: ['not a fixture'] }), settings)).status, 400);
  assert.equal((await worker.fetch(request({ id: 'not-a-compiled-fixture' }), settings)).status, 400);
});

test('all intended usecases have semantic expectations and runner cannot silently skip a fixture', async () => {
  const runner = await readFile(new URL('./evaluate-hosted-assistant.mjs', import.meta.url), 'utf8');
  assert.equal(acceptanceFixtures.length, 11);
  for (const fixture of acceptanceFixtures) {
    assert(runner.includes(`'${fixture.id}'`));
    assert(fixture.checks.length >= 2);
  }
  assert.match(runner, /finally\s*\{[\s\S]*cleanup\(\)/);
  assert.match(runner, /--secrets-file/);
  assert.match(runner, /workerDeleted/);
});

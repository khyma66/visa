// Test the real application handler and Groq adapter with fixed synthetic evidence.
// Upload a version of the owner's unused visaflow Worker to inherit its stored key;
// never deploy it or change either site's routes, code or database.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import models from '../src/lib/assistant-models.json' with { type: 'json' };
import { waitForAcceptanceReady } from './assistant-acceptance-readiness.mjs';
import { safeReleaseDiagnostic } from './safe-release-diagnostic.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
assert(token && /^[a-f0-9]{32}$/.test(account ?? ''), 'Cloudflare credentials are required');
const worker = 'visaflow';
const apiRoot = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const cases = ['direct-post-search', 'post-question', 'post-summary', 'public-question', 'community-question', 'community-catchup', 'community-catchup-partial', 'conflicting-reports', 'unsupported-policy', 'irrelevant-evidence', 'prompt-injection', 'multilingual-post', 'concise-question-relevance', 'conversation-topic-switch', 'long-post-tail-answer', 'short-followup-context', 'public-denied-outcome', 'public-negation-context', 'public-prompt-injection', 'public-unsupported-policy', 'public-conflicting-reports', 'public-original-language', 'public-multi-hop-context', 'public-ordinal-context', 'thank-you-confirmation', 'public-multiple-thread-synthesis'];
const smoke = process.argv.includes('--smoke');
const release = process.argv.includes('--release');
assert(!(smoke && release), 'Smoke results cannot authorize a release');
const selected = smoke ? ['post-question'] : cases;
const repetitions = smoke ? 1 : 3;
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' });
assert(revision.status === 0 && status.status === 0 && !status.stdout.trim(), 'Evaluation requires a clean committed checkout');
const sourceSha = revision.stdout.trim();
const cache = join(root, '.cache/visaflow');
const routingStatePath = join(cache, 'groq-evaluation-routing.json');
const temporary = join(cache, `groq-eval-${randomBytes(8).toString('hex')}`);
await mkdir(temporary, { recursive: true, mode: 0o700 });
const secret = randomBytes(32).toString('base64url');
const alias = `groq-${randomBytes(6).toString('hex')}`;
const expires = Date.now() + 15 * 60_000;
const configPath = join(temporary, 'wrangler.json');
const secretsPath = join(temporary, 'secrets.json');
const receiptPath = join(cache, release ? 'assistant-acceptance.json' : smoke ? 'groq-smoke.json' : 'groq-acceptance.json');
const receipt = { schemaVersion: 1, provider: 'groq', model: models.groq.answer, modelProfile: models.groq, sourceSha, createdAt: new Date().toISOString(), expiresAt: new Date(expires).toISOString(), repetitions, passed: false, cases: [], evaluationWorker: worker, previewRoutingRestored: false, activeDeploymentsUnchanged: false };
async function api(path, options = {}) {
  const response = await fetch(`${apiRoot}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  assert(response.ok, `Cloudflare ${path} returned ${response.status}`);
  const data = await response.json();
  assert(data.success, 'Cloudflare request failed');
  return data.result;
}
const active = async name => (await api(`/workers/scripts/${name}/deployments`)).deployments?.[0]?.versions;
async function restoreRouting(state) {
  assert.equal(state.worker, worker);
  assert.equal(state.account, account);
  assert.equal(typeof state.routing?.enabled, 'boolean');
  assert.equal(typeof state.routing?.previews_enabled, 'boolean');
  const after = await Promise.all([active(worker), active('visaflow-dev'), active('visathreads-sandbox')]);
  assert.deepEqual(after, state.baseline, 'Active deployments changed during evaluation');
  await api(`/workers/scripts/${worker}/subdomain`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.routing) });
  const restored = await api(`/workers/scripts/${worker}/subdomain`);
  assert.equal(restored.enabled, state.routing.enabled);
  assert.equal(restored.previews_enabled, state.routing.previews_enabled);
  await rm(routingStatePath);
}
if (process.argv.includes('--cleanup')) {
  try { await restoreRouting(JSON.parse(await readFile(routingStatePath, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rm(temporary, { recursive: true, force: true });
  console.log('Isolated evaluation cleanup complete.');
  process.exit(0);
}
let baseline, routing, failure, ownsRouting = false;
try {
  const [secrets, settings, domains, subdomain] = await Promise.all([
    api(`/workers/scripts/${worker}/secrets`), api(`/workers/scripts/${worker}/settings`),
    api('/workers/domains'), api('/workers/subdomain'),
  ]);
  assert(secrets.some(secret => secret.name === 'GROQ_API_KEY'), 'The isolated Worker needs GROQ_API_KEY');
  assert(!domains.some(domain => domain.service === worker), 'Evaluation Worker must not serve a custom domain');
  assert(settings.bindings.every(binding => ['secret_text', 'plain_text'].includes(binding.type)), 'Evaluation Worker must have no database, storage or service bindings');
  assert(/^[a-z0-9-]+$/.test(subdomain.subdomain), 'Invalid Worker subdomain');
  baseline = await Promise.all([active(worker), active('visaflow-dev'), active('visathreads-sandbox')]);
  assert(baseline.every(value => Array.isArray(value) && value.length), 'All active deployment baselines must be known');
  routing = await api(`/workers/scripts/${worker}/subdomain`);
  routing = { enabled: routing.enabled, previews_enabled: routing.previews_enabled ?? routing.enabled };
  await writeFile(routingStatePath, JSON.stringify({ worker, account, routing, baseline }), { mode: 0o600, flag: 'wx' });
  ownsRouting = true;
  console.log('PASS stored Groq key, isolated bindings, and active deployment baselines');
  await writeFile(configPath, JSON.stringify({ name: worker, account_id: account, main: resolve(root, 'scripts/assistant-acceptance-worker.ts'), compatibility_date: '2026-10-01', preview_urls: true, routes: [], observability: { enabled: false }, vars: { ACCEPTANCE_PROVIDER: 'groq', ACCEPTANCE_EXPIRES: String(expires), ACCEPTANCE_SOURCE_SHA: sourceSha } }));
  await writeFile(secretsPath, JSON.stringify({ ACCEPTANCE_SECRET: secret }), { mode: 0o600 });
  const upload = spawnSync(join(root, 'node_modules/.bin/wrangler'), ['versions', 'upload', '--config', configPath, '--env', '', '--secrets-file', secretsPath, '--preview-alias', alias, '--message', 'Isolated synthetic Groq acceptance; never deploy'], { cwd: root, env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }, encoding: 'utf8', timeout: 120_000, maxBuffer: 4_000_000 });
  if (upload.status !== 0) {
    receipt.uploadDiagnostic = safeReleaseDiagnostic(`${upload.stdout ?? ''}\n${upload.stderr ?? ''}`, [secret, token,
      ...Object.entries(process.env).filter(([name]) => /TOKEN|SECRET|KEY|PASSWORD/i.test(name)).map(([, value]) => value)]);
    throw Error(`Isolated version upload failed (${upload.status ?? 'timeout'}): ${receipt.uploadDiagnostic}`);
  }
  await rm(secretsPath, { force: true });
  // A Worker created only by secret upload starts with both routes disabled.
  // Version upload alone does not reliably enable its version URL routing.
  await api(`/workers/scripts/${worker}/subdomain`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: routing.enabled, previews_enabled: true }) });
  console.log('PASS test version uploaded; isolated version URL enabled for this run');
  const base = `https://${alias}-${worker}.${subdomain.subdomain}.workers.dev/evaluate`;
  const url = await waitForAcceptanceReady(base, secret, sourceSha, cases, { modelProfile: models.groq });
  console.log('PASS exact model/profile readiness and unauthenticated denial; no active version changed');
  if (process.argv.includes('--transport')) {
    const probe = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: '__transport__' }), redirect: 'error', signal: AbortSignal.timeout(15000) });
    receipt.transportProbe = await probe.json();
    console.log(JSON.stringify(receipt.transportProbe));
  }
  // Serial samples bound spending and make account rate limits visible. A
  // failed sample is retained, never replaced by a successful retry.
  for (const id of selected) {
    const samples = [];
    for (let sample = 0; sample < repetitions; sample++) {
      const started = Date.now();
      try {
        const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id }), redirect: 'error', signal: AbortSignal.timeout(60_000) });
        assert(response.headers.get('X-Assistant-Acceptance') === 'v1', 'Unrecognized evaluation response');
        const value = await response.json();
        assert(value.id === id && value.model === models.groq.answer, 'Unexpected model or fixture');
        samples.push({ ...value, httpStatus: response.status, roundTripMs: Date.now() - started });
        console.log(`${value.passed ? 'PASS' : 'FAIL'} ${id} sample ${sample + 1}/${repetitions} ${Date.now() - started}ms${value.syntheticDiagnostic?.providerReason ? ` ${value.syntheticDiagnostic.providerReason}` : ''}`);
        if (smoke && value.transport) console.log(JSON.stringify({ providerTransport: value.transport }));
        if (['rate_limited', 'authentication_failed', 'permission_denied', 'invalid_key_format', 'network_error', 'unsupported_redirect', 'illegal_invocation', 'invalid_request'].includes(value.syntheticDiagnostic?.providerReason)) {
          receipt.cases.push({ id, passed: false, samples });
          throw Error(`Groq ${value.syntheticDiagnostic.providerReason}; stop additional inference until configuration/capacity is resolved`);
        }
      } catch (error) {
        if (receipt.cases.some(item => item.id === id)) throw error;
        samples.push({ id, passed: false, checks: [{ name: 'transport_and_schema', passed: false }], roundTripMs: Date.now() - started });
        console.log(`FAIL ${id} sample ${sample + 1}/${repetitions} transport-or-schema`);
      }
    }
    receipt.cases.push({ id, passed: samples.length === repetitions && samples.every(sample => sample.passed), samples });
  }
  receipt.passed = receipt.cases.length === selected.length && receipt.cases.every(item => item.passed);
  if (!receipt.passed) failure = Error('Groq acceptance failed; retain every failed sample');
} catch (error) { failure = error; }
finally {
  try {
    if (ownsRouting) {
      await restoreRouting({ worker, account, routing, baseline });
      receipt.previewRoutingRestored = true;
      receipt.activeDeploymentsUnchanged = true;
    }
  } catch (error) { failure = error; receipt.passed = false; }
  await rm(temporary, { recursive: true, force: true });
  receipt.features = { posts: receipt.passed && !smoke, communities: receipt.passed && !smoke, catchup: receipt.passed && !smoke };
  receipt.cases = receipt.cases.map(row => ({ ...row, model: models.groq.answer, checks: row.samples.flatMap((sample, index) => (sample.checks ?? []).map(check => ({ name: `sample_${index + 1}_${check.name}`, passed: check.passed }))) }));
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
}
if (failure) { console.error(failure.message); process.exitCode = 1; }
else console.log(`Groq ${smoke ? 'smoke' : 'acceptance'} passed; active deployments preserved.`);

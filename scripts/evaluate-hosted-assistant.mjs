// Runs the production application service and adapter against synthetic evidence through a temporary,
// secret-protected AI binding. This never changes either application Worker.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForAcceptanceReady } from './assistant-acceptance-readiness.mjs';
import { readAcceptanceFailureDiagnostic } from './assistant-acceptance-diagnostics.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const cache = join(root, '.cache/visaflow');
const statePath = join(cache, 'assistant-evaluation-worker.json');
const receiptPath = join(cache, 'assistant-acceptance.json');
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
assert(token && account && /^[a-f0-9]{32}$/i.test(account), 'Cloudflare account and token are required');
const apiRoot = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const workerPattern = /^visathreads-ai-eval-[a-f0-9]{20}$/;
const cases = ['post-question', 'post-summary', 'public-question', 'community-question', 'community-catchup', 'community-catchup-partial', 'conflicting-reports', 'unsupported-policy', 'irrelevant-evidence', 'prompt-injection', 'multilingual-post', 'concise-question-relevance', 'conversation-topic-switch', 'long-post-tail-answer', 'short-followup-context'];

async function api(path, options = {}) {
  const reply = await fetch(`${apiRoot}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (options.method === 'DELETE' && reply.status === 404) return null;
  assert(reply.ok, `Cloudflare ${options.method ?? 'GET'} ${path} failed (${reply.status})`);
  const value = await reply.json();
  assert(value.success === true, `Cloudflare ${options.method ?? 'GET'} ${path} was unsuccessful`);
  return value.result;
}
async function cleanup() {
  let state;
  try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  assert(workerPattern.test(state.name) && state.account === account, 'Cleanup target must be this run\'s evaluation Worker');
  await api(`/workers/scripts/${state.name}`, { method: 'DELETE' });
  await rm(statePath);
  return true;
}
if (process.argv.includes('--cleanup')) { await cleanup(); console.log('Temporary AI evaluation Worker cleanup completed.'); process.exit(0); }

await mkdir(cache, { recursive: true });
await rm(receiptPath, { force: true });
try { await readFile(statePath); throw Error('Previous evaluation cleanup is pending; run --cleanup first'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
assert(revision.status === 0, 'Git revision is required');
const sourceSha = revision.stdout.trim();
assert(/^[a-f0-9]{40}$/.test(sourceSha), 'Invalid source revision');
if (process.env.GITHUB_SHA) assert.equal(process.env.GITHUB_SHA, sourceSha, 'Checkout must match the workflow revision');
const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' });
assert(status.status === 0 && !status.stdout.trim(), 'Hosted acceptance requires a clean tracked checkout');
const name = `visathreads-ai-eval-${randomBytes(10).toString('hex')}`;
const secret = randomBytes(32).toString('base64url');
const temporary = join(cache, name);
await mkdir(temporary, { recursive: true, mode: 0o700 });
const configPath = join(temporary, 'wrangler.json');
const secretsPath = join(temporary, 'secrets.json');
await writeFile(configPath, JSON.stringify({ name, main: resolve(root, 'scripts/assistant-acceptance-worker.ts'), account_id: account, compatibility_date: '2026-10-01', workers_dev: true, preview_urls: false, routes: [], ai: { binding: 'ASSISTANT_AI' }, vars: { ACCEPTANCE_EXPIRES: String(Date.now() + 15 * 60_000), ACCEPTANCE_SOURCE_SHA: sourceSha }, observability: { enabled: false } }));
await writeFile(secretsPath, JSON.stringify({ ACCEPTANCE_SECRET: secret }), { mode: 0o600 });
const repetitions = 3;
const receipt = { schemaVersion: 1, sourceSha, provider: 'workers-ai', model: '@cf/openai/gpt-oss-120b', createdAt: new Date().toISOString(), passed: false, repetitions, features: { posts: true, communities: true, catchup: true }, cases: [], workerDeleted: false };
let failure;
try {
  const subdomain = await api('/workers/subdomain');
  assert(subdomain && /^[a-z0-9-]+$/i.test(subdomain.subdomain), 'A Workers subdomain is required');
  // Record before deployment so CI's always-cleanup also catches interrupted uploads.
  await writeFile(statePath, JSON.stringify({ name, account }), { mode: 0o600 });
  const deployment = spawnSync(join(root, 'node_modules/.bin/wrangler'), ['deploy', '--config', configPath, '--env', '', '--secrets-file', secretsPath, '--no-autoconfig'], { cwd: root, env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }, encoding: 'utf8', timeout: 120_000, maxBuffer: 4_000_000 });
  // Wrangler output is intentionally not forwarded: no secret or accidental source logging.
  assert(deployment.status === 0, `Temporary AI Worker deployment failed (exit ${deployment.status ?? 'timeout'})`);
  await rm(secretsPath, { force: true });
  const baseUrl = `https://${name}.${subdomain.subdomain}.workers.dev/evaluate`;
  await waitForAcceptanceReady(baseUrl, secret, sourceSha, cases);
  console.log('PASS authenticated Worker readiness and unauthenticated denial');
  for (const id of cases) {
    const samples = [];
    // Fixed independent samples, never retrying a failed inference or replacing
    // a failure with a later success. Every sample remains in the receipt.
    for (let sample = 0; sample < repetitions; sample++) {
      const url = await waitForAcceptanceReady(baseUrl, secret, sourceSha, cases);
      const reply = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, body: JSON.stringify({ id }), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(35_000) });
      if (!reply.ok) {
        const syntheticDiagnostic = await readAcceptanceFailureDiagnostic(reply, id, receipt.model);
        samples.push({ id, passed: false, checks: [{ name: 'hosted_inference_and_validation', passed: false }], httpStatus: reply.status, workerMarker: reply.headers.get('X-Assistant-Acceptance') === 'v1', ...(syntheticDiagnostic ? { syntheticDiagnostic } : {}) });
        console.log(`FAIL ${id} sample ${sample + 1}/${repetitions} HTTP ${reply.status} worker-marker=${reply.headers.get('X-Assistant-Acceptance') === 'v1'}`);
        continue;
      }
      const value = await reply.json();
      assert(value.id === id && value.model === receipt.model && Array.isArray(value.checks), 'Evaluation returned an unexpected fixture or model');
      samples.push(value);
      console.log(`${value.passed ? 'PASS' : 'FAIL'} ${id} sample ${sample + 1}/${repetitions}`);
    }
    receipt.cases.push({ id, model: receipt.model, passed: samples.length === repetitions && samples.every(sample => sample.passed === true), checks: samples.flatMap((sample, index) => sample.checks.map(check => ({ name: `sample_${index + 1}_${check.name}`, passed: check.passed }))), samples });
  }
  receipt.passed = receipt.cases.length === cases.length && receipt.cases.every(item => item.passed === true && item.checks.every(check => check.passed === true));
  if (!receipt.passed) failure = Error('Hosted AI acceptance failed; production AI must remain disabled');
} catch (error) { failure = error; }
finally {
  try { receipt.workerDeleted = await cleanup(); } catch (error) { failure = error; receipt.passed = false; }
  await rm(temporary, { recursive: true, force: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
}
if (failure) { console.error(failure.message); process.exitCode = 1; }
else console.log(`Hosted AI acceptance passed ${receipt.cases.length} cases; temporary Worker deleted.`);

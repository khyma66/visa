// Feature updates for the existing visathreads.com early preview. This does not
// change the formal public-release workflow, launch approval, indexing, or dev.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkedLiveArchive, LIVE_SITE, LIVE_DATABASE, LIVE_WORKER, sha256 } from './live-preview-archive.mjs';
import { sourceProvenance } from './build-provenance.mjs';
import { recoverWorkerArchive, canonicalJson, publishedArchive } from './recover-worker-archive.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const privateDirectory = resolve(root, '.cache/visaflow/live-preview');
const receiptPath = resolve(privateDirectory, 'receipt.json');
const configPath = resolve(root, 'dist/server/wrangler.json');
const hosts = ['visathreads.com', 'www.visathreads.com'];
const publicVariableNames = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SITE_URL', 'GOOGLE_NEWS_RSS_ENABLED'];

async function jsonRequest(url, options = {}, maximum = 12 * 1024 * 1024) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  assert(response.ok, `Request failed (${response.status}); response content was withheld.`);
  assert(/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? ''), 'Expected JSON.');
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const value = await reader.read(); if (value.done) break;
      length += value.value.byteLength;
      assert(length <= maximum, 'Response exceeds allowed size.');
      chunks.push(value.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Response was not valid JSON; content withheld.'); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function cloudflare(path) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  assert(/^[a-f0-9]{32}$/.test(account ?? '') && token, 'Cloudflare environment credentials are required.');
  return jsonRequest(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  }, 2 * 1024 * 1024).then(data => { assert(data.success, 'Cloudflare API did not confirm success.'); return data.result; });
}

export function featureEnvironment(values, enabled) {
  assert.equal(values.NEXT_PUBLIC_SITE_URL, LIVE_SITE);
  assert.equal(values.NEXT_PUBLIC_SUPABASE_URL, LIVE_DATABASE);
  assert(/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''), 'A production publishable key is required.');
  assert(['true', 'false'].includes(enabled), 'ASSISTANT_ENABLED must be true or false.');
  return {
    ...Object.fromEntries(publicVariableNames.filter(name => values[name] !== undefined).map(name => [name, values[name]])),
    NEXT_PUBLIC_APP_ENV: 'development', APP_ENV: 'development', CLOUDFLARE_ENV: 'development',
    VISATHREADS_EXISTING_PREVIEW: 'true', PUBLIC_LAUNCH_APPROVED: 'false', IMPORTED_CONTENT_APPROVED: 'false',
    COMMUNITY_SOURCE_MODE: 'snapshot', APIFY_LIVE_FETCH_ENABLED: 'false',
    ASSISTANT_PROJECT_REF: 'cycnichledvqbxevrwnt', ASSISTANT_PROVIDER: 'workers-ai',
    ASSISTANT_ENABLED: enabled, ASSISTANT_COMMUNITIES_ENABLED: 'false', ASSISTANT_CATCHUP_ENABLED: 'false',
  };
}

export function verifyFeatureWorker(config, enabled) {
  assert.equal(config.name, LIVE_WORKER);
  assert.deepEqual(config.routes, hosts.map(pattern => ({ pattern, custom_domain: true })));
  assert.equal(config.vars.APP_ENV, 'development', 'Existing launch mode must remain unchanged.');
  assert.equal(config.vars.PUBLIC_LAUNCH_APPROVED, 'false');
  assert.equal(config.vars.IMPORTED_CONTENT_APPROVED, 'false');
  assert.equal(config.vars.APIFY_LIVE_FETCH_ENABLED, 'false');
  assert.equal(config.vars.NEXT_PUBLIC_SITE_URL, LIVE_SITE);
  assert.equal(config.vars.NEXT_PUBLIC_SUPABASE_URL, LIVE_DATABASE);
  assert.equal(config.vars.ASSISTANT_ENABLED, enabled);
  assert.equal(config.vars.ASSISTANT_PROJECT_REF, 'cycnichledvqbxevrwnt');
  assert.equal(config.vars.ASSISTANT_PROVIDER, 'workers-ai');
  assert.equal(config.vars.ASSISTANT_COMMUNITIES_ENABLED, 'false');
  assert.equal(config.vars.ASSISTANT_CATCHUP_ENABLED, 'false');
  assert.deepEqual(config.ai, { binding: 'ASSISTANT_AI' });
}

async function liveState() {
  const domains = await cloudflare('/workers/domains');
  for (const host of hosts) assert.equal(domains.find(row => row.hostname === host)?.service, LIVE_WORKER, 'Live route ownership changed.');
  const { deployments } = await cloudflare(`/workers/scripts/${LIVE_WORKER}/deployments`);
  const deployment = deployments[0];
  assert.equal(deployment.versions.length, 1, 'An in-progress traffic split needs operator review.');
  assert.equal(deployment.versions[0].percentage, 100);
  const health = await jsonRequest(`${LIVE_SITE}/api/health?release=${Date.now()}`, { cache: 'no-store' });
  assert.equal(health.environment, 'development', 'Existing live site is no longer an early preview.');
  assert.equal(health.releaseStatus, 'configured');
  assert.equal(health.build.siteOrigin, LIVE_SITE);
  assert.equal(health.build.dirty, false);
  assert.match(health.build.gitSha, /^[a-f0-9]{40}$/);
  const response = await fetch(LIVE_SITE, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  assert.match(response.headers.get('x-robots-tag') ?? '', /noindex/, 'Do not change an already launched site through preview tooling.');
  await response.body?.cancel();
  return { deployment, health };
}

export async function captureFeatureBaseline() {
  const { deployment, health } = await liveState();
  const settings = await cloudflare(`/workers/scripts/${LIVE_WORKER}/settings`);
  const stored = Object.fromEntries((settings.bindings ?? []).filter(binding => binding.type === 'plain_text' && publicVariableNames.includes(binding.name)).map(binding => [binding.name, binding.text]));
  const values = Object.fromEntries(publicVariableNames.map(name => [name, process.env[name] || stored[name]]));
  // These expected origins are fixed targets, never inferred from a token/account.
  values.NEXT_PUBLIC_SITE_URL ??= LIVE_SITE; values.NEXT_PUBLIC_SUPABASE_URL ??= LIVE_DATABASE;
  featureEnvironment(values, 'false');
  const publicArchive = await jsonRequest(`${LIVE_SITE}/api/community`, { cache: 'no-store' });
  // Recover the original JSON literal from the currently deployed Worker, never
  // evaluate its JavaScript and never persist or log the downloaded Worker code.
  const archive = await recoverWorkerArchive(await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${LIVE_WORKER}`, {
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(30_000),
  }));
  assert.equal(sha256(canonicalJson(publishedArchive(archive))), sha256(canonicalJson(publicArchive)), 'Deployed snapshot does not match the live feed.');
  assert.equal(archive.questions?.length, 563);
  assert.equal(new Set(archive.questions.map(row => row.id)).size, 563);
  assert.equal(Object.values(archive.answersByQuestionId ?? {}).flat().length, 628);
  assert.equal(archive.source?.importedItems, 563);
  assert.equal(archive.source?.commentCount, 628);
  const bytes = `${JSON.stringify(archive)}\n`;
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  await writeFile(resolve(root, 'src/data/api-archive.json'), bytes, { mode: 0o600 });
  await writeFile(resolve(privateDirectory, 'public-build-values.json'), JSON.stringify(values), { mode: 0o600 });
  const receipt = { schemaVersion: 1, siteOrigin: LIVE_SITE, databaseOrigin: LIVE_DATABASE, worker: LIVE_WORKER,
    capturedAt: new Date().toISOString(), deploymentId: deployment.id, previousVersion: deployment.versions[0].version_id,
    health, archiveSha256: sha256(bytes), publishedArchiveSha256: sha256(canonicalJson(publicArchive)), questionCount: 563, replyCount: 628 };
  await writeFile(receiptPath, JSON.stringify(receipt), { mode: 0o600 });
  const safeInventory = (settings.bindings ?? []).map(binding => ({ name: binding.name, type: binding.type, ...(binding.type === 'plain_text' && ['APP_ENV', 'PUBLIC_LAUNCH_APPROVED', 'IMPORTED_CONTENT_APPROVED', 'ASSISTANT_ENABLED', 'ASSISTANT_COMMUNITIES_ENABLED', 'ASSISTANT_CATCHUP_ENABLED', 'GOOGLE_NEWS_RSS_ENABLED'].includes(binding.name) ? { value: binding.text } : {}) }));
  console.log(JSON.stringify({ operation: 'captured-existing-preview', source: health.build.gitSha, previousVersion: receipt.previousVersion, archiveSha256: receipt.archiveSha256, publishedArchiveSha256: receipt.publishedArchiveSha256, questionCount: 563, replyCount: 628, bindings: safeInventory }));
}

function run(command, args, env) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.on('error', reject); child.on('exit', code => code === 0 ? done() : reject(new Error(`${command} failed (${code}).`)));
  });
}

export async function buildFeatureRelease(enabled) {
  const provenance = sourceProvenance(root);
  assert.equal(provenance.dirty, false, 'Feature release requires committed, clean source.');
  if (process.env.GITHUB_SHA) assert.equal(provenance.gitSha, process.env.GITHUB_SHA);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  execFileSync('git', ['merge-base', '--is-ancestor', receipt.health.build.gitSha, 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const values = JSON.parse(await readFile(resolve(privateDirectory, 'public-build-values.json'), 'utf8'));
  const env = { ...process.env, ...featureEnvironment(values, enabled) };
  // Only deploy steps receive account credentials. Avoid accidentally bundling
  // runner secrets, service credentials or unrelated local AI provider settings.
  for (const key of Object.keys(env)) if (/TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL|DIRECT_URL|CLOUDFLARE_ACCOUNT_ID/.test(key)) delete env[key];
  checkedLiveArchive(root, env);
  await run(process.execPath, ['scripts/check-private-experiences.mjs'], env);
  await run(resolve(root, 'node_modules/.bin/vinext'), ['build'], env);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.vars = { ...config.vars, ...featureEnvironment(values, enabled) };
  delete config.vars.CLOUDFLARE_ENV; delete config.vars.VISATHREADS_EXISTING_PREVIEW;
  config.ai = { binding: 'ASSISTANT_AI' };
  // Wrangler preserves existing secrets. Never download, serialize or replace them.
  verifyFeatureWorker(config, enabled);
  await writeFile(configPath, JSON.stringify(config, null, 2));
  await run(process.execPath, ['scripts/check-archive-bundle.mjs'], env);
  await run(process.execPath, ['scripts/check-bundle.mjs'], env);
}

export async function predeployFeatureCheck(enabled) {
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const { deployment, health } = await liveState();
  assert.equal(deployment.id, receipt.deploymentId, 'Production changed since capture. Rebuild against the new live baseline.');
  assert.equal(health.build.gitSha, receipt.health.build.gitSha);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  verifyFeatureWorker(config, enabled);
  checkedLiveArchive(root, { ...config.vars, CLOUDFLARE_ENV: 'development', VISATHREADS_EXISTING_PREVIEW: 'true' });
  console.log('Live route, deployment baseline, archive and production-only assistant target verified.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const command = process.argv[2];
  const enabled = process.env.ASSISTANT_ENABLED ?? 'false';
  try {
    if (command === 'capture') await captureFeatureBaseline();
    else if (command === 'build') await buildFeatureRelease(enabled);
    else if (command === 'predeploy') await predeployFeatureCheck(enabled);
    else throw new Error('Use capture, build or predeploy. This helper does not deploy.');
  } catch (error) {
    // Never expose assertion diffs containing recovered source or public config.
    console.error(`Feature release blocked: ${error.message.split('\n')[0]}`); console.error(String(error.stack).split('\n').filter(line => /at .*production-feature-release|at .*recover-worker-archive/.test(line)).slice(0,2).join('\n')); process.exitCode = 1;
  }
}

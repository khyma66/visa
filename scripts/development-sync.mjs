// Production-first feature sync. Copies reviewed code, never production accounts,
// database credentials, or production content. No deploy is performed by this helper.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assistantDevelopmentEnvironment, verifyAssistantWorker } from './development-site.mjs';
import { DEV_SITE, DEV_DATABASE, DEV_WORKER, DEV_SYNC_DIRECTORY, checkedDevelopmentArchive } from './development-sync-archive.mjs';
import { LIVE_SITE, LIVE_WORKER, sha256 } from './live-preview-archive.mjs';
import { buildProvenance, sourceProvenance } from './build-provenance.mjs';
import { canonicalJson, publishedArchive, recoverWorkerArchive } from './recover-worker-archive.mjs';
import { verifyCurrentFeatureDeployment } from './production-feature-release.mjs';
import { smokeSite, waitForHealthProvenance } from './smoke-site.mjs';
import { createRolloutProbe, probeRolloutHealth, publicClientAssets, verifyClientAssets, verifyStableRollout } from './rollout-verification.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, DEV_SYNC_DIRECTORY);
const configPath = resolve(root, 'dist/server/wrangler.json');
const allowedPublic = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'GOOGLE_NEWS_RSS_ENABLED'];
// The old dev Worker still carries this unused setting. It is read only to
// recognize the existing deployment and is never copied into the new build.
const retiredDevSettings = ['NEWS_REFRESH_ORIGIN'];
const hash = value => sha256(canonicalJson(value));
const save = (name, value) => writeFile(resolve(directory, name), `${JSON.stringify(value)}\n`, { mode: 0o600 });
const read = async name => JSON.parse(await readFile(resolve(directory, name), 'utf8'));

async function requestJson(url, options = {}, limit = 12 * 1024 * 1024) {
  const response = await fetch(url, { ...options, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) });
  assert(response.ok, `Read failed (${response.status}); body withheld.`);
  assert(/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? ''), 'Expected JSON.');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; assert(size <= limit, 'Response exceeds limit.'); chunks.push(part.value); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Invalid JSON; body withheld.'); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function cfUrl(path) {
  assert(/^[a-f0-9]{32}$/.test(process.env.CLOUDFLARE_ACCOUNT_ID ?? '') && process.env.CLOUDFLARE_API_TOKEN, 'Cloudflare credentials are required.');
  return `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}${path}`;
}
const auth = () => ({ Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` });
async function cf(path) { const response = await requestJson(cfUrl(path), { headers: auth() }, 2 * 1024 * 1024); assert(response.success, 'Cloudflare did not confirm success.'); return response.result; }
async function deployment(worker) {
  const value = (await cf(`/workers/scripts/${worker}/deployments`)).deployments?.[0];
  assert.match(value?.id ?? '', /^[a-f0-9-]{36}$/);
  assert.equal(value.versions?.length, 1, 'Split deployments require manual review.');
  assert.equal(value.versions[0].percentage, 100);
  assert.match(value.versions[0].version_id, /^[a-f0-9-]{36}$/);
  return value;
}
export function verifySyncProductionSource(health, source) {
  assert.equal(source.dirty, false, 'Sync requires clean committed source.');
  assert.equal(health.environment, 'development', 'Production launch mode changed.');
  assert.equal(health.releaseStatus, 'configured');
  assert.equal(health.build?.siteOrigin, LIVE_SITE);
  for (const field of ['gitSha', 'gitTree', 'sourceSha256', 'dirty']) assert.equal(health.build[field], source[field], `Production ${field} must match this candidate before dev sync.`);
}
async function productionState() {
  const source = sourceProvenance(root);
  assert.equal(source.gitSha, process.env.GITHUB_SHA, 'Sync must run for the same immutable workflow SHA.');
  const domains = await cf('/workers/domains');
  for (const [host, worker] of [['visathreads.com', LIVE_WORKER], ['www.visathreads.com', LIVE_WORKER], ['visa-central.com', DEV_WORKER], ['www.visa-central.com', DEV_WORKER]]) {
    assert.equal(domains.find(row => row.hostname === host)?.service, worker, 'Domain ownership changed.');
  }
  const active = await deployment(LIVE_WORKER);
  const health = await requestJson(`${LIVE_SITE}/api/health?dev-sync=${Date.now()}`);
  verifySyncProductionSource(health, source);
  return { source, deploymentId: active.id, version: active.versions[0].version_id };
}
export function developmentSyncEnvironment(values) {
  const publicValues = Object.fromEntries(allowedPublic.filter(name => values[name] !== undefined).map(name => [name, values[name]]));
  return { ...publicValues, ...assistantDevelopmentEnvironment(publicValues), PUBLIC_LAUNCH_APPROVED: 'false', IMPORTED_CONTENT_APPROVED: 'false', VISATHREADS_DEV_SYNC: 'true' };
}
export function verifyDevelopmentSyncWorker(config) {
  verifyAssistantWorker(config);
  assert.equal(config.vars.PUBLIC_LAUNCH_APPROVED, 'false');
  assert.equal(config.vars.IMPORTED_CONTENT_APPROVED, 'false');
  assert.equal(config.vars.APIFY_LIVE_FETCH_ENABLED, 'false');
  assert.equal(config.vars.COMMUNITY_SOURCE_MODE, 'snapshot');
  for (const name of Object.keys(config.vars)) assert(!/TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL|DIRECT_URL/.test(name), 'Secret or unrelated database value in dev configuration.');
  const populated = value => value != null && (Array.isArray(value) ? value.length > 0 : typeof value === 'object' ? Object.values(value).some(populated) : true);
  for (const name of ['services', 'd1_databases', 'kv_namespaces', 'r2_buckets', 'hyperdrive', 'queues', 'durable_objects', 'ai', 'workflows', 'vectorize', 'secrets_store_secrets', 'dispatch_namespaces', 'send_email', 'pipelines', 'unsafe', 'browser', 'images', 'analytics_engine_datasets', 'mtls_certificates', 'logfwdr', 'cloudchamber', 'ai_search_namespaces', 'ai_search', 'agent_memory', 'k2', 'artifacts', 'flagship', 'worker_loaders', 'vpc_services', 'vpc_networks']) assert(!populated(config[name]), 'Unreviewed resource binding in dev sync.');
}
export function verifyDevelopmentSyncSettings(settings) {
  const stored = Object.fromEntries((settings.bindings ?? []).filter(row => row.type === 'plain_text').map(row => [row.name, row.text]));
  const fixed = { APP_ENV: 'development', NEXT_PUBLIC_APP_ENV: 'development', NEXT_PUBLIC_DEPLOYMENT_TARGET: 'development-sandbox',
    COMMUNITY_SOURCE_MODE: 'snapshot', APIFY_LIVE_FETCH_ENABLED: 'false', ASSISTANT_ENABLED: 'false', ASSISTANT_COMMUNITIES_ENABLED: 'false',
    ASSISTANT_CATCHUP_ENABLED: 'false', ASSISTANT_PROJECT_REF: '', ASSISTANT_PROVIDER: '', PUBLIC_LAUNCH_APPROVED: 'false', IMPORTED_CONTENT_APPROVED: 'false' };
  // The original isolated dev Worker predates the explicit assistant gates.
  // Recognize only that exact older shape for capture; the replacement build
  // still receives the strict development-sandbox values above.
  const legacy = stored.NEXT_PUBLIC_DEPLOYMENT_TARGET === 'sandbox';
  if (legacy) {
    for (const name of ['NEXT_PUBLIC_APP_ENV', 'ASSISTANT_ENABLED', 'ASSISTANT_COMMUNITIES_ENABLED', 'ASSISTANT_CATCHUP_ENABLED', 'ASSISTANT_PROJECT_REF', 'ASSISTANT_PROVIDER']) {
      assert.equal(stored[name], undefined, 'Legacy dev baseline unexpectedly contains an assistant or newer environment setting.');
    }
    assert.equal(stored.NEWS_REFRESH_ORIGIN, DEV_SITE, 'Legacy news origin must be the isolated dev site.');
  }
  for (const binding of settings.bindings ?? []) {
    if (binding.type === 'plain_text') {
      assert(allowedPublic.includes(binding.name) || retiredDevSettings.includes(binding.name) || Object.hasOwn(fixed, binding.name), 'Unrecognized dev variable requires review before sync.');
      if (Object.hasOwn(fixed, binding.name) && !(legacy && binding.name === 'NEXT_PUBLIC_DEPLOYMENT_TARGET')) assert.equal(binding.text, fixed[binding.name], 'Existing dev setting differs from the reviewed isolated configuration.');
    } else assert(binding.type === 'secret_text' || (binding.type === 'assets' && binding.name === 'ASSETS') || (binding.type === 'version_metadata' && binding.name === 'CF_VERSION_METADATA'), 'Existing dev resource binding requires review before sync.');
  }
  assert.equal(stored.NEXT_PUBLIC_SITE_URL, DEV_SITE);
  assert.equal(stored.NEXT_PUBLIC_SUPABASE_URL, DEV_DATABASE, 'Dev must already use its isolated database.');
  for (const name of ['APP_ENV', 'COMMUNITY_SOURCE_MODE', 'APIFY_LIVE_FETCH_ENABLED']) assert.equal(stored[name], fixed[name]);
  if (!legacy) for (const name of ['ASSISTANT_ENABLED', 'ASSISTANT_COMMUNITIES_ENABLED', 'ASSISTANT_CATCHUP_ENABLED']) assert.equal(stored[name], fixed[name]);
  return stored;
}
export function verifyExistingDevelopmentHealth(health) {
  assert.equal(health.environment, 'development');
  assert.equal(health.releaseStatus, 'configured');
  assert.equal(health.build?.siteOrigin, DEV_SITE);
  // Old dev releases may record uncommitted source. We preserve only their
  // published archive after checking the active Worker version and its digest.
  assert.equal(typeof health.build?.dirty, 'boolean');
  assert.match(health.build?.gitSha ?? '', /^[a-f0-9]{40}$/);
}
async function capture() {
  const production = await productionState();
  const active = await deployment(DEV_WORKER);
  const settings = await cf(`/workers/scripts/${DEV_WORKER}/settings`);
  const stored = verifyDevelopmentSyncSettings(settings);
  const values = Object.fromEntries(allowedPublic.filter(name => stored[name] !== undefined).map(name => [name, stored[name]]));
  // A public dev key is permitted only as an explicit fallback; never a prod key.
  values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= process.env.DEV_SUPABASE_PUBLISHABLE_KEY;
  developmentSyncEnvironment(values);
  const health = await requestJson(`${DEV_SITE}/api/health?dev-sync=${Date.now()}`);
  verifyExistingDevelopmentHealth(health);
  const feed = await requestJson(`${DEV_SITE}/api/community`);
  const archive = await recoverWorkerArchive(await fetch(cfUrl(`/workers/scripts/${DEV_WORKER}`), { headers: auth(), redirect: 'error', signal: AbortSignal.timeout(30_000) }));
  assert.equal(hash(publishedArchive(archive)), hash(feed), 'Recovered dev archive differs from currently served dev content.');
  assert(archive.questions.length > 0 && archive.questions.length <= 5000, 'Unexpected dev archive size.');
  assert.equal(new Set(archive.questions.map(question => question.id)).size, archive.questions.length, 'Duplicate dev post IDs.');
  const after = await deployment(DEV_WORKER); assert.equal(after.id, active.id, 'Dev changed during capture.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const bytes = `${JSON.stringify(archive)}\n`;
  await writeFile(resolve(root, 'src/data/api-archive.json'), bytes, { mode: 0o600 });
  await save('public-build-values.json', values);
  const receipt = { schemaVersion: 1, siteOrigin: DEV_SITE, databaseOrigin: DEV_DATABASE, worker: DEV_WORKER,
    capturedAt: new Date().toISOString(), source: production.source.gitSha, productionSource: production.source.gitSha,
    productionDeploymentId: production.deploymentId, productionVersion: production.version,
    deploymentId: active.id, previousVersion: active.versions[0].version_id, health,
    archiveSha256: sha256(bytes), publishedArchiveSha256: hash(feed), questionCount: archive.questions.length,
    replyCount: Object.values(archive.answersByQuestionId).flat().length };
  await save('receipt.json', receipt);
  console.log(JSON.stringify({ operation: 'captured-existing-dev', source: receipt.source, archiveSha256: receipt.archiveSha256, questions: receipt.questionCount, replies: receipt.replyCount, previousVersion: receipt.previousVersion }));
}
function run(command, args, env) {
  return new Promise((done, reject) => { const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' }); child.on('error', reject); child.on('exit', code => code === 0 ? done() : reject(new Error(`Build command failed (${code}).`))); });
}
async function build() {
  const source = sourceProvenance(root); assert.equal(source.dirty, false); assert.equal(source.gitSha, process.env.GITHUB_SHA);
  const receipt = await read('receipt.json'); assert.equal(receipt.source, source.gitSha);
  const env = { ...process.env, ...developmentSyncEnvironment(await read('public-build-values.json')) };
  // Account credentials are used only by capture/check/deploy, never by the build.
  for (const name of Object.keys(env)) if (/TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL|DIRECT_URL|CLOUDFLARE_ACCOUNT_ID|VISATHREADS_EXISTING_PREVIEW/.test(name)) delete env[name];
  checkedDevelopmentArchive(root, env);
  const sourceConfig = JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
  verifyAssistantWorker(sourceConfig.env.sandbox);
  const expected = buildProvenance(root, env);
  await run(resolve(root, 'node_modules/.bin/vinext'), ['build'], env);
  const manifest = JSON.parse(await readFile(resolve(root, '.cache/visaflow/build-provenance.json'), 'utf8'));
  assert.deepEqual(manifest, expected, 'Built dev provenance changed.');
  await save('build-provenance.json', manifest);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.vars = { ...config.vars, ...developmentSyncEnvironment(await read('public-build-values.json')) };
  delete config.vars.VISATHREADS_DEV_SYNC; delete config.vars.CLOUDFLARE_ENV;
  verifyDevelopmentSyncWorker(config);
  await writeFile(configPath, JSON.stringify(config, null, 2));
  await run(process.execPath, ['scripts/check-archive-bundle.mjs'], env);
}
async function productionUnchanged(receipt) {
  const current = await productionState();
  assert.equal(current.deploymentId, receipt.productionDeploymentId, 'Production deployment changed during dev sync.');
  assert.equal(current.version, receipt.productionVersion);
}
async function deployCheck() {
  const receipt = await read('receipt.json'); await productionUnchanged(receipt);
  const env = { ...developmentSyncEnvironment(await read('public-build-values.json')), GITHUB_SHA: process.env.GITHUB_SHA };
  checkedDevelopmentArchive(root, env);
  const expected = await read('build-provenance.json'); assert.deepEqual(expected, buildProvenance(root, env));
  verifyDevelopmentSyncWorker(JSON.parse(await readFile(configPath, 'utf8')));
  assert.equal((await deployment(DEV_WORKER)).id, receipt.deploymentId, 'Dev changed after capture; refusing to overwrite it.');
  assert.equal(hash(await requestJson(`${DEV_SITE}/api/community`)), receipt.publishedArchiveSha256, 'Live dev content changed before deployment.');
  console.log('Verified exact production source, isolated dev target, unchanged archive and rollback baseline.');
}
export function uploadedDevelopmentVersion(text) {
  assert(typeof text === 'string' && text.length <= 1024 * 1024, 'Unexpected deployment output.');
  const records = text.trim().split(/\r?\n/).filter(Boolean).map(line => { try { return JSON.parse(line); } catch { throw new Error('Invalid deployment output; content withheld.'); } });
  const values = records.filter(row => row.type === 'deploy');
  assert.equal(values.length, 1, 'Expected exactly one upload record.');
  assert.equal(values[0].version, 1); assert.equal(values[0].worker_name, DEV_WORKER, 'Upload targeted a different Worker.');
  assert.match(values[0].version_id ?? '', /^[a-f0-9-]{36}$/);
  return values[0].version_id;
}
async function uploaded() { return uploadedDevelopmentVersion(await readFile(resolve(directory, 'wrangler-deploy.ndjson'), 'utf8')); }
async function record() {
  const receipt = await read('receipt.json'); const version = await uploaded(); const active = await deployment(DEV_WORKER);
  verifyCurrentFeatureDeployment(active, version, receipt); await save('deployed.json', active);
  console.log(JSON.stringify({ operation: 'recorded-dev-deployment', version, rollbackVersion: receipt.previousVersion }));
}
async function rollbackVersion() {
  const receipt = await read('receipt.json'); const version = await uploaded();
  let recorded; try { recorded = await read('deployed.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  verifyDevelopmentSyncWorker(JSON.parse(await readFile(configPath, 'utf8')));
  verifyCurrentFeatureDeployment(await deployment(DEV_WORKER), version, receipt, recorded);
  assert.match(receipt.previousVersion, /^[a-f0-9-]{36}$/); assert.notEqual(receipt.previousVersion, version);
  console.log(receipt.previousVersion);
}
async function verifyRollback() {
  const receipt = await read('receipt.json'); await productionUnchanged(receipt);
  assert.equal((await deployment(DEV_WORKER)).versions[0].version_id, receipt.previousVersion, 'Captured dev version was not restored.');
  await waitForHealthProvenance(DEV_SITE, receipt.health.build);
  assert.equal(hash(await requestJson(`${DEV_SITE}/api/community`)), receipt.publishedArchiveSha256, 'Dev archive changed after rollback.');
  console.log(JSON.stringify({ status: 'dev-rollback-verified', version: receipt.previousVersion, archiveUnchanged: true }));
}
async function verify() {
  const receipt = await read('receipt.json'); await productionUnchanged(receipt);
  const expected = await read('build-provenance.json'); assert.equal(expected.gitSha, process.env.GITHUB_SHA);
  const assets = await publicClientAssets(resolve(root, 'dist/client'));
  await verifyStableRollout({ expected, previous: receipt.health,
    persist: report => save('rollout-verification.json', report),
    runRound: async ({ signal, record }) => {
      const probe = createRolloutProbe({ origin: DEV_SITE, expected, previous: receipt.health, signal, record });
      await probeRolloutHealth(probe, 'start');
      const feed = await probe.request('dev-archive', '/api/community');
      assert.equal(hash(await feed.json()), receipt.publishedArchiveSha256, 'Dev content changed during sync.');
      const flags = await probe.request('removed-chatbot', '/api/assistant', {}, { status: 410 });
      assert.deepEqual(await flags.json(), { posts: false, communities: false, catchup: false, code: 'removed' });
      for (const [path, options, status] of [
        ['/assistant', {}, 404], ['/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'ask', scope: { kind: 'public' }, question: 'test' }) }, 410],
        ['/api/communities/00000000-0000-4000-8000-000000000001/summary', {}, 503],
      ]) { const response = await probe.request(`disabled:${path}`, path, options, { status }); await response.body?.cancel(); }
      const page = await probe.request('dev-home', '/'); assert.match(page.headers.get('x-robots-tag') ?? '', /noindex/);
      assert(!(await page.text()).includes('aria-label="Ask VisaThreads assistant"'));
      await smokeSite(DEV_SITE, expected, { fetchImpl: probe.siteFetch, skipHealthWait: true });
      await verifyClientAssets(probe, assets); await probeRolloutHealth(probe, 'end');
    },
  });
  await productionUnchanged(receipt);
  console.log(JSON.stringify({ status: 'verified-dev-sync', source: expected.gitSha, archiveUnchanged: true, questions: receipt.questionCount, replies: receipt.replyCount, assetsVerified: assets.length, assistant: 'disabled', productionUnchanged: true }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const commands = { capture, build, 'deploy-check': deployCheck, 'record-deployment': record, 'rollback-version': rollbackVersion, 'verify-rollback': verifyRollback, verify,
    'production-unchanged': async () => productionUnchanged(await read('receipt.json')) };
  try { assert(commands[process.argv[2]], 'Unknown dev-sync command.'); await commands[process.argv[2]](); }
  catch (error) { console.error(`Dev sync blocked: ${error.message.split('\n')[0]}`); process.exitCode = 1; }
}

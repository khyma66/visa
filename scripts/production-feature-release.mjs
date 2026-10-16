// Feature updates for the existing visathreads.com early preview. This does not
// change the formal public-release workflow, launch approval, indexing, or dev.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkedLiveArchive, LIVE_SITE, LIVE_DATABASE, LIVE_WORKER, sha256 } from './live-preview-archive.mjs';
import { buildProvenance, sourceProvenance } from './build-provenance.mjs';
import { recoverWorkerArchive, canonicalJson, publishedArchive } from './recover-worker-archive.mjs';
import { pinnedChatbotRecovery, verifyRecoveryFiles } from './pinned-chatbot-recovery.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const privateDirectory = resolve(root, '.cache/visaflow/live-preview');
const receiptPath = resolve(privateDirectory, 'receipt.json');
const configPath = resolve(root, 'dist/server/wrangler.json');
const deploymentOutputPath = resolve(privateDirectory, 'wrangler-deploy.ndjson');
const hosts = ['visathreads.com', 'www.visathreads.com'];
const publicVariableNames = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'GOOGLE_NEWS_RSS_ENABLED'];
const LEGACY_BASELINE_SHA = '0624c651cb252436c47c5f2b020baecfec0bfbd0';
const LEGACY_BASELINE_VERSION = '879503b4-e947-420e-8ad8-e1f2f7082ae5';
// Original deployment and the independently observed guarded rollback from run 38582002973.
const LEGACY_BASELINE_DEPLOYMENTS = new Set(['82f636de-0d17-4625-9510-4480c11dc8e0', '5763d137-9c62-4646-a35b-efbe947cfe65']);
const LEGACY_BASELINE_TREE = '1e67b513d22bd843ddcb587548feb68e71f0ef92';
const LEGACY_BASELINE_SOURCE = '2b0809b06597008d2f9b911ec76b13648cfb3cefd271bdbe20809c2826762ea7';

function pinnedLegacySource(build) {
  return build?.gitSha === LEGACY_BASELINE_SHA && build.gitTree === LEGACY_BASELINE_TREE && build.sourceSha256 === LEGACY_BASELINE_SOURCE && build.dirty === false;
}

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

export function featureEnvironment(values, enabled, features = {}) {
  assert.equal(values.NEXT_PUBLIC_SITE_URL, LIVE_SITE);
  assert.equal(values.NEXT_PUBLIC_SUPABASE_URL, LIVE_DATABASE);
  assert(/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''), 'A production publishable key is required.');
  assert(['true', 'false'].includes(enabled), 'ASSISTANT_ENABLED must be true or false.');
  const communities = features.communities ?? 'false';
  const catchup = features.catchup ?? 'false';
  assert(['true', 'false'].includes(communities) && ['true', 'false'].includes(catchup), 'Additional AI feature flags must be explicit booleans.');
  assert(enabled === 'true' || (communities === 'false' && catchup === 'false'), 'Disabled assistant cannot advertise enabled subfeatures.');
  return {
    ...Object.fromEntries(publicVariableNames.filter(name => values[name] !== undefined).map(name => [name, values[name]])),
    NEXT_PUBLIC_APP_ENV: 'development', APP_ENV: 'development', CLOUDFLARE_ENV: 'development',
    VISATHREADS_EXISTING_PREVIEW: 'true', PUBLIC_LAUNCH_APPROVED: 'false', IMPORTED_CONTENT_APPROVED: 'false',
    COMMUNITY_SOURCE_MODE: 'snapshot', APIFY_LIVE_FETCH_ENABLED: 'false',
    ASSISTANT_PROJECT_REF: 'cycnichledvqbxevrwnt', ASSISTANT_PROVIDER: 'workers-ai',
    ASSISTANT_ENABLED: enabled, ASSISTANT_COMMUNITIES_ENABLED: communities, ASSISTANT_CATCHUP_ENABLED: catchup,
  };
}

export function verifyFeatureWorker(config, enabled, features = {}) {
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
  assert.equal(config.vars.ASSISTANT_COMMUNITIES_ENABLED, features.communities ?? 'false');
  assert.equal(config.vars.ASSISTANT_CATCHUP_ENABLED, features.catchup ?? 'false');
  assert.deepEqual(config.ai, { binding: 'ASSISTANT_AI' });
}

/** One observed older build omitted only its site origin. Routes are checked
 * independently before this function; no future build inherits this exception. */
export function verifyExistingLiveProvenance(health, deployment) {
  assert.equal(health.environment, 'development', 'Existing live site is no longer an early preview.');
  assert.equal(health.releaseStatus, 'configured', 'Current site backend is not configured.');
  const recovery = deployment?.versions?.length === 1 && deployment.versions[0].percentage === 100 && pinnedChatbotRecovery(health.build, {
    deploymentId: deployment.id, previousVersion: deployment.versions[0].version_id,
    worker: LIVE_WORKER, siteOrigin: LIVE_SITE, databaseOrigin: LIVE_DATABASE,
  });
  assert(health.build?.dirty === false || recovery, 'Current site was not built from clean committed source and is not the reviewed recovery target.');
  assert.match(health.build?.gitSha ?? '', /^[a-f0-9]{40}$/, 'Current site provenance lacks a Git SHA.');
  const legacyOrigin = health.build?.siteOrigin === null && pinnedLegacySource(health.build) && LEGACY_BASELINE_DEPLOYMENTS.has(deployment.id) &&
    deployment.versions?.length === 1 && deployment.versions[0].version_id === LEGACY_BASELINE_VERSION && deployment.versions[0].percentage === 100;
  assert(health.build?.siteOrigin === LIVE_SITE || legacyOrigin || recovery, 'Current site provenance has an unexpected origin.');
}

async function liveState() {
  const domains = await cloudflare('/workers/domains');
  for (const host of hosts) assert.equal(domains.find(row => row.hostname === host)?.service, LIVE_WORKER, 'Live route ownership changed.');
  const { deployments } = await cloudflare(`/workers/scripts/${LIVE_WORKER}/deployments`);
  const deployment = deployments[0];
  assert.equal(deployment.versions.length, 1, 'An in-progress traffic split needs operator review.');
  assert.equal(deployment.versions[0].percentage, 100, 'Current deployment must serve one version at 100 percent.');
  const health = await jsonRequest(`${LIVE_SITE}/api/health?release=${Date.now()}`, { cache: 'no-store' });
  console.log(JSON.stringify({ operation: 'live-health-check', environment: health.environment, releaseStatus: health.releaseStatus, source: health.build?.gitSha, gitTree: health.build?.gitTree, sourceSha256: health.build?.sourceSha256, configSha256: health.build?.configSha256, siteOrigin: health.build?.siteOrigin, dirty: health.build?.dirty, deploymentId: deployment.id, versions: deployment.versions.map(row => ({ version: row.version_id, percentage: row.percentage })) }));
  verifyExistingLiveProvenance(health, deployment);
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
  assert.equal(archive.questions?.length, 563, 'Original archive post count differs from baseline.');
  assert.equal(new Set(archive.questions.map(row => row.id)).size, 563, 'Original archive contains duplicate post IDs.');
  assert.equal(Object.values(archive.answersByQuestionId ?? {}).flat().length, 628, 'Original archive reply count differs from baseline.');
  assert.equal(archive.source?.importedItems, 563, 'Original archive import metadata differs from baseline.');
  assert.equal(archive.source?.commentCount, 628, 'Original archive reply metadata differs from baseline.');
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

function verifyFeatureManifestSource(manifest, source) {
  assert.equal(manifest.schemaVersion, 1, 'Unsupported feature build manifest.');
  assert.equal(manifest.dirty, false, 'Feature build manifest must record clean source.');
  assert.match(manifest.configSha256 ?? '', /^[a-f0-9]{64}$/, 'Feature build manifest lacks a configuration digest.');
  for (const field of ['gitSha', 'gitTree', 'sourceSha256', 'dirty']) {
    assert.equal(manifest[field], source[field], `Feature build manifest ${field} does not match release source.`);
  }
}

/** Vite config evaluation writes the ordinary manifest even during deploy's
 * --skip-build metadata inspection. Freeze the actual build result before that
 * can happen; deployment must never redefine its own expected provenance. */
export async function snapshotFeatureBuildProvenance(repository, expected) {
  const manifest = JSON.parse(await readFile(resolve(repository, '.cache/visaflow/build-provenance.json'), 'utf8'));
  verifyFeatureManifestSource(manifest, sourceProvenance(repository));
  assert.deepEqual(manifest, expected, 'Built provenance does not match the checked build environment.');
  const destination = resolve(repository, '.cache/visaflow/live-preview/build-provenance.json');
  await mkdir(resolve(repository, '.cache/visaflow/live-preview'), { recursive: true, mode: 0o700 });
  await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return manifest;
}

export async function readFeatureBuildProvenance(repository = root) {
  const manifest = JSON.parse(await readFile(resolve(repository, '.cache/visaflow/live-preview/build-provenance.json'), 'utf8'));
  verifyFeatureManifestSource(manifest, sourceProvenance(repository));
  return manifest;
}

/** Prove the deployed source is retained even if its original local commit was
 * never pushed: an identical tracked-source fingerprint in HEAD's ancestry is
 * equivalent evidence, not permission to accept approximately matching code. */
export function verifySourceAncestry(repository, build, baseline) {
  assert.match(build?.gitSha ?? '', /^[a-f0-9]{40}$/, 'Live source commit is missing.');
  assert.match(build?.sourceSha256 ?? '', /^[a-f0-9]{64}$/, 'Live tracked-source fingerprint is missing.');
  const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (build.dirty !== false) {
    assert(pinnedChatbotRecovery(build, baseline), 'Unreviewed dirty live source cannot establish ancestry.');
    git('merge-base', '--is-ancestor', build.gitSha, 'HEAD');
    verifyRecoveryFiles(repository);
    return { method: 'pinned-chatbot-recovery', liveSource: build.gitSha, previousVersion: baseline.previousVersion,
      sourceEquivalence: 'not-established', retainedBranding: true,
      rationale: 'Owner-authorized repair of exact observed misconfigured deployment; committed base and reviewed branding retained. Archive independently verified.' };
  }
  try {
    git('merge-base', '--is-ancestor', build.gitSha, 'HEAD');
    return { method: 'git-ancestor', liveSource: build.gitSha, ancestor: build.gitSha };
  } catch { /* An unpushed local commit may have an exact source-equivalent ancestor. */ }
  for (const ancestor of git('rev-list', 'HEAD').trim().split('\n')) {
    const entries = git('ls-tree', '-r', '-z', ancestor);
    const sourceEntries = entries.split('\0').filter(entry => entry.slice(entry.indexOf('\t') + 1) !== 'docs/release-review.json').join('\0');
    if (sha256(sourceEntries) === build.sourceSha256) return { method: 'exact-source-fingerprint', liveSource: build.gitSha, ancestor, sourceSha256: build.sourceSha256 };
  }
  // The owner authorized replacing this observed live preview with the reviewed
  // feature candidate. Its original local commit was never available remotely.
  // State the transition honestly; this is neither ancestry nor equivalence.
  if (pinnedLegacySource(build) && LEGACY_BASELINE_DEPLOYMENTS.has(baseline?.deploymentId) && baseline.previousVersion === LEGACY_BASELINE_VERSION && baseline.worker === LIVE_WORKER && baseline.siteOrigin === LIVE_SITE && baseline.databaseOrigin === LIVE_DATABASE) {
    return { method: 'pinned-legacy-replacement', liveSource: build.gitSha, previousVersion: LEGACY_BASELINE_VERSION, previousDeployment: baseline.deploymentId, sourceEquivalence: 'not-established', rationale: 'Authorized feature replacement; exact archive and active deployment remain independently checked.' };
  }
  throw new Error('Live source is not an ancestor and no exact tracked-source fingerprint exists in release history.');
}

export async function buildFeatureRelease(enabled, features = {}) {
  const provenance = sourceProvenance(root);
  assert.equal(provenance.dirty, false, 'Feature release requires committed, clean source.');
  if (process.env.GITHUB_SHA) assert.equal(provenance.gitSha, process.env.GITHUB_SHA);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  console.log(JSON.stringify(verifySourceAncestry(root, receipt.health.build, receipt)));
  const values = JSON.parse(await readFile(resolve(privateDirectory, 'public-build-values.json'), 'utf8'));
  const env = { ...process.env, ...featureEnvironment(values, enabled, features) };
  // Only deploy steps receive account credentials. Avoid accidentally bundling
  // runner secrets, service credentials or unrelated local AI provider settings.
  for (const key of Object.keys(env)) if (/TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL|DIRECT_URL|CLOUDFLARE_ACCOUNT_ID/.test(key)) delete env[key];
  checkedLiveArchive(root, env);
  await run(process.execPath, ['scripts/check-private-experiences.mjs'], env);
  const expectedProvenance = buildProvenance(root, env);
  await run(resolve(root, 'node_modules/.bin/vinext'), ['build'], env);
  await snapshotFeatureBuildProvenance(root, expectedProvenance);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.vars = { ...config.vars, ...featureEnvironment(values, enabled, features) };
  delete config.vars.CLOUDFLARE_ENV; delete config.vars.VISATHREADS_EXISTING_PREVIEW;
  config.ai = { binding: 'ASSISTANT_AI' };
  // Wrangler preserves existing secrets. Never download, serialize or replace them.
  verifyFeatureWorker(config, enabled, features);
  await writeFile(configPath, JSON.stringify(config, null, 2));
  await run(process.execPath, ['scripts/check-archive-bundle.mjs'], env);
  await run(process.execPath, ['scripts/check-bundle.mjs'], env);
}

export function verifyAssistantAcceptance(receipt, sourceSha, features = {}) {
  assert.equal(receipt?.schemaVersion, 1);
  assert.equal(receipt.sourceSha, sourceSha, 'Model acceptance must match the exact release commit.');
  assert.equal(receipt.provider, 'workers-ai');
  assert.equal(receipt.model, '@cf/openai/gpt-oss-120b');
  assert.equal(receipt.passed, true, 'Hosted model acceptance did not pass.');
  assert.equal(receipt.workerDeleted, true, 'Temporary evaluation Worker must be removed before release.');
  assert.equal(receipt.features?.posts, true);
  for (const feature of ['communities', 'catchup']) if (features[feature] === 'true') assert.equal(receipt.features?.[feature], true, `${feature} needs hosted model acceptance.`);
  assert.equal(receipt.repetitions, 3, 'Hosted acceptance requires three independent samples per case.');
  const requiredCases = ['direct-post-search', 'post-question', 'post-summary', 'public-question', 'community-question', 'community-catchup', 'community-catchup-partial', 'conflicting-reports', 'unsupported-policy', 'irrelevant-evidence', 'prompt-injection', 'multilingual-post', 'concise-question-relevance', 'conversation-topic-switch', 'long-post-tail-answer', 'short-followup-context', 'public-denied-outcome', 'public-negation-context', 'public-prompt-injection', 'public-unsupported-policy', 'public-conflicting-reports', 'public-original-language', 'public-multi-hop-context', 'public-ordinal-context'];
  assert(Array.isArray(receipt.cases) && receipt.cases.length === requiredCases.length && requiredCases.every(id => receipt.cases.some(row => row.id === id)), 'Every required hosted case must occur exactly once.');
  for (const row of receipt.cases) {
    assert.equal(row.model, receipt.model);
    assert.equal(row.passed, true, 'Every hosted case must pass.');
    assert(Array.isArray(row.samples) && row.samples.length === receipt.repetitions, 'Every hosted case must retain all three samples.');
    for (const sample of row.samples) {
      assert.equal(sample.id, row.id, 'Sample belongs to a different fixture.');
      assert.equal(sample.model, receipt.model, 'Sample belongs to a different model.');
      assert.equal(sample.passed, true, 'Every hosted sample must pass.');
      assert(Array.isArray(sample.checks) && sample.checks.length > 0 && sample.checks.every(check => typeof check.name === 'string' && check.name.length > 0 && check.passed === true), 'Every sample must retain passing semantic checks.');
    }
    const aggregate = row.samples.flatMap((sample, index) => sample.checks.map(check => ({ name: `sample_${index + 1}_${check.name}`, passed: check.passed })));
    assert.deepEqual(row.checks, aggregate, 'Aggregate checks must exactly retain every sample result.');
  }
  const age = Date.now() - Date.parse(receipt.createdAt);
  assert(age >= 0 && age < 60 * 60 * 1000, 'Hosted model acceptance is expired.');
}

export async function predeployFeatureCheck(enabled, features = {}, requireAcceptance = false) {
  if (requireAcceptance) assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Production feature deployment requires the reviewed main branch.');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const { deployment, health } = await liveState();
  assert.equal(deployment.id, receipt.deploymentId, 'Production changed since capture. Rebuild against the new live baseline.');
  assert.equal(health.build.gitSha, receipt.health.build.gitSha);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  await readFeatureBuildProvenance(root);
  verifyFeatureWorker(config, enabled, features);
  checkedLiveArchive(root, { ...config.vars, CLOUDFLARE_ENV: 'development', VISATHREADS_EXISTING_PREVIEW: 'true' });
  if (enabled === 'true' && requireAcceptance) verifyAssistantAcceptance(JSON.parse(await readFile(resolve(root, '.cache/visaflow/assistant-acceptance.json'), 'utf8')), sourceProvenance(root).gitSha, features);
  console.log('Live route, deployment baseline, archive and production-only assistant target verified.');
}

/** Read Wrangler's structured output, not console text or an arbitrary newest version.
 * Wrangler 4.147.0 emits this NDJSON entry after a completed deployment. */
export function uploadedFeatureVersion(text) {
  assert(typeof text === 'string' && text.length <= 1024 * 1024, 'Unexpected deployment output.');
  let rows;
  try { rows = text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)); }
  catch { throw new Error('Invalid structured Wrangler deployment output.'); }
  const deployments = rows.filter(row => row?.type === 'deploy');
  assert.equal(deployments.length, 1, 'Exactly one recorded deployment is required.');
  const deployed = deployments[0];
  assert.equal(deployed.version, 1, 'Unknown Wrangler deployment output format.');
  assert.equal(deployed.worker_name, LIVE_WORKER, 'Upload targeted a different Worker.');
  assert.match(deployed.version_id ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i, 'Upload did not record an exact Worker version.');
  return deployed.version_id;
}

export function verifyCurrentFeatureDeployment(deployment, uploadedVersion, baseline, recorded) {
  assert.match(uploadedVersion ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
  assert(deployment?.id && deployment.id !== baseline.deploymentId, 'Deployment did not change.');
  assert.equal(deployment.versions?.length, 1, 'A traffic split cannot be recorded or rolled back automatically.');
  assert.equal(deployment.versions[0].percentage, 100);
  assert.equal(deployment.versions[0].version_id, uploadedVersion, 'A different version is active; refuse to overwrite unrelated work.');
  if (recorded) assert.equal(deployment.id, recorded.id, 'A later deployment exists; automatic rollback would overwrite unrelated work.');
}

export async function recordFeatureDeployment() {
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const uploadedVersion = uploadedFeatureVersion(await readFile(deploymentOutputPath, 'utf8'));
  const { deployments } = await cloudflare(`/workers/scripts/${LIVE_WORKER}/deployments`);
  verifyCurrentFeatureDeployment(deployments[0], uploadedVersion, receipt);
  await writeFile(resolve(privateDirectory, 'deployed.json'), JSON.stringify(deployments[0]), { mode: 0o600 });
  console.log(JSON.stringify({ deployedVersion: uploadedVersion, rollbackVersion: receipt.previousVersion }));
}

export async function checkedRollbackVersion() {
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const uploadedVersion = uploadedFeatureVersion(await readFile(deploymentOutputPath, 'utf8'));
  let deployed;
  try { deployed = JSON.parse(await readFile(resolve(privateDirectory, 'deployed.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const { deployments } = await cloudflare(`/workers/scripts/${LIVE_WORKER}/deployments`);
  // A failed recording API call must not suppress rollback after a successful
  // upload. The CLI's exact version remains sufficient proof when no record exists.
  verifyCurrentFeatureDeployment(deployments[0], uploadedVersion, receipt, deployed);
  assert.match(receipt.previousVersion, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
  assert.notEqual(receipt.previousVersion, uploadedVersion);
  console.log(receipt.previousVersion);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const command = process.argv[2];
  const enabled = process.env.ASSISTANT_ENABLED ?? 'false';
  const features = { communities: process.env.ASSISTANT_COMMUNITIES_ENABLED ?? 'false', catchup: process.env.ASSISTANT_CATCHUP_ENABLED ?? 'false' };
  try {
    if (command === 'capture') await captureFeatureBaseline();
    else if (command === 'build') await buildFeatureRelease(enabled, features);
    else if (command === 'predeploy') await predeployFeatureCheck(enabled, features);
    else if (command === 'deploy-check') await predeployFeatureCheck(enabled, features, true);
    else if (command === 'record-deployment') await recordFeatureDeployment();
    else if (command === 'rollback-version') await checkedRollbackVersion();
    else throw new Error('Use capture, build, predeploy or deploy-check. This helper does not deploy.');
  } catch (error) {
    // Never expose assertion diffs containing recovered source or public config.
    const frame = error.stack?.split('\n').find(line => /\/scripts\/(?:production-feature-release|live-preview-archive|recover-worker-archive)\.mjs:\d+:\d+\)?$/.test(line.trim()));
    console.error(`Feature release blocked: ${error.message.split('\n')[0]}${frame ? ` [${frame.trim()}]` : ''}`); process.exitCode = 1;
  }
}

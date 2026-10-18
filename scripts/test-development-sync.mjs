import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveSource } from './archive-source.mjs';
import { DEV_SITE, DEV_DATABASE, DEV_WORKER, DEV_SYNC_DIRECTORY, checkedDevelopmentArchive } from './development-sync-archive.mjs';
import { developmentSyncEnvironment, uploadedDevelopmentVersion, verifyDevelopmentSyncWorker, verifyDevelopmentSyncSettings, verifySyncProductionSource } from './development-sync.mjs';
import { verifyCurrentFeatureDeployment } from './production-feature-release.mjs';
import { sha256, LIVE_SITE } from './live-preview-archive.mjs';
import { buildProvenance } from './build-provenance.mjs';

const sha = 'a'.repeat(40);
const uuid = '00000000-0000-4000-8000-000000000001';
const newVersion = '00000000-0000-4000-8000-000000000002';
const values = { NEXT_PUBLIC_SITE_URL: DEV_SITE, NEXT_PUBLIC_SUPABASE_URL: DEV_DATABASE, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_dev_fixture_key_1234567890', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'public-dev-captcha' };
function config() {
  const vars = developmentSyncEnvironment(values); delete vars.VISATHREADS_DEV_SYNC; delete vars.CLOUDFLARE_ENV;
  return { name: DEV_WORKER, workers_dev: false, routes: ['visa-central.com', 'www.visa-central.com'].map(pattern => ({ pattern, custom_domain: true })), vars };
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'visathreads-dev-sync-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, DEV_SYNC_DIRECTORY), { recursive: true });
  await mkdir(join(root, 'src/data'), { recursive: true });
  const bytes = '{"questions":[{"id":"dev-only"}],"answersByQuestionId":{},"source":{}}\n';
  await writeFile(join(root, 'src/data/api-archive.json'), bytes);
  await writeFile(join(root, 'wrangler.jsonc'), '{}');
  const receipt = { capturedAt: new Date().toISOString(), siteOrigin: DEV_SITE, databaseOrigin: DEV_DATABASE, worker: DEV_WORKER,
    deploymentId: uuid, previousVersion: uuid, source: sha, productionSource: sha, archiveSha256: sha256(bytes) };
  const save = () => writeFile(join(root, DEV_SYNC_DIRECTORY, 'receipt.json'), JSON.stringify(receipt));
  await save();
  return { root, receipt, save, env: { ...developmentSyncEnvironment(values), CI: 'true', GITHUB_SHA: sha } };
}

test('dev sync environment only copies public dev settings and keeps all launch, import and AI gates closed', () => {
  const env = developmentSyncEnvironment({ ...values, GROQ_API_KEY: 'not-real', SUPABASE_SERVICE_ROLE_KEY: 'not-real', DATABASE_URL: 'not-real', PUBLIC_LAUNCH_APPROVED: 'true', ASSISTANT_ENABLED: 'true', VISATHREADS_EXISTING_PREVIEW: 'true' });
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, DEV_DATABASE);
  assert.equal(env.NEXT_PUBLIC_SITE_URL, DEV_SITE);
  assert.equal(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, values.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  assert.equal(env.CLOUDFLARE_ENV, 'sandbox'); assert.equal(env.VISATHREADS_DEV_SYNC, 'true');
  for (const key of ['PUBLIC_LAUNCH_APPROVED', 'IMPORTED_CONTENT_APPROVED', 'APIFY_LIVE_FETCH_ENABLED', 'ASSISTANT_ENABLED', 'ASSISTANT_COMMUNITIES_ENABLED', 'ASSISTANT_CATCHUP_ENABLED']) assert.equal(env[key], 'false');
  for (const key of ['GROQ_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL', 'VISATHREADS_EXISTING_PREVIEW']) assert.equal(env[key], undefined);
  for (const change of [{ NEXT_PUBLIC_SITE_URL: LIVE_SITE }, { NEXT_PUBLIC_SUPABASE_URL: 'https://cycnichledvqbxevrwnt.supabase.co' }, { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_invalid' }]) assert.throws(() => developmentSyncEnvironment({ ...values, ...change }));
});

test('dev Worker checks reject prod routes, live-fetch, provider bindings and plaintext credentials', () => {
  verifyDevelopmentSyncWorker(config());
  verifyDevelopmentSyncWorker({ ...config(), services: [], kv_namespaces: [], durable_objects: { bindings: [] }, queues: { producers: [], consumers: [] } });
  for (const mutate of [
    c => { c.name = 'visaflow-dev'; }, c => { c.routes[0].pattern = 'visathreads.com'; }, c => { c.workers_dev = true; },
    c => { c.vars.NEXT_PUBLIC_SUPABASE_URL = 'https://cycnichledvqbxevrwnt.supabase.co'; }, c => { c.vars.ASSISTANT_ENABLED = 'true'; },
    c => { c.vars.PUBLIC_LAUNCH_APPROVED = 'true'; }, c => { c.vars.APIFY_LIVE_FETCH_ENABLED = 'true'; },
    c => { c.vars.GROQ_API_KEY = 'not-real'; }, c => { c.ai = { binding: 'AI' }; }, c => { c.services = [{ binding: 'PROD', service: 'visaflow-dev' }]; },
    c => { c.durable_objects = { bindings: [{ name: 'PROD', class_name: 'NotAllowed' }] }; },
    c => { c.unsafe = { bindings: [{ name: 'PROD', type: 'service', service: 'visaflow-dev' }] }; },
    c => { c.browser = { binding: 'BROWSER' }; }, c => { c.analytics_engine_datasets = [{ binding: 'PROD', dataset: 'prod' }]; },
  ]) { const value = config(); mutate(value); assert.throws(() => verifyDevelopmentSyncWorker(value)); }
});

test('same immutable source must already be live in production before dev sync', () => {
  const source = { gitSha: sha, gitTree: 'b'.repeat(40), sourceSha256: 'c'.repeat(64), dirty: false };
  const health = { environment: 'development', releaseStatus: 'configured', build: { ...source, siteOrigin: LIVE_SITE } };
  verifySyncProductionSource(health, source);
  for (const change of [{ gitSha: 'b'.repeat(40) }, { gitTree: 'a'.repeat(40) }, { sourceSha256: 'd'.repeat(64) }, { dirty: true }, { siteOrigin: DEV_SITE }]) assert.throws(() => verifySyncProductionSource({ ...health, build: { ...health.build, ...change } }, source));
  assert.throws(() => verifySyncProductionSource({ ...health, environment: 'production' }, source));
});

test('unknown existing dev settings fail closed rather than being silently overwritten', () => {
  const settings = { bindings: Object.entries(config().vars).map(([name, text]) => ({ type: 'plain_text', name, text })) };
  assert.equal(verifyDevelopmentSyncSettings(settings).NEXT_PUBLIC_SITE_URL, DEV_SITE);
  verifyDevelopmentSyncSettings({ bindings: [...settings.bindings, { name: 'GROQ_API_KEY', type: 'secret_text' }, { name: 'ASSETS', type: 'assets' }, { name: 'CF_VERSION_METADATA', type: 'version_metadata' }] });
  for (const binding of [{ name: 'EXTRA_SECURITY_FLAG', text: 'true', type: 'plain_text' }, { name: 'PUBLIC_LAUNCH_APPROVED', text: 'true', type: 'plain_text' }, { name: 'AI', type: 'ai' }, { name: 'PROD_DATABASE', type: 'hyperdrive' }]) assert.throws(() => verifyDevelopmentSyncSettings({ bindings: [...settings.bindings, binding] }));
});

test('CI retains synthetic data unless a fresh exact dev receipt authorizes the already-serving archive', async t => {
  const f = await fixture(t);
  assert.equal(archiveSource(f.root, { CI: 'true', NEXT_PUBLIC_APP_ENV: 'development' }), join(f.root, 'src/data/archive-fixture.json'));
  assert.equal(archiveSource(f.root, f.env), join(f.root, 'src/data/api-archive.json'));
  for (const change of [{ CLOUDFLARE_ENV: 'development' }, { NEXT_PUBLIC_APP_ENV: 'production' }, { NEXT_PUBLIC_SITE_URL: LIVE_SITE }, { NEXT_PUBLIC_SUPABASE_URL: 'https://cycnichledvqbxevrwnt.supabase.co' }, { VISATHREADS_EXISTING_PREVIEW: 'true' }, { GITHUB_SHA: 'b'.repeat(40) }]) assert.throws(() => checkedDevelopmentArchive(f.root, { ...f.env, ...change }));
  f.receipt.capturedAt = new Date(Date.now() - 91 * 60 * 1000).toISOString(); await f.save();
  assert.throws(() => checkedDevelopmentArchive(f.root, f.env), /expired/);
  f.receipt.capturedAt = new Date(Date.now() + 30_000).toISOString(); await f.save();
  assert.throws(() => checkedDevelopmentArchive(f.root, f.env), /expired/);
});

test('dev archive digest, receipt target and production source cannot be swapped', async t => {
  const f = await fixture(t);
  for (const change of [{ siteOrigin: LIVE_SITE }, { databaseOrigin: 'https://cycnichledvqbxevrwnt.supabase.co' }, { worker: 'visaflow-dev' }, { productionSource: 'b'.repeat(40) }, { archiveSha256: '0'.repeat(64) }]) {
    const original = { ...f.receipt }; Object.assign(f.receipt, change); await f.save();
    assert.throws(() => checkedDevelopmentArchive(f.root, f.env)); Object.assign(f.receipt, original);
  }
  await f.save(); const before = buildProvenance(f.root, f.env).configSha256;
  f.receipt.archiveSha256 = '0'.repeat(64); await f.save();
  assert.notEqual(buildProvenance(f.root, f.env).configSha256, before, 'Exact captured content contributes to build provenance');
});

test('rollback recording accepts only one exact dev upload and refuses unrelated subsequent deployments', () => {
  const row = { type: 'deploy', version: 1, worker_name: DEV_WORKER, version_id: newVersion };
  assert.equal(uploadedDevelopmentVersion(JSON.stringify(row)), newVersion);
  for (const output of ['', 'not-json', JSON.stringify({ ...row, worker_name: 'visaflow-dev' }), JSON.stringify({ ...row, version_id: 'latest' }), `${JSON.stringify(row)}\n${JSON.stringify(row)}`]) assert.throws(() => uploadedDevelopmentVersion(output));
  const captured = { deploymentId: uuid };
  const active = { id: newVersion, versions: [{ version_id: newVersion, percentage: 100 }] };
  verifyCurrentFeatureDeployment(active, newVersion, captured, active);
  assert.throws(() => verifyCurrentFeatureDeployment({ ...active, id: 'other-deployment' }, newVersion, captured, active));
  assert.throws(() => verifyCurrentFeatureDeployment({ ...active, versions: [{ version_id: uuid, percentage: 100 }] }, newVersion, captured));
});

test('workflow sync follows successful prod release at same SHA, with guarded rollback and metadata-only evidence', async () => {
  const workflow = await readFile(new URL('../.github/workflows/production-features.yml', import.meta.url), 'utf8');
  const sync = workflow.slice(workflow.indexOf('  sync-development:'));
  assert.match(sync, /needs: release/);
  assert.match(sync, /needs\.release\.result == 'success'/);
  assert.match(sync, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(sync, /group: visa-central-development/);
  assert(sync.indexOf('development-sync.mjs deploy-check') < sync.indexOf('vinext-cloudflare deploy'));
  assert.match(sync, /rollback-version[\s\S]*--name visathreads-sandbox/);
  assert.match(sync, /development-sync.mjs production-unchanged/);
  assert.match(sync, /steps\.rollback\.outcome == 'success'[\s\S]*development-sync.mjs verify-rollback/);
  const artifact = sync.slice(sync.indexOf('uses: actions/upload-artifact@v4'), sync.indexOf('- name: Remove recovered dev'));
  assert.match(artifact, /build-provenance\.json/); assert.match(artifact, /rollout-verification\.json/);
  assert.doesNotMatch(artifact, /api-archive|receipt\.json|public-build-values|src\/data|\*\*/);
  assert.match(sync, /if: always\(\)[\s\S]*rm -f src\/data\/api-archive\.json/);
});

// One reviewed dashboard release. Existing assistant acceptance, archive,
// provenance, deployment, and rollback gates remain mandatory and unchanged.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sourceProvenance } from './build-provenance.mjs';
import { LIVE_SITE, LIVE_DATABASE, LIVE_WORKER } from './live-preview-archive.mjs';

export const DASHBOARD_BASELINE = '9eca469b8d617df08c407a7041cce78921ca95cd';
export const DASHBOARD_BRANCH = 'refs/heads/release/dashboard-production-20261016';
export const DASHBOARD_PATHS = Object.freeze([
  'src/lib/analytics-types.ts', 'src/lib/analytics-server.ts',
  'src/components/OwnerAnalyticsDashboard.tsx', 'src/app/api/admin/analytics/route.ts',
  'src/app/admin/analytics/page.tsx', 'src/lib/search-visibility.ts',
  'src/app/sitemap.ts', 'src/app/robots.ts',
  'scripts/test-analytics.mjs', 'scripts/test-search-visibility.mjs',
  'tests/database/analytics.test.mjs',
  'supabase/migrations/20261016210135_owner_analytics_aggregates.sql',
  'src/middleware.ts', 'package.json',
  'docs/DASHBOARD_OPERATIONS.md', 'docs/dashboard-release-2026-10-16.json',
]);
export const DASHBOARD_TOOLING = Object.freeze([
  '.github/workflows/dashboard-release.yml', 'scripts/dashboard-release.mjs',
  'scripts/test-dashboard-release.mjs', 'scripts/smoke-dashboard-release.mjs',
]);
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, '.cache/visaflow/live-preview');
const receiptPath = resolve(directory, 'receipt.json');
const scopePath = resolve(directory, 'dashboard-scope.json');
const flags = Object.freeze({ posts: true, communities: false, catchup: false });
const features = Object.freeze({ provider: 'groq', communities: 'false', catchup: 'false' });

// Existing shared files are not a blanket permission to alter account/auth
// behavior. Their exact additive edits are independently checked.
export function verifyRestrictedDashboardChange(path, before, after) {
  if (path === 'src/middleware.ts') {
    const previous = '|owner|feedback|assistant)';
    assert.equal(before.split(previous).length, 2, 'Expected one sensitive-route expression.');
    assert.equal(after, before.replace(previous, '|owner|feedback|assistant|admin)'), 'Only admin noindex protection may change in middleware.');
  } else if (path === 'package.json') {
    const expected = JSON.parse(before);
    assert.equal(expected.scripts['test:analytics'], undefined, 'Analytics test script must be new.');
    expected.scripts['test:analytics'] = 'node --test scripts/test-analytics.mjs scripts/test-search-visibility.mjs';
    expected.scripts.test += ' && npm run test:analytics';
    assert.deepEqual(JSON.parse(after), expected, 'Only the analytics test script may change in package.json.');
  }
}

export function verifyDashboardSource(repository, { expectedSha, workflowSha, workflowRef, baselineSha = DASHBOARD_BASELINE } = {}) {
  assert.match(expectedSha ?? '', /^[a-f0-9]{40}$/, 'An immutable dashboard candidate SHA is required.');
  assert.equal(workflowSha, expectedSha, 'Workflow revision must be the exact requested candidate.');
  assert.equal(workflowRef, DASHBOARD_BRANCH, 'Only the dedicated dashboard branch may use this release.');
  const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const source = sourceProvenance(repository);
  assert.equal(source.gitSha, expectedSha, 'Checked-out source does not match the requested candidate.');
  assert.equal(source.dirty, false, 'Dashboard source must be committed and clean.');
  assert.notEqual(expectedSha, baselineSha, 'Dashboard candidate must contain reviewed changes.');
  git('merge-base', '--is-ancestor', baselineSha, expectedSha);
  git('merge-base', '--is-ancestor', expectedSha, 'refs/remotes/origin/main');
  const changedPaths = git('diff', '--name-only', '--no-renames', '-z', baselineSha, expectedSha).split('\0').filter(Boolean).sort();
  assert(changedPaths.includes('src/app/admin/analytics/page.tsx'), 'Dashboard page is required.');
  const allowed = new Set([...DASHBOARD_PATHS, ...DASHBOARD_TOOLING]);
  for (const path of changedPaths) {
    assert(allowed.has(path), `Non-dashboard change is forbidden: ${path}`);
    assert.match(git('ls-tree', expectedSha, '--', path), /^100644 blob [a-f0-9]{40}\t/, `Changed file must be a regular non-executable file: ${path}`);
    if (['src/middleware.ts', 'package.json'].includes(path)) {
      verifyRestrictedDashboardChange(path, git('show', `${baselineSha}:${path}`), git('show', `${expectedSha}:${path}`));
    }
  }
  for (const path of DASHBOARD_TOOLING) {
    assert.match(git('ls-tree', expectedSha, '--', path), /^100644 blob [a-f0-9]{40}\t/, `Release tooling must be a regular non-executable file: ${path}`);
    assert.equal(git('rev-parse', `${expectedSha}:${path}`), git('rev-parse', `refs/remotes/origin/main:${path}`), `Release tooling must exactly match merged main: ${path}`);
  }
  return { schemaVersion: 1, baselineSha, candidateSha: source.gitSha, gitTree: source.gitTree, sourceSha256: source.sourceSha256, changedPaths };
}

export function verifyDashboardBaseline(receipt, scope) {
  assert.equal(receipt?.health?.build?.gitSha, DASHBOARD_BASELINE, 'Live source changed; review this isolated dashboard release again.');
  assert.equal(receipt.health.build.dirty, false);
  assert.equal(scope.baselineSha, DASHBOARD_BASELINE);
  assert.equal(receipt.siteOrigin, LIVE_SITE);
  assert.equal(receipt.databaseOrigin, LIVE_DATABASE);
  assert.equal(receipt.worker, LIVE_WORKER);
  assert.equal(receipt.questionCount, 563);
  assert.equal(receipt.replyCount, 628);
}

export function verifyDashboardRuntime(settings, schedules) {
  assert(Array.isArray(settings?.bindings), 'Worker bindings were not returned.');
  const values = Object.fromEntries(settings.bindings.filter(row => row.type === 'plain_text').map(row => [row.name, row.text]));
  for (const [name, expected] of Object.entries({ APP_ENV: 'development', PUBLIC_LAUNCH_APPROVED: 'false', IMPORTED_CONTENT_APPROVED: 'false', APIFY_LIVE_FETCH_ENABLED: 'false', COMMUNITY_SOURCE_MODE: 'snapshot', NEXT_PUBLIC_SITE_URL: LIVE_SITE, NEXT_PUBLIC_SUPABASE_URL: LIVE_DATABASE, ASSISTANT_PROVIDER: 'groq', ASSISTANT_ENABLED: 'true', ASSISTANT_COMMUNITIES_ENABLED: 'false', ASSISTANT_CATCHUP_ENABLED: 'false', ASSISTANT_PROJECT_REF: 'cycnichledvqbxevrwnt' })) {
    assert.equal(values[name], expected, `Existing runtime setting changed: ${name}`);
  }
  assert.equal(values.GROQ_API_KEY, undefined, 'Provider credentials must remain stored secrets.');
  assert(settings.bindings.some(row => row.type === 'secret_text' && row.name === 'GROQ_API_KEY'), 'Existing provider secret must remain configured.');
  assert.deepEqual(schedules?.schedules, [], 'Schedules must remain stopped; do not alter them through this release.');
}

async function verifyLiveRuntime(expectedSource = DASHBOARD_BASELINE) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  assert(/^[a-f0-9]{32}$/.test(account ?? '') && token, 'Cloudflare credentials are required.');
  const read = async suffix => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${LIVE_WORKER}/${suffix}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    assert(response.ok, `Worker ${suffix} inspection failed (${response.status}).`);
    const data = await response.json();
    assert(data.success, `Worker ${suffix} inspection was not confirmed.`);
    return data.result;
  };
  const [settings, schedules] = await Promise.all([read('settings'), read('schedules')]);
  verifyDashboardRuntime(settings, schedules);
  const response = await fetch(`${LIVE_SITE}/api/assistant?dashboard=${Date.now()}`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200, 'Could not check existing assistant flags.');
  assert.equal(response.headers.get('x-visathreads-build'), expectedSource, 'Assistant flags belong to another live revision.');
  assert.deepEqual(await response.json(), flags, 'Existing assistant features changed.');
}

function candidateScope() {
  for (const [name, value] of Object.entries({ ASSISTANT_PROVIDER: 'groq', ASSISTANT_ENABLED: 'true', ASSISTANT_COMMUNITIES_ENABLED: 'false', ASSISTANT_CATCHUP_ENABLED: 'false' })) assert.equal(process.env[name], value, `Keep existing ${name}.`);
  return verifyDashboardSource(root, { expectedSha: process.env.DASHBOARD_CANDIDATE_SHA, workflowSha: process.env.GITHUB_SHA, workflowRef: process.env.GITHUB_REF });
}

async function checkedScope() {
  const scope = candidateScope();
  assert.deepEqual(JSON.parse(await readFile(scopePath, 'utf8')), scope, 'Dashboard scope changed after capture.');
  verifyDashboardBaseline(JSON.parse(await readFile(receiptPath, 'utf8')), scope);
  return scope;
}

export async function dashboardRelease(command) {
  if (command === 'check-source') { console.log(JSON.stringify(candidateScope())); return; }
  const { captureFeatureBaseline, buildFeatureRelease, predeployFeatureCheck, verifyAssistantAcceptance } = await import('./production-feature-release.mjs');
  if (command === 'capture') {
    const scope = candidateScope(); await verifyLiveRuntime(); await captureFeatureBaseline();
    verifyDashboardBaseline(JSON.parse(await readFile(receiptPath, 'utf8')), scope);
    await writeFile(scopePath, `${JSON.stringify(scope, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  } else if (command === 'build') {
    await checkedScope(); await buildFeatureRelease('true', features);
    const config = JSON.parse(await readFile(resolve(root, 'dist/server/wrangler.json'), 'utf8'));
    assert.deepEqual(config.triggers?.crons ?? [], [], 'Generated dashboard build must not start schedules.');
  } else if (command === 'deploy-check') {
    const scope = await checkedScope();
    // Byte-identical assistant source is NOT substituted for fresh acceptance.
    verifyAssistantAcceptance(JSON.parse(await readFile(resolve(root, '.cache/visaflow/assistant-acceptance.json'), 'utf8')), scope.candidateSha, features);
    await verifyLiveRuntime();
    // Narrow, merged immutable branch proof replaces only main-branch identity.
    await predeployFeatureCheck('true', features);
    const config = JSON.parse(await readFile(resolve(root, 'dist/server/wrangler.json'), 'utf8'));
    assert.deepEqual(config.triggers?.crons ?? [], [], 'Generated dashboard build must not start schedules.');
  } else if (command === 'verify-runtime') {
    const scope = await checkedScope(); await verifyLiveRuntime(scope.candidateSha);
    console.log('PASS exact dashboard runtime, unchanged assistant provider/flags and stopped schedules.');
  } else throw new Error('Use check-source, capture, build, deploy-check or verify-runtime. This helper does not deploy.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) dashboardRelease(process.argv[2]).catch(error => {
  // Do not serialize assertions that may contain remote config or user content.
  console.error(`Dashboard release blocked: ${error.message.split('\n')[0]}`); process.exitCode = 1;
});

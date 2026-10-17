import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LIVE_SITE } from './live-preview-archive.mjs';
import { readFeatureBuildProvenance } from './production-feature-release.mjs';

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
// Deliberately synthetic, correctly shaped and never signed by the project.
// This case must reach Auth, not merely exercise local header rejection.
const invalidSignature = [encode({ alg: 'HS256', typ: 'JWT' }), encode({ sub: '00000000-0000-4000-8000-000000000001', role: 'authenticated', aud: 'authenticated', iss: 'https://cycnichledvqbxevrwnt.supabase.co/auth/v1', iat: 0, exp: 4102444800 }), 'A'.repeat(43)].join('.');
export const DASHBOARD_DENIAL_CASES = Object.freeze([
  Object.freeze({ id: 'anonymous', token: null, category: 'sign-in-required' }),
  Object.freeze({ id: 'malformed-token', token: 'invalid-not-a-session', category: 'sign-in-required' }),
  Object.freeze({ id: 'invalid-signature', token: invalidSignature, category: 'invalid-session' }),
]);
const errorCategories = new Map([
  ['Sign in with the designated owner account.', 'sign-in-required'],
  ['Your session expired. Please sign in again.', 'invalid-session'],
  ['Owner access required.', 'owner-required'],
  ['Dashboard configuration is unavailable.', 'configuration-unavailable'],
  ['Account verification is temporarily unavailable.', 'account-verification-unavailable'],
  ['Metrics are unavailable. No zero values have been substituted.', 'metrics-unavailable'],
  ['Metrics are unavailable. Please retry; no zero values have been substituted.', 'metrics-unavailable'],
  ['Choose 7, 30 or 90 days.', 'invalid-period'],
]);

export async function verifyAnalyticsDenial(response, testCase, log = console.log) {
  let payload;
  try { payload = await response.json(); } catch { /* Never log raw error bodies. */ }
  const object = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  const category = object && typeof object.error === 'string' ? errorCategories.get(object.error) ?? 'unrecognized-response' : 'unrecognized-response';
  // Only case/status/allowlisted category reach logs; never a token or raw body.
  log(JSON.stringify({ case: testCase.id, status: response.status, category }));
  assert.equal(response.status, 401, `${testCase.id}: expected a confirmed 401, not a backend failure or authorization bypass.`);
  assert.equal(category, testCase.category, `${testCase.id}: denial did not come from its required verification stage.`);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert(object && object.metrics === undefined && object.imports === undefined && object.release === undefined, `${testCase.id}: denial must not contain private aggregates.`);
}

export async function runAnalyticsDenialChecks(fetcher = fetch, log = console.log) {
  for (const testCase of DASHBOARD_DENIAL_CASES) {
    const response = await fetcher(`${LIVE_SITE}/api/admin/analytics?days=30`, { headers: testCase.token ? { Authorization: `Bearer ${testCase.token}` } : {}, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000) });
    // A 403, 503 or unexpected result fails immediately. Do not retry to hide it.
    await verifyAnalyticsDenial(response, testCase, log);
  }
}

export async function runDashboardSmoke() {
const expected = await readFeatureBuildProvenance();
const request = path => fetch(`${LIVE_SITE}${path}`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000) });
const health = await request(`/api/health?dashboard=${Date.now()}`);
assert.equal(health.status, 200);
const value = await health.json();
assert.equal(value.build?.gitSha, expected.gitSha, 'Dashboard smoke hit another live revision.');
assert.equal(value.environment, 'development', 'Dashboard must not open the formal public launch.');

await runAnalyticsDenialChecks();
const dashboard = await request('/admin/analytics');
assert.equal(dashboard.status, 200);
assert.match(dashboard.headers.get('x-robots-tag') ?? '', /noindex/);
assert.match(dashboard.headers.get('cache-control') ?? '', /no-store/);
const html = await dashboard.text();
assert.match(html, /Owner dashboard|Owner analytics|Dashboard|Analytics/i, 'Dashboard shell must be present.');
assert(!/"(?:metrics|imports)"\s*:\s*\{/.test(html), 'Public dashboard HTML must not embed private aggregates.');

const sitemap = await request('/sitemap.xml');
assert.equal(sitemap.status, 200);
assert.match(sitemap.headers.get('content-type') ?? '', /xml/);
assert(!/<loc>/.test(await sitemap.text()), 'Existing preview must not publish crawlable sitemap entries.');
const robots = await request('/robots.txt');
assert.equal(robots.status, 200);
assert.match(await robots.text(), /Disallow:\s*\/(?:\r?\n|$)/);
const receipt = { schemaVersion: 1, candidateSha: expected.gitSha, verifiedAt: new Date().toISOString(), anonymousDenied: true, malformedTokenDenied: true, invalidSignatureDeniedByAuth: true, invalidSessionDenied: true, privateCacheHeaders: true, previewIndexingBlocked: true, realOwnerAcceptance: 'not-tested-by-this-read-only-smoke' };
await writeFile(resolve('.cache/visaflow/live-preview/dashboard-verification.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
console.log('PASS dashboard anonymous/malformed/invalid-signature denial, private headers, exact source and preview search protections. Real-owner acceptance remains separate.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runDashboardSmoke();

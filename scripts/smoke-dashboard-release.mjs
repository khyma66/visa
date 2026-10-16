import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LIVE_SITE } from './live-preview-archive.mjs';
import { readFeatureBuildProvenance } from './production-feature-release.mjs';

const expected = await readFeatureBuildProvenance();
const request = path => fetch(`${LIVE_SITE}${path}`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000) });
const health = await request(`/api/health?dashboard=${Date.now()}`);
assert.equal(health.status, 200);
const value = await health.json();
assert.equal(value.build?.gitSha, expected.gitSha, 'Dashboard smoke hit another live revision.');
assert.equal(value.environment, 'development', 'Dashboard must not open the formal public launch.');

for (const token of [null, 'invalid-not-a-session']) {
  const response = await fetch(`${LIVE_SITE}/api/admin/analytics?days=30`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, 401, 'Anonymous or invalid session must not access metrics.');
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  const payload = await response.json();
  assert.equal(payload.metrics, undefined, 'A denial must contain no metrics.');
  assert.equal(payload.imports, undefined, 'A denial must contain no import details.');
  assert.equal(payload.release, undefined, 'A denial must contain no release details.');
}
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
const receipt = { schemaVersion: 1, candidateSha: expected.gitSha, verifiedAt: new Date().toISOString(), anonymousDenied: true, invalidSessionDenied: true, privateCacheHeaders: true, previewIndexingBlocked: true, realOwnerAcceptance: 'not-tested-by-this-read-only-smoke' };
await writeFile(resolve('.cache/visaflow/live-preview/dashboard-verification.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
console.log('PASS dashboard anonymous/invalid-session denial, private headers, exact source and preview search protections. Real-owner acceptance remains separate.');

import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';

const origin = 'https://visa-central.com';
const request = (path, options = {}) => fetch(origin + path, { ...options, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
let health;
// A successful upload can precede edge propagation. Still require this exact
// commit; an older deployment must never count as a successful rollout.
for (let attempt = 0; attempt < 10; attempt++) {
  const healthResponse = await request('/api/health?deployment-check='+Date.now(), { cache: 'no-store' });
  assert.equal(healthResponse.status, 200);
  health = await healthResponse.json();
  if (!process.env.GITHUB_SHA || health.build.gitSha === process.env.GITHUB_SHA) break;
  if (attempt < 9) await setTimeout(5000);
}
assert.equal(health.build.siteOrigin, origin);
if (process.env.GITHUB_SHA) assert.equal(health.build.gitSha, process.env.GITHUB_SHA, 'Hosted source matches checked commit');
assert.equal(health.build.dirty, false, 'Deployment uses committed source');
assert.equal(health.releaseStatus, 'configured');
for (const path of ['/', '/login', '/signup', '/ask', '/experiences', '/experiences/new', '/explore', '/tags', '/news']) {
  const response = await request(path);
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('x-robots-tag') ?? '', /noindex/, 'Development stays out of search indexes');
  const html = await response.text();
  assert(!html.includes('aria-label="Ask VisaThreads assistant"'), 'Development has no AI header action');
}
assert.equal((await request('/assistant')).status, 404, 'Development has no assistant page');
const flags = await (await request('/api/assistant')).json();
assert.deepEqual(flags, { posts: false, communities: false, catchup: false });
const disabled = await request('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'ask', scope: { kind: 'public' }, question: 'test' }) });
assert.equal(disabled.status, 503, 'AI fails closed before authentication or inference');
for (const method of ['GET', 'POST']) assert.equal((await request('/api/communities/00000000-0000-4000-8000-000000000001/summary', { method })).status, 503, 'Legacy AI summaries are disabled too');
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), origin, gitSha: health.build.gitSha, pages: 9, ai: 'absent from dev UI and disabled at API' }));

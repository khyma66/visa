import assert from 'node:assert/strict';

const origin = 'https://visa-central.com';
const request = (path, options = {}) => fetch(origin + path, { ...options, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
const healthResponse = await request('/api/health');
assert.equal(healthResponse.status, 200);
const health = await healthResponse.json();
assert.equal(health.build.siteOrigin, origin);
if (process.env.GITHUB_SHA) assert.equal(health.build.gitSha, process.env.GITHUB_SHA, 'Hosted source matches checked commit');
assert.equal(health.build.dirty, false, 'Deployment uses committed source');
assert.equal(health.releaseStatus, 'configured');
for (const path of ['/', '/login', '/signup', '/ask', '/experiences', '/explore', '/tags', '/news']) {
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
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), origin, gitSha: health.build.gitSha, pages: 8, ai: 'absent from dev UI and disabled at API' }));

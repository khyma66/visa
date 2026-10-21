import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { TARGET, plan, canary, boundedBody } from './free-tier.mjs';

const sha = 'a'.repeat(40);
const healthy = { status: 'ok', service: 'visathreads', environment: 'development', releaseStatus: 'configured',
  build: { gitSha: sha, dirty: false, siteOrigin: TARGET.origin } };
function response(url) {
  const api = url.includes('/api/');
  const body = url.endsWith('/api/health') ? healthy : api ? { posts: false, communities: false, catchup: false } : '<html>VisaThreads</html>';
  return new Response(api ? JSON.stringify(body) : body, { headers: { 'content-type': api ? 'application/json' : 'text/html', 'x-robots-tag': 'noindex, nofollow' } });
}
const options = { expectedCommit: sha, pause: async () => {} };

test('10k plan refuses free-tier execution and counts every configured hold', () => {
  const result = plan('concurrent-10k');
  assert.equal(result.hostedLoadAllowed, false);
  assert(result.blockers.includes('CONNECTION_CEILING'));
  assert(result.blockers.includes('DELIVERY_RATE_CEILING'));
  assert.equal(result.modeled.messageWrites, 367500);
  assert.equal(result.modeled.recipientDeliveriesLowerBound, 1470000);
  assert.equal(result.measured.connected, 0);
});
test('small cohorts still require account, fixtures and implementation verification', () => {
  for (const profile of ['smoke-10', 'baseline-100']) {
    const result = plan(profile);
    assert.equal(result.hostedLoadAllowed, false);
    assert(!result.blockers.includes('CONNECTION_CEILING'));
    assert(result.blockers.includes('ACCOUNT_PLAN_AND_REMAINING_QUOTAS_UNVERIFIED'));
  }
});
test('production, alternate projects and lookalike hosts fail before any network access', async () => {
  let calls = 0;
  for (const target of [
    { ...TARGET, origin: 'https://visathreads.com' },
    { ...TARGET, origin: 'https://visa-central.com.evil.test' },
    { ...TARGET, origin: 'https://visa-central.com:443' },
    { ...TARGET, projectRef: 'cycnichledvqbxevrwnt' },
    { ...TARGET, databaseOrigin: 'https://cycnichledvqbxevrwnt.supabase.co' },
  ]) {
    assert.throws(() => plan('smoke-10', target));
    await assert.rejects(canary({ ...options, target, fetcher: () => { calls++; } }));
  }
  assert.equal(calls, 0);
});
test('canary sends exactly six sequential read-only requests without credentials', async () => {
  const calls = [];
  const result = await canary({ ...options, fetcher: async (url, init) => {
    calls.push(url); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit'); assert.equal(init.headers.Authorization, undefined);
    assert.equal(new URL(url).origin, TARGET.origin); return response(url);
  } });
  assert.equal(calls.length, 6); assert.equal(result.passed, true);
  assert.equal(result.measured.authenticated, 0);
  assert.equal(calls[0], calls.at(-1));
});
test('redirect, WAF, rate limit and malformed responses stop immediately without retries', async () => {
  for (const fake of [
    () => new Response('', { status: 302, headers: { location: 'https://visathreads.com' } }),
    () => new Response('Just a moment', { headers: { 'content-type': 'text/html', 'x-robots-tag': 'noindex' } }),
    () => new Response('', { status: 429 }),
    () => new Response('not-json', { headers: { 'content-type': 'application/json', 'x-robots-tag': 'noindex' } }),
    () => { throw new Error('sensitive-provider-detail'); },
  ]) {
    let calls = 0;
    const result = await canary({ ...options, fetcher: async () => { calls++; return fake(); } });
    assert.equal(result.passed, false); assert.equal(calls, 1);
    assert(!JSON.stringify(result).includes('sensitive-provider-detail'));
  }
});
test('deployment mismatch or dirty build never passes the canary', async () => {
  for (const build of [{ ...healthy.build, gitSha: 'b'.repeat(40) }, { ...healthy.build, dirty: true }]) {
    const result = await canary({ ...options, fetcher: async () => new Response(JSON.stringify({ ...healthy, build }),
      { headers: { 'content-type': 'application/json', 'x-robots-tag': 'noindex' } }) });
    assert.equal(result.passed, false); assert.equal(result.requests.length, 1);
  }
});
test('operator stop and abort issue no further requests', async () => {
  let calls = 0;
  const result = await canary({ ...options, stopped: () => calls === 1, fetcher: async url => { calls++; return response(url); } });
  assert.equal(calls, 1); assert.equal(result.passed, false);
  const aborted = await canary({ ...options, signal: AbortSignal.abort(), fetcher: async () => { calls++; } });
  assert.equal(calls, 1); assert.equal(aborted.passed, false);
});
test('large streaming bodies are rejected even without a content length', async () => {
  await assert.rejects(boundedBody(new Response('x'.repeat(2 * 1024 * 1024 + 1))), /byte limit/);
});
test('CLI blocked plans and unknown arguments exit nonzero', () => {
  for (const args of [['plan', 'concurrent-10k'], ['plan', 'typo'], ['canary', sha, '--force']]) {
    const child = spawnSync(process.execPath, [new URL('./free-tier.mjs', import.meta.url).pathname, ...args]);
    assert.notEqual(child.status, 0);
  }
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { LIVE_SITE, sha256 } from './live-preview-archive.mjs';
import { canonicalJson } from './recover-worker-archive.mjs';
import { assertHealthProvenance, smokeSite } from './smoke-site.mjs';

const receipt = JSON.parse(await readFile('.cache/visaflow/live-preview/receipt.json', 'utf8'));
const expected = JSON.parse(await readFile('.cache/visaflow/build-provenance.json', 'utf8'));
const request = (path, options = {}) => fetch(LIVE_SITE + path, { ...options, redirect: 'error', signal: AbortSignal.timeout(20_000), cache: 'no-store' });
let health;
for (let attempt = 0; attempt < 10; attempt++) {
  const response = await request(`/api/health?feature-release=${Date.now()}`);
  if (response.ok) { health = await response.json(); if (health.build?.gitSha === expected.gitSha) break; }
  if (attempt < 9) await setTimeout(5000);
}
assertHealthProvenance(health, expected);
assert.equal(health.environment, 'development', 'Launch state must remain the existing early preview.');
const feedResponse = await request('/api/community');
assert.equal(feedResponse.status, 200);
const feed = await feedResponse.json();
assert.equal(sha256(canonicalJson(feed)), receipt.publishedArchiveSha256, 'Published content changed during feature deployment.');
const flagsResponse = await request('/api/assistant');
assert.equal(flagsResponse.status, 200);
const features = { posts: process.env.ASSISTANT_ENABLED === 'true', communities: process.env.ASSISTANT_COMMUNITIES_ENABLED === 'true', catchup: process.env.ASSISTANT_CATCHUP_ENABLED === 'true' };
assert.deepEqual(await flagsResponse.json(), features);
const assistant = await request('/assistant'); assert.equal(assistant.status, 200);
assert.match(assistant.headers.get('x-robots-tag') ?? '', /noindex/);
await assistant.body?.cancel();
const question = JSON.stringify({ mode: 'ask', scope: { kind: 'public' }, question: 'What experiences have members reported?' });
const anonymous = await request('/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: question });
assert.equal(anonymous.status, 401, 'Anonymous inference must be denied.');
assert.match(anonymous.headers.get('cache-control') ?? '', /private, no-store/);
await anonymous.body?.cancel();
const crossOrigin = await request('/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://untrusted.example' }, body: question });
assert.equal(crossOrigin.status, 403, 'Cross-origin inference must be denied.');
await crossOrigin.body?.cancel();
const invalidToken = await request('/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${'invalid-test'.repeat(4)}` }, body: question });
assert.equal(invalidToken.status, 401, 'An invalid session must be denied before inference.');
await invalidToken.body?.cancel();
await smokeSite(LIVE_SITE, expected);
console.log(JSON.stringify({ status: 'verified', source: expected.gitSha, features, archiveUnchanged: true, questions: receipt.questionCount, replies: receipt.replyCount, signedInAcceptance: 'requires real user session; not established by this smoke check' }));

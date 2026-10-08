import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const smokeRoutes = ['/', '/login', '/signup', '/account/recovery', '/account/update-password', '/messages', '/moderation', '/community-safety', '/privacy', '/terms', '/contact', '/tags', '/explore', '/my-communities', '/communities/new', '/news', '/api/health'];

export function assertHealthProvenance(health, expected) {
  assert.match(expected?.gitSha ?? '', /^[a-f0-9]{40}$/, 'Expected manifest must identify an exact Git commit');
  assert.match(expected?.gitTree ?? '', /^[a-f0-9]{40}$/, 'Expected manifest must identify an exact Git tree');
  assert.match(expected?.sourceSha256 ?? '', /^[a-f0-9]{64}$/, 'Expected manifest must identify the source fingerprint');
  assert.match(expected?.configSha256 ?? '', /^[a-f0-9]{64}$/, 'Expected manifest must identify the build configuration');
  assert.equal(expected.dirty, false, 'Smoke verification requires a clean reviewed build');
  assert.equal(health.releaseStatus, 'configured', 'Connected backend config or release approval is missing');
  assert.equal(health.build?.schemaVersion, 1, 'Deployed build has no supported provenance');
  for (const field of ['gitSha', 'gitTree', 'sourceSha256', 'configSha256', 'appEnvironment', 'siteOrigin', 'dirty']) {
    assert.equal(health.build?.[field], expected[field], `Deployed ${field} does not match the reviewed build`);
  }
  assert.equal(health.environment, expected.appEnvironment, 'Runtime environment does not match the build');
}

export async function smokeSite(origin, expected) {
const site = new URL(origin);
assert(['https:', 'http:'].includes(site.protocol) && site.pathname === '/' && !site.search && !site.hash && !site.username && !site.password, 'Pass the exact site origin to test.');
if (expected.appEnvironment === 'production') assert.equal(site.origin, expected.siteOrigin, 'Production smoke target must match the configured public origin');
let firstNonce;
for (const path of smokeRoutes) {
  const response = await fetch(new URL(path,origin), { signal:AbortSignal.timeout(15000),redirect:'error' });
  assert.equal(response.status,200,`${path}: unexpected status`);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff',`${path}: missing nosniff`);
  assert.equal(response.headers.get('x-frame-options'),'DENY',`${path}: framing allowed`);
  assert.equal(response.headers.get('referrer-policy'),'no-referrer',`${path}: referrer policy missing`);
  if (/^\/(login|signup|account|messages|moderation)/.test(path)) {
    assert(response.headers.get('cache-control')?.includes('no-store'),`${path}: must not cache private pages`);
    assert(response.headers.get('x-robots-tag')?.includes('noindex'),`${path}: must not index private pages`);
  }
  const body = await response.text();
  if (response.headers.get('content-type')?.includes('text/html')) {
    const policy=response.headers.get('content-security-policy') ?? '';
    const nonce=policy.match(/'nonce-([^']+)'/)?.[1];
    if(path==='/') firstNonce=nonce;
    assert(nonce,`${path}: missing script nonce policy`);
    assert(!policy.split(';').find((part)=>part.trim().startsWith('script-src '))?.includes('unsafe-inline'),`${path}: inline script bypass`);
    assert(response.headers.get('cache-control')?.includes('no-store'),`${path}: nonce HTML must not be cached`);
    for(const header of ['cdn-cache-control','cloudflare-cdn-cache-control']) {
      const value=response.headers.get(header);
      assert(!value || value.includes('no-store') || value.includes('private'),`${path}: shared cache override on nonce HTML`);
    }
    const scripts=[...body.matchAll(/<script\b([^>]*)>/gi)];
    assert(scripts.length>0,`${path}: no framework scripts found`);
    for (const [,attributes] of scripts) assert(attributes.includes(`nonce="${nonce}"`),`${path}: script/header nonce mismatch`);
  }
  assert(!body.includes('sb_secret_'),`${path}: private key prefix in page`);
  if (path==='/api/health') {
    assert(response.headers.get('cache-control')?.includes('no-store'),'Build provenance must not be cached');
    assertHealthProvenance(JSON.parse(body),expected);
  }
  console.log(`PASS ${path}`);
}
const injected=await fetch(new URL('/',origin),{signal:AbortSignal.timeout(15000),redirect:'error',headers:{
  'content-security-policy':"script-src 'nonce-attacker'",'x-nonce':'attacker',
  'x-middleware-subrequest':'middleware:middleware:middleware:middleware:middleware',
}});
assert.equal(injected.status,200);
const secondNonce=injected.headers.get('content-security-policy')?.match(/'nonce-([^']+)'/)?.[1];
assert(secondNonce && secondNonce!==firstNonce && secondNonce!=='attacker','Nonce must be fresh and not caller-controlled');
await injected.body?.cancel();
console.log('PASS fresh nonce and untrusted-header replacement');
const missing = await fetch(new URL('/a-page-that-does-not-exist',origin),{signal:AbortSignal.timeout(15000),redirect:'error'});
assert.equal(missing.status,404,'Unknown route must be a real 404');
await missing.body?.cancel();
console.log('PASS real 404 and exact build provenance; smoke checks do not verify email delivery or production capacity.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert(process.argv[2] && process.argv[3], 'Usage: node scripts/smoke-site.mjs <site-origin> <build-provenance.json> [expected-git-sha]');
  const expected = JSON.parse(readFileSync(resolve(process.argv[3]), 'utf8'));
  const workflowSha = process.argv[4] ?? process.env.GITHUB_SHA;
  if (workflowSha) assert.equal(expected.gitSha, workflowSha, 'Build manifest does not match the workflow commit');
  await smokeSite(process.argv[2], expected);
}

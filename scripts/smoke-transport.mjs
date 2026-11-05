import assert from 'node:assert/strict';

/** Probe only synthetic URLs, without cookies, auth headers or user data. */
export async function verifySecureTransport(origin, fetchImpl = fetch) {
  const base = new URL(origin);
  assert(['visathreads.com','visa-central.com'].includes(base.hostname) && base.protocol === 'https:' && !base.username && !base.password && !base.port && base.pathname==='/' && !base.search && !base.hash, 'Unexpected transport-check origin');
  for (const path of ['/login?next=%2Fnotifications', '/notifications']) {
    const insecure = new URL(path, base); insecure.protocol = 'http:';
    const response = await fetchImpl(insecure, { redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    try {
      assert([301,302,307,308].includes(response.status), 'HTTP must redirect before serving application content');
      assert.equal(new URL(response.headers.get('location'), insecure).href, new URL(path, base).href, 'Upgrade must preserve environment, path and return URL');
    } finally { await response.body?.cancel(); }
  }
  console.log('PASS HTTP upgrades to HTTPS before login and notifications.');
}

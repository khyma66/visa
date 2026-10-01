import { test } from 'node:test';
import assert from 'node:assert/strict';

const routes = [
  ['r2-upload', 'POST'], ['r2-delete', 'DELETE'], ['r2-fetch', 'GET'],
  ['queue/cluster', 'POST'], ['cache/get', 'GET'],
];

for (const [path, method] of routes) {
  test(`${method} /api/${path} cannot forward crafted input or reveal secrets`, async () => {
    const handler = (await import(`../../src/app/api/${path}/route.ts`))[method];
    const previousFetch = globalThis.fetch;
    const previousSecret = process.env.WORKER_SECRET;
    const previousR2Secret = process.env.CF_R2_ACCESS_KEY_SECRET;
    const sentinel = 'synthetic-test-secret-do-not-return';
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; throw new Error('Unexpected outbound request'); };
    process.env.WORKER_SECRET = sentinel;
    process.env.CF_R2_ACCESS_KEY_SECRET = sentinel;
    try {
      const request = new Proxy({}, { get() { throw new Error('Disabled routes must not parse input'); } });
      const response = await handler(request);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const text = await response.text();
      assert.match(JSON.parse(text).error, /temporarily unavailable/);
      assert.ok(!text.includes(sentinel));
      assert.equal(fetchCalled, false);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousSecret === undefined) delete process.env.WORKER_SECRET;
      else process.env.WORKER_SECRET = previousSecret;
      if (previousR2Secret === undefined) delete process.env.CF_R2_ACCESS_KEY_SECRET;
      else process.env.CF_R2_ACCESS_KEY_SECRET = previousR2Secret;
    }
  });
}

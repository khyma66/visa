import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const source = await readFile(new URL('../src/lib/supabase/client.ts', import.meta.url), 'utf8');
const stub = moduleUrl('export function createClient(){throw new Error("Capability checks must not create an authenticated client")}');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  .replace(/from ['"]@supabase\/supabase-js['"]/, `from ${JSON.stringify(stub)}`);
let instance = 0;

async function fixture(configured = true) {
  const names = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
  const prior = names.map(name => process.env[name]);
  if (configured) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fixture.supabase.invalid';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'fixture-public-key';
  } else names.forEach(name => delete process.env[name]);
  try { return await import(moduleUrl(`${compiled}\n// isolated test instance ${++instance}`)); }
  finally {
    names.forEach((name, index) => {
      if (prior[index] === undefined) delete process.env[name];
      else process.env[name] = prior[index];
    });
  }
}

test('concurrent capability checks share one bounded public request and return no user or token data', async t => {
  const { getAuthMethods } = await fixture();
  const controller = new AbortController();
  const timeouts = [];
  t.mock.method(AbortSignal, 'timeout', milliseconds => { timeouts.push(milliseconds); return controller.signal; });
  let resolve;
  const calls = [];
  t.mock.method(globalThis, 'fetch', (url, options) => {
    calls.push({ url, options });
    return new Promise(finish => { resolve = finish; });
  });
  const first = getAuthMethods(), second = getAuthMethods(), third = getAuthMethods();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://fixture.supabase.invalid/auth/v1/settings');
  assert.deepEqual(calls[0].options.headers, { apikey: 'fixture-public-key' });
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.signal, controller.signal);
  assert.deepEqual(timeouts, [8000]);
  resolve(Response.json({ external: { google: true, phone: false, github: true }, access_token: 'must-not-be-returned', user: { email: 'private@example.invalid' } }));
  for (const result of await Promise.all([first, second, third])) {
    assert.deepEqual(result, { google: true, phone: false });
    assert(!JSON.stringify(result).includes('must-not-be-returned'));
  }
});

test('successful capabilities are cached for sixty seconds and refreshed at expiry', async t => {
  const { getAuthMethods } = await fixture();
  let now = 1000, calls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ external: { google: ++calls === 1, phone: calls > 1 } }));
  assert.deepEqual(await getAuthMethods(), { google: true, phone: false });
  now += 59999;
  assert.deepEqual(await getAuthMethods(), { google: true, phone: false });
  assert.equal(calls, 1);
  now += 1;
  assert.deepEqual(await getAuthMethods(), { google: false, phone: true });
  assert.equal(calls, 2, 'Provider changes must be discovered once the short cache expires');
});

test('HTTP, malformed JSON and network failures are not cached and allow a fresh retry', async t => {
  const failures = [
    async () => new Response('temporarily unavailable', { status: 503 }),
    async () => new Response('not-json', { headers: { 'content-type': 'application/json' } }),
    async () => { throw new TypeError('network offline'); },
  ];
  for (const fail of failures) {
    const { getAuthMethods } = await fixture();
    let calls = 0;
    const fetch = t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      return calls === 1 ? fail() : Response.json({ external: { google: true, phone: true } });
    });
    await assert.rejects(getAuthMethods());
    assert.deepEqual(await getAuthMethods(), { google: true, phone: true });
    assert.equal(calls, 2);
    fetch.mock.restore();
  }
});

test('a timed-out shared request rejects all waiting readers and clears for retry', async t => {
  const { getAuthMethods } = await fixture();
  const controller = new AbortController();
  let deadlines = 0;
  t.mock.method(AbortSignal, 'timeout', () => ++deadlines === 1 ? controller.signal : new AbortController().signal);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => {
    calls++;
    assert.equal(signal.aborted, false, 'A retried request needs a fresh timeout signal');
    if (calls > 1) return Promise.resolve(Response.json({ external: { google: true } }));
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const first = assert.rejects(getAuthMethods(), { name: 'TimeoutError' });
  const second = assert.rejects(getAuthMethods(), { name: 'TimeoutError' });
  controller.abort(new DOMException('Timed out', 'TimeoutError'));
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(await getAuthMethods(), { google: true, phone: false });
  assert.equal(calls, 2);
});

test('only explicit true capabilities enable providers; missing configuration performs no fetch', async t => {
  const { getAuthMethods } = await fixture();
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ external: { google: 'true', phone: 1 } }));
  assert.deepEqual(await getAuthMethods(), { google: false, phone: false });
  const unconfigured = await fixture(false);
  assert.deepEqual(await unconfigured.getAuthMethods(), { google: false, phone: false });
  assert.equal(fetch.mock.callCount(), 1);
});

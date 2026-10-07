import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Use only fixture settings and fake HTTP, never a hosted auth service.
const source = (await readFile(new URL('../src/lib/supabase/client.ts', import.meta.url), 'utf8'))
  .replace('process.env.NEXT_PUBLIC_SUPABASE_URL', JSON.stringify('https://auth.visathreads.example'))
  .replace('process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', JSON.stringify('fixture-publishable-key'));
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  .replace(/from ['"]@supabase\/supabase-js['"]/, `from 'data:text/javascript,export function createClient(){throw new Error("Unexpected client creation");}'`);
const { getAuthMethods } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('provider discovery uses the configured branded origin and only exposes Google', async t => {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ external: { google: true, apple: true } }));
  });
  assert.deepEqual(await getAuthMethods(), { google: true });
  assert.equal(request.url, 'https://auth.visathreads.example/auth/v1/settings');
  assert.equal(request.options.headers.apikey, 'fixture-publishable-key');
});

test('provider discovery times out instead of leaving Google checking forever', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  t.mock.method(globalThis, 'fetch', (_url, options) => new Promise((_resolve, reject) => {
    signal = options.signal;
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const rejected = assert.rejects(getAuthMethods(), { name: 'AbortError' });
  t.mock.timers.tick(7999); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); await rejected; assert.equal(signal.aborted, true);
});

test('leaving the page cancels provider discovery and removes its abort listener', async t => {
  const controller = new AbortController();
  const remove = t.mock.method(controller.signal, 'removeEventListener');
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const rejected = assert.rejects(getAuthMethods(controller.signal), { name: 'AbortError' });
  controller.abort(); await rejected;
  assert.equal(remove.mock.calls.length, 1);
});

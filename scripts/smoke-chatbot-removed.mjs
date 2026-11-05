import { verifyDestinationRoutes } from './smoke-destination-routing.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Exercise the actual built router with no provider or database credentials.
const origin = 'http://127.0.0.1:18795';
// Production routes otherwise make Wrangler impersonate the public HTTP host,
// then rewrite its HTTPS redirect back to this local URL indefinitely.
const server = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev',
  '--config', 'dist/server/wrangler.json', '--local', '--ip', '127.0.0.1', '--port', '18795',
  '--local-upstream', new URL(origin).host, '--upstream-protocol', 'http', '--log-level', 'error'],
{ env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'ignore', 'ignore'] });
const localFetch = (path, options = {}) => fetch(origin + path, { ...options, redirect: 'manual', credentials: 'omit' });
let exited = false;
server.once('exit', () => { exited = true; });
const closed = once(server, 'close');
try {
  let ready = false, lastStatus;
  for (let attempt = 0; attempt < 100 && !exited; attempt++) {
    try {
      const response = await localFetch('/api/health', { signal: AbortSignal.timeout(1000) });
      lastStatus = response.status;
      await response.body?.cancel();
      if (response.ok) { ready = true; break; }
    } catch { /* Local Worker is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, `Built Worker did not become ready. Last local HTTP status: ${lastStatus ?? 'unavailable'}.`);
  for (const method of ['GET', 'POST']) for (const accept of ['application/json', 'application/x-ndjson']) {
    const response = await localFetch('/api/assistant', { method, signal: AbortSignal.timeout(5000), headers: { Accept: accept } });
    assert.equal(response.status, 410);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    assert.deepEqual(await response.json(), { posts: false, communities: false, catchup: false, code: 'removed' });
  }
  const removed = await localFetch('/assistant', { signal: AbortSignal.timeout(10000) });
  assert.equal(removed.status, 404);
  await removed.body?.cancel();
  for (const path of ['/us/en', '/us/en/news', '/login']) {
    const response = await localFetch(path, { signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, path);
    assert(!/href="\/assistant"|Ask VisaThreads|VisaThreads AI/.test(await response.text()), path);
  }
  await verifyDestinationRoutes(origin);
  console.log('PASS built router: chatbot page absent, API permanently retired, normal pages available.');
} finally {
  if (!exited) server.kill('SIGTERM');
  const force = setTimeout(() => { if (!exited) server.kill('SIGKILL'); }, 5000);
  try { await closed; } finally { clearTimeout(force); }
}

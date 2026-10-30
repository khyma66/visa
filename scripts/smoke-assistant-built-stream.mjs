import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Exercise the complete built Vinext router in workerd, not just the route function.
// Local origins are always denied before authentication, database access or inference.
const origin = 'http://127.0.0.1:18795';
const server = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev',
  '--config', 'dist/server/wrangler.json', '--local', '--ip', '127.0.0.1', '--port', '18795', '--log-level', 'error'],
{ env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'ignore', 'ignore'] });
let exited = false;
server.once('exit', () => { exited = true; });
const closed = once(server, 'close');
try {
  let ready = false;
  for (let attempt = 0; attempt < 100 && !exited; attempt++) {
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.ok) { ready = true; break; }
    } catch { /* The local worker is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, 'Built Worker did not become ready for its local streaming check.');
  const response = await fetch(`${origin}/api/assistant`, { method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { Accept: 'application/x-ndjson', 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'ask', scope: { kind: 'public' }, question: 'Synthetic local streaming check' }) });
  assert.equal(response.status, 200, 'Application router rejected the streaming response.');
  assert.match(response.headers.get('content-type') ?? '', /^application\/x-ndjson/);
  assert.match(response.headers.get('cache-control') ?? '', /private, no-store/);
  const frames = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0], { type: 'progress', stage: 'request' });
  assert.equal(frames[1].type, 'complete');
  assert.equal(frames[1].status, 503);
  assert.equal(frames[1].value.code, 'unavailable');
  console.log('PASS built application router streams progress and a safe local-origin denial.');
} finally {
  if (!exited) server.kill('SIGTERM');
  const force = setTimeout(() => { if (!exited) server.kill('SIGKILL'); }, 5000);
  try { await closed; } finally { clearTimeout(force); }
}

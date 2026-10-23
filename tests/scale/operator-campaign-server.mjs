// One-use loopback key handoff for the local operator campaign. Never logs keys.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { checkEvidence, UUID } from './multiuser-core.mjs';

const resume100 = process.argv.length === 3 && process.argv[2] === '--resume-100';
assert(process.argv.length === 2 || resume100, 'Only --resume-100 is supported');

const publicKey = process.env.VISAFLOW_MULTIUSER_PUBLIC_KEY;
assert(/^sb_publishable_[\w-]{20,}$/.test(publicKey ?? ''), 'Dev publishable key required');
const local = JSON.parse(await readFile('.local/multiuser/local-protocol-100.json', 'utf8'));
assert(local.passed === true && local.cleanupVerified === true && local.authenticated === 100 &&
  Date.now() - Date.parse(local.executedAt) < 86400000, 'Fresh local 100-user pass required before requesting a key');
const evidence = JSON.parse(await readFile('.local/multiuser/limits.json', 'utf8'));
checkEvidence(evidence, resume100 ? 100 : 10);
if (resume100) {
  assert(UUID.test(evidence.previousRunId ?? '') && evidence.previousStage?.users === 50 &&
    evidence.previousStage.passed === true && evidence.previousStage.cleanupVerified === true,
    'Verified cleaned 50-user stage required before requesting a key');
  const prior = `.local/multiuser/${evidence.previousRunId}`;
  const [manifest, result, cleanup] = await Promise.all(['manifest.json', 'result.json', 'cleanup.json']
    .map(name => readFile(`${prior}/${name}`, 'utf8').then(JSON.parse)));
  assert(manifest.runId === evidence.previousRunId && result.runId === evidence.previousRunId &&
    cleanup.runId === evidence.previousRunId && manifest.state === 'cleaned' &&
    manifest.users.length === 50 && result.passed === true &&
    result.applicationCommit === evidence.applicationCommit && cleanup.passed === true,
    'The referenced 50-user result and cleanup must match the current dev deployment');
}
const provider = await fetch('https://status.supabase.com/api/v2/summary.json',
  { signal: AbortSignal.timeout(10000), redirect: 'error' }).then(r => {
  assert(r.ok, 'Supabase status unavailable'); return r.json();
});
assert.equal(provider.status?.indicator, 'none', 'Supabase reports a service impact');
assert(!(provider.incidents ?? []).some(i => ['investigating', 'identified'].includes(i.status)),
  'Supabase has an active unresolved incident');
const token = randomBytes(24).toString('hex');
let used = false;
let origin;
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'GET' && req.url === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><head><title>VisaFlow test handoff</title></head><body><main><h1>VisaFlow dev test</h1><p>Transfer the existing dev Supabase secret key to the local test runner once.</p><form method="post" action="/start"><input type="hidden" name="token" value="${token}"><label>Dev secret key <input type="password" name="key" autocomplete="off" required pattern="sb_secret_[A-Za-z0-9_-]{20,}"></label><button type="submit">Start test</button></form></main></body></html>`);
    return;
  }
  if (req.method !== 'POST' || req.url !== '/start' || used || req.headers.origin !== origin ||
      !/^application\/x-www-form-urlencoded(?:;|$)/.test(req.headers['content-type'] ?? '')) {
    res.writeHead(403); res.end('Request refused'); return;
  }
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1000) { res.writeHead(413); res.end('Request too large'); return; }
    chunks.push(chunk);
  }
  const data = new URLSearchParams(Buffer.concat(chunks).toString());
  const key = data.get('key');
  if (data.get('token') !== token || !/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(key ?? '')) {
    res.writeHead(403); res.end('Invalid local handoff'); return;
  }
  used = true;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Local test started. This page has no report; see the Codex task.');
  server.close();
  const child = spawn(process.execPath, ['tests/scale/operator-campaign.mjs', ...(resume100 ? ['--resume-100'] : [])], {
    cwd: process.cwd(), env: { ...process.env, VISAFLOW_MULTIUSER_ADMIN_KEY: key,
      VISAFLOW_MULTIUSER_ENCRYPTION_KEY: randomBytes(32).toString('hex') },
    stdio: 'inherit',
  });
  child.once('error', () => { console.error('Campaign process could not start'); process.exitCode = 1; });
  child.once('close', code => { process.exitCode = code ?? 1; });
});
server.listen(0, '127.0.0.1', () => {
  origin = `http://127.0.0.1:${server.address().port}`;
  console.log(JSON.stringify({ localHandoff: origin }));
});
setTimeout(() => { if (!used) { server.close(); process.exitCode = 1; } }, 5 * 60_000).unref();

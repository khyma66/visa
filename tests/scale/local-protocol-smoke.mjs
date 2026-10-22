// Optional Docker-backed protocol test. It never contacts the hosted dev project.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { newManifest, checkCount, checkOwned, networkBudget } from './multiuser-core.mjs';
import { hostedRun } from './multiuser.mjs';
import { cleanup } from './multiuser-cleanup.mjs';

process.env.VISAFLOW_LOCAL_PROTOCOL_TEST = '1';
assert(process.argv.length <= 3, 'Supply at most one local cohort size');
const count = Number(process.argv[2] ?? 4);
checkCount(count);
const env = Object.fromEntries(execFileSync(process.env.VISAFLOW_LOCAL_SUPABASE_CLI ?? 'supabase', ['status', '--workdir', '.local/supabase-protocol', '-o', 'env'],
  { encoding: 'utf8' }).trim().split('\n').map(line => {
  const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).replace(/^"|"$/g, '')];
}));
const origin = env.API_URL;
assert.equal(origin, 'http://127.0.0.1:55431', 'Isolated local stack required');
assert(/^sb_publishable_/.test(env.PUBLISHABLE_KEY) && /^sb_secret_/.test(env.SECRET_KEY));
const controller = new AbortController();
const budget = networkBudget({ signal: controller.signal, expectedOrigin: origin,
  intervalMs: 20, authIntervalMs: 100, maxRequests: 3000 });
const admin = createClient(origin, env.SECRET_KEY, { global: { fetch: budget.fetch },
  auth: { persistSession: false, autoRefreshToken: false } });
const cleanupBudget = networkBudget({ expectedOrigin: origin, intervalMs: 20,
  authIntervalMs: 100, maxRequests: 1000 });
const cleanupAdmin = createClient(origin, env.SECRET_KEY, { global: { fetch: cleanupBudget.fetch },
  auth: { persistSession: false, autoRefreshToken: false } });
const manifest = newManifest(count, { serverAssignedIds: true });
const passwords = Object.fromEntries(manifest.users.map(u => [u.email, randomBytes(24).toString('base64url')]));
let result, cleaned, provisionFailed = false, lastProgress = '';
try {
  for (const fixture of manifest.users) {
    const created = await admin.auth.admin.createUser({ email: fixture.email, password: passwords[fixture.email], email_confirm: true,
      user_metadata: { first_name: 'Synthetic', last_name: 'Tester' },
      app_metadata: { visaflow_test_run: manifest.runId, visaflow_test_purpose: 'free-tier-multiuser' } });
    if (created.error) throw new Error(`Local Auth create failed: ${created.error.code ?? created.error.status}`);
    checkOwned(created.data.user, fixture, manifest.runId);
    fixture.id = created.data.user.id;
  }
  manifest.state = 'provisioned';
  result = await hostedRun({ manifest, passwords, createClient, budget, signal: controller.signal,
    progress: ({ authenticated, subscribed, completedPairs }) => {
      const progress = `${Math.floor(authenticated / 10)}:${Math.floor(completedPairs / 10)}`;
      if (count >= 10 && progress !== lastProgress) {
        lastProgress = progress;
        console.log(JSON.stringify({ localProgress: true, authenticated, subscribed, completedPairs }));
      }
    },
    stop: () => controller.abort(), clientOrigin: origin, clientPublicKey: env.PUBLISHABLE_KEY });
} catch {
  provisionFailed = true;
} finally {
  if (manifest.state === 'provisioning') manifest.state = 'provisioning-failed';
  cleaned = await cleanup(cleanupAdmin, manifest);
}
const latencies = (result?.deliveries ?? []).map(d => d.observedAndReadMs).sort((a, b) => a - b);
const percentile = p => latencies.length ? latencies[Math.ceil(latencies.length * p) - 1] : null;
const report = { localProtocol: true, backend: origin, runId: manifest.runId, requestedUsers: count,
  executedAt: new Date().toISOString(), passed: result?.passed === true && cleaned?.passed === true,
  authenticated: result?.authenticated ?? 0,
  peakSubscribed: result?.peakSubscribed ?? 0, pairs: result?.pairs.length ?? 0, deliveries: result?.deliveries.length ?? 0,
  posts: result?.posts ?? 0, replies: result?.replies ?? 0, votes: result?.votes ?? 0,
  distinctSenders: result?.distinctSenders ?? 0, distinctRecipients: result?.distinctRecipients ?? 0,
  allSubscribedSeconds: result?.allInboxesReadyThrough ? Math.floor((Date.parse(result.allInboxesReadyThrough) - Date.parse(result.allInboxesReadyAt)) / 1000) : null,
  deliveryAndReadMs: { p50: percentile(0.5), p95: percentile(0.95) },
  securityPairsPassed: (result?.pairs ?? []).filter(p => p.outsiderDenied && p.idempotencyVerified && p.blockedSendDenied).length,
  httpRequests: budget.stats.requests, cleanupRequests: cleanupBudget.stats.requests,
  failurePhase: provisionFailed ? 'local-provision-or-run' : result?.failurePhase, failureCode: result?.failureCode,
  cleanupVerified: cleaned?.passed === true, cleanupFailurePhase: cleaned?.failurePhase };
await mkdir('.local/multiuser', { recursive: true, mode: 0o700 });
await writeFile(`.local/multiuser/local-protocol-${count}.json`, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;

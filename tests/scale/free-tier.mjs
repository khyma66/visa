// Operator-side tooling only. No credentials, hosted writes, or load execution.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export const TARGET = Object.freeze({
  origin: 'https://visa-central.com', projectRef: 'ppdwysmeistjxzjpmxyk',
  databaseOrigin: 'https://ppdwysmeistjxzjpmxyk.supabase.co', worker: 'visathreads-sandbox',
});
// Published ceilings, not account-specific available quota or execution approval.
export const PUBLISHED = Object.freeze({
  checkedOn: '2026-10-21', realtimeConnections: 200, realtimeEventsPerSecond: 100,
  joinsPerSecond: 100, realtimeMessagesPerMonth: 2_000_000,
  monthlyActiveUsers: 50_000, databaseMB: 500, egressGB: 5,
  workerRequestsPerDay: 100_000, workerCpuMs: 10,
  sources: Object.freeze([
    'https://supabase.com/docs/guides/realtime/limits',
    'https://supabase.com/pricing',
    'https://developers.cloudflare.com/workers/platform/limits/',
  ]),
});
export const PROFILES = Object.freeze({
  'smoke-10': Object.freeze([{ users: 10, seconds: 60 }]),
  'baseline-100': Object.freeze([{ users: 10, seconds: 60 }, { users: 100, seconds: 300 }]),
  'concurrent-10k': Object.freeze([
    { users: 1000, seconds: 300 }, { users: 2500, seconds: 300 },
    { users: 5000, seconds: 600 }, { users: 10000, seconds: 1800 },
  ]),
});

export function validateTarget(target) {
  for (const [name, value] of Object.entries(TARGET)) assert.equal(target?.[name], value, `Disallowed ${name}`);
}

export function plan(profile, target = TARGET) {
  validateTarget(target);
  assert(Object.hasOwn(PROFILES, profile), 'Unknown profile');
  const stages = PROFILES[profile];
  const peak = Math.max(...stages.map(s => s.users));
  // Model from the supplied blueprint: one write per identity per minute.
  // Two inbox recipients + two active conversation recipients = four deliveries.
  // Excludes joins, read-receipt invalidations, reconnects and other workload.
  const writes = stages.reduce((n, s) => n + s.users * s.seconds / 60, 0);
  const blockers = [];
  if (peak > PUBLISHED.realtimeConnections) blockers.push('CONNECTION_CEILING');
  if (peak / 60 * 4 > PUBLISHED.realtimeEventsPerSecond) blockers.push('DELIVERY_RATE_CEILING');
  blockers.push('ACCOUNT_PLAN_AND_REMAINING_QUOTAS_UNVERIFIED', 'AUTH_FIXTURES_AND_CLEANUP_UNVERIFIED', 'REALTIME_RUNNER_NOT_IMPLEMENTED');
  return {
    schemaVersion: 1, kind: 'planning-only', target, profile, publishedLimits: PUBLISHED,
    stages, maxDistinctIdentities: peak,
    modeled: {
      configuredHoldSeconds: stages.reduce((n, s) => n + s.seconds, 0),
      messageWrites: writes, recipientDeliveriesLowerBound: writes * 4,
      peakWritesPerSecond: peak / 60, peakRecipientDeliveriesPerSecond: peak / 60 * 4,
    },
    exclusions: ['setup', 'transitions between holds', 'cleanup', 'retries', 'read receipts', 'other actions', 'background traffic'],
    hostedLoadAllowed: false, blockers,
    measured: { provisioned: 0, authenticated: 0, connected: 0, subscribed: 0, active: 0 },
    conclusion: peak > 200 ? '10,000 concurrent Realtime users are not supported by the published Free tier.'
      : 'Below the connection ceiling does not prove available quota or capacity. Hosted load remains blocked.',
  };
}

const ROUTES = Object.freeze(['/api/health', '/', '/login', '/messages', '/api/assistant', '/api/health']);
const MAX_BYTES = 2 * 1024 * 1024;

export async function boundedBody(response) {
  assert(response.body, 'Missing response body');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    assert(Number(response.headers.get('content-length') || 0) <= MAX_BYTES, 'Response byte limit exceeded');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      assert(bytes <= MAX_BYTES, 'Response byte limit exceeded');
      chunks.push(value);
    }
    return { text: Buffer.concat(chunks).toString('utf8'), bytes };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

// Six sequential GETs only. This is an availability canary, NOT a load test.
export async function canary({ target = TARGET, expectedCommit, signal,
  stopped = () => false, fetcher = fetch, pause = delay } = {}) {
  validateTarget(target);
  assert(/^[a-f0-9]{40}$/.test(expectedCommit ?? ''), 'An exact expected deployed commit is required');
  const report = { schemaVersion: 1, kind: 'public-read-only-canary', target,
    startedAt: new Date().toISOString(), expectedCommit, passed: false, requests: [],
    measured: { provisioned: 0, authenticated: 0, connected: 0, subscribed: 0, active: 0 },
    limitations: ['No browser execution', 'No authenticated actions', 'No database health check', 'No capacity or zero-cost claim'],
  };
  const deadline = AbortSignal.timeout(90_000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    for (const path of ROUTES) {
      assert(!stopped(), 'Operator stop requested');
      combined.throwIfAborted();
      const started = performance.now();
      const row = { path, status: null, bytes: 0, ms: 0, passed: false };
      report.requests.push(row);
      try {
        const response = await fetcher(target.origin + path, {
          method: 'GET', redirect: 'error', credentials: 'omit',
          headers: { Accept: path.startsWith('/api/') ? 'application/json' : 'text/html' },
          signal: AbortSignal.any([combined, AbortSignal.timeout(12_000)]),
        });
        row.status = response.status;
        if (response.status !== 200 || !/\bnoindex\b/i.test(response.headers.get('x-robots-tag') ?? '')) {
          await response.body?.cancel();
          throw new Error('Unexpected status or missing development noindex header');
        }
        const body = await boundedBody(response); row.bytes = body.bytes;
        const type = response.headers.get('content-type') ?? '';
        if (path.startsWith('/api/')) {
          assert(/^application\/json(?:;|$)/i.test(type), 'Expected JSON, not a challenge page');
          const data = JSON.parse(body.text);
          if (path === '/api/health') {
            assert.equal(data.service, 'visathreads');
            assert.equal(data.environment, 'development');
            assert.equal(data.status, 'ok');
            assert.equal(data.releaseStatus, 'configured');
            assert.equal(data.build?.siteOrigin, TARGET.origin);
            assert.equal(data.build?.gitSha, expectedCommit, 'Deployed source changed');
            assert.equal(data.build?.dirty, false);
          } else assert.deepEqual(data, { posts: false, communities: false, catchup: false });
        } else {
          assert(/^text\/html(?:;|$)/i.test(type));
          assert(/VisaThreads/i.test(body.text), 'Missing application identity');
          assert(!/cf-chl-|Just a moment|Checking your browser/i.test(body.text), 'Challenge response');
          assert(!body.text.includes('cycnichledvqbxevrwnt.supabase.co'), 'Production backend in dev HTML');
        }
        row.passed = true;
      } finally { row.ms = Math.round(performance.now() - started); }
      if (report.requests.length < ROUTES.length) await pause(1000, undefined, { signal: combined });
    }
    report.passed = true;
  } catch {
    // No response bodies, URLs supplied by a server, tokens or errors with secrets.
    report.failure = 'Canary stopped or failed validation; inspect failed route and dev service logs.';
  }
  report.finishedAt = new Date().toISOString();
  return report;
}

async function main(args) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const [command, value, ...extra] = args;
  assert(!extra.length, 'Unexpected arguments');
  assert(['plan', 'canary'].includes(command), 'Use plan PROFILE or canary EXPECTED_DEPLOYED_SHA');
  if (command === 'plan') {
    const result = plan(value);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 2; // Never mistake a blocked plan for execution approval.
    return;
  }
  const output = resolve(root, '.local/scale'); mkdirSync(output, { recursive: true, mode: 0o700 });
  const lock = resolve(output, 'canary.lock');
  // Exclusive file creation prevents overlapping canaries in this checkout.
  const { open, unlink } = await import('node:fs/promises');
  const handle = await open(lock, 'wx', 0o600);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const result = await canary({ expectedCommit: value, signal: controller.signal,
      stopped: () => existsSync(resolve(output, 'STOP')) });
    result.runId = randomUUID();
    result.harnessCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    result.harnessDirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
    result.configurationHash = createHash('sha256').update(JSON.stringify({ target: TARGET, routes: ROUTES, expectedCommit: value, maxBytes: MAX_BYTES })).digest('hex');
    const path = resolve(output, `${result.runId}.json`);
    writeFileSync(path, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ passed: result.passed, requests: result.requests.length, report: path }));
    if (!result.passed) process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    await handle.close(); await unlink(lock);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch(() => { console.error('Scale tool refused execution. Check arguments, expected commit, and .local/scale/canary.lock.'); process.exitCode = 1; });

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { assertHealthProvenance } from './smoke-site.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = value => /^[a-f0-9]{40}$/.test(value ?? '') ? value : value ? 'invalid' : null;
const safeType = value => ['application/json', 'application/javascript', 'text/javascript', 'text/css', 'text/html'].includes(value?.split(';')[0].trim().toLowerCase()) ? value.split(';')[0].trim().toLowerCase() : 'other';
const safeCache = value => ['private', 'no-store', 'no-cache', 'public', 'immutable'].filter(token => value?.toLowerCase().split(',').some(part => part.trim() === token)).join(', ');

export class RolloutFailure extends Error {
  constructor(code, check, retryable = false) { super(`${check}: ${code}`); this.code = code; this.check = check; this.retryable = retryable; }
}

/** Only fixed diagnostics: no response bodies, query URLs, auth, or error text. */
function responseMetadata(check, response) {
  const ray = response.headers.get('cf-ray');
  const vinext = response.headers.get('x-vinext-build-id');
  const edgeCache = response.headers.get('cf-cache-status');
  return { check, status: response.status, build: sha(response.headers.get('x-visathreads-build')),
    contentType: safeType(response.headers.get('content-type')), cacheControl: safeCache(response.headers.get('cache-control')),
    cfRay: /^[a-f0-9]{16,32}-[A-Z]{3}$/.test(ray ?? '') ? ray : null,
    vinextBuildId: /^[a-f0-9]{7,64}$/.test(vinext ?? '') ? vinext : null,
    cfCacheStatus: ['HIT', 'MISS', 'BYPASS', 'DYNAMIC', 'EXPIRED', 'STALE', 'UPDATING', 'REVALIDATED'].includes(edgeCache) ? edgeCache : null };
}

export function verifyRolloutHealth(health, expected, previous, check) {
  const fields = ['schemaVersion', 'gitSha', 'gitTree', 'sourceSha256', 'configSha256', 'appEnvironment', 'siteOrigin', 'dirty'];
  const exactPrevious = previous?.build && fields.every(key => health?.build?.[key] === previous.build[key])
    && health?.environment === previous.environment && health?.releaseStatus === previous.releaseStatus;
  if (exactPrevious && health.build.gitSha !== expected.gitSha) throw new RolloutFailure('captured-previous-build', check, true);
  try { assertHealthProvenance(health, expected); }
  catch { throw new RolloutFailure('provenance-mismatch', check); }
}

export function createRolloutProbe({ origin, expected, previous, signal, record, fetchImpl = fetch }) {
  const request = async (check, path, options = {}, { status = 200, denial = false, marked = false } = {}) => {
    signal.throwIfAborted();
    const url = new URL(path, origin);
    assert.equal(url.origin, origin, 'Rollout probes must stay on the exact public origin');
    let response;
    try {
      response = await fetchImpl(url, { ...options, cache: 'no-store', redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000), ...(options.signal ? [options.signal] : [])]) });
    } catch {
      record({ check, status: null, build: null, contentType: null, cacheControl: null });
      throw new RolloutFailure(signal.aborted ? 'deadline' : 'network-unavailability', check, !signal.aborted);
    }
    const metadata = responseMetadata(check, response);
    record(metadata);
    const reject = async (code, retryable = false) => {
      await response.body?.cancel().catch(() => {});
      throw new RolloutFailure(code, check, retryable);
    };
    // Authorization success is never a readiness retry, regardless of version.
    if (denial && response.status >= 200 && response.status < 300) await reject('unauthorized-success');
    // A SHA header alone cannot prove every field of the captured old build.
    if (metadata.build && metadata.build !== expected.gitSha) await reject('foreign-build');
    if (response.status !== status) {
      if (!metadata.build && [404, 503].includes(response.status)) await reject('unmarked-unavailability', true);
      await reject('unexpected-status');
    }
    if (marked && metadata.build !== expected.gitSha) await reject('missing-build-marker');
    if (url.pathname === '/api/health') {
      assert(response.headers.get('cache-control')?.includes('no-store'), 'Build provenance must not be cached');
      try {
        const health = await response.clone().json();
        record({ check: `${check}:source`, source: sha(health?.build?.gitSha) });
        verifyRolloutHealth(health, expected, previous, check);
      } catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
    }
    return response;
  };
  // The original smokeSite assertions run unchanged through this observing fetch.
  const siteFetch = (url, options) => {
    const path = new URL(url, origin).pathname;
    return request(`site:${path}`, url, options, { status: path === '/a-page-that-does-not-exist' ? 404 : 200 });
  };
  return { request, siteFetch };
}

export async function probeRolloutHealth(probe, phase) {
  for (const [kind, path] of [['bare', '/api/health'], ['fresh', `/api/health?smoke-provenance=${randomUUID()}`]]) {
    const response = await probe.request(`health:${phase}:${kind}`, path);
    await response.body?.cancel();
  }
}

/** Public build files only; never request hidden Vite metadata, server files or maps. */
export async function publicClientAssets(directory) {
  const assets = [];
  const walk = async (path, prefix = '') => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const relative = prefix + entry.name;
      assert(/^[A-Za-z0-9_./@+-]+$/.test(relative), 'Unexpected public asset filename');
      if (entry.isDirectory()) await walk(join(path, entry.name), `${relative}/`);
      else if (entry.isFile() && (/\.(?:js|css)$/.test(relative) || /(?:^|\/)(?:entry-?manifest|asset-?manifest|manifest)(?:-[A-Za-z0-9_-]+)?\.json$/.test(relative) || relative === 'vinext-client-entry-manifest.json')) {
        const bytes = await readFile(join(path, entry.name));
        assets.push({ path: `/${relative}`, sha256: digest(bytes), size: bytes.length,
          type: relative.endsWith('.css') ? 'css' : relative.endsWith('.json') ? 'json' : 'js' });
      }
      else assert(!entry.isSymbolicLink(), 'Symlinked public build assets are not accepted');
    }
  };
  await walk(directory);
  assert(assets.some(asset => asset.type === 'js'), 'Built client JavaScript assets are missing');
  assert(assets.length <= 1000, 'Unexpectedly large public client asset inventory');
  return assets.sort((a, b) => a.path.localeCompare(b.path));
}

export async function verifyClientAssets(probe, assets, { concurrency = 6 } = {}) {
  assert(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 8);
  let cursor = 0;
  let failure;
  const workers = Array.from({ length: Math.min(concurrency, assets.length) }, async () => {
    while (!failure && cursor < assets.length) {
      const asset = assets[cursor++];
      try {
        const response = await probe.request(`asset:${asset.path}`, asset.path);
        const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        const expectedTypes = { js: ['application/javascript', 'text/javascript'], css: ['text/css'], json: ['application/json'] };
        assert(expectedTypes[asset.type]?.includes(type), 'Asset must have its actual JavaScript/CSS/JSON type, not HTML fallback');
        const bytes = new Uint8Array(await response.arrayBuffer());
        assert.equal(bytes.length, asset.size, 'Public asset byte length changed');
        assert.equal(digest(bytes), asset.sha256, 'Public asset content changed');
      } catch (error) {
        // A concurrent integrity failure must never be hidden by an earlier404.
        if (!failure || (failure instanceof RolloutFailure && failure.retryable)) failure = error;
      }
    }
  });
  await Promise.all(workers);
  if (failure) throw failure;
}

/** Only complete consecutive rounds count; every failed round is retained. */
export async function verifyStableRollout({ expected, previous, runRound, persist,
  maxRounds = 6, deadlineMs = 120_000, delayMs = 5000, now = Date.now, wait = delay }) {
  assert(Number.isInteger(maxRounds) && maxRounds >= 2 && maxRounds <= 6);
  assert(Number.isFinite(deadlineMs) && deadlineMs > 0 && deadlineMs <= 120_000);
  assert(Number.isFinite(delayMs) && delayMs >= 0 && delayMs <= 5000);
  assert.match(expected.gitSha, /^[a-f0-9]{40}$/);
  assert.match(previous?.build?.gitSha ?? '', /^[a-f0-9]{40}$/);
  const started = now();
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new RolloutFailure('deadline', 'rollout')); }, deadlineMs);
  });
  const report = { schemaVersion: 1, source: expected.gitSha, previousSource: previous.build.gitSha,
    startedAt: new Date(started).toISOString(), completedAt: null, passed: false, failure: null, rounds: [] };
  let consecutive = 0;
  const save = () => persist(JSON.parse(JSON.stringify(report)));
  try {
    for (let round = 1; round <= maxRounds; round++) {
      const row = { round, startedAt: new Date(now()).toISOString(), completedAt: null, passed: false, retryable: false, failure: null, checks: [], lastSource: null };
      report.rounds.push(row);
      let open = true;
      const record = metadata => {
        if (!open) return;
        row.checks.push(metadata);
        if (/^[a-f0-9]{40}$/.test(metadata.source ?? metadata.build ?? '')) row.lastSource = metadata.source ?? metadata.build;
      };
      try {
        if (now() - started >= deadlineMs) throw new RolloutFailure('deadline', 'rollout');
        await Promise.race([runRound({ signal: controller.signal, record }), deadline]);
        if (now() - started >= deadlineMs) throw new RolloutFailure('deadline', 'rollout');
        row.passed = true;
        consecutive++;
      } catch (error) {
        consecutive = 0;
        row.retryable = error instanceof RolloutFailure && error.retryable;
        row.failure = { check: error instanceof RolloutFailure ? error.check : 'assertion', code: error instanceof RolloutFailure ? error.code : 'assertion-failed' };
      } finally {
        open = false;
        row.completedAt = new Date(now()).toISOString();
        await save();
      }
      if (!row.passed && !row.retryable) throw new RolloutFailure(row.failure.code, row.failure.check);
      if (controller.signal.aborted || now() - started >= deadlineMs) throw new RolloutFailure('deadline', 'rollout');
      if (consecutive >= 2) { report.passed = true; return report; }
      if (round < maxRounds) await Promise.race([wait(delayMs, undefined, { signal: controller.signal }), deadline]);
    }
    throw new RolloutFailure('stable-rounds-exhausted', 'rollout');
  } catch (error) {
    report.failure = { check: error instanceof RolloutFailure ? error.check : 'assertion', code: error instanceof RolloutFailure ? error.code : 'assertion-failed' };
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
    report.completedAt = new Date(now()).toISOString();
    await save();
  }
}

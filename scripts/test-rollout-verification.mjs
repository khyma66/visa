import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRolloutProbe, probeRolloutHealth, publicClientAssets, verifyClientAssets, verifyRolloutHealth, verifyStableRollout, RolloutFailure } from './rollout-verification.mjs';
import { PLAYBOOK_GUIDE_CHECKS, verifyPlaybookPages } from './smoke-playbook.mjs';

const origin = 'https://visathreads.com';
const expected = { schemaVersion: 1, gitSha: 'a'.repeat(40), gitTree: 'b'.repeat(40), sourceSha256: 'c'.repeat(64), configSha256: 'd'.repeat(64), appEnvironment: 'development', siteOrigin: origin, dirty: false };
const current = { environment: 'development', releaseStatus: 'configured', build: expected };
const previous = { environment: 'development', releaseStatus: 'configured', build: { ...expected, gitSha: 'e'.repeat(40), gitTree: 'f'.repeat(40), sourceSha256: '1'.repeat(64), configSha256: '2'.repeat(64), siteOrigin: null, dirty: true } };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const response = (status = 200, { marker = expected.gitSha, type = 'application/json', body = '{}', cache = 'private, no-store', extra = {} } = {}) => new Response(body, { status, headers: { 'content-type': type, 'cache-control': cache, ...(marker === null ? {} : { 'x-visathreads-build': marker }), ...extra } });
function probe(fetchImpl) {
  const records = [], controller = new AbortController();
  return { records, controller, ...createRolloutProbe({ origin, expected, previous, signal: controller.signal, record: row => records.push(row), fetchImpl }) };
}
async function sequence(outcomes) {
  let count = 0;
  const saved = [], waits = [];
  const options = { expected, previous, delayMs: 0,
    persist: report => { saved.push(report); }, wait: async ms => { waits.push(ms); },
    runRound: async ({ record }) => { record({ check: 'last', status: 200, build: expected.gitSha }); const outcome = outcomes[count++]; if (outcome instanceof Error) throw outcome; } };
  try { const result = await verifyStableRollout(options); return { result, count, saved, waits }; }
  catch (error) { return { error, count, saved, waits }; }
}

test('complete transient failure then two passes retains the failure and every round', async () => {
  const out = await sequence([new RolloutFailure('unmarked-unavailability', 'cross-origin-denial', true), true, true]);
  assert.equal(out.result.passed, true); assert.equal(out.count, 3);
  assert.deepEqual(out.result.rounds.map(row => row.passed), [false, true, true]);
  assert.equal(out.result.rounds[0].failure.code, 'unmarked-unavailability');
  assert.equal(out.result.rounds[0].checks.length, 1); assert.equal(out.saved.at(-1).passed, true);
});
test('a late failure resets a previously complete pass, not only its own check', async () => {
  const out = await sequence([true, new RolloutFailure('unmarked-unavailability', 'asset:lazy.js', true), true, true]);
  assert.equal(out.count, 4); assert.equal(out.result.rounds.length, 4);
});
test('persistent and alternating failure never pass after six rounds', async () => {
  const unavailable = () => new RolloutFailure('unmarked-unavailability', 'asset:lazy.js', true);
  for (const outcomes of [Array.from({ length: 6 }, unavailable), [true, unavailable(), true, unavailable(), true, unavailable()]]) {
    const out = await sequence(outcomes);
    assert.equal(out.count, 6); assert.equal(out.error.code, 'stable-rounds-exhausted');
    assert.equal(out.saved.at(-1).passed, false); assert(out.saved.at(-1).completedAt);
  }
});
test('ordinary content/security assertions fail immediately without recording their potentially private text', async () => {
  const out = await sequence([new Error('private-source-body bearer-secret')]);
  assert.equal(out.count, 1); assert.equal(out.saved.at(-1).passed, false);
  assert(!JSON.stringify(out.saved).includes('private-source-body')); assert(!JSON.stringify(out.saved).includes('bearer-secret'));
});
test('two successful rounds are separated by the full configured five seconds', async () => {
  const waits = [];
  const result = await verifyStableRollout({ expected, previous, runRound: async () => {}, persist: async () => {}, wait: async ms => { waits.push(ms); } });
  assert.equal(result.rounds.length, 2); assert.deepEqual(waits, [5000]);
});
test('deadline aborts a stalled request/round and preserves failed evidence', async () => {
  let signal, saved;
  await assert.rejects(verifyStableRollout({ expected, previous, deadlineMs: 20, delayMs: 0, persist: report => { saved = report; }, runRound: context => { signal = context.signal; return new Promise(() => {}); } }), /deadline/);
  assert.equal(signal.aborted, true); assert.equal(saved.passed, false); assert.equal(saved.rounds[0].failure.code, 'deadline');
});
test('deadline includes intervening waits, never accepts a single good round', async () => {
  let saved;
  await assert.rejects(verifyStableRollout({ expected, previous, deadlineMs: 20, persist: report => { saved = report; }, runRound: async () => {}, wait: () => new Promise(() => {}) }), /deadline/);
  assert.equal(saved.passed, false); assert.equal(saved.rounds.length, 1); assert.equal(saved.failure.code, 'deadline');
});
test('all fetches use no-store, error redirects and an abort signal, including original site checks', async () => {
  const options = [];
  const p = probe(async (url, init) => { options.push(init); return response(new URL(url).pathname === '/a-page-that-does-not-exist' ? 404 : 200); });
  await p.request('assistant-flags', '/api/assistant'); await p.siteFetch(new URL('/login', origin)); await p.siteFetch(new URL('/a-page-that-does-not-exist', origin));
  for (const init of options) { assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error'); assert(init.signal instanceof AbortSignal); }
});
test('only unmarked404/503 may retry; current503, malformed/foreign/previous markers, and wrong denial fail closed', async () => {
  for (const status of [404, 503]) {
    const p = probe(async () => response(status, { marker: null }));
    await assert.rejects(p.request('cross-origin-denial', '/api/assistant', {}, { status: 403, denial: true, marked: true }), error => error.code === 'unmarked-unavailability' && error.retryable);
  }
  for (const [status, marker] of [[503, expected.gitSha], [503, previous.build.gitSha], [503, '9'.repeat(40)], [503, 'malformed'], [401, expected.gitSha], [403, null]]) {
    const p = probe(async () => response(status, { marker }));
    await assert.rejects(p.request('cross-origin-denial', '/api/assistant', {}, { status: 403, denial: true, marked: true }), error => !error.retryable);
  }
});
test('only a marked private transient auth failure retries the invalid-session probe; 401 is still required', async () => {
  const temporary = probe(async () => response(503));
  await assert.rejects(temporary.request('invalid-session-denial', '/api/assistant', {}, { status: 401, denial: true, marked: true }),
    error => error.code === 'auth-upstream-unavailable' && error.retryable);
  for (const options of [{ marker: previous.build.gitSha }, { marker: null }, { cache: 'public' }, { cache: 'private' }]) {
    const p = probe(async () => response(503, options));
    await assert.rejects(p.request('invalid-session-denial', '/api/assistant', {}, { status: 401, denial: true, marked: true }),
      error => options.marker === null ? error.code === 'unmarked-unavailability' && error.retryable : !error.retryable);
  }
  const denied = probe(async () => response(401));
  assert.equal((await denied.request('invalid-session-denial', '/api/assistant', {}, { status: 401, denial: true, marked: true })).status, 401);
  const persistent = await sequence(Array.from({ length: 6 }, () => new RolloutFailure('auth-upstream-unavailable', 'invalid-session-denial', true)));
  assert.equal(persistent.error.code, 'stable-rounds-exhausted');
  assert.equal(persistent.count, 6);
});
test('unauthorized2xx is immediately fatal for every version marker', async () => {
  for (const marker of [null, expected.gitSha, previous.build.gitSha, '9'.repeat(40)]) {
    const p = probe(async () => response(200, { marker }));
    await assert.rejects(p.request('anonymous-denial', '/api/assistant', {}, { status: 401, denial: true, marked: true }), error => error.code === 'unauthorized-success' && !error.retryable);
  }
});
test('network failure is classified without leaking the exception or request headers', async () => {
  const p = probe(async () => { throw new Error('token=private-network-details'); });
  await assert.rejects(p.request('anonymous-denial', '/api/assistant', { headers: { Authorization: 'Bearer private-secret' } }), error => error.code === 'network-unavailability' && error.retryable);
  assert(!JSON.stringify(p.records).includes('private'));
});
test('only the complete captured old health manifest is retryable; same SHA with changed field is fatal', () => {
  assert.throws(() => verifyRolloutHealth(previous, expected, previous, 'health'), error => error.retryable === true);
  for (const key of ['schemaVersion', 'gitTree', 'sourceSha256', 'configSha256', 'appEnvironment', 'siteOrigin', 'dirty']) {
    assert.throws(() => verifyRolloutHealth({ ...previous, build: { ...previous.build, [key]: 'changed' } }, expected, previous, 'health'), error => !error.retryable);
  }
  assert.throws(() => verifyRolloutHealth({ ...previous, releaseStatus: 'missing' }, expected, previous, 'health'), error => !error.retryable);
  assert.throws(() => verifyRolloutHealth({ ...previous, environment: 'production' }, expected, previous, 'health'), error => !error.retryable);
  verifyRolloutHealth(current, expected, previous, 'health');
});
test('bare and cache-busted probes both run, and the late bare smoke health cannot bypass equality', async () => {
  const urls = [];
  const p = probe(async url => { urls.push(new URL(url)); return response(200, { marker: null, body: JSON.stringify(current) }); });
  await probeRolloutHealth(p, 'start'); await probeRolloutHealth(p, 'end');
  assert.equal(urls.length, 4); assert.equal(urls[0].search, ''); assert(urls[1].searchParams.has('smoke-provenance')); assert.equal(urls[2].search, '');
  const stale = probe(async () => response(200, { marker: null, body: JSON.stringify(previous) }));
  await assert.rejects(stale.siteFetch(new URL('/api/health', origin)), error => error.retryable && error.code === 'captured-previous-build');
});
test('malformed health, missing no-store and wrong source fail, rather than retry', async () => {
  for (const options of [{ body: 'invalid json' }, { body: JSON.stringify(current), cache: 'public' }, { body: JSON.stringify({ ...current, build: { ...expected, gitSha: '9'.repeat(40) } }) }]) {
    const p = probe(async () => response(200, { marker: null, ...options }));
    await assert.rejects(p.request('health', '/api/health'), error => !error.retryable);
  }
});
test('metadata is allowlisted; bodies, auth, raw arbitrary headers and error text are not retained', async () => {
  const p = probe(async () => response(503, { marker: null, body: 'private-body', type: 'private-content-type', cache: 'private, no-store, secret=value', extra: { 'cf-ray': 'private-ray', 'x-vinext-build-id': 'private-build', 'cf-cache-status': 'private-cache', 'set-cookie': 'private-cookie' } }));
  await assert.rejects(p.request('cross-origin-denial', '/api/assistant', { headers: { Authorization: 'private-auth' } }));
  const encoded = JSON.stringify(p.records);
  for (const value of ['private-body', 'private-content-type', 'secret=value', 'private-ray', 'private-build', 'private-cache', 'private-cookie', 'private-auth']) assert(!encoded.includes(value));
  assert.equal(p.records[0].cacheControl, 'private, no-store');
});
test('public inventory includes lazy chunks and actual vinext entry manifest, excludes hidden metadata and maps', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'visa-rollout-assets-'));
  try {
    await mkdir(join(dir, 'assets')); await mkdir(join(dir, '.vite'));
    for (const path of ['assets/AssistantPanel-abc123.js', 'assets/styles-abc123.css', 'vinext-client-entry-manifest.json', '.vite/manifest.json', 'assets/debug.js.map', 'private.json']) await writeFile(join(dir, path), '{}');
    const assets = await publicClientAssets(dir);
    assert.deepEqual(assets.map(asset => asset.path), ['/assets/AssistantPanel-abc123.js', '/assets/styles-abc123.css', '/vinext-client-entry-manifest.json']);
    assert(assets.every(asset => asset.sha256 === sha256('{}')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
const asset = { path: '/assets/lazy-abc123.js', type: 'js', size: 5, sha256: sha256('hello') };
test('asset bytes and content type must match; 200HTML and altered bytes are fatal', async () => {
  for (const options of [{ body: 'hello', type: 'text/html' }, { body: 'HELLO', type: 'text/javascript' }, { body: 'hell', type: 'text/javascript' }]) {
    const p = probe(async () => response(200, { marker: null, ...options }));
    await assert.rejects(verifyClientAssets(p, [asset]), error => !error.retryable);
  }
  const p = probe(async () => response(200, { marker: null, body: 'hello', type: 'application/javascript' }));
  await verifyClientAssets(p, [asset]);
});
test('missing lazy asset retries the entire round, and concurrency stays bounded', async () => {
  const missing = probe(async () => response(404, { marker: null }));
  await assert.rejects(verifyClientAssets(missing, [asset]), error => error.retryable);
  let active = 0, peak = 0;
  const p = probe(async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 1)); active--; return response(200, { marker: null, body: 'hello', type: 'text/javascript' }); });
  await verifyClientAssets(p, Array.from({ length: 20 }, (_, index) => ({ ...asset, path: `/assets/lazy-${index}.js` })), { concurrency: 3 });
  assert.equal(peak, 3);
});
test('simultaneous fatal asset integrity failure wins over a retryable missing asset', async () => {
  const p = probe(async url => new URL(url).pathname.includes('missing') ? response(404, { marker: null }) : response(200, { marker: null, body: 'HELLO', type: 'text/javascript' }));
  await assert.rejects(verifyClientAssets(p, [{ ...asset, path: '/assets/missing.js' }, asset]), error => !error.retryable);
});
test('feature integration retains original whole-site assertions and both post-asset health probes', async () => {
  const source = await readFile(new URL('./smoke-production-features.mjs', import.meta.url), 'utf8');
  assert(source.includes("await smokeSite(LIVE_SITE, expected, { fetchImpl: probe.siteFetch, skipHealthWait: true })"));
  assert(source.includes("await probeRolloutHealth(probe, 'start')")); assert(source.includes("await probeRolloutHealth(probe, 'end')"));
  assert(source.includes('receipt.publishedArchiveSha256')); assert(source.includes('assert.deepEqual(await flagsResponse.json(), features)'));
  assert(source.includes("['anonymous-denial', {}, 401]")); assert(source.includes("Origin: 'https://untrusted.example' }, 403")); assert(source.includes("'invalid-session-denial'"));
  assert(source.includes('/private, no-store/')); assert(source.includes('rollout-verification.json'));
  assert(source.includes('await verifyPlaybookPages(probe, feed)'));
});

const playbookPost = { id: 'apify-smoke-public-post', status: 'open', destination_country: 'United States', post_kind: 'question', title: 'Public question & source', body: 'Public community content is rendered on the server, without depending on client scripts.' };
const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function playbookDocuments() {
  const document = (path, title, body) => `<html><head><title>${escapeHtml(title)} · VisaThreads</title><link rel="canonical" href="${origin}${path}"><meta name="robots" content="noindex, nofollow"></head><body>${body}</body></html>`;
  const pages = new Map([
    ['/guides?sort=unanswered', document('/guides', 'U.S. Visa Guides and Official Resources', `<h1>U.S. Visa Guides</h1>${PLAYBOOK_GUIDE_CHECKS.map(guide => `<a href="/guides/${guide.slug}">${escapeHtml(guide.title)}</a>`).join('')}`)],
    ['/about', document('/about', 'About VisaThreads', '<main>An independent community<a href="/guides">Guides</a><a href="/contact">Contact</a></main>')],
    ['/admin/launch', document('/admin/launch', 'Owner workspace', '<main>Private to the designated owner<p>Checking your account…</p></main>')],
    [`/questions/${playbookPost.id}`, document(`/questions/${playbookPost.id}`, playbookPost.title, `<h1>${escapeHtml(playbookPost.title)}</h1><div>${escapeHtml(playbookPost.body)}</div>`) ],
  ]);
  for (const guide of PLAYBOOK_GUIDE_CHECKS) pages.set(`/guides/${guide.slug}`, document(`/guides/${guide.slug}`, guide.title, `<main><h1>${escapeHtml(guide.title)}</h1><h2>Your preparation checklist</h2><h2>Official references</h2><a href="${guide.source}">Official agency</a><a href="/contact">Report a correction</a></main>`));
  return pages;
}
function playbookProbe(pages) {
  const paths = [];
  const p = probe(async (url, init) => {
    const parsed = new URL(url); const path = parsed.pathname + parsed.search; paths.push(path);
    assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error'); assert(init.signal instanceof AbortSignal);
    assert.equal(init.headers?.Authorization, undefined); assert.equal(init.headers?.Cookie, undefined);
    return response(pages.has(path) ? 200 : 404, { body: pages.get(path) ?? '', type: 'text/html', extra: { 'x-robots-tag': 'noindex, nofollow' } });
  });
  return { ...p, paths };
}
test('playbook smoke uses exactly seven provenance-aware anonymous requests with real server content', async () => {
  const p = playbookProbe(playbookDocuments());
  await verifyPlaybookPages(p, { questions: [{ ...playbookPost, id: 'apify-experience', post_kind: 'experience' }, playbookPost] });
  assert.equal(p.paths.length, 7); assert.equal(p.records.length, 7);
  assert(p.records.every(row => row.build === expected.gitSha && row.check.startsWith('playbook:')));
  assert(p.paths.includes('/guides?sort=unanswered'));
  assert.equal(p.paths.at(-1), `/questions/${playbookPost.id}`);
});
test('playbook smoke rejects script-only content, wrong canonical/source and owner payloads without logging values', async () => {
  const ownerSecret = 'private-owner-evidence-example';
  const mutations = [
    [`/questions/${playbookPost.id}`, html => html.replace(`<div>${playbookPost.body}</div>`, `<script>${JSON.stringify({ body: playbookPost.body })}</script>`), 'imported-server-content'],
    ['/guides?sort=unanswered', html => html.replace(`${origin}/guides"`, `${origin}/guides?sort=unanswered"`), 'guides-canonical'],
    [`/guides/${PLAYBOOK_GUIDE_CHECKS[0].slug}`, html => html.replace(PLAYBOOK_GUIDE_CHECKS[0].source, 'https://untrusted.example/'), 'guide-source-and-correction'],
    ['/admin/launch', html => html.replace('</body>', `<script>{"tasks":[{"evidence":"${ownerSecret}"}]}</script></body>`), 'owner-no-record-payload'],
    ['/admin/launch', html => html.replace('</body>', `<script>self.__next_f.push([1,"{\\"assigned_to\\":\\"${ownerSecret}\\"}"])</script></body>`), 'owner-no-record-payload'],
  ];
  for (const [path, mutate, check] of mutations) {
    const pages = playbookDocuments(); pages.set(path, mutate(pages.get(path)));
    const p = playbookProbe(pages);
    await assert.rejects(verifyPlaybookPages(p, { questions: [playbookPost] }), error => error.message === `Playbook ${check} verification failed.`);
    assert(!JSON.stringify(p.records).includes(ownerSecret)); assert(!JSON.stringify(p.records).includes(playbookPost.body));
  }
});

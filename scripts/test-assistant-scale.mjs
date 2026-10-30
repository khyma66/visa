import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// LOCAL, SYNTHETIC ONLY. These are lifecycle/load-shape regressions, not a
// production throughput, latency, provider-quota or database-capacity claim.
// No target URL/credentials are accepted. All dependencies below are fixtures;
// the edge test routes every outbound fetch to a second local fixture Worker.
const root = new URL('../', import.meta.url).pathname;
const entry = `export * from ${JSON.stringify(root + 'src/lib/assistant-service.ts')};`;
const bundled = await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true,
  write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' });
const service = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const id = '00000000-0000-4000-8000-000000000001';
const source = { id: `q:${id}`, questionId: id, communityId: null, kind: 'question', title: 'Synthetic appointment',
  body: 'My passport arrived on Friday.', createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z',
  url: `/questions/${id}`, provenance: 'member' };
const input = { mode: 'ask', scope: { kind: 'post', id }, question: 'When did the passport arrive?' };
const answer = { status: 'answered', claims: [{ text: 'The member reported Friday delivery.',
  evidence: [{ sourceId: source.id, quote: source.body }] }], disagreements: [], unanswered: [] };
const review = prompt => JSON.stringify({ feedback: (true) && (prompt.reviewIds.map(id => ({ id, supported: true }))).every(check => check.supported === true) ? '' : 'Synthetic review: a claim lacks support or a material qualification is missing.', fulfillsTask: true, checks: prompt.reviewIds.map(id => ({ id, supported: true })) });
const token = actor => `synthetic-actor-${String(actor).padStart(8, '0')}`;
const request = (actor, signal) => new Request('https://visathreads.com/api/assistant', { method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(actor)}` }, body: JSON.stringify(input), signal });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(check) { const end = Date.now() + 15_000; while (!check()) { assert(Date.now() < end, 'Synthetic phase did not become ready'); await tick(); } }
function timings(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const p = fraction => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return { samples: sorted.length, p50Ms: p(0.5), p95Ms: p(0.95), maximumMs: sorted.at(-1) };
}
async function noNetwork(work) {
  const originalFetch = globalThis.fetch; let attempted = 0;
  globalThis.fetch = async () => { attempted++; throw Error('Outbound fetch is forbidden in synthetic scale tests'); };
  try { await work(); assert.equal(attempted, 0); } finally { globalThis.fetch = originalFetch; }
}
function fixture(overrides = {}) {
  const state = { authenticated: 0, reads: 0, reservations: 0, generated: 0, reviewed: 0, writes: 0, timings: [], signals: new Set() };
  const cache = new Map();
  const deps = {
    availability: () => ({ posts: true, communities: true, catchup: true }), model: 'synthetic-local',
    async authenticate(actor, context) {
      state.authenticated++; state.signals.add(context.signal);
      return { actor, async corpus() { state.reads++; return { sources: [source], partial: false }; },
        async reserve() { state.reservations++; return true; } };
    },
    async generate(prompt) {
      if (prompt.outputKind === 'review') { state.reviewed++; return review(prompt); }
      state.generated++; return JSON.stringify(answer);
    },
    cache: { get: async key => cache.get(key) ?? null, put: async (key, value) => { state.writes++; cache.set(key, value); } },
    reportTiming: event => state.timings.push(event), ...overrides,
  };
  return { state, cache, deps, handler: service.createAssistantHandler(deps) };
}

test('synthetic 1,000-request cold burst keeps request cancellation and completed output isolated', { timeout: 30_000 }, async t => noNetwork(async () => {
  const gate = deferred(); let entered = 0, reviewed = 0;
  const signals = new Set();
  const h = fixture({ generate: async (prompt, signal) => {
    if (prompt.outputKind === 'review') { reviewed++; return review(prompt); }
    signals.add(signal); entered++; await gate.promise; return JSON.stringify(answer);
  } });
  const controllers = Array.from({ length: 1000 }, () => new AbortController());
  const pending = controllers.map((controller, actor) => h.handler(request(actor, controller.signal)));
  try {
    await waitFor(() => entered === 1000);
    // Intentionally all cold misses run independently. This records the lack
    // of singleflight/backpressure instead of silently pretending it exists.
    assert.equal(signals.size, 1000); assert.equal(h.state.reservations, 1000);
    controllers.forEach((controller, index) => { if (index % 4 === 0) controller.abort(); });
    const stopped = await Promise.all(pending.filter((_, index) => index % 4 === 0));
    assert(stopped.every(response => response.status === 499));
    assert.equal([...signals].filter(signal => signal.aborted).length, 250);
    gate.resolve();
    const responses = await Promise.all(pending);
    assert.equal(new Set(responses.map(response => response.headers.get('X-VisaThreads-Request-Id'))).size, 1000);
    for (let index = 0; index < responses.length; index++) {
      const result = await responses[index].json();
      if (index % 4 === 0) { assert.equal(result.code, 'cancelled'); assert.equal(result.claims, undefined); }
      else { assert.equal(responses[index].status, 200); assert.deepEqual(result.claims, answer.claims); }
    }
    assert.equal(reviewed, 750); assert.equal(h.state.reads, 1750); assert.equal(h.state.writes, 750);
    t.diagnostic(JSON.stringify({ syntheticOnly: true, capacityClaim: false, concurrentColdMisses: entered,
      succeeded: 750, cancelled: 250, outboundRequests: 0, duration: timings(h.state.timings.map(event => event.durationMs)) }));
  } finally { gate.resolve(); controllers.forEach(controller => controller.abort()); await Promise.allSettled(pending); }
}));

test('synthetic actor-isolated warm cache avoids model/quota but retains both fresh corpus checks', { timeout: 20_000 }, async t => noNetwork(async () => {
  const h = fixture();
  const actors = Array.from({ length: 64 }, (_, index) => index);
  const cold = await Promise.all(actors.map(actor => h.handler(request(actor))));
  assert(cold.every(response => response.status === 200));
  // Same input, corpus and model, different actor: still 64 separate entries.
  assert.equal(h.cache.size, 64); assert.equal(h.state.reservations, 64); assert.equal(h.state.generated, 64);
  const warm = await Promise.all(actors.map(actor => h.handler(request(actor))));
  assert((await Promise.all(warm.map(response => response.json()))).every(result => result.cached === true));
  assert.equal(h.state.authenticated, 128); assert.equal(h.state.reads, 256);
  assert.equal(h.state.reservations, 64); assert.equal(h.state.generated, 64); assert.equal(h.state.reviewed, 64);
  const stranger = await h.handler(request(9999));
  assert.equal(stranger.status, 200); assert.notEqual((await stranger.json()).cached, true);
  assert.equal(h.state.reservations, 65); assert.equal(h.cache.size, 65);
  t.diagnostic(JSON.stringify({ syntheticOnly: true, actors: 64, cacheHits: 64, freshReadsPerHit: 2,
    crossActorHits: 0, outboundRequests: 0 }));
}));

test('synthetic quota denials stop a burst before inference, without claiming PostgreSQL concurrency capacity', { timeout: 20_000 }, async t => noNetwork(async () => {
  let grants = 0, attempts = 0, generations = 0;
  const h = fixture({
    authenticate: async actor => ({ actor, corpus: async () => ({ sources: [source], partial: false }), reserve: async () => {
      attempts++; if (grants === 32) throw service.assistantLimitError({ reason: 'global_daily_limit', reset_at: new Date(Date.now() + 60_000).toISOString() }, 'quota');
      grants++; return true;
    } }),
    generate: async prompt => { if (prompt.outputKind === 'review') return review(prompt); generations++; return JSON.stringify(answer); },
  });
  const responses = await Promise.all(Array.from({ length: 256 }, (_, actor) => h.handler(request(actor))));
  assert.equal(attempts, 256); assert.equal(grants, 32); assert.equal(generations, 32);
  assert.equal(responses.filter(response => response.status === 200).length, 32);
  const denied = responses.filter(response => response.status === 429);
  assert.equal(denied.length, 224);
  for (const response of denied) {
    const result = await response.json(); assert.equal(result.code, 'quota'); assert.equal(result.quotaReason, 'global_daily_limit');
    assert(Number(response.headers.get('Retry-After')) >= 1); assert.equal(result.claims, undefined);
  }
  t.diagnostic(JSON.stringify({ syntheticOnly: true, simulatedAtomicQuota: true, databaseLoadTest: false,
    burst: 256, grants, denials: 224, generated: generations, outboundRequests: 0 }));
}));

test('synthetic concurrent deadlines return promptly and absorb late rejecting dependencies without downstream work', { timeout: 20_000 }, async t => noNetwork(async () => {
  const waits = [], unhandled = [], listener = error => unhandled.push(error);
  let generationCalls = 0;
  const h = fixture({ deadlineMs: 300, generate: async () => {
    generationCalls++; const waiting = deferred(); waits.push(waiting); return waiting.promise;
  } });
  process.on('unhandledRejection', listener);
  try {
    const start = Date.now();
    const responses = await Promise.all(Array.from({ length: 128 }, (_, actor) => h.handler(request(actor))));
    assert.equal(waits.length, 128, 'Every request must reach the synthetic stalled provider');
    assert(responses.every(response => response.status === 504));
    assert(Date.now() - start < 5000, 'The local event loop must remain bounded, not wait for ignored cancellation');
    assert([...h.state.signals].every(signal => signal.aborted));
    assert.equal(h.state.reads, 128); assert.equal(h.state.writes, 0); assert.equal(h.state.reservations, 128);
    waits.forEach(waiting => waiting.reject(Error('synthetic late rejection')));
    await tick(); await tick();
    assert.equal(generationCalls, 128); assert.equal(h.state.reads, 128); assert.equal(h.state.writes, 0); assert.deepEqual(unhandled, []);
    t.diagnostic(JSON.stringify({ syntheticOnly: true, requests: 128, deadlineMs: 300, timeouts: 128,
      lateRejectionsHandled: 128, downstreamCallsAfterTimeout: 0, duration: timings(h.state.timings.map(event => event.durationMs)) }));
  } finally { waits.forEach(waiting => waiting.resolve('')); await tick(); process.removeListener('unhandledRejection', listener); }
}));

test('local workerd concurrent requests preserve cancellation ownership and total deadlines with no external network', { timeout: 30_000 }, async t => {
  const script = (await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import {createAssistantHandler,assistantDatabaseFetch} from ${JSON.stringify(root + 'src/lib/assistant-service.ts')};
    const source=${JSON.stringify(source)},input=${JSON.stringify(input)},answer=${JSON.stringify(answer)};
    const state={reserved:0,generated:0,reviewed:0,reads:0};
    const deps={availability:()=>({posts:true,communities:true,catchup:true}),model:'synthetic-local',
      authenticate:async(_token,context)=>({actor:'same-synthetic-actor',corpus:async()=>{state.reads++;await assistantDatabaseFetch(context)('https://fixture.invalid/corpus');return {sources:[source],partial:false}},reserve:async()=>{state.reserved++;return true}}),
      generate:async(prompt,signal)=>{if(prompt.outputKind==='review'){state.reviewed++;return JSON.stringify({feedback:'',fulfillsTask:true,checks:prompt.reviewIds.map(id=>({id,supported:true}))})}state.generated++;await fetch('https://fixture.invalid/model',{signal});return JSON.stringify(answer)}};
    const normal=createAssistantHandler(deps),deadline=createAssistantHandler({...deps,deadlineMs:40});
    export default {async fetch(request){const url=new URL(request.url);if(url.pathname==='/status')return Response.json(state);
      const controller=new AbortController();const timer=url.searchParams.has('abort')?setTimeout(()=>controller.abort(),100):null;
      try{return await (url.pathname==='/deadline'?deadline:normal)(new Request('https://visathreads.com/api/assistant',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+'a'.repeat(40)},body:JSON.stringify(input),signal:controller.signal}));}finally{if(timer)clearTimeout(timer)}
    }};` }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' })).outputFiles[0].text;
  const fixtureWorker = `export default {async fetch(request){const url=new URL(request.url);if(url.hostname!=='fixture.invalid'||!['/model','/corpus'].includes(url.pathname))throw Error('Unexpected outbound target');if(url.pathname==='/model')await new Promise(resolve=>setTimeout(resolve,350));return new Response('synthetic');}};`;
  const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: 'app', modules: true, compatibilityDate: '2026-09-09', script, outboundService: 'fixture' },
    { name: 'fixture', modules: true, compatibilityDate: '2026-09-09', script: fixtureWorker, outboundService: async () => { throw Error('External network forbidden'); } },
  ] }));
  try {
    const responses = await Promise.all(Array.from({ length: 64 }, (_, index) => runtime.dispatchFetch(`http://localhost/run${index % 2 ? '' : '?abort=1'}`)));
    assert.equal(responses.filter(response => response.status === 499).length, 32);
    assert.equal(responses.filter(response => response.status === 200).length, 32);
    assert.equal(new Set(responses.map(response => response.headers.get('X-VisaThreads-Request-Id'))).size, 64);
    assert.deepEqual(await (await runtime.dispatchFetch('http://localhost/status')).json(), { reserved: 64, generated: 64, reviewed: 32, reads: 96 });
    const expired = await Promise.all(Array.from({ length: 16 }, () => runtime.dispatchFetch('http://localhost/deadline')));
    assert(expired.every(response => response.status === 504));
    const final = await (await runtime.dispatchFetch('http://localhost/status')).json();
    assert.deepEqual(final, { reserved: 80, generated: 80, reviewed: 32, reads: 112 });
    t.diagnostic(JSON.stringify({ syntheticOnly: true, runtime: 'local-workerd', requests: 80, concurrentBurst: 64,
      succeeded: 32, cancelled: 32, timeouts: 16, externalNetworkRequests: 0, productionCapacityClaim: false }));
  } finally { await runtime.dispose(); }
});

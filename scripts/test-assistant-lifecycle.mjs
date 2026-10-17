import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { build, transform } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const root = new URL('../', import.meta.url).pathname;
const entry = `export * from ${JSON.stringify(root + 'src/lib/assistant-service.ts')}; export { AssistantError } from ${JSON.stringify(root + 'src/lib/assistant-core.ts')}; export { retrieveAssistantCorpus } from ${JSON.stringify(root + 'src/lib/assistant-data.ts')};`;
const bundled = await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent',
  plugins: [{ name: 'synthetic-archive', setup(builder) {
    builder.onResolve({ filter: /^@visa\/archive$/ }, () => ({ path: 'archive', namespace: 'synthetic' }));
    builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, () => ({ contents: 'export default { questions: [], answersByQuestionId: {} };', loader: 'js' }));
  } }],
});
const moduleUrl = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const serviceUrl = moduleUrl(bundled.outputFiles[0].text);
const service = await import(serviceUrl);
const id = '00000000-0000-4000-8000-000000000001';
const source = { id: `q:${id}`, questionId: id, communityId: null, kind: 'question', title: 'Appointment', body: 'My passport arrived on Friday.', createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z', url: `/questions/${id}`, provenance: 'member' };
const input = { mode: 'ask', scope: { kind: 'post', id }, question: 'When did the passport arrive?' };
const output = { status: 'answered', claims: [{ text: 'The member reported Friday delivery.', evidence: [{ sourceId: source.id, quote: source.body }] }], disagreements: [], unanswered: [] };
const review = prompt => JSON.stringify({ fulfillsTask: true, checks: prompt.reviewIds.map(id => ({ id, supported: true })) });
const request = (signal, body = input) => new Request('https://visathreads.com/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${'synthetic-token'.repeat(3)}`, 'X-VisaThreads-Request-Id': 'caller-controlled' }, body: JSON.stringify(body), signal });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(overrides = {}) {
  const state = { reads: 0, reserved: 0, generated: 0, reviewed: 0, cache: new Map(), writes: 0, failures: [], timings: [], signals: [] };
  const session = { actor: 'synthetic-actor', async corpus(_input, signal) { state.signals.push(signal); state.reads++; return { sources: [source], partial: false }; }, async reserve(signal) { state.signals.push(signal); state.reserved++; return true; } };
  const deps = {
    availability: () => ({ posts: true, communities: true, catchup: true }), model: 'synthetic-model',
    authenticate: async (_token, context) => { state.signals.push(context.signal); return session; },
    async generate(prompt, signal) { state.signals.push(signal); if (prompt.outputKind === 'review') { state.reviewed++; return review(prompt); } state.generated++; return JSON.stringify(output); },
    cache: { get: async key => state.cache.get(key) ?? null, put: async (key, value) => { state.writes++; state.cache.set(key, value); } },
    reportFailure: event => state.failures.push(event), reportTiming: event => state.timings.push(event), ...overrides,
  };
  return { state, session, deps, handler: service.createAssistantHandler(deps) };
}

test('one request owns every stage signal and performs exactly one final fresh access check', async () => {
  const h = harness(); const response = await h.handler(request());
  assert.equal(response.status, 200); assert.equal(h.state.reads, 2); assert.equal(h.state.reserved, 1);
  assert.equal(h.state.generated, 1); assert.equal(h.state.reviewed, 1); assert.equal(h.state.writes, 1);
  assert(h.state.signals.length >= 6); assert(h.state.signals.every(signal => signal === h.state.signals[0]));
  assert.match(response.headers.get('x-visathreads-request-id'), /^[0-9a-f-]{36}$/);
  assert.match(response.headers.get('server-timing'), /^assistant;dur=\d+$/);
  assert.equal(h.state.timings[0].requestId, response.headers.get('x-visathreads-request-id'));
  assert.deepEqual(h.state.failures, []);
  const cached = await h.handler(request());
  assert.equal(cached.status, 200); assert.equal((await cached.json()).cached, true);
  assert.equal(h.state.reads, 4); assert.equal(h.state.generated, 1); assert.equal(h.state.reserved, 1);
  assert.notEqual(cached.headers.get('x-visathreads-request-id'), response.headers.get('x-visathreads-request-id'));
});

test('identical concurrent callers do not share cancellation, reservations or pending generation', async () => {
  const waits = [], signals = [];
  const h = harness({ generate: async (prompt, signal) => { if (prompt.outputKind === 'review') return review(prompt); const item = deferred(); waits.push(item); signals.push(signal); return item.promise; } });
  const ownerController = new AbortController();
  const owner = h.handler(request(ownerController.signal)), waiter = h.handler(request());
  while (waits.length < 2) await tick();
  assert.equal(h.state.reserved, 2); assert.notEqual(signals[0], signals[1]);
  ownerController.abort(); const stopped = await owner;
  assert.equal(stopped.status, 499); assert.equal((await stopped.json()).code, 'cancelled');
  assert.equal(signals[0].aborted, true); assert.equal(signals[1].aborted, false);
  waits[1].resolve(JSON.stringify(output)); assert.equal((await waiter).status, 200);
  waits[0].resolve(JSON.stringify(output)); await tick();
  assert.equal(h.state.writes, 1); assert.equal(h.state.reads, 3, 'Aborted owner must not revalidate after late generation');
});

test('late rejections and synchronous abort-then-throw remain handled without resuming work', async () => {
  const unhandled = [], listener = failure => unhandled.push(failure);
  process.on('unhandledRejection', listener);
  try {
    for (const phase of ['authentication', 'generation']) {
      const controller = new AbortController(); let rejectLate, entered = false;
      const h = harness();
      const wait = () => { entered = true; return new Promise((_resolve, reject) => { rejectLate = reject; }); };
      if (phase === 'authentication') h.deps.authenticate = wait;
      else h.deps.generate = wait;
      const pending = h.handler(request(controller.signal));
      while (!entered) await tick();
      controller.abort(); assert.equal((await pending).status, 499);
      rejectLate(Error('synthetic late rejection')); await tick(); await tick();
      assert.equal(h.state.writes, 0); assert.equal(h.state.reviewed, 0);
    }
    const controller = new AbortController(); const h = harness({ authenticate() { controller.abort(); throw Error('synthetic synchronous rejection'); } });
    assert.equal((await h.handler(request(controller.signal))).status, 499);
    await tick(); await tick(); assert.deepEqual(unhandled, []);
    assert.equal(h.state.reads, 0); assert.equal(h.state.reserved, 0);
  } finally { process.removeListener('unhandledRejection', listener); }
});

test('the single total deadline interrupts each asynchronous stage, including dependencies ignoring abort', async () => {
  assert.equal(service.ASSISTANT_REQUEST_BUDGET_MS, 45000);
  for (const phase of ['authentication', 'retrieval', 'quota', 'generation', 'review', 'revalidation', 'cache-read', 'cache-write']) {
    const paused = deferred(); const h = harness({ deadlineMs: 100 });
    let entered = false, capturedSignal;
    const hold = signal => { entered = true; capturedSignal = signal; return paused.promise; };
    if (phase === 'authentication') h.deps.authenticate = (_token, context) => hold(context.signal);
    if (phase === 'retrieval' || phase === 'revalidation') h.session.corpus = async (_input, signal) => {
      h.state.reads++; return h.state.reads > (phase === 'revalidation' ? 1 : 0) ? hold(signal) : { sources: [source], partial: false };
    };
    if (phase === 'quota') h.session.reserve = signal => hold(signal);
    if (phase === 'generation' || phase === 'review') h.deps.generate = async (prompt, signal) =>
      (prompt.outputKind === 'review') === (phase === 'review') ? hold(signal) : JSON.stringify(output);
    if (phase === 'cache-read') h.deps.cache.get = () => hold(h.state.signals[0]);
    if (phase === 'cache-write') h.deps.cache.put = () => hold(h.state.signals[0]);
    const start = Date.now(); const response = await h.handler(request()); const body = await response.json();
    assert(entered, phase); assert.equal(response.status, 504, phase); assert.equal(body.code, 'timeout', phase);
    assert.equal(capturedSignal.aborted, true, phase); assert(Date.now() - start < 1000, phase);
    assert.equal(h.state.failures[0].category, 'timeout');
    const before = { reserved: h.state.reserved, generated: h.state.generated, reviewed: h.state.reviewed, writes: h.state.writes };
    paused.resolve(phase === 'authentication' ? h.session : phase === 'retrieval' || phase === 'revalidation' ? { sources: [source], partial: false } : phase === 'generation' ? JSON.stringify(output) : undefined);
    await tick(); assert.deepEqual({ reserved: h.state.reserved, generated: h.state.generated, reviewed: h.state.reviewed, writes: h.state.writes }, before, `${phase}: late completion continued work`);
  }
});

test('cumulative budget does not reset between individually successful stages', async () => {
  const delay = () => new Promise(resolve => setTimeout(resolve, 60));
  const h = harness({ deadlineMs: 150 });
  h.deps.authenticate = async (_token, context) => { h.state.signals.push(context.signal); await delay(); return h.session; };
  h.session.corpus = async (_input, signal) => { h.state.signals.push(signal); h.state.reads++; await delay(); return { sources: [source], partial: false }; };
  h.deps.generate = async (_prompt, signal) => { h.state.generated++; h.state.signals.push(signal); await delay(); return JSON.stringify(output); };
  const start = Date.now(); const response = await h.handler(request());
  assert.equal(response.status, 504); assert.equal((await response.json()).code, 'timeout');
  assert(Date.now() - start < 1000); assert.equal(h.state.reads, 1); assert.equal(h.state.reviewed, 0); assert.equal(h.state.writes, 0);
});

test('cache-hit live access failures are not swallowed or charged as fresh generations', async () => {
  for (const status of [401, 403, 409, 429, 503]) {
    const h = harness(); assert.equal((await h.handler(request())).status, 200);
    h.session.corpus = async () => { h.state.reads++; if (h.state.reads === 4) throw new service.AssistantError(status, 'private backend error'); return { sources: [source], partial: false }; };
    const result = await h.handler(request());
    assert.equal(result.status, status); assert.equal(h.state.generated, 1); assert.equal(h.state.reserved, 1); assert.equal(h.state.writes, 1);
    assert(!JSON.stringify(await result.json()).includes('private backend error'));
  }
});

test('cache storage or structure failures remain optional, while changed sources prevent cache writes', async () => {
  for (const get of [async () => { throw Error('private cache issue'); }, async () => ({ result: {}, digest: 'invalid' })]) {
    const h = harness(); h.deps.cache.get = get;
    assert.equal((await h.handler(request())).status, 200); assert.equal(h.state.generated, 1);
  }
  const h = harness(); h.session.corpus = async () => ({ sources: h.state.reads++ ? [] : [source], partial: false });
  const response = await h.handler(request());
  assert.equal(response.status, 409); assert.equal((await response.json()).code, 'source_changed'); assert.equal(h.state.writes, 0);
});

test('quota reasons and reset metadata are bounded and request IDs are generated, not reflected', async () => {
  for (const [reason, code] of [['user_daily_limit', 'quota'], ['global_daily_limit', 'quota'], ['user_minute_limit', 'rate_limit']]) {
    const resetAt = new Date(Date.now() + 3600000).toISOString();
    const h = harness(); h.session.reserve = async () => { throw service.assistantLimitError({ reason, reset_at: resetAt, secret: 'private quota diagnostic' }, 'quota'); };
    const response = await h.handler(request()); const body = await response.json();
    assert.equal(response.status, 429); assert.equal(body.code, code); assert.equal(body.quotaReason, reason); assert.equal(body.resetAt, resetAt);
    assert(body.retryAfterSeconds > 3500 && body.retryAfterSeconds <= 3600);
    assert.equal(response.headers.get('retry-after'), String(body.retryAfterSeconds));
    assert.equal(response.headers.get('x-visathreads-request-id'), body.requestId); assert.match(body.requestId, /^[0-9a-f-]{36}$/);
    assert(!JSON.stringify(body).includes('private')); assert.equal(h.state.generated, 0);
  }
  const invalid = service.assistantLimitError({ reason: 'private arbitrary reason', reset_at: '2099-01-01T00:00:00Z' }, 'quota');
  assert.deepEqual(invalid.metadata, {});
});

test('unexpected error text and caller headers never enter public diagnostics; observer failures are harmless', async () => {
  const h = harness({ generate: async () => { throw Error('private source or credential'); }, reportTiming: () => { throw Error('observer failed'); } });
  const response = await h.handler(request()); const body = await response.json();
  assert.equal(response.status, 503); assert.equal(body.code, 'unavailable');
  assert.equal(h.state.failures[0].requestId, body.requestId); assert.equal(typeof h.state.failures[0].durationMs, 'number');
  assert(!JSON.stringify({ body, failures: h.state.failures }).includes('private'));
  assert(!JSON.stringify({ body, failures: h.state.failures }).includes('caller-controlled'));
});

test('database transport preserves an existing abort signal as well as the request budget', async () => {
  for (const abortWhich of ['request', 'upstream']) {
    const caller = new AbortController(), upstream = new AbortController(); let outgoing;
    const fetcher = service.assistantDatabaseFetch({ signal: caller.signal, requestId: 'synthetic-only' }, async (_url, options) => { outgoing = options; return Response.json({}); });
    await fetcher('https://fixture.invalid/auth', { signal: upstream.signal });
    assert.equal(outgoing.cache, 'no-store'); assert.equal(outgoing.redirect, 'manual'); assert.equal(outgoing.signal.aborted, false);
    (abortWhich === 'request' ? caller : upstream).abort(); assert.equal(outgoing.signal.aborted, true);
  }
});

const routeSource = await readFile(new URL('../src/app/api/assistant/route.ts', import.meta.url), 'utf8');
const routeImports = {
  '@supabase/supabase-js': moduleUrl('export function createClient(url,key,options){return globalThis.__assistantRouteFixture.client(url,key,options);}'),
  '@visa/build-provenance': moduleUrl('export default {gitSha:"synthetic-build"};'),
  '@/lib/assistant-data': moduleUrl('export function retrieveAssistantCorpus(client,input,now){return globalThis.__assistantRouteFixture.corpus(client,input,now);}'),
  '@/lib/assistant-provider': moduleUrl('export function providerCacheKey(){return "synthetic-model";} export function runAssistantModel(prompt,options){return globalThis.__assistantRouteFixture.generate(prompt,options);}'),
  '@/lib/assistant-service': serviceUrl,
};
const routeJs = (await transform(routeSource, { loader: 'ts', format: 'esm', target: 'es2022' })).code.replace(/(from\s+)(['"])([^'"]+)\2/g, (_, prefix, _quote, name) => { assert(routeImports[name], name); return prefix + JSON.stringify(routeImports[name]); });
const route = await import(moduleUrl(routeJs));

test('actual route and retrieval keep recent and calendar windows fixed through revalidation across midnight', async () => {
  const env = { NEXT_PUBLIC_SITE_URL: 'https://visathreads.com', NEXT_PUBLIC_SUPABASE_URL: 'https://cycnichledvqbxevrwnt.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-fixture-key', ASSISTANT_PROJECT_REF: 'cycnichledvqbxevrwnt', ASSISTANT_PROVIDER: 'groq', GROQ_API_KEY: 'synthetic-local-key', ASSISTANT_ENABLED: 'true', COMMUNITY_SOURCE_MODE: 'live' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const realNow = Date.now; Object.assign(process.env, env);
  try {
    for (const [question, location, createdAt, expectedSince, expectedUntil] of [
      ['give recent experience for hyderabad stamping', 'Hyderabad', '2026-10-17T12:00:00Z', '2026-09-17T23:59:59.990Z', '2026-10-17T23:59:59.990Z'],
      ['find Chennai stamping experiences from the last 7 days', 'Chennai', '2026-10-17T12:00:00Z', '2026-10-10T23:59:59.990Z', '2026-10-17T23:59:59.990Z'],
      ['show Delhi stamping experiences from yesterday', 'Delhi', '2026-10-16T12:00:00Z', '2026-10-16T00:00:00.000Z', '2026-10-17T00:00:00.000Z'],
    ]) {
      const start = Date.parse('2026-10-17T23:59:59.990Z'); let clock = start, providerCalls = 0, reservations = 0;
      const anchors = [], searches = [];
      Date.now = () => clock;
      globalThis.__assistantRouteFixture = {
        client() { return {
          auth: { getUser: async () => ({ data: { user: { id: 'synthetic-user' } }, error: null }) },
          async rpc(name, args) {
            if (name === 'check_assistant_request_rate') return { data: [{ allowed: true }], error: null };
            if (name === 'reserve_assistant_request') { reservations++; return { data: [{ allowed: true }], error: null }; }
            assert.equal(name, 'assistant_sources_v2'); searches.push(args); clock += 90000;
            return { data: [{ source_id: `q:${id}`, source_kind: 'question', question_id: id, community_id: null,
              title: `My ${location} stamping experience`, body: `I attended my visa stamping interview at the ${location} consulate.`, created_at: createdAt, updated_at: createdAt }], error: null };
          },
          from() { throw Error('A direct lookup must not expand unrelated threads'); },
        }; },
        corpus: async (client, input, now) => { anchors.push(now); return service.retrieveAssistantCorpus(client, input, now); },
        generate: async () => { providerCalls++; throw Error('No model permitted for a direct lookup'); },
      };
      const response = await route.POST(request(undefined, { mode: 'ask', scope: { kind: 'public' }, question }));
      const result = await response.json();
      assert.equal(response.status, 200, `${question}: ${JSON.stringify(result)}`);
      assert.equal(result.status, 'answered'); assert.equal(result.sources.length, 1);
      assert.deepEqual(anchors, [start, start]); assert.equal(searches.length, 2);
      assert.deepEqual(searches[0], searches[1], 'Source revalidation must use the original window');
      assert.equal(searches[0].since_time, expectedSince); assert.equal(searches[0].until_time, expectedUntil);
      assert.equal(result.coverage.since, expectedSince); assert.equal(result.coverage.until, expectedUntil);
      assert.equal(result.generatedAt, new Date(start).toISOString());
      assert.equal(providerCalls, 0); assert.equal(reservations, 0);
    }
  } finally {
    Date.now = realNow; delete globalThis.__assistantRouteFixture;
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('actual route preserves quota reset/reason, distinguishes auth outage, and forwards the request signal to database calls', async () => {
  const env = { NEXT_PUBLIC_SITE_URL: 'https://visathreads.com', NEXT_PUBLIC_SUPABASE_URL: 'https://cycnichledvqbxevrwnt.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-fixture-key', ASSISTANT_PROJECT_REF: 'cycnichledvqbxevrwnt', ASSISTANT_PROVIDER: 'groq', GROQ_API_KEY: 'synthetic-local-key', ASSISTANT_ENABLED: 'true' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const oldFetch = globalThis.fetch; Object.assign(process.env, env);
  try {
    for (const mode of ['quota', 'auth-outage', 'permission', 'cancel']) {
      const signals = []; let providerCalls = 0;
      globalThis.fetch = async (_url, options) => { signals.push(options.signal); assert.equal(options.redirect, 'manual'); return Response.json({}); };
      globalThis.__assistantRouteFixture = {
        client(_url, _key, options) { return {
          auth: { getUser: async () => { await options.global.fetch('https://fixture.invalid/auth'); return mode === 'auth-outage' ? { data: { user: null }, error: { status: 503, message: 'private failure' } } : { data: { user: { id: 'synthetic-user' } }, error: null }; } },
          async rpc(name) { await options.global.fetch('https://fixture.invalid/' + name); return name === 'check_assistant_request_rate'
            ? mode === 'permission' ? { data: null, error: { code: '42501' } } : { data: [{ allowed: true }], error: null }
            : { data: [{ allowed: false, reason: 'user_daily_limit', reset_at: new Date(Date.now() + 3600000).toISOString() }], error: null }; },
        }; },
        corpus: async () => mode === 'cancel' ? new Promise(() => {}) : { sources: [source], partial: false },
        generate: async () => { providerCalls++; throw Error('No model permitted'); },
      };
      const controller = new AbortController(); const pending = route.POST(request(controller.signal));
      if (mode === 'cancel') { while (!signals.length) await tick(); controller.abort(); }
      const response = await pending; const body = await response.json();
      assert.equal(response.status, { quota: 429, 'auth-outage': 503, permission: 403, cancel: 499 }[mode]);
      assert.equal(providerCalls, 0); assert(!JSON.stringify(body).includes('private'));
      if (mode === 'quota') { assert.equal(body.code, 'quota'); assert.equal(body.quotaReason, 'user_daily_limit'); assert(body.retryAfterSeconds > 3500); }
      if (mode === 'cancel') assert(signals.every(signal => signal.aborted));
    }
  } finally {
    globalThis.fetch = oldFetch; delete globalThis.__assistantRouteFixture;
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('actual Workers runtime isolates cancelled callers, enforces a total deadline and rejects database redirects', { timeout: 20000 }, async () => {
  const script = (await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import {createAssistantHandler,assistantDatabaseFetch} from ${JSON.stringify(root + 'src/lib/assistant-service.ts')};
    const source=${JSON.stringify(source)},input=${JSON.stringify(input)},answer=${JSON.stringify(output)};
    const state={reserved:0,generated:0,reads:0};
    const dependencies={availability:()=>({posts:true,communities:true,catchup:true}),model:'local',
      authenticate:async(_token,context)=>({actor:'same-user',corpus:async()=>{state.reads++;await assistantDatabaseFetch(context)('https://fixture.invalid/corpus');return {sources:[source],partial:false}},reserve:async()=>{state.reserved++;return true}}),
      generate:async(prompt,signal)=>{if(prompt.outputKind==='review')return JSON.stringify({fulfillsTask:true,checks:prompt.reviewIds.map(id=>({id,supported:true}))});state.generated++;await fetch('https://fixture.invalid/model',{signal});return JSON.stringify(answer)}};
    const normal=createAssistantHandler(dependencies),deadline=createAssistantHandler({...dependencies,deadlineMs:40});
    export default {async fetch(request){const url=new URL(request.url);
      if(url.pathname==='/status')return Response.json(state);
      if(url.pathname==='/database'){
        let calls=0,cancelled=false;const controller=new AbortController();
        const call=assistantDatabaseFetch({signal:controller.signal,requestId:'local'},async(url,options)=>{calls++;const out=new Request(url,options);if(out.redirect!=='manual')throw Error('Unsafe redirect policy');return new Response(new ReadableStream({cancel(){cancelled=true}}),{status:302,headers:{Location:'https://external.invalid/secret'}})});
        let status=200;try{await call('https://fixture.invalid/auth')}catch(error){status=error.status}
        return Response.json({status,calls,cancelled});
      }
      const controller=new AbortController();const abort=url.searchParams.get('abort');const timer=abort?setTimeout(()=>controller.abort(),Number(abort)):null;
      try{return await (url.pathname==='/deadline'?deadline:normal)(new Request('https://visathreads.com/api/assistant',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+ 'a'.repeat(40)},body:JSON.stringify(input),signal:controller.signal}));}finally{if(timer)clearTimeout(timer)}
    }};` }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' })).outputFiles[0].text;
  const fixture = `export default {async fetch(request){if(new URL(request.url).pathname==='/model')await new Promise(resolve=>setTimeout(resolve,500));return new Response('fixture');}};`;
  const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: 'app', modules: true, compatibilityDate: '2026-09-09', script, outboundService: 'fixture' },
    { name: 'fixture', modules: true, compatibilityDate: '2026-09-09', script: fixture },
  ] }));
  try {
    const owner = runtime.dispatchFetch('http://localhost/run?abort=250');
    const waiter = runtime.dispatchFetch('http://localhost/run');
    const [a, b] = await Promise.all([owner, waiter]);
    assert.equal(a.status, 499); assert.equal(b.status, 200);
    const state = await (await runtime.dispatchFetch('http://localhost/status')).json();
    assert.equal(state.generated, 2); assert.equal(state.reserved, 2); assert.equal(state.reads, 3);
    const timeout = await runtime.dispatchFetch('http://localhost/deadline'); assert.equal(timeout.status, 504); assert.equal((await timeout.json()).code, 'timeout');
    assert.deepEqual(await (await runtime.dispatchFetch('http://localhost/database')).json(), { status: 503, calls: 1, cancelled: true });
  } finally { await runtime.dispose(); }
});

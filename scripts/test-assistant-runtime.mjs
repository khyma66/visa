import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const dependencies = { './assistant-models.json': `data:text/javascript;base64,${Buffer.from('export default '+await readFile(new URL('../src/lib/assistant-models.json', import.meta.url), 'utf8')).toString('base64')}` };
async function compile(name) {
  const code = ts.transpileModule(await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const resolved = code.replace(/(from\s+)(['"])([^'"]+)\2/g, (_, prefix, _quote, dependency) => {
    assert(dependencies[dependency], `Unknown dependency ${dependency}`);
    return prefix + JSON.stringify(dependencies[dependency]);
  });
  return `data:text/javascript;base64,${Buffer.from(resolved).toString('base64')}`;
}
dependencies['./assistant-context'] = await compile('assistant-context');
dependencies['./assistant-core'] = await compile('assistant-core');
const core = await import(dependencies['./assistant-core']);
dependencies['./assistant-provider'] = await compile('assistant-provider');
const provider = await import(dependencies['./assistant-provider']);
dependencies['./assistant-search'] = await compile('assistant-search');
dependencies['./assistant-review'] = await compile('assistant-review');
const serviceModule = await compile('assistant-service');
const service = await import(serviceModule);

const id = '00000000-0000-4000-8000-000000000001';
const secret = 'private-diagnostic-marker';
const token = 'private_token_'.repeat(4);
const source = {
  id: `q:${id}`, questionId: id, communityId: null, kind: 'question',
  title: 'Appointment experience', body: 'My passport arrived on Friday.',
  createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z',
  url: `/questions/${id}`, provenance: 'member',
};
const input = { mode: 'ask', scope: { kind: 'post', id }, question: `When did it arrive? ${secret}` };
const output = {
  status: 'answered', disagreements: [], unanswered: [],
  claims: [{ text: 'The member said Friday.', evidence: [{ sourceId: source.id, quote: source.body }] }],
};
const prompt = { system: `Internal instructions ${secret}`, user: `User question ${secret}` };
const request = () => new Request('https://visathreads.com/api/assistant', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(input),
});
const privateError = () => new Error(`${secret} ${token} private-user@example.invalid`);

test('deployed assistant responses identify their compiled build without trusting caller headers', async () => {
  const moduleUrl = value => `data:text/javascript;base64,${Buffer.from(value).toString('base64')}`;
  const buildSha = 'a'.repeat(40);
  const imports = {
    '@supabase/supabase-js': moduleUrl('export function createClient() { throw Error("Authentication must not run for these probes"); }'),
    '@visa/build-provenance': moduleUrl(`export default { gitSha: ${JSON.stringify(buildSha)} };`),
    '@/lib/assistant-core': dependencies['./assistant-core'],
    '@/lib/assistant-data': moduleUrl('export function retrieveAssistantCorpus() { throw Error("Retrieval must not run"); }'),
    '@/lib/assistant-provider': dependencies['./assistant-provider'],
    '@/lib/assistant-service': serviceModule,
  };
  const code = ts.transpileModule(await readFile(new URL('../src/app/api/assistant/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText.replace(/(from\s+)(['"])([^'"]+)\2/g, (_, prefix, _quote, name) => {
    assert(imports[name], `Unknown route dependency ${name}`);
    return prefix + JSON.stringify(imports[name]);
  });
  const route = await import(moduleUrl(code));
  const configured = {
    NEXT_PUBLIC_SITE_URL: 'https://visathreads.com',
    NEXT_PUBLIC_SUPABASE_URL: 'https://cycnichledvqbxevrwnt.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-fixture-key',
    ASSISTANT_PROJECT_REF: 'cycnichledvqbxevrwnt', ASSISTANT_PROVIDER: 'workers-ai',
    ASSISTANT_ENABLED: 'true', ASSISTANT_COMMUNITIES_ENABLED: 'false', ASSISTANT_CATCHUP_ENABLED: 'false',
  };
  const previous = Object.fromEntries(Object.keys(configured).map(key => [key, process.env[key]]));
  Object.assign(process.env, configured);
  try {
    const response = await route.GET(new Request('https://visathreads.com/api/assistant'));
    assert.equal(response.headers.get('x-visathreads-build'), buildSha);
    assert.deepEqual(await response.json(), { posts: true, communities: false, catchup: false });
    for (const [origin, enabled, status] of [[undefined, 'true', 401], ['https://untrusted.example', 'true', 403], [undefined, 'false', 503]]) {
      process.env.ASSISTANT_ENABLED = enabled;
      const result = await route.POST(new Request('https://visathreads.com/api/assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VisaThreads-Build': 'attacker', ...(origin ? { Origin: origin } : {}) },
        body: JSON.stringify({ mode: 'ask', scope: { kind: 'public' }, question: 'Find posts about stamping.' }),
      }));
      assert.equal(result.status, status);
      assert.equal(result.headers.get('x-visathreads-build'), buildSha);
      assert.match(result.headers.get('cache-control'), /private, no-store/);
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
function assertPrivate(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [secret, token, 'private-user@example.invalid', 'actor-private-id', source.id, source.body]) {
    assert(!serialized.includes(forbidden), `Diagnostic or error response exposed ${forbidden}`);
  }
}
function harness(overrides = {}) {
  const failures = [];
  const state = { reads: 0, generations: 0, reservations: 0 };
  const session = {
    actor: 'actor-private-id',
    corpus: async () => { state.reads++; return { sources: [source], partial: false }; },
    reserve: async () => { state.reservations++; return true; },
  };
  const handler = service.createAssistantHandler({
    availability: () => ({ posts: true, communities: true, catchup: true }), model: 'test-model',
    authenticate: async () => session,
    generate: async prompt => { if (prompt.outputKind === 'review') return JSON.stringify({ fulfillsTask: true, checks: prompt.reviewIds.map(id => ({ id, supported: true })) }); state.generations++; return JSON.stringify(output); },
    reportFailure: event => failures.push(event), ...overrides,
  });
  return { handler, state, session, failures };
}

test('runtime failures identify the failing stage without logging inputs, account IDs, or errors', async () => {
  for (const stage of ['request', 'authentication', 'retrieval', 'quota', 'generation', 'revalidation']) {
    const item = harness();
    if (stage === 'retrieval') item.session.corpus = async () => { throw privateError(); };
    if (stage === 'quota') item.session.reserve = async () => { throw privateError(); };
    if (stage === 'revalidation') item.session.corpus = async () => {
      if (item.state.reads++ > 0) throw privateError();
      return { sources: [source], partial: false };
    };
    const overrides = stage === 'request' ? { availability: () => ({ posts: false }) }
      : stage === 'authentication' ? { authenticate: async () => { throw privateError(); } }
      : stage === 'generation' ? { generate: async () => { throw privateError(); } } : {};
    const current = Object.keys(overrides).length ? harness(overrides) : item;
    const response = await current.handler(request());
    assert.equal(response.status, 503, stage);
    assert.equal(current.failures.length, 1, stage);
    assert.equal(current.failures[0].stage, stage);
    assert.equal(current.failures[0].status, 503);
    assert.deepEqual(Object.keys(current.failures[0]).sort(), ['category', 'durationMs', 'requestId', 'stage', 'status']);
    assert.equal(current.failures[0].category, 'unavailable');
    assert.match(current.failures[0].requestId, /^[0-9a-f-]{36}$/);
    assert.equal(current.failures[0].requestId, response.headers.get('x-visathreads-request-id'));
    assert(Number.isSafeInteger(current.failures[0].durationMs) && current.failures[0].durationMs >= 0);
    assertPrivate(current.failures);
    assertPrivate(await response.json());
  }
});

test('malformed model JSON and unsupported citations report distinct controlled validation codes', async () => {
  const invalidCitation = { ...output, claims: [{ text: secret, evidence: [{ sourceId: source.id, quote: `Invented source quote ${secret}` }] }] };
  for (const [raw, code] of [[`${secret}{`, 'output_json'], [JSON.stringify(invalidCitation), 'citation_quote']]) {
    const { handler, failures } = harness({ generate: async () => raw });
    const response = await handler(request());
    assert.equal(response.status, 502);
    assert.deepEqual(failures.map(({ stage, status, category, code }) => ({ stage, status, category, code })), [{ stage: 'validation', status: 502, category: 'source_verification', code }]);
    assert.equal(failures[0].requestId, response.headers.get('x-visathreads-request-id'));
    assertPrivate(failures);
    assertPrivate(await response.json());
  }
});

test('diagnostic callback exceptions cannot replace the original safe response', async () => {
  const normal = harness({ generate: async () => { throw privateError(); } });
  let calls = 0;
  const broken = harness({ generate: async () => { throw privateError(); }, reportFailure: () => { calls++; throw privateError(); } });
  const expected = await normal.handler(request());
  const response = await broken.handler(request());
  assert.equal(calls, 1);
  assert.equal(response.status, expected.status);
  const actualBody = await response.json(), expectedBody = await expected.json();
  assert.match(actualBody.requestId, /^[0-9a-f-]{36}$/);
  assert.notEqual(actualBody.requestId, expectedBody.requestId);
  delete actualBody.requestId; delete expectedBody.requestId;
  assert.deepEqual(actualBody, expectedBody);
});

test('successful, empty, and expected quota-denied requests do not report server failures', async () => {
  const success = harness();
  assert.equal((await success.handler(request())).status, 200);
  assert.deepEqual(success.failures, []);
  const empty = harness();
  empty.session.corpus = async () => ({ sources: [], partial: false });
  assert.equal((await (await empty.handler(request())).json()).status, 'insufficient');
  assert.deepEqual(empty.failures, []);
  assert.equal(empty.state.generations, 0);
  const quota = harness();
  quota.session.reserve = async () => false;
  assert.equal((await quota.handler(request())).status, 429);
  assert.deepEqual(quota.failures, []);
  assert.equal(quota.state.generations, 0);
});

test('independent concurrent requests retain their own failure stage and correlation', async () => {
  let release;
  const paused = new Promise(resolve => { release = resolve; });
  let generations = 0, lookups = 0;
  const { handler, failures } = harness({
    generate: async () => { generations++; await paused; throw privateError(); },
    cache: { get: async () => { lookups++; return null; }, put: async () => {} },
  });
  const first = handler(request()), second = handler(request());
  while (generations < 2 || lookups < 2) await new Promise(resolve => setImmediate(resolve));
  release();
  const responses = await Promise.all([first, second]);
  assert.deepEqual(responses.map(response => response.status), [503, 503]);
  assert.equal(generations, 2);
  assert.deepEqual(failures.map(({ stage, status, category }) => ({ stage, status, category })), [
    { stage: 'generation', status: 503, category: 'unavailable' }, { stage: 'generation', status: 503, category: 'unavailable' },
  ]);
  assert.equal(new Set(failures.map(event => event.requestId)).size, 2);
  assertPrivate(failures);
});

test('Workers AI diagnostics distinguish missing binding, provider failure, and unusable output', async () => {
  const cases = [
    ['missing_binding', undefined],
    ['provider_error', { run: async () => { throw privateError(); } }],
    ['incomplete_output', { run: async () => ({ choices: [{ finish_reason: 'length', message: { content: secret } }] }) }],
    ['empty_output', { run: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '' } }] }) }],
    ['oversized_output', { run: async () => ({ response: secret.repeat(2000) }) }],
  ];
  for (const [reason, binding] of cases) {
    const events = [];
    await assert.rejects(() => provider.runAssistantModel(prompt, { provider: 'workers-ai', binding, reportFailure: value => events.push(value) }), error => {
      assert.equal(error.status, 503); assertPrivate({ message: error.message }); return true;
    });
    assert.deepEqual(events, [reason]); assertPrivate(events);
  }
});

test('OpenAI diagnostics never expose upstream error responses or API keys', async () => {
  for (const [reason, options] of [
    ['missing_key', {}],
    ['provider_error', { apiKey: token, fetcher: async () => new Response(secret, { status: 429 }) }],
    ['incomplete_output', { apiKey: token, fetcher: async () => Response.json({ status: 'incomplete', error: secret }) }],
    ['empty_output', { apiKey: token, fetcher: async () => Response.json({ status: 'completed', output: [] }) }],
  ]) {
    const events = [];
    await assert.rejects(() => provider.runAssistantModel(prompt, { provider: 'openai', ...options, reportFailure: value => events.push(value) }), error => {
      assert.equal(error.status, 503); assertPrivate({ message: error.message }); return true;
    });
    assert.deepEqual(events, [reason]); assertPrivate(events);
  }
});

test('cancellation and the provider deadline have separate safe reasons', async (t) => {
  const cancelled = new AbortController();
  cancelled.abort(privateError());
  let calls = 0;
  const cancellations = [];
  await assert.rejects(() => provider.runAssistantModel(prompt, {
    provider: 'workers-ai', signal: cancelled.signal,
    binding: { run: async () => { calls++; return {}; } }, reportFailure: reason => cancellations.push(reason),
  }), error => error.status === 503);
  assert.equal(calls, 0);
  assert.deepEqual(cancellations, ['cancelled']);

  const deadline = new AbortController();
  t.mock.method(AbortSignal, 'timeout', milliseconds => { assert.equal(milliseconds, 25000); return deadline.signal; });
  const timeouts = [];
  const running = provider.runAssistantModel(prompt, {
    provider: 'workers-ai', binding: { run: async () => new Promise(() => {}) }, reportFailure: reason => timeouts.push(reason),
  });
  deadline.abort(privateError());
  await assert.rejects(() => running, error => { assert.equal(error.status, 503); assertPrivate({ message: error.message }); return true; });
  assert.deepEqual(timeouts, ['timeout']);
});

test('provider diagnostic failure is contained and successful inference emits no failure', async () => {
  let reports = 0;
  await assert.rejects(() => provider.runAssistantModel(prompt, {
    provider: 'workers-ai', reportFailure: () => { reports++; throw privateError(); },
  }), error => { assert.equal(error.status, 503); assertPrivate({ message: error.message }); return true; });
  assert.equal(reports, 1);
  const events = [];
  const result = await provider.runAssistantModel(prompt, {
    provider: 'workers-ai', binding: { run: async () => ({ response: JSON.stringify(output) }) }, reportFailure: reason => events.push(reason),
  });
  assert.equal(result, JSON.stringify(output));
  assert.deepEqual(events, []);
});

test('all providers receive bounded span schemas and restore only server-selected source evidence', async () => {
  const otherId = '00000000-0000-4000-8000-000000000002';
  const unrelatedId = 'q:00000000-0000-4000-8000-000000000099';
  const reply = { ...source, id: `a:${otherId}`, kind: 'reply', body: 'My passport arrived on Thursday.' };
  const corpus = core.prepareAssistantCorpus({ sources: [source, reply], partial: false }, input);
  // Untrusted browser fields cannot add IDs to the generated provider schema.
  const parsed = core.parseAssistantRequest({ ...input, sourceIds: [unrelatedId], sources: [{ id: unrelatedId }], evidenceSpans: [{ id: 'attacker-span', sourceId: unrelatedId, quote: 'Untrusted browser quote.' }] });
  assert.equal(parsed.evidenceSpans, undefined);
  const boundedPrompt = core.assistantPrompt(parsed, corpus);
  const selected = boundedPrompt.evidenceSpans.find(span => span.sourceId === source.id && span.quote === source.body);
  assert(selected, 'The server must supply the exact approved source span');
  const slots = (items, count) => {
    assert(items.length <= count);
    return Object.fromEntries(Array.from({ length: count }, (_, index) => [`slot${index + 1}`, index < items.length ? items[index] : null]));
  };
  const modelAnswer = spanId => JSON.stringify({ ...output,
    claims: slots([{ ...output.claims[0], evidence: slots([{ spanId }], 4) }], 6),
    disagreements: slots([], 3), unanswered: slots(output.unanswered, 4),
  });
  const modelOutput = modelAnswer(selected.id);
  const schemas = [], validated = [];
  boundedPrompt.validateOutput = raw => validated.push(raw);
  const workersResult = await provider.runAssistantModel(boundedPrompt, {
    provider: 'workers-ai', binding: { run: async (_model, payload) => {
      schemas.push(payload.response_format.json_schema.schema);
      return { choices: [{ finish_reason: 'stop', message: { content: modelOutput } }] };
    } },
  });
  const openaiResult = await provider.runAssistantModel(boundedPrompt, {
    provider: 'openai', apiKey: token, fetcher: async (_url, init) => {
      schemas.push(JSON.parse(init.body).text.format.schema);
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: modelOutput }] }] });
    },
  });
  const groqResult = await provider.runAssistantModel(boundedPrompt, {
    provider: 'groq', apiKey: token, fetcher: async (_url, init) => {
      schemas.push(JSON.parse(init.body).response_format.json_schema.schema);
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: modelOutput } }] });
    },
  });
  for (const schema of schemas) {
    for (const [key, maximum] of [['claims', 6], ['disagreements', 3]]) {
      assert.equal(schema.properties[key].type, 'object');
      assert.equal(schema.properties[key].additionalProperties, false);
      assert.equal(schema.properties[key].required.length, maximum);
      assert.deepEqual(schema.properties[key].properties.slot1.anyOf, [{ $ref: '#/$defs/claim' }, { type: 'null' }]);
    }
    const evidence = schema.$defs.evidenceSpan;
    assert.deepEqual(evidence.required, ['spanId']);
    assert.deepEqual(evidence.properties.spanId.enum, boundedPrompt.evidenceSpans.map(span => span.id));
    assert(!evidence.properties.spanId.enum.includes('attacker-span'));
    assert.equal(evidence.additionalProperties, false);
    assert.equal(evidence.properties.sourceId, undefined); assert.equal(evidence.properties.quote, undefined);
    assert.equal(schema.$defs.evidenceSlots.required.length, 4);
    assert.equal(schema.$defs.claim.properties.text.maxLength, 700);
    assert.equal(schema.properties.unanswered.properties.slot1.anyOf[0].maxLength, 400);
    assert.doesNotMatch(JSON.stringify(schema), /"type":"array"|maxItems|minItems/);
  }
  assert.equal(schemas.length, 3);
  assert.deepEqual(validated, [workersResult, openaiResult, groqResult]);
  for (const raw of [workersResult, openaiResult, groqResult]) {
    assert.equal(core.validateAssistantOutput(raw, corpus).status, 'answered');
    assert.deepEqual(JSON.parse(raw).claims[0].evidence, output.claims[0].evidence);
    assert.doesNotMatch(raw, /spanId|attacker-span/);
  }
  const laterPrompt = core.assistantPrompt(input, { sources: [reply], partial: false });
  const laterSchema = provider.assistantOutputSchema(laterPrompt);
  assert.deepEqual(laterSchema.$defs.evidenceSpan.properties.spanId.enum, laterPrompt.evidenceSpans.map(span => span.id));
  assert.deepEqual(laterPrompt.evidenceSpans.map(span => span.sourceId), [reply.id]);
  const laterResolved = JSON.parse(provider.resolveAssistantEvidence(modelAnswer(laterPrompt.evidenceSpans[0].id), laterPrompt));
  assert.deepEqual(laterResolved.claims[0].evidence, [{ sourceId: reply.id, quote: reply.body }]);
  assert.equal(provider.ASSISTANT_OUTPUT_SCHEMA.properties.claims.items.properties.evidence.items.properties.sourceId.enum, undefined);
});

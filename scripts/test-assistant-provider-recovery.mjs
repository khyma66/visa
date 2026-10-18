import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const imports = { './assistant-models.json': `data:text/javascript;base64,${Buffer.from('export default ' + await readFile(new URL('../src/lib/assistant-models.json', import.meta.url), 'utf8')).toString('base64')}` };
for (const name of ['assistant-context', 'assistant-core', 'assistant-provider']) {
  const code = ts.transpileModule(await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  imports['./' + name] = `data:text/javascript;base64,${Buffer.from(code.replace(/(from\s+)(['"])([^'"]+)\2/g, (_, prefix, _quote, dependency) => { assert(imports[dependency], dependency); return prefix + JSON.stringify(imports[dependency]); })).toString('base64')}`;
}
const {runAssistantModel, assistantOutputSchema, resolveAssistantEvidence} = await import(imports['./assistant-provider']);
const {AssistantError, validateAssistantOutput} = await import(imports['./assistant-core']);
const prompt = {system:'Only source-supported claims.',user:'Synthetic evidence only.',sourceIds:['q:synthetic']};
const output = JSON.stringify({status:'insufficient',claims:[],disagreements:[],unanswered:[]});
const success = () => Response.json({choices:[{finish_reason:'stop',message:{content:output}}]});
test('only known provider-generated schema failures receive one bounded format repair', async()=>{
  for(const code of ['json_validate_failed','json_generation_failed']){
    const calls=[],transport=[];
    const result=await runAssistantModel(prompt,{provider:'groq',apiKey:'synthetic-private-key',reportTransport:value=>transport.push(value),fetcher:async(_url,init)=>{
      calls.push(init);
      return calls.length===1?Response.json({error:{code,message:'Private user text: maxItems got6 want4',failed_generation:'private untrusted content'}},{status:400}):success();
    }});
    assert.equal(result,output);assert.equal(calls.length,2);
    assert.equal(calls[0].signal,calls[1].signal,'A repair must not reset the timeout');
    assert.match(JSON.parse(calls[1].body).messages[0].content,/FORMAT REPAIR/);
    assert.deepEqual(transport.map(x=>x.attempt),[1,2]);
    assert.equal(transport[0].errorCode,code);
    assert.doesNotMatch(JSON.stringify(transport),/Private user|untrusted|synthetic-private-key/);
  }
});
test('configuration, rate and unknown errors never trigger automatic retries',async()=>{
  for(const [status,code] of [[400,'invalid_parameter'],[400,'context_length_exceeded'],[401,'invalid_api_key'],[403,'model_permission_blocked_project'],[429,'rate_limit_exceeded'],[500,'json_validate_failed']]){
    let calls=0;
    await assert.rejects(runAssistantModel(prompt,{provider:'groq',apiKey:'synthetic-private-key',fetcher:async()=>{calls++;return Response.json({error:{code,message:'private'}},{status});}}));
    assert.equal(calls,1);
  }
});
test('repeated schema rejection stops after two attempts and retains failure classification',async()=>{
  let calls=0,reason;const transport=[];
  await assert.rejects(runAssistantModel(prompt,{provider:'groq',apiKey:'synthetic-private-key',reportFailure:value=>{reason=value;},reportTransport:value=>transport.push(value),fetcher:async()=>{calls++;return Response.json({error:{code:'json_validate_failed',message:'maxLength: private source text'}},{status:400});}}),error=>error.status===503);
  assert.equal(calls,2);assert.equal(reason,'invalid_request');assert.equal(transport[1].constraint,'maxLength');
});
test('cancelled request cannot launch a format repair',async()=>{
  const controller=new AbortController();let calls=0;
  await assert.rejects(runAssistantModel(prompt,{provider:'groq',apiKey:'synthetic-private-key',signal:controller.signal,fetcher:async()=>{calls++;controller.abort();return Response.json({error:{code:'json_validate_failed'}},{status:400});}}));
  assert.equal(calls,1);
});
test('local citation validation shares the same second attempt and never replays rejected text',async()=>{
  const calls=[];let validations=0;
  const checked={...prompt,validateOutput:()=>{if(++validations===1)throw new AssistantError(502,'private rejected text',undefined,'citation_quote');}};
  assert.equal(await runAssistantModel(checked,{provider:'groq',apiKey:'synthetic-private-key',fetcher:async(_url,init)=>{calls.push(init);return success();}}),output);
  assert.equal(calls.length,2);assert.equal(validations,2);assert.equal(calls[0].signal,calls[1].signal);
  assert.doesNotMatch(calls[1].body,/private rejected text/);
  assert.match(JSON.parse(calls[1].body).messages[0].content,/continuous verbatim/);
});
test('provider schema failure followed by citation failure cannot multiply answer attempts',async()=>{
  let calls=0;
  await assert.rejects(runAssistantModel({...prompt,validateOutput:()=>{throw new AssistantError(502,'invalid quote',undefined,'citation_quote');}},
    {provider:'groq',apiKey:'synthetic-private-key',fetcher:async()=>++calls===1?Response.json({error:{code:'json_validate_failed'}},{status:400}):success()}),error=>error.status===502&&error.code==='citation_quote');
  assert.equal(calls,2);
});
test('semantic insufficiency and unknown validation errors are never automatically retried',async()=>{
  for(const validateOutput of [()=>{},()=>{throw new Error('unknown private failure');}]){
    let calls=0;await runAssistantModel({...prompt,validateOutput},{provider:'groq',apiKey:'synthetic-private-key',fetcher:async()=>{calls++;return success();}}).catch(()=>{});
    assert.equal(calls,1);
  }
});

test('server-only single-attempt cap disables both HTTP format and local citation repair', async () => {
  for (const outputKind of [undefined, 'review']) {
    let calls = 0;
    await assert.rejects(runAssistantModel({ ...prompt, outputKind, ...(outputKind ? { reviewIds: ['claim:0'] } : {}), maxAttempts: 1 }, {
      provider: 'groq', apiKey: 'synthetic-private-key', fetcher: async (_url, init) => {
        calls++; assert(!JSON.stringify(JSON.parse(init.body)).includes('maxAttempts'));
        return Response.json({ error: { code: 'json_validate_failed' } }, { status: 400 });
      },
    }));
    assert.equal(calls, 1, outputKind ?? 'answer');
  }
  let calls = 0;
  await assert.rejects(runAssistantModel({ ...prompt, maxAttempts: 1, validateOutput() { throw new AssistantError(502, 'private', undefined, 'citation_quote'); } }, {
    provider: 'groq', apiKey: 'synthetic-private-key', fetcher: async () => { calls++; return success(); },
  }), error => error.status === 502 && error.code === 'citation_quote');
  assert.equal(calls, 1);
});

test('in-process attempt overrides clamp to one or two and can never extend the hard cap', async () => {
  for (const [maxAttempts, expected] of [[0, 1], [-1, 1], [1, 1], [1.9, 1], [2, 2], [99, 2], [Infinity, 2], [NaN, 2], ['99', 2]]) {
    let calls = 0;
    await assert.rejects(runAssistantModel({ ...prompt, maxAttempts }, { provider: 'groq', apiKey: 'synthetic-private-key', fetcher: async () => {
      calls++; return Response.json({ error: { code: 'json_generation_failed' } }, { status: 400 });
    } }));
    assert.equal(calls, expected, `maxAttempts=${maxAttempts}`);
  }
});

const spans = [
  { id: 'span-1', sourceId: 'q:synthetic', quote: 'मेरे पासपोर्ट का नाम cafe\u0301 है।\nIt arrived Friday 🙂.' },
  { id: 'span-2', sourceId: 'a:synthetic', quote: 'My passport did not arrive on Friday.' },
];
const spanPrompt = { ...prompt, sourceIds: spans.map(span => span.sourceId), evidenceSpans: spans };
const spanAnswer = { status: 'answered', disagreements: [], claims: [{ text: 'A member reported Friday delivery.', evidence: [{ spanId: 'span-1' }] }], unanswered: [] };
const slots = (items, count) => {
  assert(items.length <= count, 'Test fixtures must never silently discard overflow');
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [`slot${index + 1}`, index < items.length ? items[index] : null]));
};
const spanWire = value => ({ ...value,
  claims: slots(value.claims.map(item => ({ ...item, evidence: slots(item.evidence, 4) })), 6),
  disagreements: slots(value.disagreements.map(item => ({ ...item, evidence: slots(item.evidence, 4) })), 3),
  unanswered: slots(value.unanswered, 4),
});
const spanRaw = value => JSON.stringify(spanWire(value));
const spanSuccess = value => Response.json({ choices: [{ finish_reason: 'stop', message: { content: spanRaw(value) } }] });

test('a comparison can answer alone in either section without copying, moving or rewriting evidence', async () => {
  const comparison = { text: 'One report describes Friday delivery, while another reports no Friday delivery.', evidence: [{ spanId: 'span-1' }, { spanId: 'span-2' }] };
  for (const section of ['disagreements', 'claims']) {
    const answer = { status: 'answered', claims: [], disagreements: [], unanswered: [], [section]: [comparison] };
    const before = structuredClone(answer);
    const expected = { ...answer, [section]: [{ ...comparison, evidence: spans.map(({ sourceId, quote }) => ({ sourceId, quote })) }] };
    assert.deepEqual(JSON.parse(resolveAssistantEvidence(spanRaw(answer), spanPrompt)), expected);
    for (const provider of ['groq', 'workers-ai', 'openai']) {
      let calls = 0, validated;
      const raw = await runAssistantModel({ ...spanPrompt, validateOutput: value => { validated = JSON.parse(value); } }, {
        provider, apiKey: 'synthetic-private-key',
        binding: { run: async () => { calls++; return { response: spanRaw(answer) }; } },
        fetcher: async () => {
          calls++;
          return provider === 'groq' ? spanSuccess(answer) : Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: spanRaw(answer) }] }] });
        },
      });
      assert.equal(calls, 1); assert.deepEqual(JSON.parse(raw), expected); assert.deepEqual(validated, expected);
    }
    assert.deepEqual(answer, before);
  }
  for (const schema of [assistantOutputSchema(spanPrompt), assistantOutputSchema(prompt)]) {
    assert.match(schema.properties.status.description, /across claims and disagreements/);
    assert.match(schema.properties.disagreements.description, /without duplicating/);
    assert.match(schema.properties.claims.description, /supported comparison may appear here/);
  }
});

test('comparison-only answers still reject empty, insufficient-with-facts and invalid proof without salvage', () => {
  const comparison = { text: 'One report describes Friday delivery, while another reports no Friday delivery.', evidence: [{ spanId: 'span-1' }, { spanId: 'span-2' }] };
  const answer = { status: 'answered', claims: [], disagreements: [comparison], unanswered: [] };
  for (const [value, code] of [
    [{ ...answer, disagreements: [] }, 'answered_without_claims'],
    [{ ...answer, status: 'insufficient' }, 'output_schema'],
    [{ ...answer, disagreements: [{ ...comparison, evidence: [{ spanId: 'span-1' }] }] }, 'citation_missing'],
    [{ ...answer, disagreements: [{ ...comparison, evidence: [{ spanId: 'span-1' }, { spanId: 'foreign' }] }] }, 'citation_source'],
  ]) assert.throws(() => resolveAssistantEvidence(spanRaw(value), spanPrompt), error => error.code === code);
  const missingQuote = { ...spanPrompt, evidenceSpans: [spans[0], { id: spans[1].id, sourceId: spans[1].sourceId }] };
  assert.throws(() => resolveAssistantEvidence(spanRaw(answer), missingQuote), error => error.code === 'citation_schema');
  const sameSource = { ...spanPrompt, evidenceSpans: [spans[0], { ...spans[1], sourceId: spans[0].sourceId }] };
  const resolved = resolveAssistantEvidence(spanRaw(answer), sameSource);
  const source = { id: spans[0].sourceId, title: 'Delivery', body: spans.map(span => span.quote).join('\n'), kind: 'question', url: '/questions/synthetic', createdAt: '2026-10-17T00:00:00Z' };
  assert.throws(() => validateAssistantOutput(resolved, { sources: [source], partial: false }), error => error.code === 'conflict_sources');
});

test('every answer provider requests span IDs only and resolves exact Unicode evidence before validation and return', async () => {
  for (const provider of ['groq', 'workers-ai', 'openai']) {
    let calls = 0, wire, validated;
    const checked = { ...spanPrompt, validateOutput: raw => { validated = JSON.parse(raw); } };
    const result = await runAssistantModel(checked, { provider, apiKey: 'synthetic-private-key',
      binding: { run: async (_model, input) => { calls++; wire = input; return { response: spanRaw(spanAnswer) }; } },
      fetcher: async (_url, options) => {
        calls++; wire = JSON.parse(options.body);
        return provider === 'groq' ? spanSuccess(spanAnswer) : Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: spanRaw(spanAnswer) }] }] });
      },
    });
    const resolved = JSON.parse(result), schema = wire.response_format?.json_schema.schema ?? wire.text.format.schema;
    for (const [section, count] of [['claims', 6], ['disagreements', 3], ['unanswered', 4]]) {
      const collection = schema.properties[section];
      assert.equal(collection.type, 'object'); assert.equal(collection.additionalProperties, false);
      assert.deepEqual(collection.required, Array.from({ length: count }, (_, index) => `slot${index + 1}`));
      assert.deepEqual(Object.keys(collection.properties), collection.required);
      for (const item of Object.values(collection.properties)) assert.deepEqual(item.anyOf[1], { type: 'null' });
    }
    assert.deepEqual(schema.$defs.evidenceSpan.required, ['spanId']); assert.equal(schema.$defs.evidenceSpan.additionalProperties, false);
    assert.deepEqual(schema.$defs.evidenceSpan.properties, { spanId: { type: 'string', enum: ['span-1', 'span-2'] } });
    assert.deepEqual(schema.$defs.evidenceSlots.properties.slot1.anyOf[0], { $ref: '#/$defs/evidenceSpan' });
    assert.equal(schema.$defs.evidenceSlots.required.length, 4);
    assert.doesNotMatch(JSON.stringify(schema), /"type":"array"|maxItems|minItems/);
    assert.equal(JSON.stringify(schema).match(/"span-1"/g).length, 1, 'The evidence enum appears once, not once per slot');
    assert.equal(calls, 1, provider); assert.deepEqual(resolved, validated, provider);
    assert.deepEqual(resolved.claims[0].evidence, [{ sourceId: spans[0].sourceId, quote: spans[0].quote }]);
    assert.equal(Buffer.compare(Buffer.from(resolved.claims[0].evidence[0].quote), Buffer.from(spans[0].quote)), 0);
    assert.equal(Object.hasOwn(wire, 'evidenceSpans'), false); assert.doesNotMatch(result, /spanId/);
  }
});

test('span resolution rejects foreign, altered, duplicate and extra-field evidence without partial salvage', () => {
  const bad = [
    [{ spanId: 'span-999' }, 'citation_source'], [{ spanId: ' span-1' }, 'citation_source'],
    [{ spanId: 'SPAN-1' }, 'citation_source'], [{ spanId: 'span-1\u200b' }, 'citation_source'],
    [{ spanId: 'span-1', quote: spans[0].quote }, 'citation_schema'],
    [{ spanId: 'span-1', sourceId: spans[0].sourceId }, 'citation_schema'],
    [{ sourceId: spans[0].sourceId, quote: spans[0].quote }, 'citation_schema'],
    [{ spanId: ['span-1'] }, 'citation_schema'], [{}, 'citation_schema'], [false, 'citation_schema'],
  ];
  for (const [entry, code] of bad) {
    const answer = { ...spanAnswer, claims: [...spanAnswer.claims, { text: 'Another alleged fact.', evidence: [entry] }] };
    assert.throws(() => resolveAssistantEvidence(spanRaw(answer), spanPrompt), error => error.status === 502 && error.code === code);
  }
  const duplicated = { ...spanAnswer, claims: [{ ...spanAnswer.claims[0], evidence: [{ spanId: 'span-1' }, { spanId: 'span-1' }] }] };
  assert.throws(() => resolveAssistantEvidence(spanRaw(duplicated), spanPrompt), error => error.code === 'citation_schema');
  assert.throws(() => resolveAssistantEvidence('{', spanPrompt), error => error.code === 'output_json');
  assert.throws(() => resolveAssistantEvidence(spanRaw({ ...spanAnswer, sourceId: 'untrusted' }), spanPrompt), error => error.code === 'output_schema');
  assert.throws(() => resolveAssistantEvidence(spanRaw({ ...spanAnswer, status: ['answered'] }), spanPrompt), error => error.code === 'output_schema');
  assert.throws(() => resolveAssistantEvidence(spanRaw({ ...spanAnswer, claims: [{ ...spanAnswer.claims[0], quote: 'untrusted' }] }), spanPrompt), error => error.code === 'claim_text');
  const reused = { ...spanAnswer, claims: [...spanAnswer.claims, spanAnswer.claims[0]], disagreements: [{ text: 'Two members reported different delivery outcomes.', evidence: [{ spanId: 'span-1' }, { spanId: 'span-2' }] }] };
  const resolved = JSON.parse(resolveAssistantEvidence(spanRaw(reused), spanPrompt));
  assert.equal(resolved.claims.length, 2); assert.equal(resolved.disagreements.length, 1);
});

test('fixed slots require every exact key and never drop overflow, unknown fields or malformed non-null values', () => {
  const cases = [
    [value => { value.claims.slot7 = value.claims.slot1; }, 'claim_limit'],
    [value => { delete value.claims.slot6; }, 'claim_limit'],
    [value => { value.claims = [value.claims.slot1]; }, 'claim_limit'],
    [value => { value.claims.slot6 = false; }, 'claim_text'],
    [value => { value.claims.slot6 = { text: 'Unverified trailing fact.', evidence: slots([{ spanId: 'foreign' }], 4) }; }, 'citation_source'],
    [value => { value.disagreements.slot4 = null; }, 'claim_limit'],
    [value => { delete value.disagreements.slot3; }, 'claim_limit'],
    [value => { value.unanswered.slot5 = 'Extra question'; }, 'unanswered_limit'],
    [value => { delete value.unanswered.slot4; }, 'unanswered_limit'],
    [value => { value.unanswered.slot4 = {}; }, 'unanswered_limit'],
    [value => { value.claims.slot1.evidence.slot5 = { spanId: 'span-2' }; }, 'citation_schema'],
    [value => { delete value.claims.slot1.evidence.slot4; }, 'citation_schema'],
    [value => { value.claims.slot1.evidence = [{ spanId: 'span-1' }]; }, 'citation_schema'],
    [value => { value.claims.slot1.evidence.slot4 = []; }, 'citation_schema'],
    [value => { value.claims.slot1.evidence.slot1 = null; }, 'citation_missing'],
    [value => { value.claims.slot1.text = 'x'.repeat(701); }, 'claim_text'],
    [value => { value.unanswered.slot4 = 'x'.repeat(401); }, 'unanswered_limit'],
    [value => { value.status = 'insufficient'; }, 'output_schema'],
    [value => { value.claims = slots([], 6); }, 'answered_without_claims'],
    [value => { delete value.claims; value.other = slots([], 6); }, 'output_schema'],
  ];
  for (const [mutate, code] of cases) {
    const value = spanWire(spanAnswer); mutate(value);
    assert.throws(() => resolveAssistantEvidence(JSON.stringify(value), spanPrompt), error => error.status === 502 && error.code === code, String(mutate));
  }
  assert.throws(() => resolveAssistantEvidence(JSON.stringify(spanAnswer), spanPrompt), error => error.code === 'unanswered_limit', 'A present catalog never enables legacy array fallback');
});

test('explicit null slots preserve ordinal non-null values and the existing public response contract', () => {
  const value = spanWire(spanAnswer);
  value.claims.slot6 = { text: 'A second member reported a different outcome.', evidence: slots([], 4) };
  value.claims.slot6.evidence.slot4 = { spanId: 'span-2' };
  value.claims.slot1.evidence = { slot1: null, slot2: null, slot3: { spanId: 'span-1' }, slot4: null };
  value.unanswered.slot4 = 'What happened afterward?';
  const resolved = JSON.parse(resolveAssistantEvidence(JSON.stringify(value), spanPrompt));
  assert.deepEqual(Object.keys(resolved), ['status', 'disagreements', 'claims', 'unanswered']);
  assert.deepEqual(resolved.claims.map(item => item.text), [spanAnswer.claims[0].text, value.claims.slot6.text]);
  assert.deepEqual(resolved.claims.map(item => item.evidence), spans.map(span => [{ sourceId: span.sourceId, quote: span.quote }]));
  assert.deepEqual(resolved.unanswered, ['What happened afterward?']);
  assert.equal(resolved.disagreements.length, 0);
  const insufficient = JSON.parse(resolveAssistantEvidence(spanRaw(JSON.parse(output)), spanPrompt));
  assert.deepEqual(insufficient, JSON.parse(output));
});

test('fixed-slot schema has one bounded catalog, closed required objects and no cardinality-dependent arrays', () => {
  const evidenceSpans = Array.from({ length: 256 }, (_, index) => ({ ...spans[0], id: `span-${index + 1}` }));
  const schema = assistantOutputSchema({ ...spanPrompt, evidenceSpans });
  const serialized = JSON.stringify(schema);
  assert.equal(schema.$defs.evidenceSpan.properties.spanId.enum.length, 256);
  for (const span of evidenceSpans) assert.equal(serialized.split(JSON.stringify(span.id)).length - 1, 1);
  assert(serialized.length < 10_000, 'References must avoid multiplying the256-value enum across36 evidence slots');
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'object') {
      assert.equal(value.additionalProperties, false);
      assert.deepEqual(value.required, Object.keys(value.properties));
    }
    if (value.$ref) assert(schema.$defs[value.$ref.replace('#/$defs/', '')]);
    for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(visit); else visit(child);
  };
  visit(schema);
  assert.doesNotMatch(serialized, /"type":"array"|maxItems|minItems/);
  assert.deepEqual(schema.required, ['status', 'disagreements', 'claims', 'unanswered']);
});

test('all permitted claim, disagreement, evidence and unanswered slots remain available without relaxing proof limits', () => {
  const evidenceSpans = [...spans, { ...spans[0], id: 'span-3', quote: 'A member reported completing the interview.' }, { ...spans[1], id: 'span-4', quote: 'Another member reported receiving a decision.' }];
  const evidence = evidenceSpans.map(span => ({ spanId: span.id }));
  const claim = { text: 'The members described different personal experiences.', evidence };
  const full = { status: 'answered', claims: Array.from({ length: 6 }, () => claim), disagreements: Array.from({ length: 3 }, () => claim), unanswered: Array.from({ length: 4 }, (_, index) => `Unresolved question${index + 1}`) };
  const resolved = JSON.parse(resolveAssistantEvidence(spanRaw(full), { ...spanPrompt, evidenceSpans }));
  assert.equal(resolved.claims.length, 6); assert.equal(resolved.disagreements.length, 3); assert.equal(resolved.unanswered.length, 4);
  assert(resolved.claims.concat(resolved.disagreements).every(item => item.evidence.length === 4));
  const shortConflict = { ...spanAnswer, disagreements: [{ text: 'Alleged conflict.', evidence: [{ spanId: 'span-1' }] }] };
  assert.throws(() => resolveAssistantEvidence(spanRaw(shortConflict), spanPrompt), error => error.code === 'citation_missing');
});

test('span catalogs fail closed before any provider call when present but empty, invalid, duplicate or out of scope', async () => {
  for (const evidenceSpans of [undefined, null, [], {}, [spans[0], spans[0]], [{ ...spans[0], quote: 'short' }], [{ ...spans[0], quote: 'x'.repeat(401) }], [{ ...spans[0], sourceId: 'q:foreign' }], [{ ...spans[0], extra: true }], Array.from({ length: 257 }, (_, index) => ({ ...spans[0], id: `span-${index + 1}` }))]) {
    let calls = 0;
    const invalid = { ...spanPrompt, evidenceSpans };
    assert.throws(() => assistantOutputSchema(invalid), error => error.code === 'citation_schema');
    assert.throws(() => resolveAssistantEvidence(output, invalid), error => error.code === 'citation_schema');
    await assert.rejects(runAssistantModel(invalid, { provider: 'groq', apiKey: 'synthetic-private-key', fetcher: async () => { calls++; return success(); } }), error => error.code === 'citation_schema');
    assert.equal(calls, 0);
  }
  assert.equal(resolveAssistantEvidence(output, prompt), output, 'Only a genuinely absent catalog allows legacy prompts');
  assert(assistantOutputSchema(prompt).properties.claims.items.properties.evidence.items.properties.quote);
});

test('resolved spans retain independent-source disagreement validation and leave review output unchanged', () => {
  const sameSource = { ...spanPrompt, evidenceSpans: [spans[0], { ...spans[1], sourceId: spans[0].sourceId }] };
  const answer = { ...spanAnswer, disagreements: [{ text: 'Allegedly conflicting reports.', evidence: [{ spanId: 'span-1' }, { spanId: 'span-2' }] }] };
  const raw = resolveAssistantEvidence(spanRaw(answer), sameSource);
  const source = { id: spans[0].sourceId, title: 'Delivery', body: spans.map(span => span.quote).join('\n'), kind: 'question', url: '/questions/synthetic', createdAt: '2026-10-17T00:00:00Z' };
  assert.throws(() => validateAssistantOutput(raw, { sources: [source], partial: false }), error => error.code === 'conflict_sources');
  const reviewPrompt = { ...spanPrompt, outputKind: 'review', reviewIds: ['claim:0'], evidenceSpans: [] };
  const review = '{"checks":[{"id":"claim:0","supported":true}],"fulfillsTask":true}';
  assert.equal(resolveAssistantEvidence(review, reviewPrompt), review);
  assert.deepEqual(assistantOutputSchema(reviewPrompt).properties.checks.items.properties.id.enum, ['claim:0']);
});

test('span resolution failures share the two-attempt budget and format repair never asks for rewritten quotes', async () => {
  for (const first of ['bad-span', 'schema-400']) {
    const calls = [], validated = [];
    const result = await runAssistantModel({ ...spanPrompt, validateOutput: raw => validated.push(raw) }, {
      provider: 'groq', apiKey: 'synthetic-private-key', fetcher: async (_url, options) => {
        calls.push(options);
        if (calls.length === 1) return first === 'schema-400' ? Response.json({ error: { code: 'json_validate_failed' } }, { status: 400 })
          : spanSuccess({ ...spanAnswer, claims: [{ ...spanAnswer.claims[0], evidence: [{ spanId: 'foreign-private-sentinel' }] }] });
        return spanSuccess(spanAnswer);
      },
    });
    assert.equal(calls.length, 2); assert.equal(validated.length, 1); assert.equal(result, validated[0]); assert.equal(calls[0].signal, calls[1].signal);
    const repair = JSON.parse(calls[1].body).messages[0].content;
    assert.match(repair, /only a spanId selected/); assert.doesNotMatch(repair, /continuous verbatim|Copy only actual source IDs|foreign-private-sentinel/);
  }
  for (const maxAttempts of [undefined, 1]) {
    let calls = 0, validations = 0;
    await assert.rejects(runAssistantModel({ ...spanPrompt, ...(maxAttempts ? { maxAttempts } : {}), validateOutput: () => { validations++; } }, {
      provider: 'groq', apiKey: 'synthetic-private-key', fetcher: async () => { calls++; return spanSuccess({ ...spanAnswer, claims: [{ ...spanAnswer.claims[0], evidence: [{ spanId: 'span-999' }] }] }); },
    }), error => error.code === 'citation_source');
    assert.equal(calls, maxAttempts ?? 2); assert.equal(validations, 0);
  }
  let calls = 0;
  await assert.rejects(runAssistantModel(spanPrompt, { provider: 'groq', apiKey: 'synthetic-private-key', fetcher: async () => ++calls === 1
    ? Response.json({ error: { code: 'json_validate_failed' } }, { status: 400 })
    : spanSuccess({ ...spanAnswer, claims: [{ ...spanAnswer.claims[0], evidence: [{ spanId: 'span-999' }] }] }),
  }), error => error.code === 'citation_source');
  assert.equal(calls, 2);
});

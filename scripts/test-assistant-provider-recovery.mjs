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
const spanSuccess = value => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });

test('every answer provider requests span IDs only and resolves exact Unicode evidence before validation and return', async () => {
  for (const provider of ['groq', 'workers-ai', 'openai']) {
    let calls = 0, wire, validated;
    const checked = { ...spanPrompt, validateOutput: raw => { validated = JSON.parse(raw); } };
    const result = await runAssistantModel(checked, { provider, apiKey: 'synthetic-private-key',
      binding: { run: async (_model, input) => { calls++; wire = input; return { response: JSON.stringify(spanAnswer) }; } },
      fetcher: async (_url, options) => {
        calls++; wire = JSON.parse(options.body);
        return provider === 'groq' ? spanSuccess(spanAnswer) : Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(spanAnswer) }] }] });
      },
    });
    const resolved = JSON.parse(result), schema = wire.response_format?.json_schema.schema ?? wire.text.format.schema;
    for (const section of ['claims', 'disagreements']) {
      const evidence = schema.properties[section].items.properties.evidence;
      assert.deepEqual(evidence.items.required, ['spanId']); assert.equal(evidence.items.additionalProperties, false);
      assert.deepEqual(evidence.items.properties, { spanId: { type: 'string', enum: ['span-1', 'span-2'] } });
    }
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
    [{ spanId: ['span-1'] }, 'citation_schema'], [{}, 'citation_schema'], [null, 'citation_schema'],
  ];
  for (const [entry, code] of bad) {
    const answer = { ...spanAnswer, claims: [...spanAnswer.claims, { text: 'Another alleged fact.', evidence: [entry] }] };
    assert.throws(() => resolveAssistantEvidence(JSON.stringify(answer), spanPrompt), error => error.status === 502 && error.code === code);
  }
  const duplicated = { ...spanAnswer, claims: [{ ...spanAnswer.claims[0], evidence: [{ spanId: 'span-1' }, { spanId: 'span-1' }] }] };
  assert.throws(() => resolveAssistantEvidence(JSON.stringify(duplicated), spanPrompt), error => error.code === 'citation_schema');
  assert.throws(() => resolveAssistantEvidence('{', spanPrompt), error => error.code === 'output_json');
  assert.throws(() => resolveAssistantEvidence(JSON.stringify({ ...spanAnswer, sourceId: 'untrusted' }), spanPrompt), error => error.code === 'output_schema');
  assert.throws(() => resolveAssistantEvidence(JSON.stringify({ ...spanAnswer, status: ['answered'] }), spanPrompt), error => error.code === 'output_schema');
  assert.throws(() => resolveAssistantEvidence(JSON.stringify({ ...spanAnswer, claims: [{ ...spanAnswer.claims[0], quote: 'untrusted' }] }), spanPrompt), error => error.code === 'claim_text');
  const reused = { ...spanAnswer, claims: [...spanAnswer.claims, spanAnswer.claims[0]], disagreements: [{ text: 'Two members reported different delivery outcomes.', evidence: [{ spanId: 'span-1' }, { spanId: 'span-2' }] }] };
  const resolved = JSON.parse(resolveAssistantEvidence(JSON.stringify(reused), spanPrompt));
  assert.equal(resolved.claims.length, 2); assert.equal(resolved.disagreements.length, 1);
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
  const raw = resolveAssistantEvidence(JSON.stringify(answer), sameSource);
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

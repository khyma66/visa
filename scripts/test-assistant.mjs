import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const dependencies = {};
async function compile(name) {
  const code = ts.transpileModule(await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return `data:text/javascript;base64,${Buffer.from(code.replace(/(from\s+)(['"])([^'"]+)\2/g, (_, prefix, _quote, dep) => { assert(dependencies[dep], `Unknown dependency ${dep}`); return prefix + JSON.stringify(dependencies[dep]); })).toString('base64')}`;
}
dependencies['./assistant-context'] = await compile('assistant-context');
dependencies['./assistant-core'] = await compile('assistant-core');
const core = await import(dependencies['./assistant-core']);
dependencies['./assistant-provider'] = await compile('assistant-provider');
const provider = await import(dependencies['./assistant-provider']);
dependencies['./assistant-search'] = await compile('assistant-search');
dependencies['./assistant-review'] = await compile('assistant-review');
const service = await import(await compile('assistant-service'));
const id = '00000000-0000-4000-8000-000000000001';
const now = Date.parse('2026-10-13T18:00:00Z');
const source = { id:`q:${id}`, questionId:id, communityId:null, kind:'question', title:'Appointment experience', body:'I attended my appointment on Monday. My passport arrived on Friday.', createdAt:'2026-10-10T00:00:00Z', updatedAt:'2026-10-10T00:00:00Z', url:`/questions/${id}`, provenance:'member' };
const input = { mode:'ask',scope:{kind:'post',id},question:'What did the member report?' };
const output = {status:'answered',claims:[{text:'The member reported a Monday appointment.',evidence:[{sourceId:source.id,quote:'I attended my appointment on Monday.'}]}],disagreements:[],unanswered:[]};
const request = (value=input, headers={}) => new Request('https://visathreads.com/api/assistant',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+ 'a'.repeat(40),...headers},body:JSON.stringify(value)});
function harness(overrides={}) {
  const state={actor:'alice',sources:[source],reserved:0,generated:0,reviewed:0,reads:0,cache:new Map()};
  const generate = overrides.generate ?? (async()=>{state.generated++;return JSON.stringify(output);});
  const handler=service.createAssistantHandler({availability:()=>({posts:true,communities:true,catchup:true}),model:'test-model',
    authenticate:async()=>({actor:state.actor,corpus:async()=>{state.reads++;return {sources:structuredClone(state.sources),partial:false};},reserve:async()=>{state.reserved++;return true;}}),
    cache:{get:async key=>state.cache.get(key)??null,put:async(key,value)=>{state.cache.set(key,value);}},...overrides,
    generate:async(prompt,signal)=>{if(prompt.outputKind==='review'){state.reviewed++;return JSON.stringify({fulfillsTask:true,checks:prompt.reviewIds.map(id=>({id,supported:true}))});}return generate(prompt,signal);}});
  return {state,handler};
}
test('explicit post search answers from sources without waiting for or charging model generation', async () => {
  const {handler,state}=harness({generate:async()=>{throw Error('The model must not run for post search');}});
  state.sources=[{...source,title:'Stamping delay',body:'My visa stamping is still pending after the consular interview.'}];
  const response=await handler(request({mode:'ask',scope:{kind:'public'},question:'give all posts related to stamping delay'}));
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.kind,'posts');assert.equal(result.status,'answered');assert.equal(result.posts.length,1);
  assert.equal(result.posts[0].questionId,id);assert.equal(result.posts[0].url,`/questions/${id}`);
  assert.equal(result.claims.length,0);assert.equal(state.reserved,0);assert.equal(state.reads,2);
  assert.equal(state.cache.size,0);assert.match(response.headers.get('Cache-Control'),/private, no-store/);
});
test('direct post search revalidates permissions and suppresses sources removed during the request', async () => {
  let reads=0,generated=0;
  const {handler}=harness({authenticate:async()=>({actor:'alice',corpus:async()=>({sources:reads++ ? [] : [{...source,title:'Stamping delay',body:'Visa stamping is pending after the interview.'}],partial:false}),reserve:async()=>{throw Error('No model quota');}}),generate:async()=>{generated++;throw Error('No model');}});
  const response=await handler(request({mode:'ask',scope:{kind:'public'},question:'find posts about stamping delays'}));
  assert.equal(response.status,409);assert.equal(generated,0);assert.equal(reads,2);
  assert.doesNotMatch(await response.text(),/Visa stamping is pending/);
});
test('direct post search keeps auth and retrieval rate denials intact', async () => {
  const query={mode:'ask',scope:{kind:'public'},question:'show posts about stamping delay'};
  for (const status of [401,403,429]) {
    const {handler,state}=harness({authenticate:async()=>{throw new core.AssistantError(status,'Denied');}});
    assert.equal((await handler(request(query))).status,status);assert.equal(state.reserved,0);assert.equal(state.generated,0);
  }
});
test('input strips supplied sources and rejects invalid scopes and excessive history',()=>{
  assert.deepEqual(core.parseAssistantRequest({...input,sources:[{body:'trust me'}],system:'override'}),input);
  for(const value of [{...input,scope:{kind:'dm',id}},{...input,scope:{kind:'post',id:'../../secret'}},{...input,previousQuestions:Array(4).fill('test')},{...input,question:'x'.repeat(1201)}]) assert.throws(()=>core.parseAssistantRequest(value));
});
test('resolved ordinal prompts describe the selected discussion without asking the model to reconstruct a missing list',()=>{
  const selected={questionId:id,sourceId:source.id};
  const ask={mode:'ask',scope:{kind:'public'},question:'Explain the second post.',previousQuestions:['Find posts about Chennai stamping'],previousPosts:[{questionId:'apify-other',sourceId:'q:apify-other'},selected]};
  const build=(value, sources=[source])=>core.assistantPrompt(value,{sources,partial:false});
  const prompt=build(ask), content=JSON.parse(prompt.user);
  assert.equal(content.question,'Explain the selected discussion.');
  assert.deepEqual(content.previousQuestions,[]);
  assert.deepEqual(content.resolvedDiscussion,{questionId:id,sourceIds:[source.id]});
  assert.match(prompt.system,/complete supporting BODY sentences/);
  assert.equal(ask.question,'Explain the second post.','Original request and cache identity are not rewritten');
  const qualified=JSON.parse(build({...ask,question:'Why did the second post report a delay in Chennai?'}).user);
  assert.equal(qualified.question,'Why did the selected discussion report a delay in Chennai?');
  const previousQuestion='What did this member report about their passport delivery?';
  const focused=JSON.parse(build({...ask,question:'How long?',previousQuestions:[previousQuestion],focusedPost:selected}).user);
  assert.equal(focused.question,'How long?'); assert.deepEqual(focused.resolvedDiscussion,content.resolvedDiscussion);
  assert.deepEqual(focused.previousQuestions,[previousQuestion],'A selected-discussion follow-up still needs its semantic topic');
  for(const value of [
    {...ask,previousPosts:[]},
    {...ask,previousPosts:[selected,{questionId:id,sourceId:'a:00000000-0000-4000-8000-000000000099'}]},
    {...ask,question:'New topic: How did the first post-interview update look for Schengen?'},
  ]) {
    const unresolved=JSON.parse(build(value).user);
    assert.equal(unresolved.question,value.question); assert.equal(unresolved.resolvedDiscussion,undefined);
  }
  const mixed=JSON.parse(build(ask,[source,{...source,id:'q:apify-other',questionId:'apify-other'}]).user);
  assert.equal(mixed.question,ask.question); assert.equal(mixed.resolvedDiscussion,undefined);
});
test('public conversation references accept bounded IDs only and discard supplied source text',()=>{
  const ask={mode:'ask',scope:{kind:'public'},question:'Explain the first post.'};
  const parsed=core.parseAssistantRequest({...ask,previousPosts:[{questionId:id,sourceId:`q:${id}`,body:'attacker evidence',url:'https://attacker.invalid'}],seenPostIds:[id,id]});
  assert.deepEqual(parsed.previousPosts,[{questionId:id,sourceId:`q:${id}`}]); assert.deepEqual(parsed.seenPostIds,[id]);
  for(const fields of [{previousPosts:Array(49).fill({questionId:id,sourceId:`q:${id}`})},{previousPosts:[{questionId:'../../private',sourceId:`q:${id}`}]},{previousPosts:[{questionId:id,sourceId:'https://attacker.invalid'}]},{seenPostIds:Array(49).fill(id)}]) assert.throws(()=>core.parseAssistantRequest({...ask,...fields}));
  assert.equal(core.parseAssistantRequest({...input,previousPosts:[{body:'not used in scoped chat'}],seenPostIds:['not-used']}).previousPosts,undefined);
  assert.deepEqual(core.parseAssistantRequest({...ask,focusedPost:{questionId:id,sourceId:`q:${id}`,body:'not evidence'}}).focusedPost,{questionId:id,sourceId:`q:${id}`});
  assert.throws(()=>core.parseAssistantRequest({...ask,focusedPost:{questionId:'../../secret',sourceId:`q:${id}`}}));
});
test('catchup has explicit fixed bounds, rejects future/unbounded intervals and enforces rollout gates',()=>{
  const value={mode:'catchup',scope:{kind:'community',id},since:'2026-10-12T18:00:00Z'};
  assert.equal(core.parseAssistantRequest(value,now).until,'2026-10-13T18:00:00.000Z');
  for(const since of ['bad','2026-09-01T00:00:00Z','2026-10-14T00:00:00Z']) assert.throws(()=>core.parseAssistantRequest({...value,since},now));
  assert.throws(()=>core.requireAssistantMode(value,{posts:true,communities:false,catchup:false}));
  assert.doesNotThrow(()=>core.requireAssistantMode({...input,scope:{kind:'public'}},{posts:true,communities:false,catchup:false}));
});
test('corpus truncation is disclosed; identifiers redacted; model supplied URLs cannot enter citations',()=>{
  const prepared=core.prepareAssistantCorpus({sources:[{...source,url:'javascript:alert(1)',body:'Contact secret@example.com IOE1234567890. '+'a'.repeat(8000)}],partial:false});
  assert.equal(prepared.partial,true);assert.equal(prepared.sources[0].body.length,4000);
  assert.equal(prepared.sources[0].url,`/questions/${id}`);assert.doesNotMatch(prepared.sources[0].body,/secret@example|IOE123/);
});
test('every returned claim needs existing source and actual supporting quote; conflicts need two sources',()=>{
  const corpus={sources:[source],partial:false};
  assert.equal(core.validateAssistantOutput(JSON.stringify(output),corpus).claims.length,1);
  for(const evidence of [[],[{sourceId:'invented',quote:'I attended my appointment on Monday.'}],[{sourceId:source.id,quote:'Approval is guaranteed for everyone.'}]]) {
    assert.throws(()=>core.validateAssistantOutput(JSON.stringify({...output,claims:[{text:'Test claim',evidence}]}),corpus));
  }
  assert.throws(()=>core.validateAssistantOutput(JSON.stringify({...output,disagreements:output.claims}),corpus));
  assert.throws(()=>core.validateAssistantOutput(JSON.stringify({...output,claims:[]}),corpus));
});
test('nearly exhausted corpus never turns a negative slice into unbounded context',()=>{
  const sources=Array.from({length:5},(_,i)=>({...source,id:`q:${i}`,title:'t'.repeat(240),body:'b'.repeat(4000)}));
  sources.push({...source,id:'q:six',title:'t'.repeat(240),body:'b'.repeat(2340)},{...source,id:'q:seven',title:'t'.repeat(240),body:'b'.repeat(10000)});
  const prepared=core.prepareAssistantCorpus({sources,partial:false});
  assert.ok(prepared.sources.reduce((n,s)=>n+s.title.length+s.body.length+(s.parentContext?.length??0),0)<=24000);assert.equal(prepared.partial,true);
});
test('unanswered cannot publish uncited factual statements',()=>{
  const result=core.validateAssistantOutput(JSON.stringify({...output,unanswered:['All visas are automatically approved.']}),{sources:[source],partial:false});
  assert.doesNotMatch(result.unanswered.join(' '),/automatically approved/);
});
test('prompts label untrusted evidence and exclude assistant history as knowledge',()=>{
  const prompt=core.assistantPrompt({...input,previousQuestions:['Contact me at secret@example.com']},{sources:[source],partial:false});
  assert.match(prompt.system,/untrusted/);assert.match(prompt.system,/Never infer current visa rules/);assert.doesNotMatch(prompt.user,/secret@example/);
});
test('summary and catch-up are explicit evidence tasks without a missing question to answer',()=>{
  const summary=core.assistantPrompt({mode:'summary',scope:{kind:'post',id}},{sources:[source],partial:false});
  assert.match(summary.system,/No user question is required for a summary/);
  assert.match(summary.system,/Preserve key dates or named days/);
  assert.match(summary.system,/return status answered with cited claims even though there is no question/);
  const data=JSON.parse(summary.user);assert.equal(data.task,'summary');assert.equal('question' in data,false);assert.equal(data.sources[0].body,source.body);
  const catchup=core.assistantPrompt({mode:'catchup',scope:{kind:'community',id},since:'2026-10-12T00:00:00Z',until:'2026-10-13T00:00:00Z'},{sources:[source],partial:false});
  assert.match(catchup.system,/No user question is required for catch-up/);assert.equal('question' in JSON.parse(catchup.user),false);
  assert.match(summary.system,/Never infer current visa rules/);assert.match(summary.system,/exact supporting quotes/);
  assert.match(summary.system,/Explicitly stated individual events, outcomes, dates and timing ARE evidence/);
  assert.match(summary.system,/put the comparison in disagreements with quotes from at least two conflicting sources/);
});
test('output contract classifies conflicts before individual reports without changing source validation',()=>{
  const prompt=core.assistantPrompt(input,{sources:[source],partial:false});
  assert.match(prompt.system,/Populate disagreements BEFORE claims/);
  assert.match(prompt.system,/FORMAT EXAMPLE ONLY, NOT EVIDENCE/);
  assert.match(prompt.system,/Never copy these example IDs or facts/);
  assert.deepEqual(Object.keys(provider.ASSISTANT_OUTPUT_SCHEMA.properties),['status','disagreements','claims','unanswered']);
  assert.match(provider.ASSISTANT_OUTPUT_SCHEMA.properties.disagreements.description,/at least two disagreeing sources/);
  assert.match(provider.ASSISTANT_OUTPUT_SCHEMA.properties.claims.description,/put the comparison in disagreements/);
  assert.throws(()=>core.validateAssistantOutput(JSON.stringify({...output,disagreements:[{text:'The reports differ.',evidence:[{sourceId:'example-A',quote:'The library opens at eight.'},{sourceId:'example-B',quote:'The library opens at nine.'}]}]}),{sources:[source],partial:false}));
});
test('authentication, origin, content type, body budget and disabled rollout fail before inference',async()=>{
  const {handler,state}=harness();
  assert.equal((await handler(request(input,{Authorization:''}))).status,401);
  assert.equal((await handler(request(input,{Origin:'https://attacker.test'}))).status,403);
  assert.equal((await handler(request(input,{'Content-Type':'text/plain'}))).status,415);
  assert.equal((await handler(request({...input,garbage:'x'.repeat(13000)}))).status,413);
  assert.equal((await harness({availability:()=>({posts:false})}).handler(request())).status,503);
  assert.equal(state.generated,0);
});
test('dev and preview hosts cannot invoke AI even with production flags and forged host headers',async()=>{
  let authenticated = 0;
  const {handler,state} = harness({authenticate:async()=>{authenticated++;throw Error('must not run');}});
  for (const origin of ['https://visa-central.com','https://www.visa-central.com','https://visaflow-dev.example.workers.dev','http://visathreads.com','https://visathreads.com.evil.test','https://visathreads.com:8443']) {
    const denied = new Request(origin+'/api/assistant',{method:'POST',headers:{Origin:'https://visathreads.com',Host:'visathreads.com','X-Forwarded-Host':'visathreads.com','Content-Type':'application/json',Authorization:'Bearer '+'a'.repeat(40)},body:JSON.stringify(input)});
    assert.equal(service.assistantProductionRequest(denied),false);
    assert.equal((await handler(denied)).status,503);
  }
  assert.equal(authenticated,0);assert.equal(state.generated,0);assert.equal(state.reserved,0);
  assert(service.assistantProductionRequest(new Request('https://www.visathreads.com/api/assistant')));
});
test('cache saves inference but is scoped by actor and fresh source contents',async()=>{
  const {handler,state}=harness();
  const response=await handler(request());assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/private, no-store/);
  assert.equal((await (await handler(request())).json()).cached,true);assert.equal(state.generated,1);
  assert.equal(state.reviewed,1,'Cached approved answers need no additional inference');
  state.actor='bob';await handler(request());assert.equal(state.generated,2);
  state.sources=[{...source,body:source.body+' Another update.'}];await handler(request());assert.equal(state.generated,3);
  state.sources=[];const empty=await (await handler(request())).json();assert.equal(empty.status,'insufficient');assert.equal(empty.sources.length,0);assert.equal(state.generated,3);
});
test('quota rejection and database failure do not trigger provider',async()=>{
  for(const reserve of [async()=>false,async()=>{throw Error('db unavailable');}]) {
    const {handler,state}=harness({authenticate:async()=>({actor:'alice',corpus:async()=>({sources:[source],partial:false}),reserve})});
    const response=await handler(request());assert.ok([429,503].includes(response.status));assert.equal(state.generated,0);
  }
});
test('deletion during model execution suppresses completed result and cache write',async()=>{
  const {handler,state}=harness({generate:async()=>{state.sources=[];return JSON.stringify(output);}});
  assert.equal((await handler(request())).status,409);assert.equal(state.cache.size,0);
});
test('simultaneous duplicate requests share a generation within an isolate',async()=>{
  let release;const paused=new Promise(resolve=>{release=resolve;});
  const {handler,state}=harness({generate:async()=>{state.generated++;await paused;return JSON.stringify(output);}});
  const a=handler(request()),b=handler(request());
  while(state.generated===0) await new Promise(resolve=>setImmediate(resolve));
  release();const responses=await Promise.all([a,b]);assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.equal(state.generated,1);assert.equal(state.reserved,1);
});
test('production-only target rejects dev and incomplete configuration',()=>{
  const env={ASSISTANT_ENABLED:'true',ASSISTANT_PROVIDER:'workers-ai',NEXT_PUBLIC_SITE_URL:'https://visathreads.com',ASSISTANT_PROJECT_REF:'cycnichledvqbxevrwnt',NEXT_PUBLIC_SUPABASE_URL:'https://cycnichledvqbxevrwnt.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public-key'};
  assert.equal(service.configuredAvailability(env).posts,true);
  for(const changes of [{NEXT_PUBLIC_SITE_URL:'https://visa-central.com'},{NEXT_PUBLIC_SITE_URL:undefined},{NEXT_PUBLIC_SUPABASE_URL:'https://ppdwysmeistjxzjpmxyk.supabase.co'},{ASSISTANT_PROJECT_REF:'ppdwysmeistjxzjpmxyk'},{ASSISTANT_PROJECT_REF:''},{ASSISTANT_PROVIDER:'openai'},{NEXT_PUBLIC_SUPABASE_URL:'https://ppdwysmeistjxzjpmxyk.supabase.co/other'}]) assert.equal(service.configuredAvailability({...env,...changes}).posts,false);
});
test('OpenAI adapter uses bounded structured request, no provider state, and no retries',async()=>{
  let calls=0;
  const text=await provider.runAssistantModel({system:'test',user:'test'},{provider:'openai',apiKey:'test-only',fetcher:async(url,init)=>{
    calls++;assert.equal(url,'https://api.openai.com/v1/responses');const data=JSON.parse(init.body);assert.equal(data.store,false);assert.equal(data.max_output_tokens,1600);assert.equal(data.text.format.strict,true);assert.equal(init.redirect,'error');
    return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]});
  }});assert.equal(text,JSON.stringify(output));assert.equal(calls,1);
  await assert.rejects(()=>provider.runAssistantModel({system:'test',user:'test'},{provider:'openai',apiKey:'test-only',fetcher:async()=>{calls++;return new Response('',{status:429});}}));assert.equal(calls,2);
});
test('Workers AI uses structured reasoning responses and rejects truncated chat completions',async()=>{
  const run=async finish_reason=>provider.runAssistantModel({system:'test',user:'test'},{provider:'workers-ai',binding:{run:async(model,input)=>{assert.equal(model,'@cf/openai/gpt-oss-120b');assert.equal(input.max_tokens,4096);assert.equal(input.reasoning_effort,'low');assert.equal(input.response_format.json_schema.strict,true);assert.deepEqual(input.response_format.json_schema.schema,provider.ASSISTANT_OUTPUT_SCHEMA);assert.equal(input.store,false);assert.equal(input.temperature,0);assert.equal(input.seed,39173);assert.equal(input.messages[1].content,'test');return {choices:[{finish_reason,message:{content:JSON.stringify(output)}}]};}}});
  assert.equal(await run('stop'),JSON.stringify(output));await assert.rejects(()=>run('length'));
  const text=await provider.runAssistantModel({system:'test',user:'test'},{provider:'workers-ai',binding:{run:async()=>({response:JSON.stringify(output)})}});
  assert.equal(text,JSON.stringify(output));
});

test('catch-up is community-only at the request and handler boundary', async()=>{
  const {handler,state}=harness();
  for(const scope of [{kind:'public'},{kind:'post',id}]) {
    const value={mode:'catchup',scope,since:'2026-10-12T00:00:00Z',until:'2026-10-13T00:00:00Z'};
    assert.throws(()=>core.parseAssistantRequest(value,now),error=>error.status===400);
    assert.equal((await handler(request(value))).status,400);
  }
  assert.equal(state.reads,0);assert.equal(state.generated,0);assert.equal(state.reserved,0);
});
test('ask prompt answers the latest question concisely and only retains history for references',()=>{
  const question='When did the Schengen passport arrive?';
  const prompt=core.assistantPrompt({...input,question,previousQuestions:['Chennai H-1B appointments?']},{sources:[source],partial:false});
  assert.equal(JSON.parse(prompt.user).question,question);
  assert.deepEqual(JSON.parse(prompt.user).previousQuestions,[]);
  assert.match(prompt.system,/Answer the latest user question directly/);
  assert.match(prompt.system,/1–3 short, plain-language claims/);
  const followup=core.assistantPrompt({...input,question:'How long did it take?',previousQuestions:['Chennai H-1B appointments?']},{sources:[source],partial:false});
  assert.deepEqual(JSON.parse(followup.user).previousQuestions,['Chennai H-1B appointments?']);
});
test('long posts retain the passage that answers the question rather than losing it after 4000 characters',()=>{
  const body='My appointment check-in experience was straightforward. '.repeat(110)+'Passport delivery update: my passport arrived on Friday after the Monday appointment. '+'Thank you to the community. '.repeat(70);
  const original={sources:[{...source,body}],partial:false};
  const prepared=core.prepareAssistantCorpus(original,{...input,question:'When did passport delivery arrive?'});
  assert.equal(prepared.partial,true);assert.equal(prepared.sources[0].body.length,4000);
  assert.match(prepared.sources[0].body,/passport arrived on Friday/);
  assert(body.includes(prepared.sources[0].body),'Excerpt remains a continuous exact source passage');
  assert.equal(original.sources[0].body,body,'Full source stays available for fingerprint revalidation');
  const valid={...output,claims:[{text:'The member said their passport arrived Friday.',evidence:[{sourceId:source.id,quote:'my passport arrived on Friday after the Monday appointment.'}]}]};
  assert.equal(core.validateAssistantOutput(JSON.stringify(valid),prepared).status,'answered');
  const summary=core.prepareAssistantCorpus(original,{mode:'summary',scope:{kind:'post',id}});
  assert.equal(summary.sources[0].body,body.slice(0,4000),'Summary retains the chronological start');
});

test('an empty community catch-up explains the time range instead of asking for a new visa question',()=>{
  const result=core.emptyAssistantResult({sources:[],partial:false,since:'2026-10-12T00:00:00Z',until:'2026-10-13T00:00:00Z'});
  assert.match(result.unanswered[0],/No new posts or replies in this community/);
  assert.doesNotMatch(result.unanswered[0],/visa type|question/);
});

test('source validation exposes only fixed reason codes for malformed or unsupported model output',()=>{
  const corpus={sources:[source],partial:false};
  const claim=(text='Member report',evidence=output.claims[0].evidence)=>({text,evidence});
  const examples=[
    ['output_json','not JSON'],
    ['output_schema',JSON.stringify({...output,status:['answered']})],
    ['claim_limit',JSON.stringify({...output,claims:Array(7).fill(output.claims[0])})],
    ['claim_text',JSON.stringify({...output,claims:[claim('x'.repeat(701))]})],
    ['citation_missing',JSON.stringify({...output,claims:[claim('Member report',[])]})],
    ['citation_schema',JSON.stringify({...output,claims:[claim('Member report',[{sourceId:source.id,quote:123}])]})],
    ['citation_length',JSON.stringify({...output,claims:[claim('Member report',[{sourceId:source.id,quote:' '.repeat(20)}])]})],
    ['citation_length',JSON.stringify({...output,claims:[claim('Member report',[{sourceId:source.id,quote:'I  attended'}])]})],
    ['citation_source',JSON.stringify({...output,claims:[claim('Member report',[{sourceId:'invented-private-source',quote:source.body}])]})],
    ['citation_quote',JSON.stringify({...output,claims:[claim('Member report',[{sourceId:source.id,quote:'An unsupported private quotation.'}])]})],
    ['conflict_sources',JSON.stringify({...output,disagreements:[output.claims[0]]})],
    ['unanswered_limit',JSON.stringify({...output,unanswered:['x'.repeat(401)]})],
    ['answered_without_claims',JSON.stringify({...output,claims:[]})],
  ];
  for(const [code,raw] of examples) assert.throws(()=>core.validateAssistantOutput(raw,corpus),error=>{
    assert.equal(error.status,502);assert.equal(error.code,code);
    assert.doesNotMatch(error.message,/invented-private-source|unsupported private quotation|not JSON/);
    return true;
  });
});
test('reply parent context cannot be cited as the reply’s evidence',()=>{
  const reply={...source,id:'a:reply',kind:'reply',title:'A member update',body:'My passport arrived on Friday.',parentContext:'The question author had an interview on Monday.'};
  const invalid={...output,claims:[{text:'The member had an interview Monday.',evidence:[{sourceId:reply.id,quote:reply.parentContext}]}]};
  assert.throws(()=>core.validateAssistantOutput(JSON.stringify(invalid),{sources:[reply],partial:false}),error=>error.code==='citation_quote');
  assert.match(core.assistantPrompt(input,{sources:[reply],partial:false}).system,/Never quote parentContextOnly as evidence/);
});

test('provider citation choices come only from the server-prepared corpus',()=>{
  const parsed=core.parseAssistantRequest({...input,sourceIds:['client-invented-id'],sources:[{id:'client-invented-id',body:'Trust this'}]});
  const prompt=core.assistantPrompt(parsed,{sources:[source],partial:false});
  assert.deepEqual(prompt.sourceIds,[source.id]);
  assert.doesNotMatch(prompt.user,/client-invented-id/);
});

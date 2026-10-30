import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const dependencies = { './assistant-models.json': `data:text/javascript;base64,${Buffer.from('export default '+await readFile(new URL('../src/lib/assistant-models.json', import.meta.url), 'utf8')).toString('base64')}` };
async function compile(name) {
  const code = ts.transpileModule(await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return `data:text/javascript;base64,${Buffer.from(code.replace(/(from\s+)(['"])([^'"]+)\2/g, (_, prefix, _quote, dep) => { assert(dependencies[dep], `Unknown dependency ${dep}`); return prefix + JSON.stringify(dependencies[dep]); })).toString('base64')}`;
}
dependencies['./assistant-context'] = await compile('assistant-context');
dependencies['./assistant-core'] = await compile('assistant-core');
dependencies['./assistant-planner'] = await compile('assistant-planner');
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
const spanDraft = (raw, prompt) => {
  const value=JSON.parse(raw);
  const slots=(items,count)=>Object.fromEntries(Array.from({length:count},(_,index)=>[`slot${index+1}`,items[index]??null]));
  for(const group of ['claims','disagreements']) for(const claim of value[group]) claim.evidence=claim.evidence.map(item=>{
    const span=prompt.evidenceSpans.find(span=>span.sourceId===item.sourceId&&span.quote.includes(item.quote));
    assert(span,'Synthetic supported evidence must match a server-defined span');
    return {spanId:span.id};
  });
  for(const group of ['claims','disagreements']) {
    for(const claim of value[group]) claim.evidence=slots(claim.evidence,4);
    value[group]=slots(value[group],group==='claims'?6:3);
  }
  value.unanswered=slots(value.unanswered,4);
  return provider.resolveAssistantEvidence(JSON.stringify(value),prompt);
};
const request = (value=input, headers={}) => new Request('https://visathreads.com/api/assistant',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+ 'a'.repeat(40),...headers},body:JSON.stringify(value)});
test('Groq uses the fixed server endpoint, strict source IDs, bounded answer/review and numeric-only telemetry', async () => {
  const usage = [], transport = [], calls = [];
  const fetcher = async (url, init) => {
    calls.push({url, init, body:JSON.parse(init.body)});
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output),reasoning:'must never leak'}}],usage:{prompt_tokens:2300,completion_tokens:180}}, {headers:{'x-ratelimit-limit-tokens':'250000','x-ratelimit-remaining-tokens':'247700'}});
  };
  const options={provider:'groq',apiKey:'synthetic-groq-secret',fetcher,reportUsage:value=>usage.push(value),reportTransport:value=>transport.push(value)};
  assert.equal(await provider.runAssistantModel({system:'System',user:'Question',sourceIds:[source.id]},options),JSON.stringify(output));
  await provider.runAssistantModel({system:'Review',user:'Evidence',outputKind:'review',reviewIds:['claim:0']},options);
  for(const call of calls) {
    assert.equal(call.url,'https://api.groq.com/openai/v1/chat/completions'); assert.equal(call.init.redirect,'manual');
    assert.equal(call.init.headers.Authorization,'Bearer synthetic-groq-secret');
    assert.equal(call.body.model,'openai/gpt-oss-120b'); assert.equal(call.body.response_format.json_schema.strict,true);
    assert.equal(call.body.include_reasoning,false);
    assert.equal(call.body.tools,undefined); assert.equal(call.body.stream,undefined);
  }
  assert.equal(calls[0].body.reasoning_effort,'low'); assert.equal(calls[1].body.reasoning_effort,'medium');
  assert.equal(calls[0].body.max_completion_tokens,4096); assert.equal(calls[1].body.max_completion_tokens,2048);
  assert.deepEqual(calls[0].body.response_format.json_schema.schema.properties.claims.items.properties.evidence.items.properties.sourceId.enum,[source.id]);
  assert.deepEqual(calls[1].body.response_format.json_schema.schema.properties.checks.items.properties.id.enum,['claim:0']);
  assert.deepEqual(usage.map(value=>value.stage),['answer','review']);
  assert.equal(transport[0].tokenLimit,250000);
  assert.doesNotMatch(JSON.stringify({usage,transport}),/synthetic-groq-secret|must never leak/);
  assert.notEqual(provider.providerCacheKey('groq'),provider.providerCacheKey('workers-ai'));
  assert.equal(JSON.parse(provider.providerCacheKey('groq').slice(5)).reviewReasoningEffort,'medium');
});
test('Groq errors fail closed without retries, provider body disclosure or model fallback', async () => {
  for(const [status,reason] of [[302,'provider_error'],[307,'provider_error'],[400,'invalid_request'],[401,'authentication_failed'],[403,'permission_denied'],[429,'rate_limited'],[500,'provider_error']]) {
    let calls=0, observed;
    await assert.rejects(provider.runAssistantModel({system:'System',user:'Question'}, {provider:'groq',apiKey:'synthetic-key',reportFailure:value=>{observed=value;},fetcher:async()=>{calls++;return new Response('private provider diagnostic synthetic-key',{status});}}),error=>error.status===503&&!error.message.includes('private'));
    assert.equal(calls,1); assert.equal(observed,reason);
  }
  let calls=0;
  await assert.rejects(provider.runAssistantModel({system:'System',user:'Question'},{provider:'groq',fetcher:async()=>{calls++;throw Error('Must not call');}}));
  assert.equal(calls,0);
});
test('Groq permission diagnostics retain only allowlisted categories, never error bodies',async()=>{
  for(const [code,denial] of [['model_permission_blocked_org','model-org'],['model_permission_blocked_project','model-project'],['private-arbitrary-code','other']]) {
    let transport, reason;
    await assert.rejects(provider.runAssistantModel({system:'System',user:'Question'},{provider:'groq',apiKey:'synthetic-key',reportTransport:value=>{transport=value;},reportFailure:value=>{reason=value;},fetcher:async()=>Response.json({error:{code,message:'private synthetic-key provider text'}},{status:403})}));
    assert.equal(reason,'permission_denied'); assert.equal(transport.denial,denial); assert.equal(transport.responseFormat,'json');
    assert.doesNotMatch(JSON.stringify(transport),/private|synthetic-key/);
  }
});
test('Groq rejects truncated, empty, oversized and invalid responses', async () => {
  for(const data of [
    {choices:[{finish_reason:'length',message:{content:JSON.stringify(output)}}]},
    {choices:[{finish_reason:'stop',message:{content:''}}]},
    {choices:[{finish_reason:'stop',message:{content:'x'.repeat(24001)}}]},
    {choices:[]},
  ]) await assert.rejects(provider.runAssistantModel({system:'System',user:'Question'},{provider:'groq',apiKey:'synthetic-key',fetcher:async()=>Response.json(data)}));
});
test('Groq distinguishes malformed secrets and network failures without disclosing either',async()=>{
  for(const apiKey of ['key\n',' key','key\u0000']) {
    let observed, calls=0;
    await assert.rejects(provider.runAssistantModel({system:'System',user:'Question'},{provider:'groq',apiKey,reportFailure:value=>{observed=value;},fetcher:async()=>{calls++;throw Error('Do not call');}}));
    assert.equal(observed,'invalid_key_format'); assert.equal(calls,0);
  }
  let observed;
  await assert.rejects(provider.runAssistantModel({system:'System',user:'Question'},{provider:'groq',apiKey:'synthetic-key',reportFailure:value=>{observed=value;},fetcher:async()=>{throw new TypeError('Secret request detail');}}),error=>!error.message.includes('Secret'));
  assert.equal(observed,'network_error');
});
test('Groq rollout requires its own server secret and production project/domain boundary',()=>{
  const env={ASSISTANT_ENABLED:'true',ASSISTANT_PROVIDER:'groq',GROQ_API_KEY:'synthetic-key',NEXT_PUBLIC_SITE_URL:'https://visathreads.com',ASSISTANT_PROJECT_REF:'cycnichledvqbxevrwnt',NEXT_PUBLIC_SUPABASE_URL:'https://cycnichledvqbxevrwnt.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public-key'};
  assert.equal(service.configuredAvailability(env).posts,true);
  for(const changes of [{GROQ_API_KEY:undefined,OPENAI_API_KEY:'wrong-secret'},{NEXT_PUBLIC_SITE_URL:'https://visa-central.com'},{NEXT_PUBLIC_SUPABASE_URL:'https://ppdwysmeistjxzjpmxyk.supabase.co'}]) assert.equal(service.configuredAvailability({...env,...changes}).posts,false);
});
function harness(overrides={}) {
  const state={actor:'alice',sources:[source],reserved:0,generated:0,reviewed:0,reads:0,cache:new Map()};
  const generate = overrides.generate ?? (async()=>{state.generated++;return JSON.stringify(output);});
  const handler=service.createAssistantHandler({availability:()=>({posts:true,communities:true,catchup:true}),model:'test-model',
    authenticate:async()=>({actor:state.actor,corpus:async()=>{state.reads++;return {sources:structuredClone(state.sources),partial:false};},reserve:async()=>{state.reserved++;return true;}}),
    cache:{get:async key=>state.cache.get(key)??null,put:async(key,value)=>{state.cache.set(key,value);}},...overrides,
    generate:async(prompt,signal)=>{if(prompt.outputKind==='review'){state.reviewed++;return JSON.stringify({fulfillsTask:true,checks:prompt.reviewIds.map(id=>({id,supported:true}))});}return spanDraft(await generate(prompt,signal),prompt);}});
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
  assert.equal(content.question,'Summarize the selected discussion.');
  assert.equal(content.task,'summary');
  assert.equal(content.summaryStyle,'brief');
  assert.match(prompt.system,/TASK: Give a brief summary of the selected discussion, not an exhaustive retelling/);
  assert.match(prompt.system,/about 60–80 words/);
  assert.match(prompt.system,/FINAL LENGTH CHECK.*within 100 words/);
  assert.match(prompt.system,/Do not repeat an unresolved point in unanswered when a cited claim already explains it/);
  assert.match(prompt.system,/"the author has not said whether a decision was made" does not establish "no decision was made or given"/);
  assert.match(prompt.system,/an explicit report that no decision was made supports that attributed event/);
  assert.match(prompt.system,/do not invent the underlying state or when it applied/);
  assert.match(prompt.system,/unqualified selected-discussion summary.*within 100 words/);
  assert.match(prompt.system,/word budget is not a reason to erase qualifications or connect separate events/);
  assert.deepEqual(content.previousQuestions,[]);
  assert.deepEqual(content.resolvedDiscussion,{questionId:id,sourceIds:[source.id]});
  assert.match(prompt.system,/complete supporting BODY sentences/);
  assert.equal(ask.question,'Explain the second post.','Original request and cache identity are not rewritten');
  for (const question of ['Summarize the second post.', 'Please explain the second post!', 'Summarise the second post']) {
    assert.deepEqual(build({...ask,question}),prompt,'Equivalent unqualified selected summaries must serialize identically');
  }
  const focusedSummary=JSON.parse(build({...ask,question:'Explain this post.',previousQuestions:['An irrelevant older question'],focusedPost:selected}).user);
  assert.equal(focusedSummary.question,content.question);
  assert.deepEqual(focusedSummary.previousQuestions,[],'A fully resolved generic summary needs no older question hints');
  const qualified=JSON.parse(build({...ask,question:'Why did the second post report a delay in Chennai?'}).user);
  assert.equal(qualified.question,'Why did the selected discussion report a delay in Chennai?');
  assert.equal(qualified.task,'ask');
  for(const question of ['Explain the second post and whether I qualify.', 'Explain the second post in detail and predict my outcome.']) {
    assert.equal(JSON.parse(build({...ask,question}).user).task,'ask','Qualified requests must not be silently converted to summaries');
    assert.doesNotMatch(build({...ask,question}).system,/unqualified selected-discussion summary/);
  }
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
test('complete comparison-only answers survive full grounding but not missing or fabricated evidence',()=>{
  const other={...source,id:`a:${id}`,kind:'reply',body:'My appointment was on Tuesday. My passport arrived on Saturday.'};
  const corpus={sources:[source,other],partial:false};
  const comparison={text:'One member reported a Monday appointment; the other reported Tuesday.',evidence:[{sourceId:source.id,quote:'I attended my appointment on Monday.'},{sourceId:other.id,quote:'My appointment was on Tuesday.'}]};
  const draft={status:'answered',claims:[],disagreements:[comparison],unanswered:[]};
  const checked=core.validateAssistantOutput(JSON.stringify(draft),corpus,now,input);
  assert.equal(checked.status,'answered'); assert.deepEqual(checked.claims,[]);
  assert.deepEqual(checked.disagreements,[{...comparison,evidence:[{sourceId:source.id,quote:source.body},{sourceId:other.id,quote:other.body}]}]); assert.equal(checked.sources.length,2);
  for(const evidence of [[],comparison.evidence.slice(0,1),[comparison.evidence[0],comparison.evidence[0]],[comparison.evidence[0],{sourceId:other.id,quote:'A fabricated quotation from another visit.'}]]) {
    assert.throws(()=>core.validateAssistantOutput(JSON.stringify({...draft,disagreements:[{...comparison,evidence}]}),corpus,now,input));
  }
  const policy=core.validateAssistantOutput(JSON.stringify(draft),corpus,now,{...input,question:'Am I eligible under the current visa rule?'});
  assert.equal(policy.status,'insufficient'); assert.deepEqual(policy.disagreements,[]);
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
test('summary prompts require atomic explicit facts without inferred timing, chronology, venue or roles',()=>{
  const adjacent={...source,body:'I attended my appointment on Tuesday. My application was approved. I waited outside. My document arrived on Saturday.'};
  const corpus={sources:[adjacent],partial:false};
  const selected={questionId:id,sourceId:source.id};
  for(const value of [
    {mode:'summary',scope:{kind:'post',id}},
    {mode:'ask',scope:{kind:'public'},question:'Explain the first post.',previousPosts:[selected]},
    {...input,question:'What did this member report?'},
    {mode:'catchup',scope:{kind:'community',id},since:'2026-10-10T00:00:00Z',until:'2026-10-11T00:00:00Z'},
  ]) {
    const prompt=core.assistantPrompt(value,corpus);
    assert.match(prompt.system,/Sentence adjacency and list order do not establish event timing, sequence or causation/);
    assert.match(prompt.system,/"same day", "same week", "later", "before", "after" or "because" unless the source explicitly states that relationship/);
    assert.match(prompt.system,/Named weekdays alone do not establish a shared calendar week or elapsed duration/);
    assert.match(prompt.system,/do not attach an undated outcome to a nearby dated appointment or collection/);
    assert.match(prompt.system,/waiting "outside" or "in a queue" does not identify an embassy, consulate, office/);
    assert.match(prompt.system,/omit an unstated venue or specialized role/);
    assert.match(prompt.system,/Preserve explicit material qualifications in the claim text, not only inside its evidence quote/);
    assert.match(prompt.system,/Attribution alone must not hide that stated limitation/);
    assert.match(prompt.system,/select the essential outcome or unresolved status, corrected dates, and explicit limitations first/);
    assert.match(prompt.system,/never cite every repeated report/);
    assert.match(prompt.system,/select the spans covering its event, stated timing and material qualification/);
    assert.match(prompt.system,/summarize a representative report in the singular/);
    assert.match(prompt.system,/split it into atomic claims or narrow its attribution/);
    assert.match(prompt.system,/Never solve the citation limit by citing only one report for plural wording/);
    assert.match(prompt.system,/Do not describe several people, consensus, prevalence or corroboration merely because repeated text or different source IDs exist/);
    assert.match(prompt.system,/check every timing expression, sequence word, duration, venue, role and causal link against its quoted source body/);
    assert.equal(JSON.parse(prompt.user).sources[0].body,adjacent.body,'Prompt hardening must not edit or supplement the evidence');
    if(JSON.parse(prompt.user).task==='summary') {
      assert.match(prompt.system,/short, atomic, attributed claims/);
      if(value.mode==='summary') assert.match(prompt.system,/as many of the six available claim slots as needed/);
      else assert.match(prompt.system,/use an additional claim only for an essential correction, conflict or qualification/);
      assert.match(prompt.system,/An undated outcome remains undated/);
    }
  }
  assert.equal(core.ASSISTANT_VERSION,'grounded-chat-v31-bounded-summaries','Semantic change invalidates old cached answers');
});
test('summary preparation collapses exact repeated reports but preserves distinct material differences',()=>{
  const repeated='I attended my appointment on Wednesday. My application was approved. My document arrived on Saturday. This is only my own experience, not a standard timeline.';
  const reports=[repeated,repeated,'I attended my appointment on Wednesday. My application is still pending. I do not know the decision date. This is only my personal experience.']
    .map((body,index)=>({...source,id:`a:summary-${index}`,body}));
  const corpus={sources:reports,partial:false};
  const summaryInput={mode:'summary',scope:{kind:'post',id}};
  const prepared=core.prepareAssistantCorpus(corpus,summaryInput);
  const prompt=core.assistantPrompt(summaryInput,prepared,corpus);
  const data=JSON.parse(prompt.user);
  assert.deepEqual(data.sources.map(item=>[item.id,item.body]),[[reports[0].id,reports[0].body],[reports[2].id,reports[2].body]],'Only exact repeated summary material is represented once');
  assert(prompt.evidenceSpans.some(span=>span.sourceId===reports[0].id));
  assert(!prompt.evidenceSpans.some(span=>span.sourceId===reports[1].id));
  assert(prompt.evidenceSpans.some(span=>span.sourceId===reports[2].id));
  assert(prompt.evidenceSpans.some(span=>span.quote.includes('still pending')));
  assert(prompt.evidenceSpans.some(span=>span.quote.includes('do not know the decision date')));
  const questionPrompt=core.assistantPrompt(input,core.prepareAssistantCorpus(corpus,input),corpus);
  assert.equal(JSON.parse(questionPrompt.user).sources.length,3,'Deduplication is limited to summaries');
  const separateReports={sources:[reports[0],
    {...reports[1],questionId:'00000000-0000-4000-8000-000000000099'},
    {...reports[1],id:'a:summary-later',createdAt:'2026-10-14T10:00:00Z',updatedAt:'2026-10-14T10:00:00Z'}],partial:false};
  assert.equal(core.prepareAssistantCorpus(separateReports,summaryInput).sources.length,3,'Identical words in a different discussion or at a different time remain independent reports');
  assert.match(prompt.system,/the server presents exact repeated records from the same discussion and timestamps/);
  assert.match(prompt.system,/Add other reports when they contribute distinct material facts, corrections, uncertainty or relevant differences/);
  assert.match(prompt.system,/A requested comparison must still preserve both sides and their citations/);
  assert.match(prompt.system,/SUMMARY FORMAT EXAMPLE ONLY, NOT EVIDENCE/);
  assert.match(prompt.system,/write separate singular statements for the dispatch, delivery and personal-only qualification/);
  assert.doesNotMatch(prompt.user,/parcel|shipment|dispatch/,'The generic format example must never become source evidence');
});
test('summary and catch-up are explicit evidence tasks without a missing question to answer',()=>{
  const summary=core.assistantPrompt({mode:'summary',scope:{kind:'post',id}},{sources:[source],partial:false});
  assert.match(summary.system,/No user question is required for a summary/);
  assert.match(summary.system,/Preserve key dates or named days/);
  assert.match(summary.system,/return status answered with cited claims even though there is no question/);
  const data=JSON.parse(summary.user);assert.equal(data.task,'summary');assert.equal('question' in data,false);assert.equal(data.sources[0].body,source.body);
  const catchup=core.assistantPrompt({mode:'catchup',scope:{kind:'community',id},since:'2026-10-12T00:00:00Z',until:'2026-10-13T00:00:00Z'},{sources:[source],partial:false});
  assert.match(catchup.system,/No user question is required for catch-up/);assert.equal('question' in JSON.parse(catchup.user),false);
  assert.match(summary.system,/Never infer current visa rules/);assert.match(summary.system,/MUST cite supporting span IDs/);
  assert.match(summary.system,/Explicitly stated individual events, outcomes, dates and timing ARE evidence/);
  assert.match(summary.system,/preserve both attributed positions in a concise comparison with spans from at least two different sources/);
});
test('generation requires nullable closed slots while summary priorities preserve evidence categories',()=>{
  const summary=core.assistantPrompt({mode:'summary',scope:{kind:'post',id}},{sources:[source],partial:false});
  assert.match(summary.system,/fixed-slot objects, NEVER arrays/);
  assert.match(summary.system,/claims requires slot1 through slot6; disagreements requires slot1 through slot3; unanswered requires slot1 through slot4/);
  assert.match(summary.system,/Lead with the relevant answer in clear, professional language/);
  assert.match(summary.system,/Never claim to have checked every post or to know missing replies/);
  assert.match(summary.system,/Every slot key is required: use null for each unused slot/);
  assert.match(summary.system,/Each evidence object requires slot1 through slot4/);
  assert.match(summary.system,/Do not fill slots merely because they exist/);
  assert.doesNotMatch(summary.system,/"claims":\[|"disagreements":\[|"evidence":\[|"unanswered":\[/);
  const example=summary.system.match(/write "disagreements":(\{.*\}) with unused claim/);
  assert(example);
  const disagreements=JSON.parse(example[1]);
  assert.deepEqual(Object.keys(disagreements),['slot1','slot2','slot3']);
  assert.deepEqual(Object.keys(disagreements.slot1.evidence),['slot1','slot2','slot3','slot4']);
  assert.equal(disagreements.slot2,null); assert.equal(disagreements.slot1.evidence.slot4,null);
  assert.match(summary.system,/For a summary of a long or mixed discussion, prioritize the author's actual reported outcome/);
  assert.match(summary.system,/need not enumerate every interview question or repeat routine advice/);
  assert.match(summary.system,/observations about other applicants, hypothetical or example dialogue, recommendations and unanswered reader questions/);
  assert.match(summary.system,/Preserve tentative wording for uncertain observations/);
  assert.match(summary.system,/Keep different process statuses and document receipt or delivery separate/);
  assert.equal(JSON.parse(summary.user).sources[0].body,source.body,'Prioritization instructions never rewrite supplied evidence');
});
test('summary brevity cannot erase an explicit material unknown outcome or decision date',()=>{
  const item={...source,body:'I attended my appointment on April 6. My application remained pending. I did not know the final decision date. This is only my personal experience. A reader asked where I parked.'};
  const corpus={sources:[item],partial:false};
  for(const request of [
    {mode:'summary',scope:{kind:'post',id}},
    {mode:'ask',scope:{kind:'public'},question:'Explain the first post.',previousPosts:[{questionId:id,sourceId:item.id}]},
  ]) {
    const prompt=core.assistantPrompt(request,corpus);
    assert.equal(JSON.parse(prompt.user).task,'summary');
    assert.match(prompt.system,/preserve explicit unknown outcomes, decision dates, durations or next steps that materially qualify the reported result/);
    assert.match(prompt.system,/State each important uncertainty in cited claim text alongside the known status/);
    assert.match(prompt.system,/a pending status alone does not preserve an explicit unknown decision date/);
    assert.match(prompt.system,/Do not hide that limitation only in the quotation or unanswered field/);
    assert.match(prompt.system,/Use a fourth or additional claim within the six-slot limit when needed/);
    assert.match(prompt.system,/SUMMARY COMPLETENESS CHECK/);
    assert.match(prompt.system,/must EACH be represented in cited claim text/);
    assert.match(prompt.system,/Do not invent uncertainty from mere silence or treat incidental unanswered reader questions as established facts/);
    assert.equal(JSON.parse(prompt.user).sources[0].body,item.body);
    assert(prompt.evidenceSpans.some(span=>span.quote.includes('I did not know the final decision date.')));
  }
});
test('output contract prioritizes complete cited comparisons without redundant section requirements',()=>{
  const prompt=core.assistantPrompt(input,{sources:[source],partial:false});
  assert.match(prompt.system,/A complete, cited comparison can answer the question by itself/);
  assert.match(prompt.system,/a fully supported comparison in claims is also valid/);
  assert.match(prompt.system,/a vague "reports differ" without the actual relevant positions is not a complete answer/);
  assert.match(prompt.system,/FORMAT EXAMPLE ONLY, NOT EVIDENCE/);
  assert.match(prompt.system,/Never copy these example IDs or facts/);
  assert.deepEqual(Object.keys(provider.ASSISTANT_OUTPUT_SCHEMA.properties),['status','disagreements','claims','unanswered']);
  assert.match(provider.ASSISTANT_OUTPUT_SCHEMA.properties.disagreements.description,/at least two disagreeing sources/);
  assert.match(provider.ASSISTANT_OUTPUT_SCHEMA.properties.claims.description,/comparison/i);
  assert.throws(()=>core.validateAssistantOutput(JSON.stringify({...output,disagreements:[{text:'The reports differ.',evidence:[{sourceId:'example-A',quote:'The library opens at eight.'},{sourceId:'example-B',quote:'The library opens at nine.'}]}]}),{sources:[source],partial:false}));
});
test('authentication, origin, content type, body budget and disabled rollout fail before inference',async()=>{
  const {handler,state}=harness();
  assert.equal((await handler(request(input,{Authorization:''}))).status,401);
  assert.equal((await handler(request(input,{Origin:'https://attacker.test'}))).status,403);
  assert.equal((await handler(request(input,{'Content-Type':'text/plain'}))).status,415);
  assert.equal((await handler(request({...input,garbage:'x'.repeat(24001)}))).status,413);
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
test('simultaneous requests own independent generation and durable quota reservations',async()=>{
  let release;const paused=new Promise(resolve=>{release=resolve;});
  const {handler,state}=harness({generate:async()=>{state.generated++;await paused;return JSON.stringify(output);}});
  const a=handler(request()),b=handler(request());
  while(state.generated<2) await new Promise(resolve=>setImmediate(resolve));
  release();const responses=await Promise.all([a,b]);assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.equal(state.generated,2);assert.equal(state.reserved,2);
  assert.notEqual(responses[0].headers.get('x-visathreads-request-id'),responses[1].headers.get('x-visathreads-request-id'));
});
test('production-only target rejects dev and incomplete configuration',()=>{
  const env={ASSISTANT_ENABLED:'true',ASSISTANT_PROVIDER:'workers-ai',NEXT_PUBLIC_SITE_URL:'https://visathreads.com',ASSISTANT_PROJECT_REF:'cycnichledvqbxevrwnt',NEXT_PUBLIC_SUPABASE_URL:'https://cycnichledvqbxevrwnt.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public-key'};
  assert.equal(service.configuredAvailability(env).posts,true);
  for(const changes of [{NEXT_PUBLIC_SITE_URL:'https://visa-central.com'},{NEXT_PUBLIC_SITE_URL:undefined},{NEXT_PUBLIC_SUPABASE_URL:'https://ppdwysmeistjxzjpmxyk.supabase.co'},{ASSISTANT_PROJECT_REF:'ppdwysmeistjxzjpmxyk'},{ASSISTANT_PROJECT_REF:''},{ASSISTANT_PROVIDER:'openai'},{NEXT_PUBLIC_SUPABASE_URL:'https://ppdwysmeistjxzjpmxyk.supabase.co/other'}]) assert.equal(service.configuredAvailability({...env,...changes}).posts,false);
});
test('OpenAI adapter uses bounded structured request, no provider state, and no retries',async()=>{
  let calls=0;
  const text=await provider.runAssistantModel({system:'test',user:'test'},{provider:'openai',apiKey:'test-only',fetcher:async(url,init)=>{
    calls++;assert.equal(url,'https://api.openai.com/v1/responses');const data=JSON.parse(init.body);assert.equal(data.store,false);assert.equal(data.max_output_tokens,1600);assert.equal(data.text.format.strict,true);assert.equal(init.redirect,'manual');
    return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]});
  }});assert.equal(text,JSON.stringify(output));assert.equal(calls,1);
  await assert.rejects(()=>provider.runAssistantModel({system:'test',user:'test'},{provider:'openai',apiKey:'test-only',fetcher:async()=>{calls++;return new Response('',{status:429});}}));assert.equal(calls,2);
});
test('Workers AI uses structured reasoning responses and rejects truncated chat completions',async()=>{
  const run=async finish_reason=>provider.runAssistantModel({system:'test',user:'test'},{provider:'workers-ai',binding:{run:async(model,input)=>{assert.equal(model,'@cf/openai/gpt-oss-120b');assert.equal(input.max_tokens,4096);assert.equal(input.reasoning_effort,'low');assert.equal(input.store,false);assert.equal(input.response_format.json_schema.strict,true);assert.deepEqual(input.response_format.json_schema.schema,provider.ASSISTANT_OUTPUT_SCHEMA);assert.equal(input.temperature,0);assert.equal(input.seed,39173);assert.equal(input.messages[1].content,'test');assert.equal(input.messages[0].content,'test');return {choices:[{finish_reason,message:{content:JSON.stringify(output)}}]};}}});
  assert.equal(await run('stop'),JSON.stringify(output));await assert.rejects(()=>run('length'));
  const text=await provider.runAssistantModel({system:'test',user:'test'},{provider:'workers-ai',binding:{run:async()=>({response:JSON.stringify(output)})}});
  assert.equal(text,JSON.stringify(output));
});

test('large and multilingual prompts route once before inference without dropping source text', async () => {
  for (const user of ['complete evidence '.repeat(2000), '完整的原始证据。'.repeat(1200)]) {
    const prompt = { system: 'Check all evidence', user, sourceIds: ['q:example'] };
    const selected = provider.workersAssistantRequest(prompt);
    assert.equal(selected.model, '@cf/openai/gpt-oss-120b');
    assert.equal(selected.input.messages[1].content, user);
    assert.equal(selected.input.reasoning_effort, 'low');
    assert.deepEqual(selected.input.response_format.json_schema.schema.properties.claims.items.properties.evidence.items.properties.sourceId.enum, ['q:example']);
    let calls = 0;
    await provider.runAssistantModel(prompt, { provider: 'workers-ai', binding: { run: async model => { calls++; assert.equal(model, selected.model); return { response: JSON.stringify(output) }; } } });
    assert.equal(calls, 1);
  }
  const profile = JSON.parse(provider.providerCacheKey('workers-ai'));
  assert.equal(profile.answer, provider.WORKERS_ASSISTANT_MODEL);
  assert(profile.review && profile.answerMaxTokens && profile.reviewMaxTokens && profile.version, 'Every model choice and parameter participates in cache identity');
});

test('usage metrics contain only bounded counts and fixed labels and cannot break answers', async () => {
  const usage = [];
  const prompt = { system: 'private system', user: 'private question' };
  const binding = { run: async () => ({ response: JSON.stringify(output), usage: { prompt_tokens: 123, completion_tokens: 45, reasoning: 'private reasoning', user: 'private identity' } }) };
  await provider.runAssistantModel(prompt, { provider: 'workers-ai', binding, reportUsage: value => usage.push(value) });
  assert.equal(usage.length, 1);
  assert.deepEqual(Object.keys(usage[0]).sort(), ['durationMs', 'inputTokens', 'model', 'outputTokens', 'stage']);
  assert.equal(usage[0].inputTokens, 123); assert.equal(usage[0].outputTokens, 45); assert.equal(usage[0].stage, 'answer');
  assert.doesNotMatch(JSON.stringify(usage), /private/);
  assert.equal(await provider.runAssistantModel(prompt, { provider: 'workers-ai', binding, reportUsage: () => { throw Error('metrics unavailable'); } }), JSON.stringify(output));
  await provider.runAssistantModel(prompt, { provider: 'workers-ai', binding: { run: async () => ({ response: JSON.stringify(output), usage: { prompt_tokens: 'private value', completion_tokens: -1 } }) }, reportUsage: value => { assert.equal(value.inputTokens, undefined); assert.equal(value.outputTokens, undefined); } });
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
  assert.equal(summary.sources[0].body,body,'Within the shared budget, summary retains the chronological start and full conclusion');
  assert.equal(summary.partial,false);
  assert.match(summary.sources[0].body,/passport arrived on Friday/);
});

test('an empty community catch-up explains the time range instead of asking for a new visa question',()=>{
  const result=core.emptyAssistantResult({sources:[],partial:false,since:'2026-10-12T00:00:00Z',until:'2026-10-13T00:00:00Z'});
  assert.match(result.unanswered[0],/matching posts or replies published during that time range/);
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

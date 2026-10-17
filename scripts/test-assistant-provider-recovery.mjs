import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const imports = { './assistant-models.json': `data:text/javascript;base64,${Buffer.from('export default ' + await readFile(new URL('../src/lib/assistant-models.json', import.meta.url), 'utf8')).toString('base64')}` };
for (const name of ['assistant-context', 'assistant-core', 'assistant-provider']) {
  const code = ts.transpileModule(await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  imports['./' + name] = `data:text/javascript;base64,${Buffer.from(code.replace(/(from\s+)(['"])([^'"]+)\2/g, (_, prefix, _quote, dependency) => { assert(imports[dependency], dependency); return prefix + JSON.stringify(imports[dependency]); })).toString('base64')}`;
}
const {runAssistantModel} = await import(imports['./assistant-provider']);
const {AssistantError} = await import(imports['./assistant-core']);
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

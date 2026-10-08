import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const load = async name => import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(await readFile(new URL(`../src/lib/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64')}`);
const policy = await load('policy');
const markets = await load('markets');
test('policy receipts preserve all three required assertions',()=>{
  for (const values of [[false,true,true],[true,false,true],[true,true,false],[false,false,false]]) assert.throws(()=>policy.acceptanceInput('fixture',...values));
  const input=policy.acceptanceInput('fixture',true,true,true);
  assert.equal(input.policy_version,policy.POLICY_VERSION);
  assert.equal(input.market,'US'); assert(!('accepted_at' in input)); assert(!('ip' in input));
});
test('10,000 is a review threshold and never activates advertising or payments',()=>{
  for (const n of [0,9999,10000,10001,1000000,NaN,Infinity,-1,10000.5]) {
    const result=markets.monetizationReadiness(n);
    assert.equal(result.reviewDue,Number.isSafeInteger(n)&&n>=10000);
    assert.equal(result.paymentsEnabled,false); assert.equal(result.advertisingEnabled,false); assert.equal(result.marketingEnabled,false);
  }
});
test('only known country codes and exact owned hostnames resolve',()=>{
  assert.equal(markets.marketForCode('US')?.code,'us');
  for(const code of ['gb','in','../us','us/','']) assert.equal(markets.marketForCode(code),null);
  for(const host of ['evilvisathreads.com','us.visathreads.com.evil.test','gb.visathreads.com','visathreads.com:444']) assert.equal(markets.marketForHostname(host),null);
  assert.equal(markets.marketForHostname('us.visathreads.com')?.code,'us');
});
test('all states and DC remain explicitly unapproved, not falsely certified',async()=>{
  const report=JSON.parse(await readFile(new URL('../docs/us-jurisdiction-review.json',import.meta.url),'utf8'));
  assert.equal(report.jurisdictions.length,51);
  assert.equal(new Set(report.jurisdictions.map(s=>s.code)).size,51);
  assert(report.jurisdictions.every(s=>s.status==='pending_counsel_review'));
});
test('published policies and database enforcement use the same version',async()=>{
  for(const path of ['src/app/privacy/page.tsx','src/app/terms/page.tsx','supabase/migrations/20261006043113_avatar_name_policy_v2.sql']) {
    assert((await readFile(new URL(`../${path}`,import.meta.url),'utf8')).includes(policy.POLICY_VERSION),path);
  }
});
test('accepted policy text matches the frozen version snapshot',async()=>{
  const archive=JSON.parse(await readFile(new URL(`../docs/policy-versions/${policy.POLICY_VERSION}.json`,import.meta.url),'utf8'));
  for(const document of archive.documents) {
    const source=await readFile(new URL(`../src/app${document.route}/page.tsx`,import.meta.url),'utf8');
    assert.equal(createHash('sha256').update(source).digest('hex'),document.sha256,'Policy edits require a new version and preserved historical text');
  }
});
test('the earlier policy text is preserved and the current notice explains public initials, not full names',async()=>{
  const previous=JSON.parse(await readFile(new URL('../docs/policy-versions/2026-10-04-preview-v1.json',import.meta.url),'utf8'));
  assert.equal(previous.version,'2026-10-04-preview-v1');
  for(const document of previous.documents) assert.equal(createHash('sha256').update(document.source).digest('hex'),document.sha256);
  const privacy=await readFile(new URL('../src/app/privacy/page.tsx',import.meta.url),'utf8');
  assert.match(privacy,/first name and an optional last name/);
  assert.match(privacy,/publishes only your first-name initial/);
  assert.match(privacy,/Your full name, email and Google photo are not added to public/);
});

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = source => ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const reactUrl = import.meta.resolve('react');
const dependencies = {
  'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'),
  react: moduleUrl(`
    export function useEffect(effect){globalThis.__policyPresentation.effects.push(effect);}
    export function useRef(initial){const state=globalThis.__policyPresentation,index=state.refIndex++;return state.refs[index]??=( {current:initial} );}
    export function useState(initial){const state=globalThis.__policyPresentation,index=state.index++;
      if(!Object.hasOwn(state.values,index))state.values[index]=initial;
      return [state.values[index],value=>{state.values[index]=typeof value==='function'?value(state.values[index]):value;}];}
  `),
  'next/link': moduleUrl(`import React from ${JSON.stringify(reactUrl)};export default props=>React.createElement('a',props,props.children);`),
  'next/navigation': moduleUrl('export const usePathname=()=>globalThis.__policyPresentation.path;'),
  './AuthProvider': moduleUrl('export const useAuth=()=>globalThis.__policyPresentation.auth;'),
  '@/lib/supabase/client': moduleUrl('export const getSupabase=()=>globalThis.__policyPresentation.client;'),
  '@/lib/policy': moduleUrl(transpile(await readFile(new URL('../src/lib/policy.ts',import.meta.url),'utf8'))),
};
let policyComponentCode=transpile(await readFile(new URL('../src/components/PolicyAcceptance.tsx',import.meta.url),'utf8'));
for(const [specifier,replacement] of Object.entries(dependencies)) policyComponentCode=policyComponentCode.replaceAll(`from '${specifier}'`,`from ${JSON.stringify(replacement)}`).replaceAll(`from "${specifier}"`,`from ${JSON.stringify(replacement)}`);
const {PolicyAcceptance}=await import(moduleUrl(policyComponentCode));
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function context(t,{status='required',path='/',auth={},read={data:null,error:null},write={error:null}}={}) {
  const state={index:0,refIndex:0,values:{0:status},refs:[],effects:[],path,auth:{user:{id:'fixture'},loading:false,demoMode:false,...auth},reads:[],writes:[]};
  state.client={from(table){
    assert.equal(table,'policy_acceptances');
    const filters=[];
    return {
      select(column){assert.equal(column,'policy_version');return this;},
      eq(column,value){filters.push([column,value]);return this;},
      abortSignal(signal){assert(signal instanceof AbortSignal);return this;},
      maybeSingle(){state.reads.push(filters);return typeof read==='function'?read():Promise.resolve(read);},
      insert(input){state.writes.push(input);return typeof write==='function'?write(input):Promise.resolve(write);},
    };
  }};
  t.after(()=>{delete globalThis.__policyPresentation;});
  return state;
}
function renderPolicy(state) {
  state.index=0;state.refIndex=0;state.effects=[];
  globalThis.__policyPresentation=state;
  const tree=PolicyAcceptance({children:React.createElement('div',null,'protected-community-fixture')});
  return {tree,html:renderToStaticMarkup(tree)};
}
function findElement(tree,type) {
  if(!tree||typeof tree!=='object')return null;
  if(tree.type===type)return tree;
  for(const child of React.Children.toArray(tree.props?.children)) {
    const found=findElement(child,type);
    if(found)return found;
  }
  return null;
}

test('joining presents one unchecked acknowledgement covering terms, privacy and adult eligibility',t=>{
  const state=context(t),{tree,html}=renderPolicy(state);
  const checkbox=findElement(tree,'input');
  assert.equal((html.match(/type="checkbox"/g)||[]).length,1);
  assert.equal(checkbox.props.checked,false);
  assert.equal(checkbox.props.required,true);
  assert.equal(findElement(tree,'button').props.disabled,true);
  assert.match(html,/at least 18/);
  assert.match(html,/href="\/terms"/);
  assert.match(html,/href="\/privacy"/);
  assert.match(html,/does not include consent to advertising, marketing or payments/);
  assert.doesNotMatch(html,/protected-community-fixture/);
});

test('one explicit acknowledgement preserves the full receipt and cannot be submitted unchecked',async t=>{
  const state=context(t);
  let view=renderPolicy(state);
  findElement(view.tree,'form').props.onSubmit({preventDefault(){}});await tick();
  assert.equal(state.writes.length,0,'A forged submit must not bypass the unchecked acknowledgement');
  assert.doesNotMatch(renderPolicy(state).html,/protected-community-fixture/);
  findElement(view.tree,'input').props.onChange({target:{checked:true}});
  view=renderPolicy(state);
  assert.equal(findElement(view.tree,'button').props.disabled,false);
  const submit=findElement(view.tree,'form').props.onSubmit;
  submit({preventDefault(){}});submit({preventDefault(){}});await tick();
  assert.deepEqual(state.writes,[{
    user_id:'fixture',policy_version:policy.POLICY_VERSION,market:'US',
    terms_accepted:true,privacy_acknowledged:true,adult_confirmed:true,
  }]);
  assert.match(renderPolicy(state).html,/protected-community-fixture/);
});

test('policy read and write failures stay blocked with retry instead of treating an error as acceptance',async t=>{
  for(const read of [{data:null,error:{code:'42501'}},()=>Promise.reject(new Error('offline'))]) {
    const state=context(t,{status:'loading',read});
    renderPolicy(state);state.effects[0]();await tick();
    const view=renderPolicy(state);
    assert.match(view.html,/role="alert"/);
    assert.match(view.html,/Try again/);
    assert.doesNotMatch(view.html,/protected-community-fixture|type="checkbox"/);
  }
  let attempts=0;
  const state=context(t,{write:async()=>({error:++attempts===1?{code:'42501'}:null})});
  let view=renderPolicy(state);
  findElement(view.tree,'input').props.onChange({target:{checked:true}});
  view=renderPolicy(state);findElement(view.tree,'form').props.onSubmit({preventDefault(){}});await tick();
  view=renderPolicy(state);
  assert.match(view.html,/could not save your acknowledgement/);
  assert.doesNotMatch(view.html,/protected-community-fixture/);
  assert.equal(findElement(view.tree,'button').props.disabled,false);
  findElement(view.tree,'form').props.onSubmit({preventDefault(){}});await tick();
  assert.match(renderPolicy(state).html,/protected-community-fixture/);
});

test('an existing receipt bypasses the acknowledgement and login never shows the discussion gate',async t=>{
  const state=context(t,{status:'loading',read:{data:{policy_version:policy.POLICY_VERSION},error:null}});
  renderPolicy(state);state.effects[0]();await tick();
  const accepted=renderPolicy(state);
  assert.deepEqual(state.reads,[[['user_id','fixture'],['policy_version',policy.POLICY_VERSION]]]);
  assert.match(accepted.html,/protected-community-fixture/);
  assert.doesNotMatch(accepted.html,/type="checkbox"/);
  assert.equal(state.writes.length,0);
  for(const path of ['/login','/signup','/account','/privacy','/contact']) {
    const view=renderPolicy(context(t,{path}));
    assert.match(view.html,/protected-community-fixture/);
    assert.doesNotMatch(view.html,/type="checkbox"/);
  }
});

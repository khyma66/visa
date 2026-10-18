import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Render the real component and call its real event handlers. Hooks/RPC are
// deterministic fixtures; this is not a substitute for hosted browser tests.
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const contract = moduleUrl(compile(await readFile(new URL('../src/lib/launch-workspace.ts', import.meta.url), 'utf8')));
const { LAUNCH_TASK_DEFINITIONS } = await import(contract);
const deps = {
  'react/jsx-runtime': moduleUrl(`import * as runtime from ${JSON.stringify(import.meta.resolve('react/jsx-runtime'))};
    export const Fragment=runtime.Fragment;
    export function jsx(type,props,key) {globalThis.__launchUI.elements.push({type,props,key});return runtime.jsx(type,props,key);}
    export function jsxs(type,props,key) {globalThis.__launchUI.elements.push({type,props,key});return runtime.jsxs(type,props,key);}`),
  react: moduleUrl(`export function useState(initial) {
    const state=globalThis.__launchUI,index=state.stateIndex++;
    if(!Object.hasOwn(state.values,index))state.values[index]=typeof initial==='function'?initial():initial;
    return[state.values[index],value=>{state.values[index]=typeof value==='function'?value(state.values[index]):value;}];
  }
  export function useRef(initial) {const state=globalThis.__launchUI,index=state.refIndex++;return state.refs[index]??=( {current:initial} );}
  export function useEffect(effect,deps) {const state=globalThis.__launchUI,index=state.effectIndex++,prior=state.effects[index];
    if(!prior||deps.some((value,i)=>!Object.is(value,prior.deps[i]))) {
      state.pending.push(()=>{prior?.cleanup?.();state.effects[index]={deps,cleanup:effect()};});
    }
  }`),
  'next/link': moduleUrl(`import React from ${JSON.stringify(import.meta.resolve('react'))};export default props=>React.createElement('a',props,props.children);`),
  'next/navigation': moduleUrl('export const useSearchParams=()=>new URLSearchParams(globalThis.__launchUI.search);'),
  'lucide-react': moduleUrl('export const ClipboardList=()=>null,Plus=()=>null,RefreshCw=()=>null,X=()=>null;'),
  './AuthProvider': moduleUrl('export const useAuth=()=>globalThis.__launchUI.auth;'),
  '@/lib/launch-workspace': contract,
  '@/lib/launch-client': moduleUrl(`export const getLaunchWorkspace=(...args)=>globalThis.__launchUI.rpc.workspace(...args);
    export const getLaunchHistory=(...args)=>globalThis.__launchUI.rpc.history(...args);
    export const saveLaunchExperiment=(...args)=>globalThis.__launchUI.rpc.experiment(...args);
    export const updateLaunchTask=(...args)=>globalThis.__launchUI.rpc.task(...args);`),
};
const source=await readFile(new URL('../src/components/OwnerLaunchWorkspace.tsx',import.meta.url),'utf8');
const compiled=compile(source+'\nexport {Workspace, TaskCard, ExperimentEditor, History};')
  .replace(/(from\s+)(['"])([^'"]+)\2/g,(_match,prefix,_quote,name)=>{
    assert(deps[name],`Unmapped launch dependency: ${name}`);return prefix+JSON.stringify(deps[name]);
  });
const {OwnerLaunchWorkspace,Workspace,TaskCard,ExperimentEditor}=await import(moduleUrl(compiled));
const makeTasks=()=>LAUNCH_TASK_DEFINITIONS.map(task=>({...task,status:'backlog',evidence:'',assigned_to:'',due_on:null,
  version:1,completed_at:null,created_at:'2026-10-18T12:00:00Z',updated_at:'2026-10-18T12:00:00Z'}));
const report=()=>({schema_version:1,generated_at:'2026-10-18T12:00:00Z',tasks:makeTasks(),experiments:[]});
const experiment=()=>({id:'11111111-1111-4111-8111-111111111111',title:'One measured contributor experiment',
  hypothesis:'A useful resource improves genuine human responses.',start_on:'2026-10-18',end_on:'2026-11-18',
  cash_cost_usd:50,founder_hours:8,hour_value_usd:40,attributable_contribution_usd:null,decision:'observe',notes:'',
  currency:'USD',version:3,created_at:'2026-10-18T12:00:00Z',updated_at:'2026-10-18T12:00:00Z'});
function harness({auth={},rpc={},values={},search=''}={}) {
  const state={stateIndex:0,refIndex:0,effectIndex:0,values,refs:[],effects:[],pending:[],elements:[],search,
    auth:{user:{id:'owner-one'},loading:false,demoMode:false,...auth},rpc:{
      workspace:()=>Promise.resolve(report()),history:()=>Promise.resolve([]),
      task:()=>Promise.reject(new Error('Unexpected write')),experiment:()=>Promise.reject(new Error('Unexpected write')),...rpc}};
  globalThis.__launchUI=state;
  return {
    state,
    render(Component=OwnerLaunchWorkspace,props={}) {state.stateIndex=state.refIndex=state.effectIndex=0;state.elements=[];
      return renderToStaticMarkup(React.createElement(Component,props));},
    async effects() {for(const run of state.pending.splice(0))run();await new Promise(resolve=>setImmediate(resolve));},
    element(type,predicate=()=>true) {const found=state.elements.find(node=>node.type===type&&predicate(node.props));assert(found,`Missing ${type}`);return found;},
    close() {for(const effect of state.effects)effect?.cleanup?.();delete globalThis.__launchUI;},
  };
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('signed-out and checking-auth screens never render retained private records',()=>{
  for(const auth of [{user:null},{loading:true}]) {
    const h=harness({auth,values:{1:{...report(),experiments:[{...experiment(),title:'Private experiment sentinel'}]}}});
    try {const html=h.render();assert.doesNotMatch(html,/Private experiment sentinel|Launch tasks|New experiment|Save task/);
      assert.match(html,auth.loading?/Checking your account/:/Owner sign-in required/);
      if(!auth.loading)assert.match(html,/login\?next=%2Fadmin%2Flaunch#sign-in/);
    } finally {h.close();}
  }
});
test('server-denied account renders an actionable error without owner records',async()=>{
  let reads=0;const h=harness({auth:{user:{id:'ordinary-member'}},rpc:{workspace:async()=>{reads++;throw {code:'42501'};}}});
  try {h.render();await h.effects();const html=h.render();assert.equal(reads,1);assert.match(html,/designated owner account/);
    assert.match(html,/role="alert"/);assert.doesNotMatch(html,/Save task|launch-critical tasks recorded complete/);
  }finally{h.close();}
});
test('demo shows only explicitly labeled blank templates and cannot persist edits',async()=>{
  let calls=0;const h=harness({auth:{user:null,demoMode:true},rpc:{workspace:async()=>{calls++;return report();},task:async()=>{calls++;}}});
  try {h.render();await h.effects();const html=h.render();assert.equal(calls,0);
    assert.match(html,/Local layout preview/);assert.match(html,/blank task templates/);assert.match(html,/<fieldset disabled=""/);
    h.element('form').props.onSubmit({preventDefault(){}});await tick();assert.equal(calls,0);
    assert.match(html,/0 of 9 launch-critical tasks recorded complete/);
  }finally{h.close();}
});
test('owner workspace loads actual task state and does not assert launch approval',async()=>{
  const data=report();data.tasks[0]={...data.tasks[0],status:'done',version:2,evidence:'Owner recorded real acceptance evidence.',completed_at:'2026-10-18T12:00:00Z'};
  const h=harness({rpc:{workspace:async()=>data}});
  try {h.render();await h.effects();const html=h.render();assert.match(html,/Owner recorded real acceptance evidence/);
    assert.match(html,/1 of 9 launch-critical tasks recorded complete/);assert.match(html,/do not enable public indexing, payments or a deployment/);
    assert.match(html,/Revision 2/);assert.match(html,/UTC/);
  }finally{h.close();}
});
test('saving one task replaces only that row and preserves sibling identities and drafts',async()=>{
  const data=report();let reads=0;
  const h=harness({rpc:{workspace:async()=>{reads++;return data;}}});
  try {h.render(Workspace,{demo:false});await h.effects();h.render(Workspace,{demo:false});
    const saved=h.state.elements.find(node=>node.type===TaskCard&&node.props.task.id==='L01');
    const sibling=h.state.elements.find(node=>node.type===TaskCard&&node.props.task.id==='L02');
    const updated={...saved.props.task,version:2,evidence:'Saved task evidence with a new revision.'};
    saved.props.onSaved(updated);h.render(Workspace,{demo:false});
    const nextSaved=h.state.elements.find(node=>node.type===TaskCard&&node.props.task.id==='L01');
    const nextSibling=h.state.elements.find(node=>node.type===TaskCard&&node.props.task.id==='L02');
    assert.equal(nextSaved.props.task,updated);assert.equal(nextSaved.key,'L01-2');
    assert.equal(nextSibling.props.task,sibling.props.task);assert.equal(nextSibling.key,sibling.key);assert.equal(reads,1);
  }finally{h.close();}
});
test('identity change uses a new workspace key and signout removes loaded records',()=>{
  const data=report();data.tasks[0].evidence='Sensitive owner workspace sentinel';
  const h=harness({values:{1:data}});
  try {assert.match(h.render(),/Sensitive owner workspace sentinel/);
    assert.equal(h.state.elements.find(node=>node.type===Workspace).key,'owner-one');
    h.state.auth.user={id:'owner-two'};h.state.values={};h.state.refs=[];h.state.effects=[];h.state.pending=[];
    const next=h.render();assert.equal(h.state.elements.find(node=>node.type===Workspace).key,'owner-two');
    assert.doesNotMatch(next,/Sensitive owner workspace sentinel/);
    h.state.auth.user=null;assert.doesNotMatch(h.render(),/Sensitive owner workspace sentinel|Save task/);
  }finally{h.close();}
});
test('task saves use expected version and conflict keeps entered evidence visible',async()=>{
  const tasks=makeTasks(),calls=[];let saved=0;
  const h=harness({rpc:{task:async(...args)=>{calls.push(args);throw {code:'40001'};}}});
  try {h.render(TaskCard,{task:tasks[0],tasks,demo:false,onSaved:()=>saved++});
    h.element('textarea').props.onChange({target:{value:'Evidence entered in this tab remains available.'}});
    h.render(TaskCard,{task:tasks[0],tasks,demo:false,onSaved:()=>saved++});
    h.element('form').props.onSubmit({preventDefault(){}});await tick();
    const html=h.render(TaskCard,{task:tasks[0],tasks,demo:false,onSaved:()=>saved++});
    assert.equal(calls.length,1);assert.equal(calls[0][0].version,1);assert.equal(calls[0][1].evidence,'Evidence entered in this tab remains available.');
    assert.equal(saved,0);assert.match(html,/another tab/);assert.match(html,/Evidence entered in this tab remains available/);
  }finally{h.close();}
});
test('experiment form distinguishes unknown from zero contribution and saves measured inputs once',async()=>{
  const item=experiment(),calls=[];let saved=0,resolve;
  const h=harness({rpc:{experiment:(...args)=>{calls.push(args);return new Promise(done=>{resolve=done;});}}});
  const props={item,onClose(){},onSaved:()=>saved++};
  try {let html=h.render(ExperimentEditor,props);assert.match(html,/Unknown/);assert.match(html,/Not measurable yet/);
    h.element('input',props=>props.placeholder==='Unknown').props.onChange({target:{value:'0'}});
    html=h.render(ExperimentEditor,props);assert.match(html,/-\$50\.00/);assert.match(html,/-\$370\.00/);assert.match(html,/-100%/);
    const form=h.element('form');form.props.onSubmit({preventDefault(){}});form.props.onSubmit({preventDefault(){}});
    assert.equal(calls.length,1);assert.equal(calls[0][0],item.id);assert.equal(calls[0][1],3);
    assert.equal(calls[0][2].attributable_contribution_usd,0);assert.equal(calls[0][2].founder_hours,8);
    resolve({...item,version:4});await tick();assert.equal(saved,1);
  }finally{h.close();}
});
test('new experiment keeps one UUID across failed attempts and reports conflict without closing',async()=>{
  const calls=[];let saved=0;const h=harness({rpc:{experiment:async(...args)=>{calls.push(args);throw {code:'40001'};}}});
  const props={item:null,onClose(){},onSaved:()=>saved++};
  try {h.render(ExperimentEditor,props);h.element('form').props.onSubmit({preventDefault(){}});await tick();
    let html=h.render(ExperimentEditor,props);assert.match(html,/another tab/);assert.equal(saved,0);
    h.element('form').props.onSubmit({preventDefault(){}});await tick();
    html=h.render(ExperimentEditor,props);assert.match(html,/another tab/);assert.equal(calls.length,2);
    assert.match(calls[0][0],/^[a-f0-9-]{36}$/);assert.equal(calls[0][0],calls[1][0]);assert.equal(calls[0][1],0);
    assert.equal(calls[0][2].attributable_contribution_usd,null);
  }finally{h.close();}
});

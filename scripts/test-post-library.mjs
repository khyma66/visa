import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const url=s=>`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const dependency=url('export const getSupabase=()=>globalThis.libraryTest.client;');
const source=await readFile(new URL('../src/lib/post-library.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText.replace("'./supabase/client'",JSON.stringify(dependency));
const lib=await import(url(code));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(userId) {
  const h={calls:[],identity:userId,read:async()=>({data:[],error:null}),write:async args=>({data:{post_id:args.target,saved:args.selection==='saved'&&args.enabled,followed:args.selection==='followed'&&args.enabled},error:null})};
  h.client={auth:{getUser:async()=>({data:{user:{id:h.identity}},error:null})},rpc(name,args){h.calls.push({name,args});const p=name==='post_library_state'?h.read(args):h.write(args);p.abortSignal=()=>p;return p;}};
  globalThis.libraryTest=h;return h;
}
test('visible cards batch state reads and do not expose another account cache',async()=>{
  const h=setup('batch-user'), store=lib.libraryStore('batch-user');
  let changed=0;const stops=['one','two','three'].map(id=>lib.watchLibrary(store,id,()=>changed++));
  await tick();assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].args.targets,['one','two','three']);assert.equal(store.values.size,3);assert(changed>0);
  stops.forEach(stop=>stop());assert.equal(lib.libraryStore('another-user').values.size,0);
});
test('late reads cannot replace a successful Save and repeated controls share state',async()=>{
  const h=setup('save-user'),store=lib.libraryStore('save-user');let finish;
  h.read=()=>new Promise(resolve=>{finish=resolve;});
  const stop=lib.watchLibrary(store,'one',()=>{});await tick();
  await lib.changeLibraryEntry(store,'one','saved',true);assert.equal(store.values.get('one').entry.saved,true);
  finish({data:[],error:null});await tick();assert.equal(store.values.get('one').entry.saved,true);
  assert.equal(h.calls[1].args.expected_user,'save-user');stop();
});
test('failed writes are not presented as successful and can be retried',async()=>{
  const h=setup('failure-user'),store=lib.libraryStore('failure-user');
  h.write=async()=>({data:null,error:{message:'offline'}});
  await assert.rejects(()=>lib.changeLibraryEntry(store,'one','saved',true),/Could not update/);
  assert.equal(store.values.size,0);
  h.write=async()=>({data:{post_id:'one',saved:true,followed:false},error:null});
  await lib.changeLibraryEntry(store,'one','saved',true);assert.equal(store.values.get('one').entry.saved,true);
});
test('account changes reject writes and ignore late reads from the prior session',async()=>{
  const h=setup('old-user'),old=lib.libraryStore('old-user');let finish;
  h.read=()=>new Promise(resolve=>{finish=resolve;});lib.watchLibrary(old,'one',()=>{});await tick();
  h.identity='new-user';const next=lib.libraryStore('new-user');
  await assert.rejects(()=>lib.changeLibraryEntry(old,'one','saved',true),/account changed/);
  finish({data:[{post_id:'one',saved:true,followed:true}],error:null});await tick();assert.equal(next.values.size,0);assert.equal(old.values.size,0);
});
test('post cards and details share the five actions and no longer mount Award',async()=>{
  for(const name of ['QuestionCard','QuestionDetail']) {
    const text=await readFile(new URL(`../src/components/${name}.tsx`,import.meta.url),'utf8');
    assert.match(text,/<PostActions /);assert.doesNotMatch(text,/<PostAward|import .*PostAward/);
  }
  const actions=await readFile(new URL('../src/components/PostActions.tsx',import.meta.url),'utf8');
  for(const name of ['MessageCircle','Bell','Bookmark','ReportButton','PostShare']) assert(actions.includes(name));
  const reply=await readFile(new URL('../src/components/QuestionDetail.tsx',import.meta.url),'utf8');
  const ask=await readFile(new URL('../src/components/AskQuestionForm.tsx',import.meta.url),'utf8');
  assert.match(reply,/<CompactTextarea[^>]+rows=\{1\}/);assert.match(ask,/<CompactTextarea[^>]+rows=\{3\}/);
});

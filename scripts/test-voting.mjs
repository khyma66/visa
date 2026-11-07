import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import ts from 'typescript';
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const compile=async(path,deps)=>ts.transpileModule(await readFile(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/(from\s+)(['"])([^'"]+)\2/g,(_,p,q,n)=>{assert(deps[n],n);return p+JSON.stringify(deps[n]);});
const flush=()=>new Promise(r=>setImmediate(r));
const hooks=url(`export function useState(initial){const h=globalThis.__votes,i=h.index++;if(!(i in h.slots))h.slots[i]=initial;return [h.slots[i],v=>{h.slots[i]=typeof v==='function'?v(h.slots[i]):v;}];}export function useRef(initial){const h=globalThis.__votes,i=h.index++;return h.slots[i]??={current:initial};}export function useEffect(fn,deps){const h=globalThis.__votes,i=h.index++,old=h.slots[i];if(!old||deps.some((d,j)=>!Object.is(d,old.deps[j]))){old?.cleanup?.();h.slots[i]={deps,cleanup:fn()};}}`);
const {VoteControls}=await import(url(await compile('../src/components/VoteControls.tsx',{
 react:hooks,'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),
 'lucide-react':url('export const ArrowUp=()=>null,ArrowDown=()=>null,ThumbsUp=()=>null;'),
 './AuthProvider':url('export const useAuth=()=>globalThis.__votes.auth;'),
 '@/lib/voting':url('export const readVote=(...a)=>globalThis.__votes.read(...a),writeVote=(...a)=>globalThis.__votes.write(...a);'),
})));
const nodes=n=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.props?.children)]:[];
const button=(tree,label)=>nodes(tree).find(n=>n.type==='button'&&n.props['aria-label']===label);
const score=tree=>nodes(tree).find(n=>n.props?.className==='vote-score').props.children;
function setup(extra={}){
 const h=globalThis.__votes={index:0,slots:[],auth:{user:{id:'viewer'}},read:async()=>0,write:async()=>7,...extra};
 const props={id:'post',kind:'question',score:7,authorId:'author',path:'/questions/post'};
 const render=(changes={})=>{Object.assign(props,changes);h.index=0;return VoteControls(props);};return {h,render};
}
test('restores selection, toggles it off, switches direction, and shows confirmed totals',async()=>{
 const calls=[];const {render}=setup({read:async()=>1,write:async(...a)=>{calls.push(a);return a[3]===0?6:5;}});
 render();await flush();let tree=render();assert.equal(button(tree,'Upvote').props['aria-pressed'],true);
 button(tree,'Upvote').props.onClick();await flush();tree=render();assert.equal(calls[0][3],0);assert.equal(score(tree),'6');assert.equal(button(tree,'Upvote').props['aria-pressed'],false);
 button(tree,'Downvote').props.onClick();await flush();tree=render();assert.equal(calls[1][3],-1);assert.equal(score(tree),'5');assert.equal(button(tree,'Downvote').props['aria-pressed'],true);
});
test('double clicks coalesce and errors preserve the previously confirmed selection and count',async()=>{
 let finish,calls=0;const {render}=setup({read:async()=>-1,write:()=>{calls++;return new Promise((_,reject)=>finish=reject);}});
 render();await flush();let tree=render();button(tree,'Upvote').props.onClick();button(tree,'Upvote').props.onClick();tree=render();assert.equal(calls,1);assert.equal(button(tree,'Downvote').props.disabled,true);assert.equal(score(tree),'7');
 finish(new Error('Please try again'));await flush();tree=render();assert.equal(button(tree,'Downvote').props['aria-pressed'],true);assert.equal(score(tree),'7');assert.equal(nodes(tree).find(n=>n.props?.role==='alert').props.children,'Please try again');
});
test('account changes ignore delayed reads and writes from the previous account',async()=>{
 let resolveRead,resolveWrite;const {h,render}=setup({read:()=>new Promise(r=>resolveRead=r),write:()=>new Promise(r=>resolveWrite=r)});
 let tree=render();button(tree,'Upvote').props.onClick();h.auth={user:{id:'second'}};h.read=async()=>-1;render();await flush();resolveRead(1);resolveWrite(99);await flush();tree=render();assert.equal(score(tree),'7');assert.equal(button(tree,'Downvote').props['aria-pressed'],true);assert.equal(button(tree,'Upvote').props.disabled,false);
});
test('own contributions are disabled, originals stay read-only, and guests return to their thread',()=>{
 const {h,render}=setup();let tree=render({authorId:'viewer'});assert.equal(button(tree,'Upvote').props.disabled,true);assert.equal(button(tree,'Downvote').props.disabled,true);
 tree=render({readOnly:true});assert.equal(nodes(tree).filter(n=>n.type==='button').length,0);
 h.auth={user:null};globalThis.window={location:{href:''}};tree=render({readOnly:false,authorId:'author'});button(tree,'Upvote').props.onClick();assert.equal(window.location.href,'/login?next=%2Fquestions%2Fpost');delete globalThis.window;
});
const api=await import(url(await compile('../src/lib/voting.ts',{
 './supabase/client':url('export const isSupabaseConfigured=true,getSupabase=()=>globalThis.__voteClient;'),
 './community':url('export const readDemoVote=()=>0,writeDemoVote=()=>0;'),
})));
test('feed selection reads batch at fifty, isolate accounts and return only matching votes',async()=>{
 const calls=[];globalThis.__voteClient={from:table=>({select:()=>({eq:(_,user)=>({in:async(_,ids)=>{calls.push({table,user,ids});return {data:ids.map(id=>({question_id:id,value:1}))};}})})})};
 const values=await Promise.all([...Array.from({length:51},(_,i)=>api.readVote('question','p'+i,'one')),api.readVote('question','p0','two')]);
 assert.equal(values.length,52);assert(values.every(x=>x===1));assert.deepEqual(calls.map(x=>[x.user,x.ids.length]),[['one',50],['two',1],['one',1]]);
});
test('writes bind expected identity, include clearing votes, and reject unconfirmed results',async()=>{
 const calls=[];globalThis.__voteClient={auth:{getUser:async()=>({data:{user:{id:'one'}}})},rpc:async(name,args)=>{calls.push({name,args});return {data:0};}};
 await api.writeVote('question','post','one',0);assert.deepEqual(calls[0],{name:'set_native_vote',args:{kind:'question',target:'post',selected:0,expected_user:'one'}});
 await api.writeVote('imported_answer','comment','one',-1);assert.equal(calls[1].name,'vote_imported_reply');
 await assert.rejects(()=>api.writeVote('answer','comment','two',1),/account changed/);assert.equal(calls.length,2);
 globalThis.__voteClient.rpc=async()=>({data:null});await assert.rejects(()=>api.writeVote('answer','comment','one',1),/confirmed/);
});

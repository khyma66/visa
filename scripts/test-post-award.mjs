import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import ts from 'typescript';

const url=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const hooks=url(`export function useState(initial){const h=globalThis.__award;const i=h.index++;if(!(i in h.slots))h.slots[i]=initial;return [h.slots[i],v=>{h.slots[i]=typeof v==='function'?v(h.slots[i]):v;}];}export function useRef(initial){const h=globalThis.__award;const i=h.index++;return h.slots[i]??={current:initial};}export function useEffect(){}`);
const dependencies={
  react:hooks,'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),
  'next/link':url('export default function Link(){return null;}'),
  'lucide-react':url('export function Award(){return null;}'),
  './AuthProvider':url('export const useAuth=()=>globalThis.__award.auth;'),
  '@/lib/supabase/client':url(`export const isSupabaseConfigured=true;export const getSupabase=()=>({rpc:(name,args)=>({abortSignal:async()=>{const h=globalThis.__award;h.calls.push({name,args});return {data:h.result,error:null};}})});`),
};
const source=await readFile(new URL('../src/components/PostAward.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/(from\s+)(['"])([^'"]+)\2/g,(match,prefix,q,name)=>{assert(dependencies[name],name);return prefix+JSON.stringify(dependencies[name]);});
const {PostAward}=await import(url(compiled));
const nodes=node=>Array.isArray(node)?node.flatMap(nodes):node&&typeof node==='object'?[node,...nodes(node.props?.children)]:[];
const text=node=>Array.isArray(node)?node.map(text).join(''):node==null?'':typeof node==='object'?text(node.props?.children):String(node);
test('award menu loads real counts and submits a selected free badge',async()=>{
  const h=globalThis.__award={index:0,slots:[],calls:[],auth:{user:{id:'viewer'},demoMode:false},result:{helpful:2,support:0,insightful:0,mine:null}};
  const render=()=>{h.index=0;return PostAward({postId:'post',authorId:'author',path:'/questions/post'});};
  let tree=render();nodes(tree).find(n=>n.type==='button').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  tree=render();assert.match(text(tree),/Free recognition/);assert.equal(h.calls[0].name,'post_award_summary');
  nodes(tree).find(n=>n.type==='button'&&text(n).includes('Helpful')).props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.calls[1].name,'set_post_award');assert.equal(h.calls[1].args.selected_badge,'helpful');
  delete globalThis.__award;
});
test('a signed-out visitor can open the menu without making a forbidden database call',()=>{
  const h=globalThis.__award={index:0,slots:[],calls:[],auth:{user:null,demoMode:false},result:null};
  const render=()=>{h.index=0;return PostAward({postId:'post',authorId:'author',path:'/questions/post'});};
  let tree=render();nodes(tree).find(n=>n.type==='button').props.onClick();tree=render();
  assert.equal(h.calls.length,0);assert.match(text(tree),/Log in to give an award/);
  delete globalThis.__award;
});

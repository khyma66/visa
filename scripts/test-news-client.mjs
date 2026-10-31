import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const compile = source => ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const shared = url(compile(await readFile(new URL('../src/lib/official-news-shared.ts',import.meta.url),'utf8')));
const react = url('export const useState = (...args) => globalThis.__newsHarness.useState(...args); export const useEffect = (...args) => globalThis.__newsHarness.useEffect(...args);');
const component = compile(await readFile(new URL('../src/components/OfficialNewsFeed.tsx',import.meta.url),'utf8')).replace(/(from\s+)(['"])([^'"]+)\2/g,(_,prefix,q,name)=>prefix+JSON.stringify(name==='react'?react:name==='@/lib/official-news-shared'?shared:pathToFileURL(require.resolve(name)).href));
const {OfficialNewsFeed}=await import(url(component));
const edition=JSON.parse(await readFile(new URL('../src/data/official-news-snapshot.json',import.meta.url),'utf8'));
class Harness {
  slots=[]; index=0; effects=[]; dirty=false;
  useState(initial){const i=this.index++; if(!(i in this.slots))this.slots[i]=initial; return [this.slots[i],value=>{this.slots[i]=typeof value==='function'?value(this.slots[i]):value;this.dirty=true;}];}
  useEffect(fn,deps){const i=this.index++;const old=this.slots[i];if(!old||deps.some((v,n)=>v!==old.deps[n])){old?.cleanup?.();const slot=this.slots[i]={deps};this.effects.push(()=>{slot.cleanup=fn();});}}
  render(){this.index=0;this.dirty=false;globalThis.__newsHarness=this;this.tree=OfficialNewsFeed({initialFeed:edition});}
  async settle(){for(let i=0;i<10;i++){for(const effect of this.effects.splice(0))effect();await new Promise(r=>setTimeout(r,1));if(!this.dirty)return;this.render();}}
  close(){for(const slot of this.slots)slot?.cleanup?.();delete globalThis.__newsHarness;}
}
function resultFeed(tree){if(!tree||typeof tree!=='object')return; if(tree.props?.feed)return tree.props.feed;for(const child of [tree.props?.children].flat(Infinity)){const found=resultFeed(child);if(found)return found;}}
for(const [name,fetcher] of [
  ['network failure',async()=>{throw Error('offline');}],
  ['HTTP failure',async()=>new Response('',{status:503})],
  ['empty response',async()=>Response.json({...edition,articles:[]})],
  ['invalid response',async()=>Response.json({articles:'bad'})],
  ['older response',async()=>Response.json({...edition,retrievedAt:'2026-01-01T00:00:00Z'})],
]) test(`browser retains server-provided articles during refresh and ${name}`,async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fetcher;const h=new Harness();
  try{h.render();assert.deepEqual(resultFeed(h.tree),edition);await h.settle();assert.deepEqual(resultFeed(h.tree),edition);}finally{h.close();globalThis.fetch=previous;}
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const source = await readFile(new URL('../src/components/TurnstileCheck.tsx',import.meta.url),'utf8');
const hooks = url(`export const useRef=v=>globalThis.__turnstile.useRef(v),useState=v=>globalThis.__turnstile.useState(v),useEffect=(fn,deps)=>globalThis.__turnstile.useEffect(fn,deps);`);
let serial = 0;
async function module() {
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
    .replace('from "react/jsx-runtime"',`from ${JSON.stringify(import.meta.resolve('react/jsx-runtime'))}`)
    .replace("from 'react'",`from ${JSON.stringify(hooks)}`);
  return import(url(js+`\n// isolate-${serial++}`));
}
const nodes = tree => !tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.props?.children)];
const tick = () => new Promise(resolve=>setImmediate(resolve));
function setup(t) {
  const originalWindow=globalThis.window,originalDocument=globalThis.document;
  const h={slots:[],index:0,effects:[],scripts:[],timers:new Map(),timer:0,removed:[],widgets:[],tokens:[]};
  h.useRef=v=>h.slots[h.index++]??={current:v};
  h.useState=v=>{const id=h.index++;if(!(id in h.slots))h.slots[id]=v;return[h.slots[id],value=>h.slots[id]=typeof value==='function'?value(h.slots[id]):value];};
  h.useEffect=(fn,deps)=>{const id=h.index++;if(h.slots[id]?.deps.every((v,i)=>Object.is(v,deps[i])))return;h.slots[id]?.cleanup?.();const slot=h.slots[id]={deps};h.effects.push(()=>slot.cleanup=fn());};
  h.api={render:(container,options)=>{h.widgets.push(options);return 'widget-'+h.widgets.length;},remove:id=>h.removed.push(id)};
  globalThis.window={setTimeout:fn=>{h.timers.set(++h.timer,fn);return h.timer;},clearTimeout:id=>h.timers.delete(id)};
  globalThis.document={querySelector:()=>({nonce:'fixture-nonce'}),createElement:()=>({remove(){this.removed=true;}}),head:{appendChild:script=>h.scripts.push(script)}};
  globalThis.__turnstile=h;
  h.render=(Component,props)=>{h.index=0;h.tree=Component(props);for(const n of nodes(h.tree))if(n.props?.ref)n.props.ref.current={};for(const effect of h.effects.splice(0))effect();};
  h.close=()=>{for(const slot of h.slots)slot?.cleanup?.();};
  t.after(()=>{h.close();if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;delete globalThis.__turnstile;});
  return h;
}

test('Turnstile loads once, carries the nonce, and a network failure or timeout permits a clean retry',async t=>{
  const h=setup(t),{loadTurnstile}=await module();
  const first=loadTurnstile(),second=loadTurnstile();
  assert.equal(first,second);assert.equal(h.scripts.length,1);
  assert.equal(h.scripts[0].src,'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
  assert.equal(h.scripts[0].nonce,'fixture-nonce');
  h.scripts[0].onerror();await assert.rejects(first,/unavailable/);
  assert(h.scripts[0].removed);assert.equal(h.timers.size,0);
  const timed=loadTurnstile();h.timers.values().next().value();await assert.rejects(timed,/unavailable/);
  assert(h.scripts[1].removed);
  const third=loadTurnstile();window.turnstile=h.api;h.scripts[2].onload();assert.equal(await third,h.api);assert.equal(h.timers.size,0);
  assert.equal(await loadTurnstile(),h.api);assert.equal(h.scripts.length,3);
});

test('Turnstile invalidates expired/error tokens, resets a widget, and ignores callbacks after removal',async t=>{
  const h=setup(t),{TurnstileCheck}=await module();window.turnstile=h.api;
  const props={siteKey:'public-fixture',resetKey:0,onToken:token=>h.tokens.push(token)};
  h.render(TurnstileCheck,props);await tick();
  assert.equal(h.widgets.length,1);h.widgets[0].callback('token-one');assert.equal(h.tokens.at(-1),'token-one');
  h.widgets[0]['expired-callback']();assert.equal(h.tokens.at(-1),'');
  h.widgets[0].callback('token-two');assert.equal(h.widgets[0]['error-callback'](),true);assert.equal(h.tokens.at(-1),'');
  h.render(TurnstileCheck,props);assert(nodes(h.tree).some(n=>n.props?.role==='alert'));
  const retry=nodes(h.tree).find(n=>n.type==='button');assert(retry);retry.props.onClick();h.render(TurnstileCheck,props);await tick();
  assert.deepEqual(h.removed,['widget-1']);assert.equal(h.widgets.length,2);
  h.widgets[0].callback('late-token');assert.equal(h.tokens.at(-1),'');
  h.widgets[1].callback('token-three');assert.equal(h.tokens.at(-1),'token-three');
  h.render(TurnstileCheck,{...props,resetKey:1});await tick();assert.equal(h.tokens.at(-1),'');assert.equal(h.widgets.length,3);
  h.widgets[2]['timeout-callback']();assert.equal(h.tokens.at(-1),'');
  h.close();h.widgets[2].callback('late-after-unmount');assert.equal(h.tokens.at(-1),'');
});

test('an empty site key loads no script or widget; unmount while loading cannot render a late widget',async t=>{
  const h=setup(t),{TurnstileCheck}=await module();
  const props={siteKey:'',resetKey:0,onToken:token=>h.tokens.push(token)};
  h.render(TurnstileCheck,props);assert.equal(h.tree,null);assert.equal(h.scripts.length,0);
  h.render(TurnstileCheck,{...props,siteKey:'public-fixture'});assert.equal(h.scripts.length,1);h.close();
  window.turnstile=h.api;h.scripts[0].onload();await tick();assert.equal(h.widgets.length,0);
});

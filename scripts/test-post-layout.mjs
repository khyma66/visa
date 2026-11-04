import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Exercise the component's real event handlers with deterministic browser boundaries.
const require = createRequire(import.meta.url);
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const dependencies = {
  'react/jsx-runtime': pathToFileURL(require.resolve('react/jsx-runtime')).href,
  react: url(`export const useState=v=>globalThis.layoutHarness.state(v); export const useRef=v=>globalThis.layoutHarness.ref(v); export const useId=()=> 'layout-test'; export const useEffect=fn=>globalThis.layoutHarness.effect(fn);`),
  './ResizablePostLayout.module.css': url('export default {};'),
};
const source = await readFile(new URL('../src/components/ResizablePostLayout.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  .replace(/(from\s+)(['"])([^'"]+)\2/g, (_, prefix, _q, name) => { assert(dependencies[name]); return prefix + JSON.stringify(dependencies[name]); });
const { ResizablePostLayout } = await import(url(code));
function nodes(node) { return !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]; }
function setup({ stored = null, blocked = false, width = 1232 } = {}) {
  const oldWindow = globalThis.window, oldObserver = globalThis.ResizeObserver;
  const h = { slots: [], index: 0, effects: [], cleanups: [], width, stored, writes: [], captured: null, disconnected: false,
    state(value) { const i=this.index++; this.slots[i] ??= value; return [this.slots[i], next => { this.slots[i] = typeof next === 'function' ? next(this.slots[i]) : next; }]; },
    ref(value) { const i=this.index++; return this.slots[i] ??= { current:value }; },
    effect(fn) { const i=this.index++; if(!this.slots[i]) {this.slots[i]=true; this.effects.push(fn);} },
    render() { this.index=0; globalThis.layoutHarness=this; this.tree=ResizablePostLayout({children:'Post fixture',related:'Related fixture'}); for(const n of nodes(this.tree)) if(n.props.ref) n.props.ref.current={getBoundingClientRect:()=>({width:this.width})}; return this; },
    separator() { return nodes(this.tree).find(n=>n.props.role==='separator').props; },
    key(key, shiftKey=false) { let prevented=false; this.separator().onKeyDown({key,shiftKey,currentTarget:this.target,preventDefault(){prevented=true;}}); this.render(); return prevented; },
    pointer(name,x,extra={}) { this.separator()[name]({pointerId:1,clientX:x,isPrimary:true,button:0,currentTarget:this.target,preventDefault(){},...extra}); this.render(); },
    close() { for(const cleanup of this.cleanups) cleanup?.(); globalThis.window=oldWindow; globalThis.ResizeObserver=oldObserver; delete globalThis.layoutHarness; },
  };
  h.target={ focus(){},setPointerCapture(id){h.captured=id;},hasPointerCapture(id){return h.captured===id;},releasePointerCapture(){h.captured=null;} };
  globalThis.window={localStorage:{getItem(){if(blocked)throw Error('blocked');return h.stored;},setItem(key,value){if(blocked)throw Error('blocked');h.stored=value;h.writes.push({key,value});}}};
  globalThis.ResizeObserver=class {constructor(fn){h.measure=fn;}observe(){}disconnect(){h.disconnected=true;}};
  h.render(); for(const fn of h.effects.splice(0))h.cleanups.push(fn()); h.render(); return h;
}

test('60/40 default and keyboard access include limits, larger steps and reset', () => {
  const h=setup();try {
    assert.equal(h.separator()['aria-valuenow'],60);
    assert.equal(h.separator()['aria-orientation'],'vertical');
    assert.equal(h.key('ArrowRight'),true); assert.equal(h.separator()['aria-valuenow'],61);
    h.key('ArrowLeft',true); assert.equal(h.separator()['aria-valuenow'],56);
    h.key('Home'); assert.equal(h.separator()['aria-valuenow'],h.separator()['aria-valuemin']);
    h.key('End'); assert.equal(h.separator()['aria-valuenow'],h.separator()['aria-valuemax']);
    assert.equal(h.key('Tab'),false);
    nodes(h.tree).find(n=>n.type==='button' && n.props.children==='Reset 60/40').props.onClick(); h.render();
    assert.equal(h.separator()['aria-valuenow'],60); assert.equal(h.stored,'60');
  }finally{h.close();}
});

test('drag is relative to the grab point, clamps, captures pointer and persists only on release', () => {
  const h=setup();try {
    h.pointer('onPointerDown',800); assert.equal(h.captured,1); assert.equal(h.separator()['aria-valuenow'],60);
    h.pointer('onPointerMove',920,{pointerId:2}); assert.equal(h.separator()['aria-valuenow'],60);
    h.pointer('onPointerMove',920); assert.equal(h.separator()['aria-valuenow'],70); assert.equal(h.writes.length,0);
    h.pointer('onPointerUp',920); assert.equal(h.stored,'70'); assert.equal(h.captured,null);
    h.pointer('onPointerDown',900); h.pointer('onPointerMove',9000); assert.equal(h.separator()['aria-valuenow'],75);
    h.pointer('onPointerUp',9000); assert.equal(h.stored,'75');
  }finally{h.close();}
});

test('pointer cancellation, lost capture and Escape restore the original width without saving', () => {
  for(const action of ['onPointerCancel','onLostPointerCapture','Escape']) {
    const h=setup();try{
      h.pointer('onPointerDown',800);h.pointer('onPointerMove',920);
      if(action==='Escape')h.key('Escape');else h.pointer(action,920);
      assert.equal(h.separator()['aria-valuenow'],60);assert.equal(h.writes.length,0);
    }finally{h.close();}
  }
});

test('stored preferences survive viewport clamps and observer is disconnected on unmount', () => {
  const h=setup({stored:'75',width:928});try{
    assert.equal(h.separator()['aria-valuenow'],68);
    assert.equal(h.writes.length,0);
    h.width=1232;h.measure();h.render();assert.equal(h.separator()['aria-valuenow'],75);
  }finally{h.close();}assert.equal(h.disconnected,true);
});

test('invalid or unavailable storage does not break resizing; pointer alternatives work', () => {
  for(const options of [{stored:'garbage'},{stored:'200'},{stored:''},{blocked:true}]) {
    const h=setup(options);try{
      assert.equal(h.separator()['aria-valuenow'],60);
      nodes(h.tree).find(n=>n.props['aria-label']==='Widen related questions').props.onClick();h.render();
      assert.equal(h.separator()['aria-valuenow'],55);
      h.separator().onDoubleClick();h.render();assert.equal(h.separator()['aria-valuenow'],60);
    }finally{h.close();}
  }
});

test('both question and experience pages share the layout; mobile hides resizing and stacks content', async () => {
  const root=new URL('../',import.meta.url);
  for(const page of ['src/app/questions/[id]/page.tsx','src/app/experiences/[id]/page.tsx']) assert.match(await readFile(new URL(page,root),'utf8'),/QuestionDetail/);
  const css=await readFile(new URL('src/components/ResizablePostLayout.module.css',root),'utf8');
  assert.match(css,/\.controls, \.divider \{ display: none; \}/);
  assert.match(css,/@media \(min-width: 1024px\)/);
  assert.match(css,/minmax\(0, var\(--post-split\)\) 32px minmax\(0, var\(--related-split\)\)/);
});

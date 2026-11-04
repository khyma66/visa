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
  const h = { slots: [], index: 0, effects: [], cleanups: [], width, stored, frames: new Map(), frameId: 0, writes: [], captured: null, disconnected: false,
    state(value) { const i=this.index++; this.slots[i] ??= value; return [this.slots[i], next => { this.slots[i] = typeof next === 'function' ? next(this.slots[i]) : next; }]; },
    ref(value) { const i=this.index++; return this.slots[i] ??= { current:value }; },
    effect(fn) { const i=this.index++; if(!this.slots[i]) {this.slots[i]=true; this.effects.push(fn);} },
    render() { this.index=0; globalThis.layoutHarness=this; this.tree=ResizablePostLayout({children:'Post fixture',related:'Related fixture'}); for(const n of nodes(this.tree)) if(n.props.ref) n.props.ref.current={getBoundingClientRect:()=>({width:this.width})}; return this; },
    separator() { return nodes(this.tree).find(n=>n.props.role==='separator').props; },
    key(key, shiftKey=false) { let prevented=false; this.separator().onKeyDown({key,shiftKey,currentTarget:this.target,preventDefault(){prevented=true;}}); this.render(); return prevented; },
    flush() { const callbacks=[...this.frames.values()]; this.frames.clear(); for(const fn of callbacks) fn(); this.render(); },
    pointer(name,x,extra={}) { this.separator()[name]({pointerId:1,clientX:x,isPrimary:true,button:0,currentTarget:this.target,preventDefault(){},...extra}); if(extra.flush !== false)this.flush(); this.render(); },
    close() { for(const cleanup of this.cleanups) cleanup?.(); globalThis.window=oldWindow; globalThis.ResizeObserver=oldObserver; delete globalThis.layoutHarness; },
  };
  h.target={ focus(){},setPointerCapture(id){h.captured=id;},hasPointerCapture(id){return h.captured===id;},releasePointerCapture(){h.captured=null;} };
  globalThis.window={requestAnimationFrame(fn){const id=++h.frameId;h.frames.set(id,fn);return id;},cancelAnimationFrame(id){h.frames.delete(id);},localStorage:{getItem(){if(blocked)throw Error('blocked');return h.stored;},setItem(key,value){if(blocked)throw Error('blocked');h.stored=value;h.writes.push({key,value});}}};
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
    h.key('Enter');
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

test('invalid or unavailable storage does not break keyboard resizing', () => {
  for(const options of [{stored:'garbage'},{stored:'200'},{stored:''},{blocked:true}]) {
    const h=setup(options);try{
      assert.equal(h.separator()['aria-valuenow'],60);
      h.key('ArrowLeft',true);
      assert.equal(h.separator()['aria-valuenow'],55);
      h.separator().onDoubleClick();h.render();assert.equal(h.separator()['aria-valuenow'],60);
    }finally{h.close();}
  }
});

test('both question and experience pages share the layout; mobile hides resizing and stacks content', async () => {
  const root=new URL('../',import.meta.url);
  for(const page of ['src/app/questions/[id]/page.tsx','src/app/experiences/[id]/page.tsx']) assert.match(await readFile(new URL(page,root),'utf8'),/QuestionDetail/);
  const css=await readFile(new URL('src/components/ResizablePostLayout.module.css',root),'utf8');
  assert.match(css,/\.divider, \.reset \{ display: none; \}/);
  assert.match(css,/@container post-layout \(min-width: 800px\)/);
  assert.match(css,/minmax\(0, var\(--post-split\)\) 32px minmax\(0, var\(--related-split\)\)/);
});


test('pointer movement is coalesced per animation frame and cancelled before commit or unmount', () => {
  const h=setup();try {
    h.pointer('onPointerDown',800);
    h.pointer('onPointerMove',860,{flush:false});h.pointer('onPointerMove',920,{flush:false});
    assert.equal(h.frames.size,1);assert.equal(h.separator()['aria-valuenow'],60);
    h.flush();assert.equal(h.separator()['aria-valuenow'],70);
    h.pointer('onPointerMove',980,{flush:false});
    h.pointer('onPointerUp',920);assert.equal(h.frames.size,0);assert.equal(h.stored,'70');
    h.pointer('onPointerDown',800);h.pointer('onPointerMove',920,{flush:false});
    h.key('Escape');assert.equal(h.frames.size,0);assert.equal(h.separator()['aria-valuenow'],70);
    h.pointer('onPointerDown',800);h.pointer('onPointerMove',920,{flush:false});
  }finally{h.close();}assert.equal(h.frames.size,0);
});

test('splitter keeps instructions and percentages off-screen; icon reset restores the saved default', () => {
  const h=setup();try {
    const reset = () => nodes(h.tree).find(n=>n.type==='button').props;
    assert.equal(nodes(h.tree).filter(n=>n.type==='button').length,1);
    assert.equal(reset()['aria-label'],'Reset panel widths');
    assert.equal(reset().disabled,true);
    h.key('ArrowRight',true);assert.equal(reset().disabled,false);
    reset().onClick();h.render();
    assert.equal(h.separator()['aria-valuenow'],60);assert.equal(h.stored,'60');
    assert.equal(reset().disabled,true);
    assert.equal(nodes(h.tree).filter(n=>n.type==='span').length,0);
    assert.equal(h.separator().children,undefined);
    assert.doesNotMatch(source,/Drag divider to resize|Reset 60\/40|styles\.(?:controls|ratio|grip)/);
  }finally{h.close();}
});


test('related scrolling is keyboard reachable only when there is room for two columns', () => {
  const h=setup({width:1200});try {
    const aside=()=>nodes(h.tree).find(n=>n.type==='aside').props;
    assert.equal(aside().tabIndex,0);
    h.width=700;h.measure();h.render();assert.equal(aside().tabIndex,undefined);
    h.width=800;h.measure();h.render();
    assert.equal(aside().tabIndex,0);
    assert.equal(h.separator()['aria-valuenow'],60);
    h.key('Home');assert(h.separator()['aria-valuenow']/100*(800-32)>=440);
    h.key('End');assert((1-h.separator()['aria-valuenow']/100)*(800-32)>=280);
  }finally{h.close();}
});

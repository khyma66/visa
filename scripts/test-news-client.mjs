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
const headlinesShared = url(compile(await readFile(new URL('../src/lib/immigration-headlines.ts',import.meta.url),'utf8')));
const react = url('export const useState = (...args) => globalThis.__newsHarness.useState(...args); export const useEffect = (...args) => globalThis.__newsHarness.useEffect(...args);');
const component = compile(await readFile(new URL('../src/components/OfficialNewsFeed.tsx',import.meta.url),'utf8')).replace(/(from\s+)(['"])([^'"]+)\2/g,(_,prefix,q,name)=>prefix+JSON.stringify(name==='./ResizablePostLayout'?url('export function ResizablePostLayout(){return null;}'):name==='react'?react:name==='@/lib/official-news-shared'?shared:name==='@/lib/immigration-headlines'?headlinesShared:pathToFileURL(require.resolve(name)).href));
const {OfficialNewsFeed,HeadlineResults}=await import(url(component));
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

function elements(node){if(Array.isArray(node))return node.flatMap(elements);if(!node||typeof node!=='object')return [];return [node,...elements([node.props?.children,node.props?.related])];}
function content(node){if(Array.isArray(node))return node.map(content).join(' ');if(node==null||typeof node==='boolean')return '';return typeof node==='object'?content([node.props?.children,node.props?.related]):String(node);}
test('headline search, topic chips, reset and pagination work without additional network requests',()=>{
  const h=new Harness();
  const headlines={source:'GDELT Project',retrievedAt:'2026-11-03T20:12:00Z',articles:Array.from({length:15},(_,i)=>({title:i===0?'USCIS F-1 student visa update':'USCIS H-1B work visa update '+i,url:'https://example.com/'+i,publisher:'Example',publishedAt:'2026-11-03T10:00:00Z'}))};
  const render=()=>{h.index=0;globalThis.__newsHarness=h;h.tree=HeadlineResults({headlines});};
  const button=name=>elements(h.tree).find(n=>n.type==='button'&&content(n).includes(name));
  try{
    render();assert.equal(elements(h.tree).filter(n=>n.type==='article').length,12);
    button('Show more').props.onClick();render();assert.equal(elements(h.tree).filter(n=>n.type==='article').length,15);
    button('Students').props.onClick();render();assert.equal(elements(h.tree).filter(n=>n.type==='article').length,1);
    elements(h.tree).find(n=>n.type==='input').props.onChange({target:{value:'no-matching-story'}});render();
    assert.match(content(h.tree),/No headlines match/);
    button('Clear filters').props.onClick();render();assert.equal(elements(h.tree).filter(n=>n.type==='article').length,12);
    assert.match(content(h.tree),/Indexed/);assert.equal(elements(h.tree).filter(n=>n.type==='img').length,0);
    for(const a of elements(h.tree).filter(n=>n.type==='a'&&n.props.target==='_blank'))assert.match(a.props.rel,/noopener/);
  }finally{h.close();}
});

test('news tabs expose one panel, support keyboard navigation and retain mounted editions without refetching', () => {
  const h=new Harness();
  const reporting={type:'section',props:{children:'Saved reporting fixture'}};
  const render=()=>{h.index=0;globalThis.__newsHarness=h;h.tree=OfficialNewsFeed({initialFeed:edition,children:reporting});};
  const tabs=()=>elements(h.tree).filter(n=>n.props.role==='tab');
  const panels=()=>elements(h.tree).filter(n=>n.props.role==='tabpanel');
  const active=()=>tabs().find(n=>n.props['aria-selected']);
  const check=id=>{
    assert.equal(active().props.id,`news-tab-${id}`);
    assert.equal(tabs().filter(n=>n.props.tabIndex===0).length,1);
    assert.equal(panels().filter(n=>!n.props.hidden).length,1);
    assert.equal(panels().find(n=>!n.props.hidden).props.id,active().props['aria-controls']);
    for(const panel of panels())assert(tabs().some(n=>n.props.id===panel.props['aria-labelledby']));
    assert.equal(panels().find(n=>n.props.id==='news-panel-reporting').props.children,reporting);
    assert.deepEqual(resultFeed(h.tree),edition);
  };
  let focused=-1;
  const key=value=>{
    let prevented=false;
    active().props.onKeyDown({key:value,preventDefault(){prevented=true;},currentTarget:{parentElement:{querySelectorAll:()=>tabs().map((_,i)=>({focus(){focused=i;}}))}}});
    render();return prevented;
  };
  try {
    render();check('reporting');const effects=h.effects.length;
    assert.equal(key('ArrowRight'),true);check('headlines');assert.equal(focused,1);
    key('End');check('official');assert.equal(focused,2);
    key('ArrowRight');check('reporting');
    key('ArrowLeft');check('official');
    key('Home');check('reporting');
    assert.equal(key('Tab'),false);check('reporting');
    tabs()[2].props.onClick();render();check('official');
    tabs()[0].props.onClick();render();check('reporting');
    assert.equal(h.effects.length,effects,'Changing sections must not restart feed requests');
    assert.equal(elements(h.tree).filter(n=>n.props.relatedLabel==='Official visa resources').length,1);
  } finally {h.close();}
});

test('without licensed reporting, news opens an available official edition and does not leave an empty tab',()=>{
  const h=new Harness();try{
    h.render();
    const tabs=elements(h.tree).filter(n=>n.props.role==='tab');
    assert.equal(tabs.length,2);
    assert.equal(tabs.find(n=>n.props['aria-selected']).props.id,'news-tab-official');
    assert.equal(elements(h.tree).filter(n=>n.props.role==='tabpanel'&&!n.props.hidden).length,1);
    assert(!elements(h.tree).some(n=>n.props.id==='news-panel-reporting'));
  }finally{h.close();}
});

test('publisher coverage stays newest first within topic and search filters without changing source dates',()=>{
  const h=new Harness();
  const headlines={source:'USCIS Newsroom',retrievedAt:'2026-11-04T00:00:00Z',articles:[
    {title:'H-1B older update',url:'https://example.com/older',publisher:'USCIS',publishedAt:'2026-11-01T09:00:00Z'},
    {title:'F-1 latest update',url:'https://example.com/latest',publisher:'USCIS',publishedAt:'2026-11-03T09:00:00Z'},
    {title:'H-1B newer update',url:'https://example.com/newer',publisher:'USCIS',publishedAt:'2026-11-02T09:00:00Z'},
  ]};
  const render=()=>{h.index=0;globalThis.__newsHarness=h;h.tree=HeadlineResults({headlines});};
  const dates=()=>elements(h.tree).filter(n=>n.type==='time').map(n=>n.props.dateTime);
  try{
    render();assert.deepEqual(dates(),[headlines.articles[1].publishedAt,headlines.articles[2].publishedAt,headlines.articles[0].publishedAt]);
    elements(h.tree).find(n=>n.type==='button'&&content(n).trim()==='Work visas').props.onClick();render();
    assert.deepEqual(dates(),[headlines.articles[2].publishedAt,headlines.articles[0].publishedAt]);
    assert.doesNotMatch(content(h.tree),/Indexed/);
    assert.equal(headlines.articles[0].title,'H-1B older update','Do not reorder cached source data');
  }finally{h.close();}
});

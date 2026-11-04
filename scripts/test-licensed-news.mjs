import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseFeed, articleFrom, refreshLicensedNews, bounded, REVIEWED_POLICY_DIGEST } from './refresh-licensed-news.mjs';
const require = createRequire(import.meta.url);
const asUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const deps = {};
async function compile(path) {
  return asUrl(ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/(from\s+)(['"])([^'"]+)\2/g, (_, prefix, q, name) => prefix + JSON.stringify(deps[name] ?? pathToFileURL(require.resolve(name)).href)));
}
const snapshot = JSON.parse(await readFile(new URL('../src/data/licensed-news-snapshot.json', import.meta.url), 'utf8'));
deps['@/data/licensed-news-snapshot.json'] = asUrl('export default ' + JSON.stringify(snapshot));
deps['@/lib/licensed-news-shared'] = deps['./licensed-news-shared'] = await compile('../src/lib/licensed-news-shared.ts');
const shared = await import(deps['./licensed-news-shared']);
deps['@/lib/licensed-news'] = await compile('../src/lib/licensed-news.ts');
const service = await import(deps['@/lib/licensed-news']);
const photoRoute = await import(await compile('../src/app/api/news-photo/[id]/route.ts'));
const { LicensedStory, LicensedNewsFeed } = await import(await compile('../src/components/LicensedNewsFeed.tsx'));
const now = Date.parse('2026-11-04T04:00:00Z');
const image = 'https://i0.wp.com/www.texastribune.org/wp-content/uploads/2026/10/story.jpg?fit=1024%2C683&ssl=1';
const row = { title: 'Immigration court ruling', link: 'https://www.texastribune.org/2026/10/30/immigration-court/', 'dc:creator': 'Reporter Name', pubDate: 'Fri, 30 Oct 2026 15:36:39 +0000', 'post-id': '123', description: `<figure><img src="${image}" width="1024" height="683" /></figure><p>Publisher-provided short excerpt.</p>` };
const html = '<article id="post-123"><figure class="post-thumbnail"><img src="story.jpg"/><figcaption><span>A courthouse on October 30.<span class="image-credit">Photographer Name for The Texas Tribune</span></span></figcaption></figure><textarea id="republication-tracker-tool-plain-text-content"></textarea></article>';
const rss = item => `<rss><channel><item>${Object.entries(item).map(([k,v])=>`<${k}><![CDATA[${v}]]></${k}>`).join('')}</item></channel></rss>`;

test('licensed edition contains genuine previews, separate photo credit, source and permission proof', () => {
  assert(shared.isLicensedNews(snapshot, now)); assert.equal(snapshot.policyDigest, REVIEWED_POLICY_DIGEST);
  assert(snapshot.articles.length >= 5); assert(snapshot.articles.filter(a=>a.photo).length >= 4);
  for(const a of snapshot.articles){assert(!/Associated Press|ProPublica|El Paso Matters/i.test(a.author)); if(a.photo) assert(shared.licensedPhotoCredit(a.photo.credit));}
});
test('RSS parsing preserves values, rejects DTDs, duplicates, complex or oversized data', () => {
  assert.deepEqual(parseFeed(rss(row))[0], row);
  assert.throws(()=>parseFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+rss(row)));
  assert.throws(()=>parseFeed('<rss><channel><item><title>a</title><title>b</title></item></channel></rss>'));
  assert.throws(()=>parseFeed(' '.repeat(1_000_001)));
  assert.throws(()=>parseFeed('<rss><channel><item><title><b>bad</b></title></item></channel></rss>'));
});
test('original article with republication enabled gets the unchanged publisher teaser and matching photo', () => {
  const article = articleFrom(row, html, now);
  assert.equal(article.excerpt, 'Publisher-provided short excerpt.'); assert.equal(article.photo.credit, 'Photographer Name for The Texas Tribune');
  assert.equal(article.photo.caption, 'A courthouse on October 30.'); assert.equal(article.photo.url, image);
});
test('partner text, revoked republication, unsafe or dated-out stories are excluded', () => {
  for(const r of [{...row,'dc:creator':'Associated Press'},{...row,link:'https://evil.test/'},{...row,pubDate:'2100-01-01'},{...row,pubDate:'2020-01-01'}]) assert.equal(articleFrom(r,html,now),null);
  assert.equal(articleFrom(row,html.replace('republication-tracker-tool-plain-text-content','disabled'),now),null);
  assert.equal(articleFrom(row,html.replace('post-123','post-124'),now),null);
});
test('wire photos, unclear credits, illustrations and mismatched image paths fail closed without dropping the text', () => {
  for(const credit of ['REUTERS/Photographer','Getty Images for The Texas Tribune','Unknown','Illustration by Artist for The Texas Tribune']) assert.equal(articleFrom(row,html.replace('Photographer Name for The Texas Tribune',credit),now).photo,undefined);
  assert.equal(articleFrom(row,html.replace('src="story.jpg"','src="unrelated.jpg"'),now).photo,undefined);
});
test('schema rejects foreign image hosts, unsafe paths, arbitrary query keys and missing attribution', () => {
  for(const url of ['https://127.0.0.1/a.jpg','https://i0.wp.com/evil.test/story.jpg?fit=1024,683&ssl=1',image+'&redirect=https://evil.test',image.replace('.jpg','.svg')]) assert(!shared.licensedPhotoUrl(url));
  for(const edit of [a=>a.photo.credit='Getty',a=>a.permissionUrl='https://evil.test/',a=>a.title='<img src=x>',a=>a.photo.url='http://localhost/x']) {const bad=structuredClone(snapshot);edit(bad.articles[0]);assert(!shared.isLicensedNews(bad,now));}
});
test('changed publisher permissions and upstream failures stop publication without mutating saved data', async () => {
  const before=JSON.stringify(snapshot);
  await assert.rejects(refreshLicensedNews(snapshot,async()=>new Response('<h4>Story Republishing Guidelines</h4><p>Changed terms.</p><h4>Multimedia Republishing Guidelines</h4>'),()=>now),/terms changed/);
  await assert.rejects(refreshLicensedNews(snapshot,async()=>new Response('',{status:503}),()=>now));
  assert.equal(JSON.stringify(snapshot),before);
  await assert.rejects(bounded(new Response('x'.repeat(11)),10));
});
test('cards include credited photo, dimensions, accessible context and full-story links; missing images need no placeholder', () => {
  const article=snapshot.articles[0];
  const lead=renderToStaticMarkup(createElement(LicensedStory,{article,lead:true}));
  assert.match(lead,/loading="eager"/); assert.match(lead,/fetchPriority="high"/);assert.match(lead,/width="1024"/);
  assert(lead.includes(article.photo.credit));assert(lead.includes(article.url));assert.match(lead,/noopener noreferrer/);
  const compact=renderToStaticMarkup(createElement(LicensedStory,{article}));assert.match(compact,/loading="lazy"/);assert.match(compact,/Photo context/);
  const textOnly=renderToStaticMarkup(createElement(LicensedStory,{article:{...article,photo:undefined},lead:true}));assert.doesNotMatch(textOnly,/<img|md:grid-cols-2/);
  const page=renderToStaticMarkup(createElement(LicensedNewsFeed,{initialEdition:snapshot}));assert.match(page,/Sources &amp; photo credits/);assert.match(page,/Updated/);assert.doesNotMatch(page,/<script\b|src="https:\/\//);
});
test('photo route accepts only edition-listed image identifiers and validates image bytes', async () => {
  const old=globalThis.fetch;let calls=[];
  globalThis.fetch=async(url,options)=>{calls.push(String(url));assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');return String(url).includes('raw.githubusercontent')?Response.json(snapshot):new Response(new Uint8Array([255,216,255,224,0,1]));};
  try{
    let r=await photoRoute.GET(new Request('https://visathreads.com/api/news-photo/bad'),{params:Promise.resolve({id:'https://localhost/'})});assert.equal(r.status,404);assert.equal(calls.length,0);
    const id=snapshot.articles[0].photo.id;
    r=await photoRoute.GET(new Request('https://visathreads.com/api/news-photo/'+id),{params:Promise.resolve({id})});assert.equal(r.status,200);assert.equal(r.headers.get('Content-Type'),'image/jpeg');assert.equal(calls.at(-1),snapshot.articles[0].photo.url);
    assert.equal(r.headers.get('Cross-Origin-Resource-Policy'),'same-origin');
    globalThis.fetch=async url=>String(url).includes('raw.githubusercontent')?Response.json(snapshot):new Response('<svg onload="alert(1)"/>');
    r=await photoRoute.GET(new Request('https://visathreads.com/api/news-photo/'+id),{params:Promise.resolve({id})});assert.equal(r.status,404);
  }finally{globalThis.fetch=old;}
});
test('news response bodies are bounded and outage fallback never fabricates a new timestamp', async () => {
  await assert.rejects(service.boundedNewsBytes(new Response('123456'),5));
  assert.equal(service.newsImageType(new TextEncoder().encode('<html>bad</html>')),null);
  const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('offline');};
  try{const result=await service.loadLicensedNews();assert.equal(result.stale,true);assert.equal(result.edition.retrievedAt,snapshot.retrievedAt);}finally{globalThis.fetch=old;}
});
test('hourly publication and daily publication share a lock and preserve each other’s edition files', async () => {
  const hourly=await readFile(new URL('../.github/workflows/licensed-news-refresh.yml',import.meta.url),'utf8');
  const daily=await readFile(new URL('../.github/workflows/news-refresh.yml',import.meta.url),'utf8');
  assert.match(hourly,/cron: '37 \* \* \* \*'/);
  for(const source of [hourly,daily]){assert.match(source,/group: public-visa-news-edition/);assert.match(source,/git read-tree "\$parent"/);assert.match(source,/git write-tree/);assert.doesNotMatch(source,/--force|git mktree/);}
});

// Component-state tests do not pretend to replace a real browser visual review.
deps.react = asUrl('export const useState = (...a) => globalThis.__licensedHarness.useState(...a); export const useEffect = (...a) => globalThis.__licensedHarness.useEffect(...a);');
const interactive = await import(await compile('../src/components/LicensedNewsFeed.tsx'));
class Harness {
  slots=[]; index=0; effects=[]; dirty=false;
  useState(initial){const i=this.index++;if(!(i in this.slots))this.slots[i]=initial;return [this.slots[i],v=>{this.slots[i]=typeof v==='function'?v(this.slots[i]):v;this.dirty=true;}];}
  useEffect(fn,deps){const i=this.index++;const old=this.slots[i];if(!old||deps.some((v,n)=>v!==old.deps[n])){old?.cleanup?.();const slot=this.slots[i]={deps};this.effects.push(()=>{slot.cleanup=fn();});}}
  render(Component=interactive.LicensedNewsFeed,props={initialEdition:snapshot}){this.index=0;this.dirty=false;globalThis.__licensedHarness=this;this.tree=Component(props);}
  async settle(){for(let i=0;i<10;i++){for(const e of this.effects.splice(0))e();await new Promise(r=>setTimeout(r,1));if(!this.dirty)return;this.render();}}
  close(){for(const slot of this.slots)slot?.cleanup?.();delete globalThis.__licensedHarness;}
}
function elements(node){if(Array.isArray(node))return node.flatMap(elements);if(!node||typeof node!=='object')return [];return [node,...elements(node.props?.children)];}
function content(node){if(Array.isArray(node))return node.map(content).join(' ');if(node==null||typeof node==='boolean')return '';return typeof node==='object'?content(node.props?.children):String(node);}
test('news search, pagination, empty results and image-error removal work through component state',()=>{
  const h=new Harness();
  const stories=()=>elements(h.tree).filter(n=>n.type===interactive.LicensedStory);
  try{
    h.render();assert.equal(stories().length,5);
    elements(h.tree).find(n=>n.type==='button').props.onClick();h.render();assert.equal(stories().length,6);
    elements(h.tree).find(n=>n.type==='input').props.onChange({target:{value:'Dolores'}});h.render();assert.equal(stories().length,1);
    elements(h.tree).find(n=>n.type==='input').props.onChange({target:{value:'no-such-story'}});h.render();assert.match(content(h.tree),/No stories match/);
  }finally{h.close();}
  const imageHarness=new Harness();const props={article:snapshot.articles[0],lead:true};
  try{
    imageHarness.render(interactive.LicensedStory,props);
    elements(imageHarness.tree).find(n=>n.type==='img').props.onError();imageHarness.render(interactive.LicensedStory,props);
    assert(!elements(imageHarness.tree).some(n=>n.type==='img'||n.type==='figure'));
    assert(!elements(imageHarness.tree).some(n=>n.props?.className?.includes('md:grid-cols-2')));
  }finally{imageHarness.close();}
});
for(const [label,fetcher,expected] of [
  ['outage',async()=>{throw Error('offline');},6],
  ['older edition',async()=>Response.json({...snapshot,retrievedAt:'2026-01-01T00:00:00Z',articles:[]}),6],
  ['withdrawn edition',async()=>Response.json({...snapshot,articles:[]}),0],
]) test(`client handles ${label} without fabricated updates or resurfacing withdrawn stories`,async()=>{
  const previous=globalThis.fetch, previousDocument=globalThis.document;const h=new Harness();
  globalThis.fetch=fetcher;globalThis.document={visibilityState:'visible'};
  try{h.render();await h.settle();assert.equal(h.slots[0].articles.length,expected);assert.equal(h.slots[0].retrievedAt,snapshot.retrievedAt);if(!expected)assert.match(content(h.tree),/No eligible reporting/);}
  finally{h.close();globalThis.fetch=previous;globalThis.document=previousDocument;}
});

test('reporting uses chronological order and one story treatment with or without a photo',()=>{
  const h=new Harness();const reversed={...snapshot,articles:[...snapshot.articles].reverse()};
  try{
    h.render(interactive.LicensedNewsFeed,{initialEdition:reversed});
    const stories=elements(h.tree).filter(n=>n.type===interactive.LicensedStory);
    const dates=stories.map(n=>Date.parse(n.props.article.publishedAt));
    assert.deepEqual(dates,[...dates].sort((a,b)=>b-a));
    assert.equal(stories.filter(n=>n.props.lead).length,1);
    assert.deepEqual(reversed.articles,[...snapshot.articles].reverse());
    for(const lead of [true,false]){
      h.render(interactive.LicensedStory,{article:snapshot.articles[0],lead});
      assert.equal(h.tree.props.className,'news-story');
    }
  }finally{h.close();}
});

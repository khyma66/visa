import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const moduleUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const fileModule = (name) => pathToFileURL(require.resolve(name)).href;
const dependencies = { react: fileModule('react'), 'react/jsx-runtime': fileModule('react/jsx-runtime') };
dependencies['next/link'] = moduleUrl(`import {jsx} from ${JSON.stringify(dependencies['react/jsx-runtime'])}; export default function Link(props){return jsx('a',props)}`);
async function compile(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  return moduleUrl(ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
    .replace(/(from\s+)(['"])([^'"]+)\2/g, (match, prefix, _quote, name) => {
      assert(dependencies[name], `Unexpected dependency ${name}`);
      return prefix + JSON.stringify(dependencies[name]);
    }));
}
dependencies['@/lib/news'] = await compile('../src/lib/news.ts');
const news = await import(dependencies['@/lib/news']);
const { NewsFeed, NewsResults, NewsUnavailable } = await import(await compile('../src/components/NewsFeed.tsx'));
const uscis = 'u-s-citizenship-and-immigration-services';
const source = (overrides = {}) => ({
  document_number:'2026-12345', title:'Visa program public notice', publication_date:'2026-10-01',
  html_url:'https://www.federalregister.gov/documents/2026/10/01/2026-12345/visa-program',
  type:'Notice', agencies:[{slug:uscis}], ...overrides,
});
const state = source({document_number:'2026-12346', title:'Citizenship regulation', publication_date:'2026-10-02',
  html_url:'https://www.federalregister.gov/documents/2026/10/02/2026-12346/citizenship', type:'Rule',agencies:[{slug:'state-department'}]});
const json = (payload) => Response.json(payload);
const makeFeed = (articles = news.normalizeNews({results:[source(),state]},'all')) => ({status:'ok',articles,agency:'all',retrievedAt:'2026-10-06T05:00:00.000Z',limit:24});

test('agency filters build only a fixed HTTPS API endpoint and bounded field list', () => {
  for (const agency of ['all','uscis','state']) {
    const url = new URL(news.buildNewsUrl(agency,Date.parse('2026-10-06T05:00:00Z')));
    assert.equal(url.origin,'https://www.federalregister.gov');
    assert.equal(url.pathname,'/api/v1/documents.json');
    assert.equal(url.searchParams.get('per_page'),'24');
    assert.equal(url.searchParams.get('order'),'newest');
    assert.equal(url.searchParams.get('conditions[publication_date][gte]'),'2025-10-06');
    assert.equal(url.searchParams.get('conditions[publication_date][lte]'),'2026-10-06');
    assert.equal(url.searchParams.getAll('conditions[agencies][]').length,agency==='all'?2:1);
  }
  assert.throws(()=>news.buildNewsUrl('https://localhost'));
});

test('source normalizer sorts, deduplicates, filters agencies and keeps exact titles', () => {
  const payload={results:[source(),state,source()]};
  const rows=news.normalizeNews(payload,'all');
  assert.deepEqual(rows.map((row)=>row.id),['2026-12346','2026-12345']);
  assert.equal(rows[1].title,'Visa program public notice');
  assert.equal(news.normalizeNews(payload,'uscis').length,1);
  assert.equal(news.normalizeNews(payload,'state')[0].agencyName,'Department of State');
  const joint={results:[source({agencies:[{slug:uscis},{slug:'state-department'}]})]};
  assert.equal(news.normalizeNews(joint,'state')[0].agency,'state');
});

test('unsafe destinations, mismatched dates, unknown agencies and malformed records cannot render', () => {
  const invalid=[
    source({html_url:'javascript:alert(1)'}),
    source({html_url:'https://www.federalregister.gov.evil.example/documents/2026/10/01/2026-12345/visa'}),
    source({html_url:'https://user:pass@www.federalregister.gov/documents/2026/10/01/2026-12345/visa'}),
    source({html_url:'https://www.federalregister.gov:1234/documents/2026/10/01/2026-12345/visa'}),
    source({publication_date:'2026-02-30'}),source({agencies:[{slug:'untrusted'}]}),
    source({html_url:'https://www.federalregister.gov/documents/2026/09/01/2026-12345/visa'}),
    source({document_number:'../../12345'}),source({title:''}),null,[],
  ];
  assert.throws(()=>news.normalizeNews({results:invalid},'all'),/No valid/);
  assert.deepEqual(news.normalizeNews({results:[...invalid,state]},'all').map((row)=>row.id),['2026-12346']);
  assert.throws(()=>news.normalizeNews({data:[]},'all'),/Invalid/);
  assert.deepEqual(news.normalizeNews({results:[]},'all'),[]);
});

test('source result count is capped even when the upstream ignores per_page',()=>{
  assert(news.normalizeNews({results:Array.from({length:200},()=>source())},'all').length<=24);
});

test('successful concurrent reads coalesce and cache expires without changing publication dates',async()=>{
  let calls=0,clock=Date.parse('2026-10-06T05:00:00Z');
  const service=news.createNewsService(async(url,options)=>{
    calls++;assert.equal(options.redirect,'error');assert.equal(options.headers.Accept,'application/json');
    assert(options.signal instanceof AbortSignal);return json({results:[source()]});
  },()=>clock);
  const [first,second]=await Promise.all([service('all'),service('all')]);
  assert.equal(calls,1);assert.deepEqual(first,second);assert.equal(first.articles[0].publishedAt,'2026-10-01');
  await service('all');assert.equal(calls,1);
  clock+=news.NEWS_CACHE_MS+1;await service('all');assert.equal(calls,2);
  await service('uscis');assert.equal(calls,3);
});

for (const [label,response] of [
  ['HTTP failure',()=>new Response('error',{status:503})],
  ['HTML error page',()=>new Response('<html>Unavailable</html>',{headers:{'Content-Type':'text/html'}})],
  ['malformed JSON',()=>new Response('{broken',{headers:{'Content-Type':'application/json'}})],
  ['malformed records',()=>json({results:[{title:'Missing official identity'}]})],
  ['oversized declared body',()=>new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':String(news.NEWS_MAX_BYTES+1)}})],
  ['oversized streamed body',()=>new Response(' '.repeat(news.NEWS_MAX_BYTES+1),{headers:{'Content-Type':'application/json'}})],
]) test(`${label} fails explicitly, is not cached and allows recovery`,async()=>{
  let fail=true,calls=0;
  const service=news.createNewsService(async()=>{calls++;return fail?response():json({results:[source()]});});
  await assert.rejects(service('all'));
  fail=false;assert.equal((await service('all')).articles.length,1);assert.equal(calls,2);
});

test('deadline aborts upstream fetch',async()=>{
  const service=news.createNewsService(async(_url,{signal})=>new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(new DOMException('Timed out','AbortError')),{once:true});
  }),Date.now,10);
  await assert.rejects(service('all'),{name:'AbortError'});
});

test('client feed validation rejects hostile or mismatched response shapes',()=>{
  assert(news.isNewsFeedData(makeFeed()));
  assert(!news.isNewsFeedData({...makeFeed(),articles:[{...makeFeed().articles[0],sourceUrl:'https://evil.example/'}]}));
  assert(!news.isNewsFeedData({...makeFeed(),retrievedAt:'not a date'}));
  assert(!news.isNewsFeedData({status:'unavailable'}));
});

test('rendered feed keeps dates, sources and escaped titles, and applies combined filters',()=>{
  const feed=makeFeed();
  const html=renderToStaticMarkup(createElement(NewsResults,{feed}));
  assert.match(html,/2026-10-01/);assert.match(html,/Oct 2, 2026/);assert.match(html,/Federal Register/);
  assert.match(html,/rel="noopener noreferrer"/);assert.match(html,/Retrieved/);
  const filtered=renderToStaticMarkup(createElement(NewsResults,{feed,type:'Notice',query:' visa '}));
  assert.match(filtered,/Visa program public notice/);assert.doesNotMatch(filtered,/Citizenship regulation/);
  const escaped=renderToStaticMarkup(createElement(NewsResults,{feed:makeFeed([{...feed.articles[0],title:'<script>alert(1)</script>'}])}));
  assert.match(escaped,/&lt;script&gt;/);assert.doesNotMatch(escaped,/<script>/);
});

test('loading, no results, filter mismatch and official fallbacks are accessible',()=>{
  const loading=renderToStaticMarkup(createElement(NewsFeed));
  assert.match(loading,/role="status"/);assert.match(loading,/Loading agency updates/);
  for(const source of news.NEWS_SOURCES) assert(loading.includes(source.url));
  const empty=renderToStaticMarkup(createElement(NewsResults,{feed:makeFeed([])}));
  assert.match(empty,/No updates were returned/);
  const mismatch=renderToStaticMarkup(createElement(NewsResults,{feed:makeFeed(),query:'unmatched-query'}));
  assert.match(mismatch,/No updates match/);
  const unavailable=renderToStaticMarkup(createElement(NewsUnavailable,{error:'Agency updates are temporarily unavailable.',retry:()=>{}}));
  assert.match(unavailable,/role="alert"/);assert.match(unavailable,/<button type="button"/);assert.match(unavailable,/Try again/);
});

test('actual route rejects invalid agency, caches success and returns explicit unavailable without internal details',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>json({results:[source()]});
  try {
    const {GET}=await import(await compile('../src/app/api/news/route.ts'));
    const bad=await GET(new Request('https://app.example/api/news?agency=https://localhost'));
    assert.equal(bad.status,400);assert.equal(bad.headers.get('cache-control'),'no-store');
    const good=await GET(new Request('https://app.example/api/news?agency=all'));
    assert.equal(good.status,200);assert.equal(good.headers.get('cache-control'),'public, max-age=60, s-maxage=300');
    assert.equal((await good.json()).articles[0].id,'2026-12345');
  } finally {globalThis.fetch=originalFetch;}
  // A separately compiled route owns a fresh service and mocked upstream.
  globalThis.fetch=async()=>{throw new Error('internal-provider-failure-sentinel');};
  try {
    const routeSource=await readFile(new URL('../src/app/api/news/route.ts',import.meta.url),'utf8');
    const code=ts.transpileModule(routeSource+'\n// failure fixture',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
      .replace("'@/lib/news'",JSON.stringify(dependencies['@/lib/news']));
    const {GET}=await import(moduleUrl(code));
    const failed=await GET(new Request('https://app.example/api/news'));
    assert.equal(failed.status,503);assert.equal(failed.headers.get('cache-control'),'no-store');
    const body=await failed.text();assert.match(body,/unavailable/);assert.doesNotMatch(body,/sentinel/);
  } finally {globalThis.fetch=originalFetch;}
});

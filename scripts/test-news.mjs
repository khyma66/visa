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
const dependencies = { react: fileModule('react'), 'react/jsx-runtime': fileModule('react/jsx-runtime'), saxes:fileModule('saxes') };
dependencies['next/link'] = moduleUrl(`import {jsx} from ${JSON.stringify(dependencies['react/jsx-runtime'])}; export default function Link(props){return jsx('a',props)}`);
async function compile(path, suffix='') {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  return moduleUrl(ts.transpileModule(source+`\n// ${suffix}`, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
    .replace(/(from\s+)(['"])([^'"]+)\2/g, (match, prefix, _quote, name) => {
      assert(dependencies[name], `Unexpected dependency ${name}`);
      return prefix + JSON.stringify(dependencies[name]);
    }));
}
dependencies['@/lib/news-shared']=dependencies['./news-shared']=await compile('../src/lib/news-shared.ts');
dependencies['@/lib/news']=await compile('../src/lib/news.ts');
const news={...await import(dependencies['@/lib/news-shared']),...await import(dependencies['@/lib/news'])};
const { NewsFeed, NewsResults, NewsUnavailable, NewsExternal } = await import(await compile('../src/components/NewsFeed.tsx'));
const now=Date.parse('2026-10-06T05:00:00Z');
const escape=(value)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const item=(overrides={})=>{
  const data={title:'Visa program update - Example Press',link:'https://news.google.com/rss/articles/CBMiVisaFixture12345?oc=5',pubDate:new Date(now-3_600_000).toUTCString(),source:'Example Press',...overrides};
  return `<item>${Object.entries(data).map(([key,value])=>`<${key}>${escape(value)}</${key}>`).join('')}</item>`;
};
const rss=(items)=>`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Google News</title>${items}</channel></rss>`;
const xmlResponse=(body)=>new Response(body,{headers:{'Content-Type':'application/xml; charset=utf-8'}});
const parse=(body)=>news.parseGoogleNewsRss(body,now);
const makeFeed=async(articles)=>({status:'ok',source:'Google News',articles:articles??await parse(rss(item())),retrievedAt:new Date(now).toISOString(),limit:24});

test('the fixed Google search covers immigration, avoids payment-company terms and has no user URL',()=>{
  const url=new URL(news.GOOGLE_NEWS_RSS_URL);
  assert.equal(url.origin,'https://news.google.com');assert.equal(url.pathname,'/rss/search');
  assert.match(url.searchParams.get('q'),/visa OR immigration/);assert.match(url.searchParams.get('q'),/-"Visa Inc"/);
  assert.match(url.searchParams.get('q'),/when:7d/);assert.equal(url.searchParams.get('hl'),'en-US');
  assert.equal(new URL(news.GOOGLE_NEWS_SEARCH_URL).pathname,'/search');
});

test('RSS parser decodes entities/CDATA, attributes publishers, strips duplicate suffix and ignores descriptions',async()=>{
  const xml=rss(item({title:'Visa & immigration update - Example Press',description:'COPYRIGHTED_BODY_SENTINEL'}));
  const articles=await parse(xml);
  assert.equal(articles[0].title,'Visa & immigration update');assert.equal(articles[0].publisher,'Example Press');
  assert.equal(articles[0].sourceUrl,'https://news.google.com/rss/articles/CBMiVisaFixture12345');
  assert(!JSON.stringify(articles).includes('COPYRIGHTED_BODY_SENTINEL'));
  const cdata=xml.replace('<title>Visa &amp; immigration update - Example Press</title>','<title><![CDATA[Visa & immigration update - Example Press]]></title>');
  assert.deepEqual(await parse(cdata),articles);
});

test('headlines sort newest first, deduplicate IDs, cap results and exclude future/old/payment stories',async()=>{
  const items=Array.from({length:35},(_,index)=>item({title:`Visa story ${index}`,link:`https://news.google.com/rss/articles/CBMiVisaFixture${String(index).padStart(8,'0')}`,pubDate:new Date(now-index*60_000).toUTCString()}));
  items.unshift(item({title:'Visa Inc shares rise'}));
  items.push(item({title:'Old immigration report',pubDate:new Date(now-10*86_400_000).toUTCString()}));
  items.push(item({title:'Future visa report',pubDate:new Date(now+86_400_000).toUTCString()}));
  items.push(items[0],items[2]);
  const rows=await parse(rss(items.join('')));
  assert.equal(rows.length,24);assert.equal(rows[0].title,'Visa story 0');assert.equal(new Set(rows.map((row)=>row.id)).size,24);
  assert(!rows.some((row)=>/Old|Future|shares/.test(row.title)));
});

for(const [label,body] of [
  ['malformed XML',rss(item()).replace('</item>','</wrong>')],
  ['non-RSS HTML','<html><body>Denied</body></html>'],
  ['DTD and external entity','<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'+rss(item()).replace('Visa program','&xxe;')],
  ['entity expansion','<!DOCTYPE rss [<!ENTITY a "boom"><!ENTITY b "&a;&a;">]>'+rss(item())],
  ['unknown entity',rss(item()).replace('Visa program','&unknown;')],
  ['duplicate channel','<rss><channel></channel><channel></channel></rss>'],
  ['deep XML',rss('<a>'.repeat(20)+'</a>'.repeat(20))],
  ['oversized input',' '.repeat(news.NEWS_MAX_BYTES+1)],
  ['too many items',rss(item().repeat(151))],
]) test(`${label} is rejected without entity/network resolution`,async()=>{await assert.rejects(parse(body));});

test('invalid URLs, duplicate/nested fields, missing publisher and invalid dates cannot render',async()=>{
  const invalid=[
    item({link:'javascript:alert(1)'}),item({link:'https://news.google.com.evil.example/rss/articles/CBMiVisaFixture12345'}),
    item({link:'https://user:pass@news.google.com/rss/articles/CBMiVisaFixture12345'}),item({link:'https://news.google.com:8080/rss/articles/CBMiVisaFixture12345'}),
    item({link:'https://news.google.com/search?q=evil'}),item({source:''}),item({pubDate:'Mon, 30 Feb 2026 04:00:00 GMT'}),
    item({pubDate:'Wed, 06 Oct 2026 04:00:00 GMT'}),item({pubDate:'Tue, 06 Oct 2026 24:00:00 GMT'}),
    item().replace('</title>','</title><title>duplicate</title>'),item().replace('Visa program','<b>Visa</b> program'),
  ];
  await assert.rejects(parse(rss(invalid.join(''))),/No valid/);
  assert.equal((await parse(rss(invalid.join('')+item()))).length,1);
  assert.deepEqual(await parse(rss('')),[]);
});

test('successful concurrent reads coalesce, cache expires and only the fixed query is fetched',async()=>{
  let calls=0,clock=now;
  const service=news.createNewsService(async(url,options)=>{
    calls++;assert.equal(url,news.GOOGLE_NEWS_RSS_URL);assert.equal(options.redirect,'error');
    assert(options.signal instanceof AbortSignal);return xmlResponse(rss(item()));
  },()=>clock);
  const [a,b]=await Promise.all([service(),service()]);assert.equal(calls,1);assert.deepEqual(a,b);
  await service();assert.equal(calls,1);clock+=news.NEWS_CACHE_MS+1;await service();assert.equal(calls,2);
});

for(const [label,response] of [
  ['HTTP failure',()=>new Response('error',{status:503})],
  ['HTML error page',()=>new Response('<html>Unavailable</html>',{headers:{'Content-Type':'text/html'}})],
  ['malformed RSS',()=>xmlResponse('<rss>')],
  ['oversized declared body',()=>new Response('<rss/>',{headers:{'Content-Type':'application/xml','Content-Length':String(news.NEWS_MAX_BYTES+1)}})],
  ['oversized streamed body',()=>xmlResponse(' '.repeat(news.NEWS_MAX_BYTES+1))],
]) test(`${label} fails explicitly, backs off repeated reads and permits recovery`,async()=>{
  let fail=true,calls=0,clock=now;
  const service=news.createNewsService(async()=>{calls++;return fail?response():xmlResponse(rss(item()));},()=>clock);
  await assert.rejects(service());fail=false;
  await assert.rejects(service(),/temporarily unavailable/);assert.equal(calls,1);
  clock+=news.NEWS_FAILURE_BACKOFF_MS;
  assert.equal((await service()).articles.length,1);assert.equal(calls,2);
  await service();assert.equal(calls,2);
});

test('timeout aborts both initial fetch and response body reads',async()=>{
  const waitingFetch=news.createNewsService(async(_url,{signal})=>new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(new DOMException('Timed out','AbortError')),{once:true});
  }),()=>now,10);
  await assert.rejects(waitingFetch(),{name:'AbortError'});
  const waitingBody=news.createNewsService(async(_url,{signal})=>new Response(new ReadableStream({start(controller){
    signal.addEventListener('abort',()=>controller.error(new DOMException('Timed out','AbortError')),{once:true});
  }}),{headers:{'Content-Type':'application/xml'}}),()=>now,10);
  await assert.rejects(waitingBody(),{name:'AbortError'});
});

test('client validation rejects hostile links, mismatched IDs and invalid timestamps without throwing',async()=>{
  const feed=await makeFeed();assert(news.isNewsFeedData(feed));
  for(const replacement of [{sourceUrl:null},{sourceUrl:'https://evil.example/'},{id:'other-fixture-id'},{publishedAt:'2026-02-30T04:00:00.000Z'},{publisher:''}]) {
    assert.equal(news.isNewsFeedData({...feed,articles:[{...feed.articles[0],...replacement}]}),false);
  }
  assert(!news.isNewsFeedData({status:'unavailable'}));
});

test('rendered headlines show publisher/date/Google links, escape markup and contain no agency controls',async()=>{
  const feed=await makeFeed();const html=renderToStaticMarkup(createElement(NewsResults,{feed}));
  assert.match(html,/Example Press/);assert.match(html,/2026-10-06T04:00:00.000Z/);assert.match(html,/Via Google News/);
  assert.match(html,/rel="noopener noreferrer"/);assert.doesNotMatch(html,/Federal Register|Document type|USCIS \+ State/);
  const escaped=renderToStaticMarkup(createElement(NewsResults,{feed:await makeFeed([{...feed.articles[0],title:'<script>alert(1)</script>'}])}));
  assert.match(escaped,/&lt;script&gt;/);assert.doesNotMatch(escaped,/<script>/);
});

test('loading, empty, unavailable and always-available external Google search are accessible',async()=>{
  const loading=renderToStaticMarkup(createElement(NewsFeed));assert.match(loading,/role="status"/);assert.match(loading,/Loading latest headlines/);
  assert(loading.includes(escape(news.GOOGLE_NEWS_SEARCH_URL).replaceAll('"','&quot;')));
  assert.doesNotMatch(loading,/<select/);
  const empty=renderToStaticMarkup(createElement(NewsResults,{feed:await makeFeed([])}));assert.match(empty,/No recent visa headlines/);
  const error=renderToStaticMarkup(createElement(NewsUnavailable,{retry:()=>{}}));assert.match(error,/role="alert"/);assert.match(error,/Try again/);
  const external=renderToStaticMarkup(createElement(NewsExternal));assert.match(external,/directly on Google News/);assert.doesNotMatch(external,/Try again|role="alert"/);
});

test('actual route is disabled by default before fetch/cache, shares canonical edge cache and fails safely',async()=>{
  const originalFetch=globalThis.fetch,originalCaches=globalThis.caches,originalFlag=process.env.GOOGLE_NEWS_RSS_ENABLED;
  let calls=0,reads=0,puts=0,cached;
  globalThis.fetch=async(url)=>{calls++;assert.equal(url,news.GOOGLE_NEWS_RSS_URL);return xmlResponse(rss(item({pubDate:new Date(Date.now()-60_000).toUTCString()})));};
  globalThis.caches={default:{async match(key){reads++;assert.equal(new URL(key.url).search,'?feed=google-visa-v1');return cached?.clone();},async put(_key,response){puts++;cached=response;}}};
  try {
    const {GET}=await import(await compile('../src/app/api/news/route.ts','success-route'));
    delete process.env.GOOGLE_NEWS_RSS_ENABLED;
    const external=await GET(new Request('https://app.example/api/news'));assert.equal(external.status,200);assert.deepEqual(await external.json(),{status:'external'});assert.equal(calls,0);assert.equal(reads,0);
    process.env.GOOGLE_NEWS_RSS_ENABLED='true';
    const good=await GET(new Request('https://app.example/api/news?url=https://localhost'));assert.equal(good.status,200);
    assert.match(good.headers.get('cache-control'),/s-maxage=/);assert.equal((await good.json()).source,'Google News');
    assert.equal(calls,1);assert.equal(puts,1);
    const warm=await GET(new Request('https://app.example/api/news?anything=123'));assert.equal(warm.status,200);assert.equal(calls,1);assert.equal(puts,1);
    delete process.env.GOOGLE_NEWS_RSS_ENABLED;
    assert.deepEqual(await (await GET(new Request('https://app.example/api/news'))).json(),{status:'external'});assert.equal(reads,2);
    process.env.GOOGLE_NEWS_RSS_ENABLED='true';
    globalThis.fetch=async()=>{throw new Error('internal-provider-failure-sentinel');};
    globalThis.caches=undefined;
    const failing=await import(await compile('../src/app/api/news/route.ts','failure-route'));
    const failed=await failing.GET(new Request('https://app.example/api/news'));assert.equal(failed.status,503);
    assert.equal(failed.headers.get('cache-control'),'no-store');assert.doesNotMatch(await failed.text(),/sentinel/);
  } finally {
    globalThis.fetch=originalFetch;globalThis.caches=originalCaches;
    if(originalFlag===undefined)delete process.env.GOOGLE_NEWS_RSS_ENABLED;else process.env.GOOGLE_NEWS_RSS_ENABLED=originalFlag;
  }
});

test('shared edge failure markers back off fresh isolates, expire, and never leak to clients',async()=>{
  const originalFetch=globalThis.fetch,originalCaches=globalThis.caches,originalFlag=process.env.GOOGLE_NEWS_RSS_ENABLED,originalNow=Date.now;
  let clock=now,calls=0,reads=0,fail=true,cached;
  Date.now=()=>clock;
  globalThis.fetch=async()=>{
    calls++;
    if(fail)throw new Error('provider-secret-sentinel');
    return xmlResponse(rss(item({pubDate:new Date(clock-60_000).toUTCString()})));
  };
  globalThis.caches={default:{
    async match(){reads++;return cached?.clone();},
    async put(_key,response){cached=response;},
  }};
  process.env.GOOGLE_NEWS_RSS_ENABLED='true';
  try {
    const first=await import(await compile('../src/app/api/news/route.ts','backoff-first-isolate'));
    const next=await import(await compile('../src/app/api/news/route.ts','backoff-next-isolate'));
    const request=()=>new Request('https://app.example/api/news');
    const failed=await first.GET(request());
    assert.equal(failed.status,503);assert.equal(failed.headers.get('cache-control'),'no-store');assert.equal(calls,1);
    assert.equal(cached.headers.get('cache-control'),'public, max-age=60');
    assert.deepEqual(await cached.clone().json(),{status:'backoff',retryAt:clock+news.NEWS_FAILURE_BACKOFF_MS});
    clock+=15_000;
    const backedOff=await next.GET(request());assert.equal(backedOff.status,503);assert.equal(calls,1);
    assert.equal(backedOff.headers.get('retry-after'),'45');assert.equal(backedOff.headers.get('x-content-type-options'),'nosniff');
    assert.doesNotMatch(await backedOff.text(),/provider-secret-sentinel|retryAt|backoff/);
    process.env.GOOGLE_NEWS_RSS_ENABLED='false';
    const oldReads=reads;assert.deepEqual(await(await next.GET(request())).json(),{status:'external'});assert.equal(reads,oldReads);
    process.env.GOOGLE_NEWS_RSS_ENABLED='true';
    clock+=news.NEWS_FAILURE_BACKOFF_MS;fail=false;
    const recovered=await next.GET(request());assert.equal(recovered.status,200);assert.equal(calls,2);
    assert.equal((await recovered.json()).status,'ok');
  } finally {
    globalThis.fetch=originalFetch;globalThis.caches=originalCaches;Date.now=originalNow;
    if(originalFlag===undefined)delete process.env.GOOGLE_NEWS_RSS_ENABLED;else process.env.GOOGLE_NEWS_RSS_ENABLED=originalFlag;
  }
});

test('malformed or overlong edge failure windows cannot suppress fresh news',async()=>{
  const originalFetch=globalThis.fetch,originalCaches=globalThis.caches,originalFlag=process.env.GOOGLE_NEWS_RSS_ENABLED;
  let calls=0;
  globalThis.fetch=async()=>{calls++;return xmlResponse(rss(item({pubDate:new Date(Date.now()-60_000).toUTCString()})));};
  process.env.GOOGLE_NEWS_RSS_ENABLED='true';
  try {
    const markers=[null,[],{status:'backoff',retryAt:'tomorrow'},{status:'backoff',retryAt:Date.now()+86_400_000},{status:'backoff',retryAt:Date.now()-1}];
    for(const [index,marker]of markers.entries()) {
      globalThis.caches={default:{async match(){return Response.json(marker);},async put(){}}};
      const route=await import(await compile('../src/app/api/news/route.ts',`bad-backoff-${index}`));
      assert.equal((await route.GET(new Request('https://app.example/api/news'))).status,200);
    }
    assert.equal(calls,markers.length);
  } finally {
    globalThis.fetch=originalFetch;globalThis.caches=originalCaches;
    if(originalFlag===undefined)delete process.env.GOOGLE_NEWS_RSS_ENABLED;else process.env.GOOGLE_NEWS_RSS_ENABLED=originalFlag;
  }
});

test('client dependency graph is independent of XML parser and upstream fetch service',async()=>{
  const component=await readFile(new URL('../src/components/NewsFeed.tsx',import.meta.url),'utf8');
  const shared=await readFile(new URL('../src/lib/news-shared.ts',import.meta.url),'utf8');
  assert.doesNotMatch(component,/from ['"]@\/lib\/news['"]/);assert.doesNotMatch(shared,/saxes|createNewsService|fetch\(/);
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const moduleUrl=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const compile=async path=>ts.transpileModule(await readFile(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const {handlePostViews,viewFingerprint}=await import(moduleUrl(await compile('../src/lib/post-views-server.ts')));
const post='33333333-3333-4333-8333-333333333333',secret='ab'.repeat(32),pass={limit:async()=>({success:true})};
const env={SECURITY_INGEST_KEY:secret,SECURITY_READ_LIMIT:pass};
const req=(method='GET',headers={},id=post)=>new Request('https://visathreads.com/api/post-views?id='+id,{method,headers:{'cf-connecting-ip':'192.0.2.1','user-agent':'Browser','origin':'https://visathreads.com',...headers}});
test('edge validates origin, privacy signals, bots, rate limits, deployment and imported existence',async t=>{
 const oldUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,oldKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://cycnichledvqbxevrwnt.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='public-test';
 let calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url,init});return Response.json([{post_id:post,views:1}]);});
 try{
  assert.equal((await handlePostViews(req('POST'),env,()=>true)).status,200);
  const body=JSON.parse(calls[0].init.body);assert.match(body.fingerprint,/^[a-f0-9]{64}$/);assert(!calls[0].init.body.includes('192.0.2.1'));assert(!calls[0].init.body.includes('Browser'));assert.equal(calls[0].init.headers['x-security-ingest-key'],secret);
  for(const headers of [{'origin':'https://elsewhere.test'},{'sec-fetch-site':'cross-site'}])assert.equal((await handlePostViews(req('POST',headers),env,()=>true)).status,403);
  for(const headers of [{'dnt':'1'},{'sec-gpc':'1'},{'user-agent':'Googlebot'}])assert.equal((await handlePostViews(req('POST',headers),env,()=>true)).status,202);
  assert.deepEqual(await (await handlePostViews(req('GET',{},'apify-missing'),env,()=>false)).json(),[]);
  assert.equal((await handlePostViews(req(),{...env,SECURITY_READ_LIMIT:{limit:async()=>({success:false})}},()=>true)).status,429);
  assert.equal((await handlePostViews(req(),{},()=>true)).status,503);
  assert.equal(calls.length,1);
  assert.equal((await handlePostViews(req(),env,()=>true)).status,200);assert.equal(JSON.parse(calls[1].init.body).fingerprint,undefined);
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://ppdwysmeistjxzjpmxyk.supabase.co';assert.equal((await handlePostViews(req(),env,()=>true)).status,503);
 }finally{if(oldUrl===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=oldKey;}
});
test('signatures rotate across days and posts and require the secret',async()=>{
 const a=await viewFingerprint(secret,post,'ip','ua','2026-11-05');
 assert.notEqual(a,await viewFingerprint(secret,post,'ip','ua','2026-11-06'));
 assert.notEqual(a,await viewFingerprint(secret,'other','ip','ua','2026-11-05'));
 assert.notEqual(a,await viewFingerprint('cd'.repeat(32),post,'ip','ua','2026-11-05'));
});
test('browser batches reads, updates all copies and never lets a stale read decrease a count',async t=>{
 const api=await import(moduleUrl(await compile('../src/lib/post-views.ts'))+'#cache');
 let resolveRead,calls=0;const pending=new Promise(r=>resolveRead=r);
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls++;return init.method==='POST'?Response.json([{post_id:post,views:2}]):pending;});
 const stop=api.watchPostViews(post,()=>{}),stop2=api.watchPostViews('apify-test',()=>{});
 await new Promise(r=>setImmediate(r));assert.equal(calls,1);
 await api.recordPostView(post);assert.equal(api.postViewCount(post),2);
 resolveRead(Response.json([{post_id:post,views:1}]));await new Promise(r=>setImmediate(r));assert.equal(api.postViewCount(post),2);
 assert.equal(api.postViewCount('apify-test'),null);stop();stop2();
});
test('only a visible detail held open for two seconds records; leaving or hiding cancels',async t=>{
 const api=await import(moduleUrl(await compile('../src/lib/post-views.ts'))+'#timer');
 t.mock.timers.enable({apis:['setTimeout']});let recorded=0;
 t.mock.method(globalThis,'fetch',async()=>{recorded++;return Response.json([{post_id:post,views:1}]);});
 const doc=new EventTarget();doc.visibilityState='hidden';const stop=api.observePostView(post,doc);
 t.mock.timers.tick(3000);assert.equal(recorded,0);doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));t.mock.timers.tick(1000);
 doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));t.mock.timers.tick(2000);assert.equal(recorded,0);
 doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));t.mock.timers.tick(2000);assert.equal(recorded,1);t.mock.timers.tick(5000);assert.equal(recorded,1);stop();
 const stop2=api.observePostView('apify-other',doc);stop2();t.mock.timers.tick(2000);assert.equal(recorded,1);
});
test('view label stays compact, accessible, singular-aware and hidden when unavailable',async()=>{
 const {createElement}=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
 const dependencies={
 'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),
 react:moduleUrl('export const useEffect=()=>{},useCallback=f=>f,useSyncExternalStore=(_,get)=>get();'),
 'lucide-react':moduleUrl('export const Eye=()=>null;'),
 '@/lib/post-views':moduleUrl('export const postViewCount=()=>globalThis.__testViews,observePostView=()=>()=>{},watchPostViews=()=>()=>{};'),
 './AuthProvider':moduleUrl('export const useAuth=()=>({demoMode:false});'),
 };
 const code=(await compile('../src/components/PostViews.tsx')).replace(/(from\s+)(['"])([^'"]+)\2/g,(_,prefix,q,name)=>prefix+JSON.stringify(dependencies[name]));
 const {PostViews}=await import(moduleUrl(code));
 try{
 globalThis.__testViews=1200;let html=renderToStaticMarkup(createElement(PostViews,{postId:post}));assert.match(html,/1.2K views/);assert.match(html,/1,200 views on VisaThreads/);
 globalThis.__testViews=1;html=renderToStaticMarkup(createElement(PostViews,{postId:post}));assert.match(html,/1 view on VisaThreads/);assert.doesNotMatch(html,/1 views/);
 globalThis.__testViews=null;assert.equal(renderToStaticMarkup(createElement(PostViews,{postId:post})), '');
 }finally{delete globalThis.__testViews;}
});

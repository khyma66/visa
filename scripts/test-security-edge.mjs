import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/lib/security-edge.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {trafficGroup,trafficDecision,trafficFingerprint,recordTrafficSignal}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const request=(path,headers={},method='GET')=>new Request('https://visathreads.com'+path,{method,headers:{'cf-connecting-ip':'192.0.2.2',...headers}});
const pass={limit:async()=>({success:true})},deny={limit:async()=>({success:false})};
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
test('auth, admin, messages, health, well-known metadata and assets are excluded from public read limits',()=>{
  for(const path of ['/login','/signup','/auth/callback','/messages','/admin/security','/api/health','/.well-known/security.txt','/assets/logo.svg'])assert.equal(trafficGroup(path),null);
});
test('archive has a separate limit and normal browsing passes',async()=>{
  assert.equal(await trafficDecision(request('/api/community'),{SECURITY_ARCHIVE_LIMIT:pass,SECURITY_READ_LIMIT:deny}),null);
  assert.equal((await trafficDecision(request('/questions/123'),{SECURITY_READ_LIMIT:deny})).kind,'read_rate_limit');
  assert.equal((await trafficDecision(request('/api/community'),{SECURITY_ARCHIVE_LIMIT:deny})).decision,'limited');
});
test('common file and admin probes are blocked without disclosing path or query',async()=>{
  for(const path of ['/.env','/.env.local','/.git/config','/wp-login.php','/phpmyadmin/'])assert.deepEqual(await trafficDecision(request(path+'?password=do-not-log'),{}),{kind:'probe_path',route_group:'probe',decision:'blocked'});
});
test('cross-site browser API reads are blocked but linked page navigation remains available',async()=>{
  assert.equal((await trafficDecision(request('/api/community',{'sec-fetch-site':'cross-site'}),{})).kind,'cross_site_read');
  assert.equal(await trafficDecision(request('/questions/123',{'sec-fetch-site':'cross-site'}),{}),null);
  assert.equal(await trafficDecision(request('/api/community',{'sec-fetch-site':'same-origin'}),{}),null);
});
test('writes retain their own database auth and quota enforcement',async()=>{assert.equal(await trafficDecision(request('/questions/123',{},'POST'),{SECURITY_READ_LIMIT:deny}),null);});
test('fingerprint is keyed, rotates daily and never equals the raw address',async()=>{
  const a=await trafficFingerprint('192.0.2.1','11'.repeat(32),new Date('2026-11-04'));
  assert.match(a,/^[0-9a-f]{64}$/);assert.notEqual(a,await trafficFingerprint('192.0.2.1','11'.repeat(32),new Date('2026-11-05')));assert.notEqual(a,await trafficFingerprint('192.0.2.1','22'.repeat(32),new Date('2026-11-04')));
});
test('telemetry is minimal, secret server-side, no redirects, private requests never forwarded',async t=>{
  const prior={url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY};
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://cycnichledvqbxevrwnt.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='public-test-key';
  let calls=0;
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    calls++;assert.equal(url,process.env.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1/rpc/record_security_event');assert.equal(init.redirect,'error');
    const payload=JSON.parse(init.body).event;assert.deepEqual(Object.keys(payload).sort(),['actor_hash','decision','kind','route_group']);
    assert(!init.body.includes('192.0.2'));assert(!init.body.includes('my-secret'));assert.equal(init.headers['x-security-ingest-key'],'ef'.repeat(32));
    return new Response(null,{status:204});
  });
  const env={SECURITY_INGEST_KEY:'ef'.repeat(32),SECURITY_EVENT_SAMPLE:pass,SECURITY_EVENT_BUDGET:pass};
  const req=request('/api/community?text=my-secret',{'cookie':'my-secret','authorization':'Bearer my-secret','cf-ray':'invalid'});
  const signal={kind:'read_rate_limit',route_group:'archive',decision:'limited'};
  try{
    await recordTrafficSignal(req,signal,env);assert.equal(calls,1);
    await recordTrafficSignal(req,signal,{...env,SECURITY_EVENT_SAMPLE:deny});assert.equal(calls,1);
    await recordTrafficSignal(req,signal,{...env,SECURITY_EVENT_BUDGET:deny});assert.equal(calls,1);
    await recordTrafficSignal(req,signal,{...env,SECURITY_INGEST_KEY:undefined});assert.equal(calls,1);
    process.env.NEXT_PUBLIC_SUPABASE_URL='https://ppdwysmeistjxzjpmxyk.supabase.co';await recordTrafficSignal(req,signal,env);assert.equal(calls,1);
  }finally{
    if(prior.url===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=prior.url;
    if(prior.key===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=prior.key;
  }
});
test('dashboard resets between accounts, escapes evidence and never claims emails are sent',async()=>{
  const ui=await readFile(new URL('../src/components/OwnerSecurityDashboard.tsx',import.meta.url),'utf8');
  assert.match(ui,/<Console key=\{user.id\}/);assert.match(ui,/No email has been sent/);assert.doesNotMatch(ui,/dangerouslySetInnerHTML|service_role|localStorage/);assert.match(ui,/AbortSignal.timeout/);
});
test('real middleware returns safe blocked responses, schedules evidence, and preserves auth/availability',async()=>{
  const env={SECURITY_READ_LIMIT:deny,SECURITY_ARCHIVE_LIMIT:deny};globalThis.__securityBindings=env;
  const runtime=moduleUrl(compile(await readFile(new URL('../src/lib/security-runtime.ts',import.meta.url),'utf8'))
    .replace("'./security-edge'",JSON.stringify(moduleUrl(js)))
    .replace("'cloudflare:workers'",JSON.stringify(moduleUrl('export const env=globalThis.__securityBindings;'))));
  const source=compile(await readFile(new URL('../src/middleware.ts',import.meta.url),'utf8'))
    .replace("'./lib/security-runtime'",JSON.stringify(runtime))
    .replace("'./lib/search-visibility'",JSON.stringify(moduleUrl('export const discoveryOrigin=()=>"";export const discoveryPath=()=>false;')))
    .replace("'next/server'",JSON.stringify(moduleUrl('export class NextResponse extends Response { static next(){return new NextResponse(null)} static redirect(url,status){return new NextResponse(null,{status,headers:{location:url.toString()}})} }')));
  const {middleware}=await import(moduleUrl(source));
  const old=process.env.APP_ENV;process.env.APP_ENV='development';
  try {
    for(const [path,expected] of [['/api/community',429],['/.env',404],['/login',200],['/admin/security',200]]){
      const req=request(path);req.nextUrl=new URL(req.url);const tasks=[];
      const response=await middleware(req,{waitUntil:task=>tasks.push(task)});await Promise.all(tasks);
      assert.equal(response.status,expected);assert.equal(response.headers.get('x-frame-options'),'DENY');assert.match(response.headers.get('content-security-policy'),/nonce-/);
      assert.match(response.headers.get('cache-control')??'',/no-store/);
      if(expected===429)assert.equal(response.headers.get('retry-after'),'60');
      if(expected===200)assert.equal(tasks.length,0);else assert.equal(tasks.length,1);
    }
    env.SECURITY_READ_LIMIT={limit:async()=>{throw new Error('unavailable');}};
    const req=request('/questions/123');req.nextUrl=new URL(req.url);
    assert.equal((await middleware(req,{waitUntil:()=>{}})).status,200,'Limiter outage fails open for public reads, not database permissions');
  } finally {delete globalThis.__securityBindings;if(old===undefined)delete process.env.APP_ENV;else process.env.APP_ENV=old;}
});
test('owner console renders evidence as inert text, and signed-out view contains none',async()=>{
  const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
  const data={generated_at:'2026-11-04T00:00:00Z',traffic:[],reports:[{id:'case',version:1,review_status:'open',subject_username:'reported-member',reason:'spam',details:'<script>alert(1)</script>',target_kind:'imported_answer',target_id:'target',source:'member',reported_at:'2026-11-04T00:00:00Z',captured_at:'2026-11-04T00:00:00Z',content_excerpt:'<img src=x onerror=alert(1)>',qualifying_reporter:true,report_status:'pending'}],repeat_members:[],review_history:[],pending_alerts:0,ingest_key_configured:false,last_traffic_observed:null};
  globalThis.__securityUi={user:{id:'owner'},tab:'reports',data};
  const deps={
    'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),
    react:moduleUrl('export const useEffect=()=>{};export const useState=initial=>[initial===null?globalThis.__securityUi.data:initial==="traffic"?globalThis.__securityUi.tab:initial,()=>{}];'),
    'next/link':moduleUrl(`import React from ${JSON.stringify(import.meta.resolve('react'))};export default function Link(p){return React.createElement('a',p)}`),
    'lucide-react':moduleUrl('export const ShieldCheck=()=>null,Radar=()=>null,Flag=()=>null,History=()=>null;'),
    './AuthProvider':moduleUrl('export const useAuth=()=>({user:globalThis.__securityUi.user,loading:false,demoMode:false});'),
    '@/lib/supabase/client':moduleUrl('export const getSupabase=()=>{throw Error("No RPC during render")};'),
  };
  let source=compile(await readFile(new URL('../src/components/OwnerSecurityDashboard.tsx',import.meta.url),'utf8'));
  for(const [name,url] of Object.entries(deps))source=source.replaceAll(JSON.stringify(name),JSON.stringify(url)).replaceAll("'"+name+"'",JSON.stringify(url));
  try {
    const {OwnerSecurityDashboard}=await import(moduleUrl(source));
    let html=renderToStaticMarkup(React.createElement(OwnerSecurityDashboard));
    assert(html.includes('Archive reply'));assert(html.includes('&lt;script&gt;'));assert(html.includes('&lt;img'));assert(!html.includes('<script>'));assert(!html.includes('<img src=x'));
    globalThis.__securityUi.user=null;html=renderToStaticMarkup(React.createElement(OwnerSecurityDashboard));assert(html.includes('Sign in as owner'));assert(!html.includes('reported-member'));assert(!html.includes('alert(1)'));
  }finally{delete globalThis.__securityUi;}
});

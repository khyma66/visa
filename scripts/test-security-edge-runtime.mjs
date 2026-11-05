import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import ts from 'typescript';

test('real Workers runtime delivers sampled evidence and rejects redirects without leaking credentials', {timeout:20_000}, async()=>{
  const compile=async path=>ts.transpileModule(await readFile(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/^import .* from ['"].*['"];?\s*$/gm,'').replace(/^export /gm,'');
  const script=await compile('../src/lib/destination-routing.ts')+await compile('../src/lib/security-edge.ts')+`
    export default {async fetch(request,env){
      process.env.NEXT_PUBLIC_SUPABASE_URL='https://cycnichledvqbxevrwnt.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='public-test-key';
      let status=204,calls=0;
      globalThis.fetch=async(url,options)=>{
        // Validate with workerd's real Request, not just a permissive Node mock.
        const outgoing=new Request(url,options);calls++;
        if(outgoing.redirect!=='manual'||outgoing.headers.has('Cookie')||outgoing.headers.has('Authorization'))throw Error('Unsafe request options');
        if(outgoing.headers.get('x-security-ingest-key')!==env.SECURITY_INGEST_KEY)throw Error('Missing capability');
        return new Response(null,{status,...(status===302||status===307?{headers:{Location:'https://example.invalid/do-not-forward'}}:{})});
      };
      const results=[];
      for(const [i,code] of [204,302,307,401,500].entries()){
        status=code;
        const incoming=new Request('https://visathreads.com/api/community?private=do-not-log',{headers:{'cf-connecting-ip':'192.0.2.'+(i+1),Cookie:'do-not-forward',Authorization:'Bearer do-not-forward'}});
        try{await recordTrafficSignal(incoming,{kind:'cross_site_read',route_group:'archive',decision:'blocked'},env);results.push({ok:true});}
        catch(error){results.push(telemetryFailureDetails(error));}
      }
      return Response.json({results,calls});
    }};
  `;
  const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01',compatibilityFlags:['nodejs_compat'],bindings:{SECURITY_INGEST_KEY:'ef'.repeat(32)},ratelimits:{SECURITY_EVENT_SAMPLE:{namespace_id:'991',simple:{limit:1,period:60}},SECURITY_EVENT_BUDGET:{namespace_id:'992',simple:{limit:60,period:60}}}}));
  try{
    const response=await runtime.dispatchFetch('http://localhost/');assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{results:[{ok:true},...[302,307,401,500].map(status=>({stage:'delivery',status}))],calls:5});
  }finally{await runtime.dispose();}
});

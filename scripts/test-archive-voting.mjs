import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import ts from 'typescript';
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
let source=ts.transpileModule(await readFile(new URL('../src/lib/archive-voting-server.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
source=source.replace("'./post-views-server'",JSON.stringify(url("export const viewsJson=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});")));
const {handleArchiveVotes}=await import(url(source));
const member='22222222-2222-4222-8222-222222222222',secret='ab'.repeat(32),pass={limit:async()=>({success:true})};
const env={SECURITY_INGEST_KEY:secret,SECURITY_READ_LIMIT:pass};
const req=(method='GET',headers={},body,query='kind=question&id=apify-public')=>new Request('https://visathreads.com/api/archive-votes?'+query,{method,headers:{'cf-connecting-ip':'192.0.2.1','origin':'https://visathreads.com',...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
test('only published targets, trusted origin, valid sessions, bounded requests and matching deployments reach the database',async t=>{
 const oldUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,oldKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://cycnichledvqbxevrwnt.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='public-test';let calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url,init});return Response.json(url.endsWith('set_archive_vote')?1:[{id:'apify-public',score:1,value:0}]);});
 const exists=(kind,id)=>kind==='question'&&id==='apify-public';
 const auth={'authorization':'Bearer test.jwt.token','content-type':'application/json'},body={selected:1,expected_user:member};
 try{
  const read=await handleArchiveVotes(req(),env,exists);assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'private, no-store');assert.equal(calls[0].init.headers['x-security-ingest-key'],secret);
  assert.equal((await handleArchiveVotes(req('POST',auth,body),env,exists)).status,200);assert.equal(calls[1].init.headers.Authorization,auth.authorization);assert.deepEqual(JSON.parse(calls[1].init.body),{kind:'question',target:'apify-public',selected:1,expected_user:member});
  const count=calls.length;
  assert.equal((await handleArchiveVotes(req('GET',{},undefined,'kind=answer&id=apify-public'),env,exists)).status,404);
  assert.equal((await handleArchiveVotes(req('GET',{},undefined,'kind=question&id=apify-fake'),env,exists)).status,404);
  assert.equal((await handleArchiveVotes(req('POST',{},body),env,exists)).status,401);
  assert.equal((await handleArchiveVotes(req('POST',{...auth,origin:'https://elsewhere.test'},body),env,exists)).status,403);
  assert.equal((await handleArchiveVotes(req('GET',{'sec-fetch-site':'cross-site'}),env,exists)).status,403);
  assert.equal((await handleArchiveVotes(req('POST',auth,{...body,selected:2}),env,exists)).status,400);
  assert.equal((await handleArchiveVotes(req('POST',auth,{...body,padding:'x'.repeat(1200)}),env,exists)).status,413);
  assert.equal((await handleArchiveVotes(req(),{...env,SECURITY_READ_LIMIT:{limit:async()=>({success:false})}},exists)).status,429);
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://ppdwysmeistjxzjpmxyk.supabase.co';assert.equal((await handleArchiveVotes(req(),env,exists)).status,503);assert.equal(calls.length,count);
 }finally{if(oldUrl===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=oldKey;}
});

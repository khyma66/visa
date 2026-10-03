import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const load = async (path) => transpile(await readFile(new URL(path, import.meta.url), 'utf8'));
const { createAuthSessionSync } = await import(moduleUrl(await load('../src/lib/auth-session.ts')));
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const user = (id) => ({ id, email: null });

test('legacy containment preserves rows and current-community grants while removing old browser access', async () => {
  const db=new PGlite();
  const legacy=['analytics_events','clusters','comment_likes','comments','communities','community_members','countries','group_members','group_message_likes','group_messages','groups','message_read_receipts','notifications','post_likes','post_reactions','post_tags','posts','tags','user_interactions','user_presence','user_sessions','users','visa_requirements','visa_types'];
  const sequences=['clusters_id_seq','countries_id_seq','post_tags_id_seq','tags_id_seq','visa_requirements_id_seq','visa_types_id_seq'];
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key,public boolean); insert into storage.buckets values(\'posts\',true); create table storage.objects(id text); insert into storage.objects values(\'preserve-me\');');
    for(const table of legacy) await db.exec(`create table public.${table}(id integer,body text); insert into public.${table} values(1,'preserve-me'); grant all on public.${table} to public,anon,authenticated,service_role; grant select(body) on public.${table} to anon,authenticated;`);
    for(const sequence of sequences) await db.exec(`create sequence public.${sequence}; grant all on public.${sequence} to public,anon,authenticated,service_role;`);
    await db.exec('create table public.questions(id integer); grant select on public.questions to anon,authenticated; create function public.match_posts(text) returns text language sql as $$ select $1 $$; grant execute on function public.match_posts(text) to anon,authenticated;');
    await db.exec(await readFile(new URL('../supabase/migrations/20260911025026_legacy_access_containment.sql',import.meta.url),'utf8'));
    for(const table of legacy) {
      assert.equal((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n,1);
      for(const role of ['anon','authenticated']) {
        assert.equal((await db.query("select has_table_privilege($1,$2,'select') allowed",[role,'public.'+table])).rows[0].allowed,false);
        assert.equal((await db.query("select has_column_privilege($1,$2,'body','select') allowed",[role,'public.'+table])).rows[0].allowed,false);
      }
    }
    assert.equal((await db.query("select count(*)::int n from pg_class where relname=any($1) and relrowsecurity",[legacy])).rows[0].n,24);
    assert.equal((await db.query("select public from storage.buckets where id='posts'")).rows[0].public,false);
    assert.equal((await db.query('select count(*)::int n from storage.objects')).rows[0].n,1);
    assert.equal((await db.query("select has_table_privilege('anon','public.questions','select') allowed")).rows[0].allowed,true);
    assert.equal((await db.query("select has_function_privilege('anon','public.match_posts(text)','execute') allowed")).rows[0].allowed,false);
    assert.equal((await db.query("select has_function_privilege('service_role','public.match_posts(text)','execute') allowed")).rows[0].allowed,true);
    for(const sequence of sequences) assert.equal((await db.query("select has_sequence_privilege('authenticated',$1,'usage') allowed",['public.'+sequence])).rows[0].allowed,false);
    assert.equal((await db.query('select count(*)::int n from private.security_change_snapshots')).rows[0].n,1);
    await db.exec('set role anon');
    await assert.rejects(()=>db.query('select * from public.posts'),/permission/);
    await assert.rejects(()=>db.query('insert into public.posts values(2,\'forbidden\')'),/permission/);
    await db.exec('reset role; set role service_role');
    assert.equal((await db.query('select count(*)::int n from public.posts')).rows[0].n,1);
  } finally { await db.close(); }
});

test('account switch immediately clears prior profile and discards late profile results', async () => {
  const states = [], reads = new Map();
  const sync = createAuthSessionSync((state) => states.push(state), (id) => new Promise((resolve) => reads.set(id,resolve)));
  sync.event(user('alice')); await tick();
  sync.event(user('bob'));
  assert.equal(states.at(-1).user.id, 'bob'); assert.equal(states.at(-1).profile, null);
  await tick();
  reads.get('bob')({id:'bob',username:'bob-profile'}); await tick();
  reads.get('alice')({id:'alice',username:'alice-profile'}); await tick();
  assert.equal(states.at(-1).profile.id,'bob');
  sync.event(null);
  assert.deepEqual(states.at(-1),{user:null,profile:null,loading:false});
  sync.initial(user('alice')); await tick();
  assert.equal(states.at(-1).user,null);
  sync.stop();
});

test('auth cleanup cancels deferred reads and ignores pending reads; failed reads clear profile', async () => {
  let calls=0;
  const sync = createAuthSessionSync(() => {}, async () => { calls++; return null; });
  sync.event(user('alice')); sync.stop(); await tick(); assert.equal(calls,0);
  const states=[]; let finish;
  const pending=createAuthSessionSync((s)=>states.push(s),()=>new Promise((resolve)=>{finish=resolve;}));
  pending.initial(user('alice')); await tick(); pending.stop();
  finish({id:'alice'}); await tick(); assert.equal(states.length,1);
  const failed=createAuthSessionSync((s)=>states.push(s),async()=>{throw new Error('offline');});
  failed.initial(user('alice')); await tick(); await tick();
  assert.equal(states.at(-1).loading,false); assert.equal(states.at(-1).profile,null); failed.stop();
});

test('account UI is keyed by identity and rejects mismatched returned profiles', async () => {
  const source=await readFile(new URL('../src/components/AuthProvider.tsx',import.meta.url),'utf8');
  assert(source.includes("<Fragment key={user?.id ?? 'signed-out'}>"),'Account-scoped state must remount when identity changes');
  const states=[];
  const sync=createAuthSessionSync((s)=>states.push(s),async()=>({id:'other-user'}));
  sync.initial(user('alice')); await tick(); await tick();
  assert.equal(states.at(-1).profile,null); sync.stop();
});

test('retired MCP never reads credentials, request bodies or upstream services', async () => {
  const {default:worker}=await import(moduleUrl(await load('../workers/mcp_server.ts')));
  const poison=new Proxy({}, {get(){throw new Error('No request or credential access permitted');}});
  const response=await worker.fetch(poison,poison);
  assert.equal(response.status,410); assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal((await response.text()).includes('disabled'),true);
});

test('live import is opt-in, bounded, nonredirecting, and cannot send credentials to another origin', async () => {
  const stub=moduleUrl('export class NextResponse extends Response {}');
  const tags=moduleUrl(await load('../src/lib/tagging.ts'));
  const source=(await load('../src/app/api/community/route.ts'))
    .replace("'next/server'",JSON.stringify(stub)).replace("'@/lib/tagging'",JSON.stringify(tags))
.replace("'@visa/archive'",JSON.stringify(moduleUrl('export default {};')));
  const { GET }=await import(moduleUrl(source));
  const names=['APP_ENV','COMMUNITY_SOURCE_MODE','APIFY_TOKEN','APIFY_API_BASE_URL','APIFY_LIVE_FETCH_ENABLED','APIFY_USE_LATEST_RUN','IMPORTED_CONTENT_APPROVED'];
  const previous=Object.fromEntries(names.map((name)=>[name,process.env[name]]));
  const savedFetch=globalThis.fetch, savedError=console.error;
  const logs=[];
  try {
    for(const name of names) delete process.env[name];
    console.error=(line)=>logs.push(line);
    let calls=0;
    globalThis.fetch=async()=>{calls++; throw new Error('unexpected fetch');};
    process.env.APP_ENV='development'; process.env.APIFY_TOKEN='fixture-secret-never-log';
    assert.equal((await GET()).status,503); assert.equal(calls,0);
    process.env.APIFY_LIVE_FETCH_ENABLED='true';
    process.env.APIFY_API_BASE_URL='https://attacker.invalid/v2';
    assert.equal((await GET()).status,502); assert.equal(calls,0);
    delete process.env.APIFY_API_BASE_URL;
    process.env.APP_ENV='production'; process.env.IMPORTED_CONTENT_APPROVED='true';
    assert.equal((await GET()).status,503); assert.equal(calls,0);
    process.env.APP_ENV='development'; process.env.APIFY_USE_LATEST_RUN='false';
    const fetchResponse=(response)=>{globalThis.fetch=async(target,options)=>{
      assert.equal(new URL(target).origin,'https://api.apify.com');
      assert.equal(options.redirect,'error'); assert.equal(options.cache,'no-store'); return response;
    };};
    fetchResponse(Response.json([])); assert.equal((await GET()).status,200);
    fetchResponse(new Response('',{status:302,headers:{location:'https://attacker.invalid'}}));
    assert.equal((await GET()).status,502);
    fetchResponse(new Response('[]',{headers:{'content-type':'text/html'}}));
    assert.equal((await GET()).status,502);
    fetchResponse(Response.json([],{headers:{'content-length':String(3*1024*1024)}}));
    assert.equal((await GET()).status,502);
    fetchResponse(new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(2*1024*1024+1)); controller.close();}}),{headers:{'content-type':'application/json'}}));
    assert.equal((await GET()).status,502);
    fetchResponse(Response.json(Array.from({length:101},()=>({}))));
    assert.equal((await GET()).status,502);
    fetchResponse(Response.json([],{headers:{'x-apify-pagination-total':'5001'}}));
    assert.equal((await GET()).status,502);
    assert(logs.every((line)=>line==='{"event":"apify_fetch_error"}'));
  } finally {
    globalThis.fetch=savedFetch; console.error=savedError;
    for(const [name,value] of Object.entries(previous)) if(value===undefined) delete process.env[name]; else process.env[name]=value;
  }
});

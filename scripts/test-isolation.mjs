import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { liveTestTarget, liveTestFixtures, liveTestFetch, PRODUCTION_DATABASE_ORIGIN, PRODUCTION_PROJECT_REF } from './test-environment.mjs';
import { developmentEnvironment, developmentArguments } from './dev-isolated.mjs';

const localEnv = {
  VISAFLOW_TEST_SUPABASE_URL:'http://127.0.0.1:55321', VISAFLOW_TEST_PROJECT_REF:'local',
  VISAFLOW_TEST_ENV:'disposable', VISAFLOW_TEST_ALLOW_WRITES:'disposable-fixtures-only',
  VISAFLOW_TEST_PUBLISHABLE_KEY:`sb_publishable_${'fixture'.repeat(5)}`,
};
const remoteRef='abcdefghijklmnopqrst';
const remoteEnv={...localEnv,VISAFLOW_TEST_SUPABASE_URL:`https://${remoteRef}.supabase.co`,VISAFLOW_TEST_PROJECT_REF:remoteRef};
const now=Date.parse('2026-10-03T12:00:00Z');
const fixture=()=>({schemaVersion:1,purpose:'visaflow-live-tests',disposable:true,databaseOrigin:localEnv.VISAFLOW_TEST_SUPABASE_URL,
  createdAt:'2026-10-03T11:00:00Z',expiresAt:'2026-10-03T13:00:00Z',
  users:[1,2,3].map(n=>({id:`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,email:`fixture-${n}@example.invalid`,password:'fixture-only-not-a-real-password'}))});
const jwt=(claims)=>`header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;

test('dedicated disposable local and remote targets are allowed without changing application settings',()=>{
  const target=liveTestTarget({...localEnv,NEXT_PUBLIC_SUPABASE_URL:PRODUCTION_DATABASE_ORIGIN});
  assert.equal(target.origin,localEnv.VISAFLOW_TEST_SUPABASE_URL);assert.equal(target.local,true);
  assert.equal(liveTestTarget(remoteEnv).projectRef,remoteRef);
});
test('production target cannot be opted into by declaring it disposable',()=>{
  for(const url of [PRODUCTION_DATABASE_ORIGIN,`${PRODUCTION_DATABASE_ORIGIN}/`,PRODUCTION_DATABASE_ORIGIN.toUpperCase(),`${PRODUCTION_DATABASE_ORIGIN}.`]) {
    assert.throws(()=>liveTestTarget({...localEnv,VISAFLOW_TEST_SUPABASE_URL:url,VISAFLOW_TEST_PROJECT_REF:PRODUCTION_PROJECT_REF}),/production database/);
  }
});
test('application URL and public key are never fallback credentials for mutation tests',()=>{
  assert.throws(()=>liveTestTarget({NEXT_PUBLIC_SUPABASE_URL:PRODUCTION_DATABASE_ORIGIN,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:localEnv.VISAFLOW_TEST_PUBLISHABLE_KEY}),/dedicated/);
  assert.throws(()=>liveTestTarget({...localEnv,VISAFLOW_TEST_PUBLISHABLE_KEY:undefined,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:localEnv.VISAFLOW_TEST_PUBLISHABLE_KEY}),/publishable/);
});
for(const name of ['APP_ENV','NEXT_PUBLIC_APP_ENV','CLOUDFLARE_ENV']) {
  test(`${name}=production blocks mutation tests even with a local target`,()=>assert.throws(()=>liveTestTarget({...localEnv,[name]:'production'}),/outside a production/));
}
for(const value of [
  'http://localhost', 'http://127.0.0.1.evil.invalid:55321', 'https://database.example.org',
  'https://abcdefghijklmnopqrst.supabase.co/path', 'https://user:password@abcdefghijklmnopqrst.supabase.co',
  'https://abcdefghijklmnopqrst.supabase.co?token=do-not-log', 'https://abcdefghijklmnopqrst.supabase.co#fragment',
  'http://abcdefghijklmnopqrst.supabase.co', 'https://abcdefghijklmnopqrst.supabase.co:4433',
]) test(`unsafe or ambiguous test destination is rejected (${new URL(value).hostname})`,()=>assert.throws(()=>liveTestTarget({...remoteEnv,VISAFLOW_TEST_SUPABASE_URL:value}),/Live test blocked/));
test('explicit project selection, disposable mode, and write acknowledgment are independently required',()=>{
  for(const key of ['VISAFLOW_TEST_PROJECT_REF','VISAFLOW_TEST_ENV','VISAFLOW_TEST_ALLOW_WRITES']) {
    assert.throws(()=>liveTestTarget({...localEnv,[key]:undefined}),/Live test blocked/);
  }
});
test('secret keys and service, authenticated, mismatched or production JWTs are rejected',()=>{
  for(const key of ['sb_secret_fixture-never-use',jwt({role:'service_role',ref:remoteRef}),jwt({role:'authenticated',ref:remoteRef}),jwt({role:'anon',ref:PRODUCTION_PROJECT_REF}),jwt({role:'anon',ref:'wrong-project'})]) {
    assert.throws(()=>liveTestTarget({...remoteEnv,VISAFLOW_TEST_PUBLISHABLE_KEY:key}),/publishable/);
  }
  assert.equal(liveTestTarget({...remoteEnv,VISAFLOW_TEST_PUBLISHABLE_KEY:jwt({role:'anon',ref:remoteRef})}).projectRef,remoteRef);
  assert.equal(liveTestTarget({...localEnv,VISAFLOW_TEST_PUBLISHABLE_KEY:jwt({role:'anon',iss:'supabase'})}).local,true);
});
test('fixture manifest binds fresh three-user fixtures to the exact target',()=>{
  const target=liveTestTarget(localEnv);
  assert.equal(liveTestFixtures(fixture(),target,now).length,3);
  for(const change of [
    {schemaVersion:undefined},{disposable:false},{purpose:'manual-user-accounts'},
    {databaseOrigin:PRODUCTION_DATABASE_ORIGIN},{expiresAt:'2026-10-03T11:30:00Z'},
    {createdAt:'2026-10-04T12:00:00Z'},{expiresAt:'2026-10-06T12:00:00Z'},
    {users:fixture().users.slice(0,2)},
  ]) assert.throws(()=>liveTestFixtures({...fixture(),...change},target,now),/Live test blocked/);
});
test('real-user emails, duplicate identities and missing test passwords are rejected without leaking values',()=>{
  for(const change of [{email:'private-person@example.com'},{id:fixture().users[1].id},{email:fixture().users[1].email},{password:''}]) {
    const manifest=fixture();manifest.users[0]={...manifest.users[0],...change};
    assert.throws(()=>liveTestFixtures(manifest,liveTestTarget(localEnv),now),error=>{
      assert(!error.message.includes('private-person'));assert(!error.message.includes('fixture-only-not-a-real-password'));
      return error.message.startsWith('Live test blocked:');
    });
  }
});
test('guarded fetch preserves payloads but blocks cross-origin and redirect credential forwarding',async()=>{
  const calls=[];
  const guarded=liveTestFetch(liveTestTarget(localEnv),async(input,options)=>{calls.push({input,options});return Response.json({ok:true});});
  await guarded(`${localEnv.VISAFLOW_TEST_SUPABASE_URL}/rest/v1/questions`,{method:'POST',body:'fixture',redirect:'follow'});
  assert.equal(calls.length,1);assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.body,'fixture');
  for(const input of [`${PRODUCTION_DATABASE_ORIGIN}/rest/v1/questions`,'https://attacker.invalid/','http://user:password@127.0.0.1:55321']) {
    await assert.rejects(()=>guarded(input),/approved disposable origin/);
  }
  assert.equal(calls.length,1);
});
test('network failures never echo provider bodies or credentials',async()=>{
  const guarded=liveTestFetch(liveTestTarget(localEnv),async()=>{throw new Error('secret-provider-body-never-log');});
  await assert.rejects(()=>guarded(`${localEnv.VISAFLOW_TEST_SUPABASE_URL}/auth/v1/token`),error=>!error.message.includes('secret-provider-body'));
});
test('live entrypoint refuses production before fixture files or clients are accessed',()=>{
  const path=fileURLToPath(new URL('./test-live-realtime.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[path],{encoding:'utf8',timeout:10_000,
    env:{PATH:process.env.PATH,...localEnv,VISAFLOW_TEST_SUPABASE_URL:PRODUCTION_DATABASE_ORIGIN,VISAFLOW_TEST_PROJECT_REF:PRODUCTION_PROJECT_REF}});
  assert.equal(result.status,1);assert.match(result.stderr,/production database can never/);
  assert(!result.stderr.includes('ENOENT'));assert(!result.stderr.includes(localEnv.VISAFLOW_TEST_PUBLISHABLE_KEY));
});
test('retired historical shell and likes entrypoints fail before invoking any legacy work',()=>{
  for(const file of ['deploy-all.sh','upload-posts.sh']) {
    const result=spawnSync('/bin/bash',[fileURLToPath(new URL(file,import.meta.url))],{encoding:'utf8',timeout:5_000,env:{PATH:'/nonexistent'}});
    assert.equal(result.status,1);assert.match(result.stderr,/Retired legacy/);assert.equal(result.stdout,'');
    assert(!result.stderr.includes('command not found'));
  }
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./test-likes-api.js',import.meta.url))],{encoding:'utf8',timeout:5_000,env:{}});
  assert.equal(result.status,1);assert.match(result.stderr,/no requests were sent/);assert.equal(result.stdout,'');
});
test('legacy Python seeding stops before database imports',async()=>{
  const source=await readFile(new URL('../backend/src/scripts/seed_data.py',import.meta.url),'utf8');
  assert(source.indexOf('raise SystemExit(')<source.indexOf('import asyncio'));
  assert(source.indexOf('raise SystemExit(')<source.indexOf('from src.core.database'));
});
test('live guard is isolated from normal browser and release entrypoints',async()=>{
  for(const file of ['../src/lib/supabase/client.ts','../vite.config.ts','../package.json','./release-check.mjs']) {
    assert(!(await readFile(new URL(file,import.meta.url),'utf8')).includes("from './test-environment.mjs'"));
  }
});

test('local interactive development refuses all hosted backends, including production selected by env precedence',()=>{
  for(const url of [PRODUCTION_DATABASE_ORIGIN,remoteEnv.VISAFLOW_TEST_SUPABASE_URL,'http://127.0.0.1.evil.invalid:54321']) {
    assert.throws(()=>developmentEnvironment({NEXT_PUBLIC_SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:localEnv.VISAFLOW_TEST_PUBLISHABLE_KEY}),/Hosted databases/);
  }
});
test('explicit local demo removes browser database settings even when application env selects production',()=>{
  const env=developmentEnvironment({NEXT_PUBLIC_SUPABASE_URL:PRODUCTION_DATABASE_ORIGIN,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_secret_do-not-use'}, {demo:true});
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL,'');assert.equal(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,'');
  assert.equal(env.VISAFLOW_LOCAL_DATA_MODE,'browser-demo');assert.equal(env.APIFY_LIVE_FETCH_ENABLED,'false');
  assert.equal(env.NEXT_PUBLIC_APP_ENV,'development');
});
test('local Supabase development keeps only validated public connection settings',()=>{
  const env=developmentEnvironment({NEXT_PUBLIC_SUPABASE_URL:localEnv.VISAFLOW_TEST_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:localEnv.VISAFLOW_TEST_PUBLISHABLE_KEY});
  assert.equal(env.VISAFLOW_LOCAL_DATA_MODE,'local-supabase');assert.equal(env.NEXT_PUBLIC_SUPABASE_URL,localEnv.VISAFLOW_TEST_SUPABASE_URL);
  for(const key of ['sb_secret_test',jwt({role:'service_role'}),jwt({role:'anon',ref:PRODUCTION_PROJECT_REF})]) {
    assert.throws(()=>developmentEnvironment({NEXT_PUBLIC_SUPABASE_URL:localEnv.VISAFLOW_TEST_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key}),/privileged keys/);
  }
  assert.throws(()=>developmentEnvironment({NEXT_PUBLIC_SUPABASE_URL:localEnv.VISAFLOW_TEST_SUPABASE_URL}),/both local/);
});
test('local launcher does not accept a mode/config argument that could bypass its target check',()=>{
  assert.deepEqual(developmentArguments([]),{demo:false,next:true,port:'3000'});
  assert.deepEqual(developmentArguments(['--demo','--next','--port','3101']),{demo:true,next:true,port:'3101'});
  for(const args of [['--mode','production'],['--config','other.js'],['--port','0'],['--port','70000']]) assert.throws(()=>developmentArguments(args));
});
test('all supported interactive dev commands pass through the local isolation launcher',async()=>{
  const packageJson=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  for(const command of ['dev','dev:next','dev:demo']) assert(packageJson.scripts[command].includes('scripts/dev-isolated.mjs'));
  assert(!packageJson.scripts['deploy:dev'].includes('dev-isolated'));
  const launcher=await readFile(new URL('./dev-isolated.mjs',import.meta.url),'utf8');
  assert(launcher.includes("const command=resolve(root,'node_modules','.bin','next');"));
});

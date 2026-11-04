// An isolated local PostgreSQL cluster; no hosted account or data is used.
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
const run=promisify(execFile),root=await mkdtemp(join(tmpdir(),'visathreads-award-pg-'));
const data=join(root,'data'),port=String(55500+Math.floor(Math.random()*400));
const sql=async value=>(await run('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-h',root,'-p',port,'-d','postgres','-c',value])).stdout.trim();
let started=false;
try {
  await run('initdb',['-D',data,'-A','trust','--no-locale']);
  await run('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o',`-k ${root} -p ${port} -c listen_addresses=''`,'-w','start']);started=true;
  const a='11111111-1111-4111-8111-111111111111',u='22222222-2222-4222-8222-222222222222',q='33333333-3333-4333-8333-333333333333';
  await sql(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
    create table auth.users(id uuid primary key,deleted_at timestamptz,is_anonymous boolean default false,banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.questions(id uuid primary key,author_id uuid,status text,community_id uuid);
    create table public.communities(id uuid primary key,is_public boolean,is_active boolean);
    create table public.policy_acceptances(user_id uuid,policy_version text);
    create table private.community_suspensions(user_id uuid);
    create table private.community_rate_windows(user_id uuid,action text,window_start timestamptz,used integer,primary key(user_id,action));
    insert into auth.users(id) values('${a}'),('${u}');insert into public.questions values('${q}','${a}','open',null);
    insert into public.policy_acceptances values('${u}','2026-11-02-preview-v3');
    grant usage on schema public,private,auth to anon,authenticated;`);
  const original=await readFile(new URL('../supabase/migrations/20260910055528_launch_safety_and_moderation.sql',import.meta.url),'utf8');
  await sql(original.match(/create function private\.community_consume\([\s\S]*?\$\$;/)[0]);
  await sql(await readFile(new URL('../supabase/migrations/20261104050311_free_post_awards.sql',import.meta.url),'utf8'));
  const toggle=()=>sql(`begin;select set_config('request.jwt.claim.sub','${u}',true);set local role authenticated;select public.set_post_award('${q}','helpful');commit;`);
  await Promise.all(Array.from({length:10},toggle));
  assert.equal(await sql('select count(*) from private.post_awards'),'0','ten serialized toggles cancel');
  await Promise.all(Array.from({length:9},toggle));
  assert.equal(await sql('select count(*) from private.post_awards'),'1','nine serialized toggles leave one award');
  console.log('PASS: concurrent award toggles are serialized and bounded to one row.');
} finally {
  if(started) await run('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  console.log('Stopped isolated test server; fixtures retained at '+root);
}

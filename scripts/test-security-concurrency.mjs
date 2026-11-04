// Isolated local PostgreSQL only; never connects to a remote/project database.
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
const run=promisify(execFile),root=await mkdtemp(join(tmpdir(),'visathreads-security-pg-')),data=join(root,'data');
const sql=async text=>(await run('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-h',root,'-p','55441','-d','postgres','-c',text],{maxBuffer:1024*1024})).stdout.trim();
const owner='11111111-1111-4111-8111-111111111111',subject='22222222-2222-4222-8222-222222222222',session='33333333-3333-4333-8333-333333333333';
const peer=i=>'44444444-4444-4444-8444-'+String(i).padStart(12,'0');
let started=false;
try {
  await run('initdb',['-D',data,'-A','trust','--no-locale']);
  await run('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o',`-k ${root} -p 55441 -c listen_addresses=''`,'-w','start']);started=true;
  await sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;grant usage on schema private to authenticated;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz default now(),phone_confirmed_at timestamptz,created_at timestamptz default now()-interval '2 days',deleted_at timestamptz,is_anonymous boolean default false);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id','${session}')$$;
    create function private.feedback_is_owner() returns boolean language sql stable as $$select auth.uid()='${owner}'::uuid$$;
    create table private.community_suspensions(user_id uuid primary key);
    create table profiles(id uuid primary key,username text);
    create table questions(id uuid primary key,author_id uuid,title text,body text);
    create table answers(id uuid primary key,author_id uuid,body text);
    create table imported_answers(id uuid primary key,author_id uuid,body text);
    create table direct_messages(id uuid primary key,sender_id uuid,body text);
    create table community_reports(id uuid primary key default gen_random_uuid(),reporter_id uuid,target_kind text,target_id uuid,reason text default 'spam',details text default '',source text default 'member',created_at timestamptz default now(),status text default 'pending');
    insert into auth.users(id) values('${owner}'),('${subject}'),${Array.from({length:12},(_,i)=>`('${peer(i)}')`).join(',')};
    insert into profiles select id,'fixture' from auth.users;insert into auth.sessions values('${session}','${owner}',null);`);
  await sql(await readFile(new URL('../supabase/migrations/20261104070127_security_evidence_console.sql',import.meta.url),'utf8'));
  await Promise.all(Array.from({length:12},(_,i)=>sql(`begin;insert into community_reports(reporter_id,target_kind,target_id) values('${peer(i)}','member','${subject}');select pg_sleep(0.01);commit;`)));
  assert.equal(await sql('select count(*) from private.security_report_evidence'),'12');
  assert.equal(await sql('select count(*) from private.security_alert_outbox'),'1');
  assert.equal(await sql('select count(*) from private.community_suspensions'),'0');
  const id=await sql('select id from private.security_report_evidence limit 1');
  const review=()=>sql(`begin;select set_config('request.jwt.claim.sub','${owner}',true);set local role authenticated;select public.security_review('report','${id}',1,'reviewing','Concurrent owner review');commit;`);
  const results=await Promise.allSettled([review(),review()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await sql('select count(*) from private.security_review_events'),'1');
  await sql(`insert into private.security_ingest_key values(true,sha256(convert_to(repeat('ab',32),'UTF8')),now());insert into private.security_ingest_window values(true,date_trunc('minute',now()),119);`);
  const observation=()=>sql(`begin;set local role anon;select set_config('request.headers',jsonb_build_object('x-security-ingest-key',repeat('ab',32))::text,true);select public.record_security_event(jsonb_build_object('kind','read_rate_limit','actor_hash',repeat('cd',32),'route_group','archive','decision','limited'));commit;`);
  await Promise.all([observation(),observation()]);assert.equal(await sql('select sum(observations) from private.security_traffic_events'),'1');
  console.log('PASS: 12 simultaneous peer reports, deduplicated escalation, no auto-ban, conflicting review protection, concurrent logging cap.');
}finally{
  if(started)await run('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  console.log('Stopped isolated test server; synthetic fixtures retained at '+root);
}

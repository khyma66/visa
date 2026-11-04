// Optional integration check with an isolated local PostgreSQL server. Never
// connects to production; all generated fixtures live in a new temp cluster.
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const run=promisify(execFile);
const root=await mkdtemp(join(tmpdir(),'visathreads-reputation-pg-'));
const data=join(root,'data');
const sql=async text=>(await run('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-h',root,'-p','55439','-d','postgres','-c',text],{maxBuffer:2*1024*1024})).stdout.trim();
let started=false;
try {
  await run('initdb',['-D',data,'-A','trust','--no-locale']);
  await run('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o',`-k ${root} -p 55439 -c listen_addresses=''`,'-w','start']); started=true;
  await sql(`create role anon; create role authenticated; create schema private; create schema auth;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz default now(),phone_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table profiles(id uuid primary key references auth.users on delete cascade,reputation integer not null default 1 check(reputation>=0),created_at timestamptz default now()-interval '2 days');
    create table questions(id uuid primary key,author_id uuid references profiles,status text default 'open');
    create table answers(id uuid primary key,question_id uuid references questions on delete cascade,author_id uuid references profiles,status text default 'active',is_accepted boolean default false);
    create table question_votes(question_id uuid references questions on delete cascade,user_id uuid references profiles on delete cascade,value integer,primary key(question_id,user_id));
    create table answer_votes(answer_id uuid references answers on delete cascade,user_id uuid references profiles on delete cascade,value integer,primary key(answer_id,user_id));
    create table private.community_suspensions(user_id uuid primary key);
    create function private.community_consume(text,integer,integer) returns void language sql as $$select$$;`);
  await sql(await readFile(new URL('../supabase/migrations/20261104043337_community_reputation.sql',import.meta.url),'utf8'));
  const owner='11111111-1111-4111-8111-111111111111',q='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const voter=i=>'22222222-2222-4222-8222-'+String(i).padStart(12,'0');
  await sql(`insert into auth.users(id) values('${owner}'),${Array.from({length:60},(_,i)=>`('${voter(i)}')`).join(',')}; insert into profiles(id) select id from auth.users; insert into questions(id,author_id) values('${q}','${owner}');`);
  const vote=i=>sql(`begin; insert into question_votes values('${q}','${voter(i)}',1) on conflict(question_id,user_id) do update set value=excluded.value; select pg_sleep(0.005); commit;`);
  // Ten independent connections contend on the same recipient and parent.
  for(let offset=0;offset<60;offset+=10) await Promise.all(Array.from({length:10},(_,i)=>vote(offset+i)));
  assert.equal(await sql(`select reputation from profiles where id='${owner}'`),'101');
  assert.equal(await sql('select sum(delta) from private.reputation_events'),'100');
  await Promise.all(Array.from({length:10},()=>vote(0)));
  assert.equal(await sql(`select reputation from profiles where id='${owner}'`),'101');
  await Promise.all([sql(`begin; update questions set status='archived' where id='${q}'; select pg_sleep(0.05); commit;`),vote(0)]);
  assert.equal(await sql(`select reputation from profiles where id='${owner}'`),'1');
  await sql(`update questions set status='open' where id='${q}'`);
  assert.equal(await sql(`select reputation from profiles where id='${owner}'`),'101');
  await sql(`delete from auth.users where id='${voter(0)}'`);
  assert.equal(await sql(`select reputation from profiles where id='${owner}'`),'99');
  console.log('PASS: concurrent caps, retries, moderation race, restoration and voter deletion.');
} finally {
  if(started) await run('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  console.log('Stopped isolated test server; fixtures retained for inspection at '+root);
}

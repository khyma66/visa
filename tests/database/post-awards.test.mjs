import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Synthetic accounts in a fresh local database; no production sessions are used.
const db=new PGlite();
const author='11111111-1111-4111-8111-111111111111', member='22222222-2222-4222-8222-222222222222';
const post='33333333-3333-4333-8333-333333333333', hidden='44444444-4444-4444-8444-444444444444';
const migration=await readFile(new URL('../../supabase/migrations/20261104050311_free_post_awards.sql',import.meta.url),'utf8');
before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create schema private;
    create table auth.users(id uuid primary key,deleted_at timestamptz,is_anonymous boolean default false,banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.policy_acceptances(user_id uuid,policy_version text);
    create table public.communities(id uuid primary key,is_public boolean,is_active boolean);
    create table public.questions(id uuid primary key,author_id uuid,status text,community_id uuid);
    create table private.community_suspensions(user_id uuid);
    create function private.community_consume(text,integer,integer) returns void language plpgsql security definer as $$begin if exists(select 1 from private.community_suspensions where user_id=auth.uid()) then raise exception 'suspended'; end if; end$$;
    grant usage on schema public,private,auth to anon,authenticated,service_role;
    insert into auth.users(id) values('${author}'),('${member}');
    insert into public.questions values('${post}','${author}','open',null),('${hidden}','${author}','archived',null);
    insert into public.policy_acceptances values('${member}','2026-11-02-preview-v3'),('${author}','2026-11-02-preview-v3');`);
  await db.exec(migration);
});
after(()=>db.close());
async function as(user,role,fn){
  await db.exec('begin');
  try {await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user??'']);await db.exec(`set local role ${role}`);return await fn();}
  finally {await db.exec('rollback');}
}
const summary=id=>db.query('select public.post_award_summary($1) as value',[id]).then(r=>r.rows[0].value);
const award=(id,badge)=>db.query('select public.set_post_award($1,$2) as value',[id,badge]).then(r=>r.rows[0].value);
test('anonymous visitors see counts but cannot award or read private rows',async()=>{
  await as(null,'anon',async()=>{assert.deepEqual(await summary(post),{helpful:0,support:0,insightful:0,mine:null});});
  await as(null,'anon',()=>assert.rejects(()=>award(post,'helpful'),/permission denied/));
  await as(null,'anon',()=>assert.rejects(()=>db.query('select * from private.post_awards'),/permission denied/));
});
test('members can choose, change and remove one award',()=>as(member,'authenticated',async()=>{
  assert.deepEqual(await award(post,'helpful'),{helpful:1,support:0,insightful:0,mine:'helpful'});
  assert.deepEqual(await award(post,'support'),{helpful:0,support:1,insightful:0,mine:'support'});
  assert.deepEqual(await award(post,'support'),{helpful:0,support:0,insightful:0,mine:null});
  assert.equal((await award('apify-123','insightful')).insightful,1);
}));
test('own, archived, malformed and unsupported awards are rejected',async()=>{
  await as(author,'authenticated',()=>assert.rejects(()=>award(post,'helpful'),/own post/));
  await as(member,'authenticated',()=>assert.rejects(()=>award(hidden,'helpful'),/unavailable/));
  await as(member,'authenticated',()=>assert.rejects(()=>award('not-a-post','helpful'),/unavailable/));
  await as(member,'authenticated',()=>assert.rejects(()=>award(post,'money'),/Invalid award/));
});
test('suspended accounts cannot give awards',async()=>{
  await db.query('insert into private.community_suspensions values($1)',[member]);
  try {await as(member,'authenticated',()=>assert.rejects(()=>award(post,'helpful'),/suspended/));}
  finally {await db.query('delete from private.community_suspensions where user_id=$1',[member]);}
});
test('unaccepted policy, anonymous identities and server role cannot give awards',async()=>{
  await db.query('delete from public.policy_acceptances where user_id=$1',[member]);
  await as(member,'authenticated',()=>assert.rejects(()=>award(post,'helpful'),/policies/));
  await db.query("insert into public.policy_acceptances values($1,'2026-11-02-preview-v3')",[member]);
  await db.query('update auth.users set is_anonymous=true where id=$1',[member]);
  try {await as(member,'authenticated',()=>assert.rejects(()=>award(post,'helpful'),/Authentication required/));}
  finally {await db.query('update auth.users set is_anonymous=false where id=$1',[member]);}
  await as(member,'service_role',()=>assert.rejects(()=>award(post,'helpful'),/permission denied/));
});

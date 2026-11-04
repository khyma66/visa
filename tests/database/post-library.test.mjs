import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Synthetic accounts in a fresh local database; no production sessions are used.
const db=new PGlite();
const author='11111111-1111-4111-8111-111111111111', member='22222222-2222-4222-8222-222222222222';
const post='33333333-3333-4333-8333-333333333333', hidden='44444444-4444-4444-8444-444444444444';
const migration=await readFile(new URL('../../supabase/migrations/20261104064821_private_post_library.sql',import.meta.url),'utf8');

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
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant usage on schema private to authenticated;
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
const set=(id,selection,enabled)=>db.query('select public.set_post_library($1,$2,$3,auth.uid()) as value',[id,selection,enabled]).then(r=>r.rows[0].value);
const list=(selection='saved',page=0)=>db.query('select public.list_post_library($1,$2) as value',[selection,page]).then(r=>r.rows[0].value);
const states=ids=>db.query('select public.post_library_state($1) as value',[ids]).then(r=>r.rows[0].value);
test('signed-out visitors cannot read or change a private library',async()=>{
  for(const action of [()=>list(),()=>states([post]),()=>set(post,'saved',true)]) await as(null,'anon',()=>assert.rejects(action,/permission denied/));
  await as(null,'authenticated',()=>assert.rejects(()=>list(),/Sign in/));
});
test('save and follow are independent, idempotent, and removable',()=>as(member,'authenticated',async()=>{
  assert.deepEqual(await set(post,'saved',true),{post_id:post,saved:true,followed:false});
  await set(post,'saved',true);assert.equal((await list()).length,1);
  assert.deepEqual(await set(post,'followed',true),{post_id:post,saved:true,followed:true});
  await set(post,'saved',false);assert.equal((await list()).length,0);assert.equal((await list('followed')).length,1);
  await set(post,'followed',false);assert.deepEqual(await states([post]),[]);
  assert.deepEqual(await set(post,'saved',false),{post_id:post,saved:false,followed:false});
  await set('apify-source-123','saved',true);assert.equal((await list())[0].post_id,'apify-source-123');
}));
test('each account sees only its own saved posts, even when requesting the same IDs',async()=>{
  await db.query('insert into private.post_library(user_id,post_id,saved) values($1,$2,true)',[author,post]);
  try {
    await as(member,'authenticated',async()=>{assert.deepEqual(await list(),[]);assert.deepEqual(await states([post]),[]);await set(post,'followed',true);assert.deepEqual(await list(),[]);});
    await as(author,'authenticated',async()=>{assert.equal((await list()).length,1);assert.equal((await states([post]))[0].saved,true);});
  } finally {await db.query('delete from private.post_library where user_id=$1',[author]);}
});
test('private rows cannot be queried or altered directly by clients or service role',async()=>{
  for(const role of ['anon','authenticated','service_role']) {
    await as(member,role,()=>assert.rejects(()=>db.query('select * from private.post_library'),/permission denied/));
    await as(member,role,()=>assert.rejects(()=>db.query('delete from private.post_library'),/permission denied/));
  }
});
test('hidden posts cannot be added but previously saved hidden posts can be removed',async()=>{
  await as(member,'authenticated',()=>assert.rejects(()=>set(hidden,'saved',true),/unavailable/));
  await db.query('insert into private.post_library(user_id,post_id,saved) values($1,$2,true)',[member,hidden]);
  try {await as(member,'authenticated',async()=>{await set(hidden,'saved',false);assert.deepEqual(await list(),[]);});}
  finally {await db.query('delete from private.post_library where user_id=$1',[member]);}
});
test('invalid lists, pages, targets and selections are rejected',async()=>{
  for(const action of [()=>set('invalid','saved',true),()=>set(post,'other',true),()=>set(post,'saved',null),()=>list('saved',-1),()=>list('other'),()=>states(Array(101).fill(post))])
    await as(member,'authenticated',()=>assert.rejects(action,/Invalid|unavailable/));
});
test('suspended and banned members cannot mutate saved posts',async()=>{
  await db.query('insert into private.community_suspensions values($1)',[member]);
  try {await as(member,'authenticated',()=>assert.rejects(()=>set(post,'saved',true),/suspended/));}
  finally {await db.query('delete from private.community_suspensions where user_id=$1',[member]);}
  await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[member]);
  try {await as(member,'authenticated',()=>assert.rejects(()=>list(),/Sign in/));}
  finally {await db.query('update auth.users set banned_until=null where id=$1',[member]);}
});
test('pagination returns bounded pages with a look-ahead record',()=>as(member,'authenticated',async()=>{
  for(let i=0;i<23;i++) await set(`apify-page-${i}`,'saved',true);
  const first=await list('saved',0),second=await list('saved',1);
  assert.equal(first.length,21);assert.equal(second.length,3);
  assert.equal(new Set([...first.slice(0,20),...second].map(x=>x.post_id)).size,23);
}));

test('a session switch cannot save into a different account',()=>as(member,'authenticated',()=>assert.rejects(()=>db.query('select public.set_post_library($1,$2,$3,$4)',[post,'saved',true,author]),/Account changed/)));

import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Completely synthetic identities and sessions in an isolated, in-memory DB.
const db=new PGlite();
const uid=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const owner=uid(1), member=uid(2), session=uid(900);
const sql=await readFile(new URL('../../supabase/migrations/20261104005819_owner_member_directory.sql',import.meta.url),'utf8');
before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create schema private;
    create table auth.users(id uuid primary key,email text,created_at timestamptz default now(),last_sign_in_at timestamptz,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz,is_anonymous boolean default false);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
    create table private.feedback_owner(user_id uuid);
    create table private.community_suspensions(user_id uuid);
    create table public.profiles(id uuid,username text);
    create table public.questions(author_id uuid,status text,post_kind text);
    create table public.answers(author_id uuid,status text);
    create table public.imported_answers(author_id uuid,status text);
    grant usage on schema public,private,auth to authenticated;
    grant usage on schema public to anon,service_role;`);
  const feedback=await readFile(new URL('../../supabase/migrations/20261013191116_private_owner_feedback.sql',import.meta.url),'utf8');
  const launch=await readFile(new URL('../../supabase/migrations/20261018063832_owner_launch_workspace.sql',import.meta.url),'utf8');
  await db.exec(feedback.match(/create function private\.feedback_is_owner\(\)[\s\S]*?\$\$;/)[0]);
  await db.exec(launch.match(/create function private\.launch_assert_owner\(\)[\s\S]*?\$\$;/)[0]);
  await db.exec(sql);
  for(let n=1;n<=55;n++) await db.query("insert into auth.users(id,email,email_confirmed_at,created_at) values($1,$2,now(),'2026-01-01')",[uid(n),`member${n}@example.invalid`]);
  await db.query('insert into private.feedback_owner values($1)',[owner]);
  await db.query('insert into auth.sessions values($1,$2,null)',[session,owner]);
  await db.query("insert into public.profiles values($1,'Example Person')",[member]);
  await db.query("insert into public.questions values($1,'open','question'),($1,'archived','question'),($1,'open','experience')",[member]);
  await db.query("insert into public.answers values($1,'active'),($1,'archived')",[member]);
  await db.query("insert into public.imported_answers values($1,'active')",[member]);
});
after(()=>db.close());
async function as(user,fn,{role='authenticated',sid=session}={}){
  await db.exec('begin');
  try{
    await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user,session_id:sid})]);
    await db.exec(`set local role ${role}`);
    return await fn();
  }finally{await db.exec('rollback');}
}
async function list(args=['','all',0,null,null,false]) {return (await db.query('select public.owner_members($1,$2,$3,$4,$5,$6) as data',args)).rows[0].data;}
for(const role of ['anon','service_role']) test(`${role} denied`,()=>as(owner,()=>assert.rejects(()=>list(),/permission denied/),{role}));
test('regular member denied at database boundary',()=>as(member,()=>assert.rejects(()=>list(),/Owner access required/)));
test('revoked/absent session denied',()=>as(owner,()=>assert.rejects(()=>list(),/Owner access required/),{sid:uid(999)}));
test('only bounded approved fields, stable keyset pagination',()=>as(owner,async()=>{
  const first=await list();assert.equal(first.total,55);assert.equal(first.items.length,50);
  const second=await list(['','all',0,first.next_cursor.created_at,first.next_cursor.id,false]);
  assert.equal(second.items.length,5);assert.equal(second.next_cursor,null);
  assert.equal(new Set([...first.items,...second.items].map(r=>r.id)).size,55);
  assert.deepEqual(Object.keys(first.items[0]).sort(),['id','email','username','created_at','last_sign_in_at','email_verified','suspended','is_owner','questions','experiences','replies'].sort());
}));
test('case-insensitive search and correct activity counts',()=>as(owner,async()=>{
  const page=await list(['EXAMPLE PERSON','verified',0,null,null,false]);
  assert.equal(page.matched,1);assert.equal(page.items[0].questions,1);assert.equal(page.items[0].experiences,1);assert.equal(page.items[0].replies,2);
  assert.equal((await list(['%','all',0,null,null,false])).matched,0);
}));
test('reject malformed filters and mismatched cursors',async()=>{
  for(const args of [['','bad',0,null,null,false],['','all',1,null,null,false],['','all',0,null,owner,false],['x'.repeat(201),'all',0,null,null,false]]) await as(owner,()=>assert.rejects(()=>list(args),/Invalid member filters/));
});
test('private tables and auth data cannot be read directly',()=>as(member,async()=>{
  await assert.rejects(()=>db.query('select * from private.member_access_events'),/permission denied/);
}));
test('filters exclude deleted and anonymous accounts and reflect verification and suspension',async()=>{
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:owner,session_id:session})]);
    await db.query('update auth.users set email_confirmed_at=null where id=$1',[member]);
    await db.query('insert into private.community_suspensions values($1)',[member]);
    await db.query('update auth.users set deleted_at=now() where id=$1',[uid(3)]);
    await db.query('update auth.users set is_anonymous=true where id=$1',[uid(4)]);
    assert.equal((await list()).total,53);
    assert.equal((await list(['','unverified',0,null,null,false])).matched,1);
    assert.equal((await list(['','suspended',0,null,null,false])).items[0].id,member);
    assert.equal((await list(['','verified',0,null,null,false])).matched,52);
  } finally {await db.exec('rollback');}
});
test('export is freshly authorized and records no PII in audit',async()=>{
  await db.exec('begin');
  try{
    await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:owner,session_id:session})]);
    await list(['example','all',0,null,null,true]);
    const row=(await db.query('select * from private.member_access_events')).rows[0];
    assert.equal(row.action,'export');assert.equal(row.row_count,50);
    assert.deepEqual(Object.keys(row).sort(),['id','actor_id','action','row_count','created_at'].sort());
    await db.query('delete from private.feedback_owner');
    await assert.rejects(()=>list(['','all',0,null,null,true]),/Owner access required/);
  }finally{await db.exec('rollback');}
});

import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const author='11111111-1111-4111-8111-111111111111', voter='22222222-2222-4222-8222-222222222222', other='44444444-4444-4444-8444-444444444444', reply='33333333-3333-4333-8333-333333333333';
const migration=await readFile(new URL('../../supabase/migrations/20261107042328_member_reply_voting.sql',import.meta.url),'utf8');
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
 create table auth.users(id uuid primary key,deleted_at timestamptz,is_anonymous boolean default false,banned_until timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.policy_acceptances(user_id uuid,policy_version text);
 create table private.community_suspensions(user_id uuid);
 create function private.community_consume(text,integer,integer) returns void language plpgsql security definer as $$begin if exists(select 1 from private.community_suspensions where user_id=auth.uid()) then raise exception 'suspended'; end if;end$$;
 create table public.imported_answers(id uuid primary key,author_id uuid,status text,vote_score integer default 0);
 create function public.vote_question(uuid,integer) returns integer language sql as $$select $2$$;
 create function public.vote_answer(uuid,integer) returns integer language sql as $$select $2$$;
 grant usage on schema public,auth to anon,authenticated,service_role;grant usage on schema private to authenticated;
 insert into auth.users(id) values('${author}'),('${voter}'),('${other}');
 insert into public.policy_acceptances values('${author}','2026-11-05-preview-v4'),('${voter}','2026-11-05-preview-v4'),('${other}','2026-11-05-preview-v4');
 insert into public.imported_answers values('${reply}','${author}','active',5);`);
 const library=await readFile(new URL('../../supabase/migrations/20261104064821_private_post_library.sql',import.meta.url),'utf8');
 await db.exec(library.slice(library.indexOf('create function private.library_member'),library.indexOf('create function private.library_post_visible')));
 await db.exec(migration);
 await db.exec("create schema security_ingress;grant usage on schema security_ingress to anon;create table private.security_ingest_key(key_hash bytea);insert into private.security_ingest_key values(sha256(convert_to(repeat('ab',32),'UTF8')));");
 await db.exec(await readFile(new URL('../../supabase/migrations/20261107043341_archive_discussion_voting.sql',import.meta.url),'utf8'));
});
after(()=>db.close());
async function as(user,role,fn){await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user??'']);await db.exec(`set local role ${role}`);return await fn();}finally{await db.exec('rollback');}}
const vote=(value,expected=voter)=>db.query('select public.vote_imported_reply($1,$2,$3) as score',[reply,value,expected]).then(r=>r.rows[0].score);
const state=()=>db.query('select public.imported_reply_vote_state($1) as result',[[reply]]).then(r=>r.rows[0].result);
test('upvote, repeat, switch, clear preserve existing totals and store one vote',()=>as(voter,'authenticated',async()=>{
 assert.equal(await vote(1),6);assert.equal(await vote(1),6);assert.deepEqual(await state(),[{id:reply,value:1}]);
 assert.equal(await vote(-1),4);assert.equal(await vote(0),5);assert.equal(await vote(0),5);assert.deepEqual(await state(),[]);
}));
test('anonymous, self, mismatched identity and invalid values are rejected',async()=>{
 await as(null,'anon',()=>assert.rejects(()=>vote(1),/permission denied/));
 await as(author,'authenticated',()=>assert.rejects(()=>vote(1,author),/own contribution/));
 await as(voter,'authenticated',()=>assert.rejects(()=>vote(1,other),/Account changed/));
 for(const value of [null,2,-2])await as(voter,'authenticated',()=>assert.rejects(()=>vote(value),/Invalid vote/));
});
test('selections are private, capped, and unavailable directly',async()=>{
 await db.query('insert into private.imported_reply_votes values($1,$2,1)',[reply,other]);
 try{
 await as(voter,'authenticated',async()=>assert.deepEqual(await state(),[]));
 await as(other,'authenticated',async()=>assert.deepEqual(await state(),[{id:reply,value:1}]));
 await as(voter,'authenticated',()=>assert.rejects(()=>db.query('select public.imported_reply_vote_state($1)',[Array(51).fill(reply)]),/Invalid reply list/));
 for(const role of ['anon','authenticated','service_role'])await as(voter,role,()=>assert.rejects(()=>db.query('select * from private.imported_reply_votes'),/permission denied/));
 }finally{await db.query('delete from private.imported_reply_votes where user_id=$1',[other]);}
});
test('hidden replies, unaccepted policies, banned and suspended accounts cannot vote',async()=>{
 for(const [setup,cleanup,pattern] of [
 ["update public.imported_answers set status='archived'","update public.imported_answers set status='active'",/unavailable/],
 [`delete from public.policy_acceptances where user_id='${voter}'`,`insert into public.policy_acceptances values('${voter}','2026-11-05-preview-v4')`,/policies/],
 [`update auth.users set banned_until=now()+interval '1 day' where id='${voter}'`,`update auth.users set banned_until=null where id='${voter}'`,/Sign in/],
 [`insert into private.community_suspensions values('${voter}')`,`delete from private.community_suspensions`,/suspended/]]){
 await db.exec(setup);try{await as(voter,'authenticated',()=>assert.rejects(()=>vote(1),pattern));}finally{await db.exec(cleanup);}
 }
});
test('account removal reverses only that accounts contribution',async()=>{
 await db.exec('begin');try{
 await db.query('insert into private.imported_reply_votes values($1,$2,1)',[reply,other]);
 await db.query('delete from auth.users where id=$1',[other]);
 assert.equal((await db.query('select vote_score from public.imported_answers where id=$1',[reply])).rows[0].vote_score,5);
 }finally{await db.exec('rollback');}
});
test('native wrapper binds the current account before invoking existing vote functions',async()=>{
 await as(voter,'authenticated',async()=>assert.equal((await db.query("select public.set_native_vote('question',$1,1,$2) as score",[reply,voter])).rows[0].score,1));
 await as(voter,'authenticated',()=>assert.rejects(()=>db.query("select public.set_native_vote('answer',$1,1,$2)",[reply,other]),/Account changed/));
 await as(null,'anon',()=>assert.rejects(()=>db.query("select public.set_native_vote('question',$1,1,$2)",[reply,voter]),/permission denied/));
});

async function trusted(){await db.query("select set_config('request.headers',$1,true)",[JSON.stringify({'x-security-ingest-key':'ab'.repeat(32)})]);}
const archivedVote=(kind,value,expected=voter)=>db.query('select public.set_archive_vote($1,$2,$3,$4) as score',[kind,'apify-original',value,expected]).then(r=>r.rows[0].score);
const archivedRead=(kind)=>db.query('select public.archive_vote_summary($1,$2) as result',[kind,['apify-original']]).then(r=>r.rows[0].result);
for(const kind of ['question','answer'])test(`original ${kind} votes are separate, idempotent, reversible and identity-bound`,()=>as(voter,'authenticated',async()=>{
 await trusted();assert.equal(await archivedVote(kind,1),1);assert.equal(await archivedVote(kind,1),1);
 assert.deepEqual(await archivedRead(kind),[{id:'apify-original',score:1,value:1}]);
 await db.query("select set_config('request.jwt.claim.sub',$1,true)",[other]);
 assert.deepEqual(await archivedRead(kind),[{id:'apify-original',score:1,value:0}]);
 assert.equal(await archivedVote(kind,-1,other),0);
 await db.query("select set_config('request.jwt.claim.sub',$1,true)",[voter]);
 assert.equal(await archivedVote(kind,0),-1);assert.equal(await archivedVote(kind,0),-1);
 await db.query("select set_config('request.jwt.claim.sub','',true)");await db.exec('set local role anon');
 assert.deepEqual(await archivedRead(kind),[{id:'apify-original',score:-1,value:0}]);
}));
test('direct clients cannot forge archive targets by bypassing the trusted edge',async()=>{
 for(const role of ['anon','authenticated'])await as(voter,role,()=>assert.rejects(()=>archivedRead('question'),/Trusted edge required/));
 await as(voter,'authenticated',()=>assert.rejects(()=>archivedVote('question',1),/Trusted edge required/));
 await as(voter,'authenticated',async()=>{await trusted();await assert.rejects(()=>archivedVote('question',1,other),/Account changed/);});
 await as(voter,'authenticated',async()=>{await trusted();await assert.rejects(()=>archivedVote('question',2),/Invalid vote/);});
 await as(voter,'authenticated',()=>assert.rejects(()=>db.query('select * from private.archive_votes'),/permission denied/));
});
test('archive vote read limits, suspension, policy acknowledgement, and cascade deletion are enforced',async()=>{
 await as(voter,'authenticated',async()=>{await trusted();await assert.rejects(()=>db.query('select public.archive_vote_summary($1,$2)',['question',Array(51).fill('apify-original')]),/Invalid vote list/);});
 await db.exec(`insert into private.community_suspensions values('${voter}')`);
 try{await as(voter,'authenticated',async()=>{await trusted();await assert.rejects(()=>archivedVote('question',1),/suspended/);});}finally{await db.exec('delete from private.community_suspensions');}
 await db.exec(`delete from public.policy_acceptances where user_id='${voter}'`);
 try{await as(voter,'authenticated',async()=>{await trusted();await assert.rejects(()=>archivedVote('question',1),/policies/);});}finally{await db.exec(`insert into public.policy_acceptances values('${voter}','2026-11-05-preview-v4')`);}
 await db.exec('begin');try{await db.query('insert into private.archive_votes values($1,$2,$3,1)',['question','apify-original',other]);await db.query('delete from auth.users where id=$1',[other]);assert.equal((await db.query('select count(*)::int as n from private.archive_votes')).rows[0].n,0);}finally{await db.exec('rollback');}
});

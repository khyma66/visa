import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const post='33333333-3333-4333-8333-333333333333',hidden='44444444-4444-4444-8444-444444444444';
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;create schema security_ingress;create schema cron;
 create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
 create table private.security_ingest_key(key_hash bytea);insert into private.security_ingest_key values(sha256(convert_to(repeat('ab',32),'UTF8')));
 create table public.questions(id uuid,status text,community_id uuid);create table public.communities(id uuid,is_public boolean,is_active boolean);
 insert into public.questions values('${post}','open',null),('${hidden}','archived',null);
 grant usage on schema public,security_ingress to anon;`);
 await db.exec(await readFile(new URL('../../supabase/migrations/20261105055658_post_view_counts.sql',import.meta.url),'utf8'));
});
after(()=>db.close());
async function as(key,role,fn){await db.exec('begin');try{await db.query("select set_config('request.headers',$1,true)",[JSON.stringify({'x-security-ingest-key':key})]);await db.exec(`set local role ${role}`);return await fn();}finally{await db.exec('rollback');}}
const read=ids=>db.query('select public.post_views($1) value',[ids]).then(r=>r.rows[0].value);
const write=(id,hash='cd'.repeat(32))=>db.query("select public.post_views($1,$2,(now() at time zone 'UTC')::date) value",[[id],hash]).then(r=>r.rows[0].value);
test('untrusted anonymous and member calls cannot read or inflate counts',async()=>{
 for(const role of ['anon','authenticated','service_role'])await as('',role,()=>assert.rejects(()=>read([post]),/Not authorized|permission denied/));
 await as('00'.repeat(32),'anon',()=>assert.rejects(()=>write(post),/Not authorized/));
});
test('only measured totals are returned; repeated opens increment once per signature and day',()=>as('ab'.repeat(32),'anon',async()=>{
 assert.deepEqual(await read([post]),[{post_id:post,views:0}]);
 assert.equal((await write(post))[0].views,1);assert.equal((await write(post))[0].views,1);
 assert.equal((await write(post,'ef'.repeat(32)))[0].views,2);
 assert.equal((await read([post]))[0].views,2);
 assert.equal((await write('apify-test'))[0].views,1);
}));
test('hidden, nonexistent and private community posts have no count and cannot be incremented',async()=>{
 await as('ab'.repeat(32),'anon',async()=>{assert.deepEqual(await write(hidden),[]);assert.deepEqual(await write('55555555-5555-4555-8555-555555555555'),[]);});
 await db.exec(`insert into public.communities values('${hidden}',false,true);update public.questions set community_id='${hidden}' where id='${post}';`);
 try{await as('ab'.repeat(32),'anon',async()=>{assert.deepEqual(await read([post]),[]);assert.deepEqual(await write(post),[]);});}
 finally{await db.exec(`update public.questions set community_id=null where id='${post}'`);}
});
test('clients cannot read signatures or alter aggregate totals directly',async()=>{
 for(const role of ['anon','authenticated','service_role'])for(const table of ['post_view_totals','post_view_dedup'])await as('ab'.repeat(32),role,()=>assert.rejects(()=>db.query(`select * from private.${table}`),/permission denied/));
});
test('invalid batches, signatures and stale dates cannot inflate counts',async()=>{
 for(const args of [[[],null,null],[Array(51).fill(post),null,null],[[post],'bad',new Date().toISOString().slice(0,10)],[[post],'ab'.repeat(32),'2020-01-01'],[[post,hidden],'ab'.repeat(32),new Date().toISOString().slice(0,10)]])
 await as('ab'.repeat(32),'anon',()=>assert.rejects(()=>db.query('select public.post_views($1,$2,$3)',args),/Invalid view request/));
});

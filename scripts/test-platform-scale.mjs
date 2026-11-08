import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
async function database(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema private;create schema extensions;create schema cron;
 create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
 -- Local crypto stub only; hosted digest is verified separately.
 create function extensions.digest(text,text) returns bytea language sql as $$select decode(md5($1)||md5($1),'hex')$$;
 create function private.security_require_owner() returns void language plpgsql as $$begin if current_setting('test.owner',true) is distinct from 'yes' then raise exception 'denied' using errcode='42501';end if;end$$;
 create table questions(id uuid primary key,status text,created_at timestamptz,post_kind text,experience_category text,search_document tsvector,tags text[],visa_type text,answer_count integer,vote_score integer,visible boolean default true);
 alter table questions enable row level security;create policy public_questions on questions for select using(visible);
 create view question_feed with(security_invoker=true) as select * from questions;
 create table imported_answers(question_id text,status text);
 grant select on questions,question_feed,imported_answers to anon,authenticated;
 grant usage on schema private to authenticated;`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261108231554_platform_scale_foundation.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261108233457_provider_capacity_metrics.sql',import.meta.url),'utf8'));
 return db;
}
test('mixed member/archive pages filter and rank before pagination while retaining RLS',async()=>{
 const db=await database();try{
 await db.exec(`insert into archive_posts(id,payload,created_at,tags,vote_score)
 select 'apify-'||i,jsonb_build_object('id','apify-'||i,'title','H1B documents','created_at',now()-i*interval '1 second'),now()-i*interval '1 second',array['h1b'],i from generate_series(1,65) i;
 insert into questions(id,status,created_at,post_kind,tags,visa_type,answer_count,vote_score)
 select ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'open',now()-i*interval '1 second','question',array['h1b'],'H-1B',0,i from generate_series(1,60) i;
 insert into archive_posts(id,payload,created_at,vote_score) values('apify-old','{"id":"apify-old"}',now()-interval '3 months',999999);
 insert into questions(id,status,created_at,post_kind,tags,answer_count,vote_score,visible) values(gen_random_uuid(),'open',now(),'question',array['h1b'],0,999999,false);
 set role anon;`);
 for(const sort of ['newest','score','activity']){
  let before=null;const ids=[];
  for(let i=0;i<4;i++){
   const rows=(await db.query('select * from platform_post_page(sort_mode=>$1,before_time=>$2,before_id=>$3,before_score=>$4)',[sort,before?.created_at??null,before?.id??null,before?.feed_rank??null])).rows.map(r=>Object.values(r)[0]);
   const page=rows.slice(0,50);ids.push(...page.map(r=>r.id));before=page.at(-1);if(rows.length<=50)break;
  }
  assert.equal(ids.length,125);assert.equal(new Set(ids).size,125);assert(!ids.includes('apify-old'));
 }
 const related=(await db.query("select * from platform_related_posts(query_tags=>array['h1b'])")).rows;
 assert.equal(related.length,5);
 await assert.rejects(db.query('select * from private.capacity_samples'),/permission denied/);
 await assert.rejects(db.query('select public.owner_capacity_dashboard()'),/permission denied/);
 await assert.rejects(db.query("select public.capacity_probe('incorrect')"),/Monitor access denied/);
 }finally{await db.close();}
});
test('capacity warnings escalate, recover with hysteresis, and require live owner authorization',async()=>{
 const db=await database();try{
 await db.exec('update private.capacity_settings set database_limit_bytes=1; select private.capacity_capture();');
 assert.equal((await db.query("select severity from private.capacity_alerts where metric='database_storage' and resolved_at is null")).rows[0].severity,'critical');
 await db.exec('update private.capacity_settings set database_limit_bytes=100000000000;select private.capacity_capture();');
 assert((await db.query("select resolved_at from private.capacity_alerts where metric='database_storage'")).rows[0].resolved_at);
 await db.exec('set role authenticated');
 await assert.rejects(db.query('select public.owner_capacity_dashboard()'),/denied/);
 await db.exec("set test.owner='yes'");
 const data=(await db.query('select public.owner_capacity_dashboard() as data')).rows[0].data;
 assert(data.sample.database_bytes>0);assert.equal(data.coverage.realtime,'not-connected');
 await db.query("select public.owner_capacity_limits(8000000000,500,'pro')");
 await assert.rejects(db.query("select public.owner_capacity_limits(-1,500,'pro')"),/Invalid capacity limits/);
 }finally{await db.close();}
});
test('100000 synthetic archive posts return bounded indexed recent pages', {timeout:120000},async()=>{
 const db=await database();try{
 await db.exec(`insert into archive_posts(id,payload,created_at,tags)
 select 'apify-'||i,jsonb_build_object('id','apify-'||i,'title','Synthetic H1B documents'),now()-i*interval '1 minute',array['h1b'] from generate_series(1,100000) i; analyze archive_posts; set role anon;`);
 const rows=(await db.query('select * from platform_post_page()')).rows;
 assert.equal(rows.length,51);
 const plan=await db.query("explain(format json) select id from archive_posts where status<>'archived' and created_at>=now()-interval '2 months' order by created_at desc,id desc limit 51");
 assert(JSON.stringify(plan.rows).includes('archive_posts_new'));
 }finally{await db.close();}
});

test('provider metrics alert on memory and measured CPU deltas; missing CPU stays unknown',async()=>{
 const db=await database();try{
 await db.query('select public.record_provider_capacity($1::jsonb)',[JSON.stringify({cpu_total:100,cpu_idle:80,memory_total:1000,memory_available:50})]);
 const first=(await db.query('select * from private.capacity_provider_samples')).rows[0];assert.equal(first.cpu_ratio,null);assert(Number(first.memory_ratio)>0.9);
 await db.exec("update private.capacity_provider_samples set at=now()-interval '2 minutes'");
 await db.query('select public.record_provider_capacity($1::jsonb)',[JSON.stringify({cpu_total:200,cpu_idle:85,memory_total:1000,memory_available:500})]);
 const next=(await db.query('select * from private.capacity_provider_samples order by at desc limit 1')).rows[0];assert.equal(Number(next.cpu_ratio),0.95);
 assert((await db.query("select resolved_at from private.capacity_alerts where metric='memory_usage'")).rows[0].resolved_at);
 await db.exec('set role anon');await assert.rejects(db.query("select public.record_provider_capacity('{}')"),/permission denied/);
 }finally{await db.close();}
});

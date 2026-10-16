import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const db = new PGlite({ extensions: { pg_trgm } });
const uid = n => `${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const [owner, alice, bob, carol, moderator, fixture, anonymous, deleted] = Array.from({length:8},(_,i)=>uid(i+1));
const ownerSession = uid(90), memberSession = uid(91);
const migration = '../../supabase/migrations/20261016210135_owner_analytics_aggregates.sql';
const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
const analytics = days => scalar('select public.owner_analytics($1)',[days ?? 7]);
const windowStart = "(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')-interval '6 days'";
async function asUser(user,fn,{role='authenticated',session=ownerSession,claims={}}={}) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user ?? '']);
    await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user,session_id:session,...claims})]);
    await db.exec(`set local role ${role}`);
    return await fn();
  } finally { await db.exec('rollback'); }
}
async function ownerAfter(change,fn) {
  await db.exec('begin');
  try {
    await change();
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
    await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:owner,session_id:ownerSession})]);
    await db.exec('set local role authenticated');
    return await fn();
  } finally { await db.exec('rollback'); }
}
before(async()=>{
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,is_anonymous boolean default false,deleted_at timestamptz,banned_until timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid(),auth.jwt() to anon,authenticated;
    create schema realtime; create table realtime.messages(topic text,extension text,payload jsonb);
    alter table realtime.messages enable row level security;
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
    create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$insert into realtime.messages values(topic,'broadcast',payload)$$;
    grant usage on schema realtime to authenticated; grant select on realtime.messages to authenticated;
    create publication supabase_realtime;`);
  for(const name of ['20260904032053_community_core.sql','20260907191603_secure_community_views.sql',
    '20260910031322_realtime_discovery_and_message_requests.sql','20260910034701_production_access_hardening.sql',
    '20260910055528_launch_safety_and_moderation.sql','20260911050812_community_write_guard_gaps.sql',
    '20261006044132_visa_experiences.sql','20261013191116_private_owner_feedback.sql'])
    await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8'));
  await db.exec(await readFile(new URL(migration,import.meta.url),'utf8'));
  for(const user of [owner,alice,bob,carol,moderator,fixture,anonymous,deleted])
    await db.query('insert into auth.users(id) values($1)',[user]);
  await db.query('insert into private.feedback_owner(user_id) values($1)',[owner]);
  await db.query('insert into private.community_moderators values($1)',[moderator]);
  await db.query("insert into private.analytics_excluded_users values($1,'test')",[fixture]);
  await db.query('update auth.users set is_anonymous=true where id=$1',[anonymous]);
  await db.query('update auth.users set deleted_at=now() where id=$1',[deleted]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2),($3,$4)',[ownerSession,owner,memberSession,alice]);
  await db.exec(`update public.profiles set created_at=${windowStart}-interval '40 days'`);
  await db.query(`update public.profiles set created_at=${windowStart}+interval '1 day' where id=$1`,[alice]);
  await db.query(`update public.profiles set created_at=${windowStart} where id=$1`,[carol]);
  const post = async(n,author,hours,{kind='question',status='open'}={}) => db.query(`insert into public.questions
    (id,author_id,title,body,post_kind,experience_category,status,created_at)
    values($1,$2,'A realistic visa question title','Private content must never appear in the analytics result.',$3,$4,$5,${windowStart}+make_interval(hours=>$6))`,
    [uid(100+n),author,kind,kind==='experience'?'Other':null,status,hours]);
  await post(1,alice,1); await post(2,alice,2); await post(3,bob,3);
  await post(4,carol,4,{kind:'experience'}); await post(5,bob,-1);
  await post(6,alice,200); await post(7,alice,10,{status:'archived'});
  for(const [n,user] of [[8,owner],[9,moderator],[10,fixture],[11,anonymous],[12,deleted]]) await post(n,user,0);
  const reply = async(q,author,hours,status='active')=>db.query(`insert into public.answers(question_id,author_id,body,status,created_at)
    values($1,$2,'Private reply text never belongs in aggregates.',$3,${windowStart}+make_interval(hours=>$4))`,[uid(100+q),author,status,hours]);
  await reply(1,bob,3); await reply(1,carol,5); await reply(2,alice,3); await reply(2,owner,3);
  await reply(2,bob,4,'archived'); await reply(3,alice,9); await reply(5,carol,10);
  await reply(4,bob,10); await reply(8,carol,10); await reply(7,carol,11);
  await reply(2,bob,200); await reply(2,bob,1);
  for(const [author,status] of [[carol,'active'],[carol,'active'],[bob,'active'],[bob,'archived'],[owner,'active'],[fixture,'active']])
    await db.query(`insert into public.imported_answers(question_id,author_id,body,status,created_at)
      values('apify-fixture',$1,'A member reply, not an imported source post.',$2,${windowStart}+interval '2 days')`,[author,status]);
  for(const [days,status] of [[2,'pending'],[3,'dismissed'],[-2,'pending'],[100,'pending']])
    await db.query(`insert into public.community_reports(reporter_id,target_kind,target_id,reason,status,created_at)
      values($1,'question',gen_random_uuid(),'other',$2,${windowStart}+make_interval(days=>$3))`,[alice,status,days]);
  for(const [days,status] of [[2,'new'],[3,'done'],[-2,'reviewing'],[100,'new']])
    await db.query(`insert into private.feedback_items(submitter_id,request_id,category,message,section,status,created_at)
      values($1,gen_random_uuid(),'other','Sensitive feedback must not leave this table.','home',$2,${windowStart}+make_interval(days=>$3))`,[alice,status,days]);
});
after(()=>db.close());

for(const role of ['anon','service_role']) {
  test(`${role} cannot execute analytics even with owner-shaped claims`,()=>asUser(owner,async()=>{
    await assert.rejects(()=>analytics(),/permission denied/);
  },{role}));
}
for(const user of [null,alice,moderator]) test(`${user ?? 'missing identity'} cannot obtain owner aggregates`,()=>asUser(user,async()=>{
  await assert.rejects(()=>analytics(),/Owner access required/);
}));
test('user metadata cannot spoof owner authorization',()=>asUser(alice,async()=>{
  await assert.rejects(()=>analytics(),/Owner access required/);
},{session:memberSession,claims:{user_metadata:{owner:true,role:'admin',user_id:owner}}}));
for(const session of [null,'invalid',uid(99),memberSession]) test(`owner session ${session} fails closed`,()=>asUser(owner,async()=>{
  await assert.rejects(()=>analytics(),/Owner access required/);
},{session}));
for(const [label,change] of [
  ['revoked session',()=>db.query('delete from auth.sessions where id=$1',[ownerSession])],
  ['expired session',()=>db.query('update auth.sessions set not_after=now() where id=$1',[ownerSession])],
  ['suspension',()=>db.query('insert into private.community_suspensions(user_id,moderator_id) values($1,$1)',[owner])],
  ['ban',()=>db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[owner])],
  ['deleted owner',()=>db.query('update auth.users set deleted_at=now() where id=$1',[owner])],
  ['anonymous owner',()=>db.query('update auth.users set is_anonymous=true where id=$1',[owner])],
  ['removed allowlist entry',()=>db.exec('delete from private.feedback_owner')],
]) test(`${label} immediately removes dashboard access`,()=>ownerAfter(change,async()=>{
  await assert.rejects(()=>analytics(),/Owner access required/);
}));
for(const days of [0,-1,8,365,2147483647,null]) test(`invalid window ${days} is rejected`,()=>asUser(owner,async()=>{
  await assert.rejects(()=>scalar('select public.owner_analytics($1)',[days]),/Choose a 7, 30 or 90/);
}));
for(const role of ['anon','authenticated','service_role']) test(`${role} cannot read or edit exclusions`,()=>asUser(owner,async()=>{
  await assert.rejects(()=>db.query('select * from private.analytics_excluded_users'),/permission denied/);
},{role}));
test('owner cannot self-enroll test accounts through the API',()=>asUser(owner,async()=>{
  await assert.rejects(()=>db.query("insert into private.analytics_excluded_users values($1,'test')",[alice]),/permission denied/);
}));
test('aggregates reconcile known rows, exclusion rules and human response quality',()=>asUser(owner,async()=>{
  const result=await analytics();
  assert.deepEqual(result.overview,{members_joined:2,questions_created:3,experiences_created:1,answers_created:7,imported_replies_created:3,distinct_contributors:3});
  assert.deepEqual(result.quality,{questions_in_window:3,questions_with_human_answer:2,answer_rate_percent:66.7,median_first_answer_hours:4,unanswered_questions_current:1});
  assert.deepEqual(result.operations,{reports_received:2,reports_pending_current:2,feedback_received:2,feedback_pending_current:2});
  assert.equal(result.schema_version,1); assert.equal(result.window.timezone,'UTC'); assert.equal(result.window.days,7);
  assert.equal(result.window.includes_partial_today,true); assert.equal(result.generated_at,result.window.end_exclusive);
  assert.equal(result.daily.length,7); assert(result.daily.every((day,i)=>i===0||day.date>result.daily[i-1].date));
  for(const field of ['members_joined','questions_created','experiences_created','answers_created','imported_replies_created'])
    assert.equal(result.daily.reduce((n,day)=>n+day[field],0),result.overview[field]);
  assert(result.daily.reduce((n,day)=>n+day.distinct_contributors,0)>result.overview.distinct_contributors);
  const serialized=JSON.stringify(result);
  for(const sensitive of [owner,alice,bob,carol,'Private','Sensitive','author_id','submitter_id','user_metadata']) assert(!serialized.includes(sensitive));
}));
for(const days of [7,30,90]) test(`${days} UTC days includes zero-filled days with bounded output`,()=>asUser(owner,async()=>{
  const result=await analytics(days);assert.equal(result.daily.length,days);
  const start=new Date(result.window.start_inclusive);assert.equal(start.getUTCHours(),0);
  assert.equal(result.daily[0].date,start.toISOString().slice(0,10));
  assert(result.daily.some(day=>day.distinct_contributors===0));
  assert(JSON.stringify(result).length<25000);
}));
test('UTC boundaries are inclusive at start and exclusive at current time regardless of caller timezone',()=>ownerAfter(async()=>{
  await db.exec("set local timezone='America/Los_Angeles'");
  await db.query(`insert into public.questions(author_id,title,body,created_at) values
    ($1,'Question exactly at window start','This precise boundary record must count in the period.',${windowStart}),
    ($1,'Question just before window start','This record belongs only in the inventory count.',${windowStart}-interval '1 microsecond'),
    ($1,'Question exactly at current time','This record is at the exclusive upper time bound.',now())`,[alice]);
},async()=>{
  const result=await analytics();assert.equal(result.overview.questions_created,4);
  assert.equal(result.quality.unanswered_questions_current,3);
}));
test('empty result uses null rates and latency, not fabricated zero success',()=>ownerAfter(async()=>{
  await db.exec('delete from public.answers; delete from public.questions; delete from public.imported_answers;');
},async()=>{
  const result=await analytics();assert.equal(result.overview.distinct_contributors,0);
  assert.equal(result.quality.answer_rate_percent,null);assert.equal(result.quality.median_first_answer_hours,null);
  assert(result.limitations.some(text=>text.includes('not an immutable event history')));
  assert(result.limitations.some(text=>text.includes('not measured')));
}));
test('migration has a private definer, invoker API, RLS, fixed search path and timeout',async()=>{
  const rows=(await db.query(`select n.nspname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='owner_analytics' order by n.nspname`)).rows;
  assert.deepEqual(rows.map(r=>[r.nspname,r.prosecdef]),[['private',true],['public',false]]);
  for(const row of rows){assert(row.proconfig.includes('search_path=""'));assert(row.proconfig.includes('statement_timeout=5s'));}
  assert.equal(await scalar("select relrowsecurity from pg_class where oid='private.analytics_excluded_users'::regclass"),true);
  assert.equal(await scalar("select has_function_privilege('anon','public.owner_analytics(integer)','EXECUTE')"),false);
  assert.equal(await scalar("select has_function_privilege('service_role','public.owner_analytics(integer)','EXECUTE')"),false);
});

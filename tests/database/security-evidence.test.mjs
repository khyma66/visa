import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite();
const [owner,member,moderator,subject,...peers]=Array.from({length:8},randomUUID);
const session=randomUUID(), token='ab'.repeat(32);
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const event={kind:'read_rate_limit',actor_hash:'cd'.repeat(32),route_group:'archive',decision:'limited',ray_id:'0123456789abcdef-DFW'};
before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema private;grant usage on schema private to authenticated;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz default now(),phone_confirmed_at timestamptz,created_at timestamptz default now()-interval '2 days',deleted_at timestamptz,banned_until timestamptz,is_anonymous boolean default false);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',nullif(current_setting('request.jwt.session',true),''))$$;
    create table private.feedback_owner(user_id uuid primary key);
    create table private.community_suspensions(user_id uuid primary key);
    create function private.feedback_is_owner() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from private.feedback_owner where user_id=auth.uid()) and not exists(select 1 from private.community_suspensions where user_id=auth.uid())$$;
    create table profiles(id uuid primary key,username text);
    create table questions(id uuid primary key default gen_random_uuid(),author_id uuid,title text,body text);
    create table answers(id uuid primary key default gen_random_uuid(),author_id uuid,body text);
    create table imported_answers(id uuid primary key default gen_random_uuid(),author_id uuid,body text);
    create table direct_messages(id uuid primary key default gen_random_uuid(),sender_id uuid,body text);
    create table community_reports(id uuid primary key default gen_random_uuid(),reporter_id uuid,target_kind text,target_id uuid,reason text default 'spam',details text not null default '',source text default 'member',created_at timestamptz default now(),status text default 'pending',unique(reporter_id,target_kind,target_id));`);
  for(const id of [owner,member,moderator,subject,...peers]){
    await db.query('insert into auth.users(id) values($1)',[id]);
    await db.query("insert into profiles values($1::uuid,'member-'||left($1::text,8))",[id]);
  }
  await db.query('insert into private.feedback_owner values($1)',[owner]);
  await db.query('insert into auth.sessions values($1,$2,null)',[session,owner]);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261104070127_security_evidence_console.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../../supabase/migrations/20261105060900_security_owner_account_status.sql',import.meta.url),'utf8'));
  await db.query("insert into private.security_ingest_key(singleton,key_hash) values(true,sha256(convert_to($1,'UTF8')))",[token]);
});
after(()=>db.close());
async function isolated(fn){await db.exec('begin');try{return await fn();}finally{await db.exec('rollback');}}
async function actor(uid=owner,role='authenticated',sid=session){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.session',$2,true)",[uid??'',sid??'']);await db.exec(`set local role ${role}`);}
const dashboard=(args=[])=>scalar(args.length?'select public.owner_security_dashboard($1,$2,$3,$4)':'select public.owner_security_dashboard()',args);
const deny=fn=>assert.rejects(fn,error=>error.code==='42501');
const ingress=payload=>scalar('select public.record_security_event($1)',[payload]);
async function headers(value=token){await db.query("select set_config('request.headers',$1,true)",[JSON.stringify({'x-security-ingest-key':value})]);}
async function report(reporter=member,target=subject,kind='member',source='member'){
  return scalar('insert into community_reports(reporter_id,target_id,target_kind,source) values($1,$2,$3,$4) returning id',[reporter,target,kind,source]);
}

for(const role of ['anon','authenticated','service_role']) test(`${role} cannot directly read or alter evidence tables`,()=>isolated(async()=>{
  await actor(member,role);
  await deny(()=>db.query('select * from private.security_report_evidence'));
}));
for(const [name,uid,role,sid] of [['anonymous',null,'anon',null],['member',member,'authenticated',session],['moderator',moderator,'authenticated',session],['missing session',owner,'authenticated',null],['forged session',owner,'authenticated',randomUUID()],['service role',owner,'service_role',session]]){
  test(`${name} cannot read owner dashboard`,()=>isolated(async()=>{await actor(uid,role,sid);await deny(()=>dashboard());}));
}
test('current owner can read bounded dashboard without member inboxes',()=>isolated(async()=>{
  await actor();const data=await dashboard();assert.deepEqual(data.traffic,[]);assert.deepEqual(data.reports,[]);assert.equal(data.ingest_key_configured,true);assert.equal(data.pending_alerts,0);
}));
for(const condition of ['expired','revoked','deleted','suspended','anonymous','banned']) test(`owner ${condition} is denied`,()=>isolated(async()=>{
  if(condition==='expired')await db.query("update auth.sessions set not_after=now()-interval '1 minute' where id=$1",[session]);
  if(condition==='revoked')await db.query('delete from auth.sessions where id=$1',[session]);
  if(condition==='deleted')await db.query('update auth.users set deleted_at=now() where id=$1',[owner]);
  if(condition==='suspended')await db.query('insert into private.community_suspensions values($1)',[owner]);
  if(condition==='anonymous')await db.query('update auth.users set is_anonymous=true where id=$1',[owner]);
  if(condition==='banned')await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[owner]);
  await actor();await deny(()=>dashboard());
}));
test('an expired auth ban does not block a current valid owner session',()=>isolated(async()=>{
  await db.query("update auth.users set banned_until=now()-interval '1 day' where id=$1",[owner]);
  await actor();assert.equal((await dashboard()).ingest_key_configured,true);
}));
test('public ingress needs its dedicated secret and grants no private schema access',()=>isolated(async()=>{
  await actor(null,'anon',null);assert.equal(await scalar("select has_schema_privilege('anon','private','usage')"),false);await deny(()=>ingress(event));
}));
test('forged secret cannot poison evidence',()=>isolated(async()=>{await actor(null,'anon',null);await headers('00'.repeat(32));await deny(()=>ingress(event));}));
for(const payload of [null,[],{...event,actor_hash:'raw-ip'},{...event,query:'private data'},{...event,kind:'anything'},{...event,ray_id:'x'.repeat(3000)}])test('ingress rejects non-allowlisted event data',()=>isolated(async()=>{
  await actor(null,'anon',null);await headers();await assert.rejects(()=>ingress(payload),error=>error.code==='22023');
}));
test('trusted edge aggregates observations and queues at most one daily alert',()=>isolated(async()=>{
  await actor(null,'anon',null);await headers();for(let i=0;i<6;i++)await ingress(event);
  await actor();const data=await dashboard();assert.equal(data.traffic.length,1);assert.equal(data.traffic[0].observations,6);assert.equal(data.pending_alerts,1);
  assert(!JSON.stringify(data).includes(token));
}));
test('ingress global cost cap drops excess observations',()=>isolated(async()=>{
  await db.query("insert into private.security_ingest_window values(true,date_trunc('minute',now()),120)");
  await actor(null,'anon',null);await headers();await ingress(event);await actor();assert.equal((await dashboard()).traffic.length,0);
}));
test('report captures only the reported message, survives edits/deletion and tracks disposition',()=>isolated(async()=>{
  const body='<script>not executable</script> reported message';
  const target=await scalar('insert into direct_messages(sender_id,body) values($1,$2) returning id',[subject,body]);
  await db.query("insert into direct_messages(sender_id,body) values($1,'OTHER UNREPORTED SECRET')",[subject]);
  const id=await report(member,target,'message');
  await db.query("update direct_messages set body='changed' where id=$1",[target]);await db.query('delete from direct_messages where id=$1',[target]);
  await db.query("update community_reports set status='removed' where id=$1",[id]);
  await db.query('delete from community_reports where id=$1',[id]);
  await actor();const data=await dashboard();assert.equal(data.reports[0].content_excerpt,body);assert.equal(data.reports[0].report_status,'removed');
  assert.equal(data.reports[0].content_sha256,createHash('sha256').update(body).digest('hex'));assert(!JSON.stringify(data).includes('OTHER UNREPORTED SECRET'));
}));
test('three distinct eligible peers flag review, not a suspension; fourth report deduplicates alert',()=>isolated(async()=>{
  for(const peer of peers)await report(peer);await actor();const data=await dashboard();assert.equal(data.repeat_members[0].distinct_reporters,4);assert.equal(data.pending_alerts,1);
  await db.exec('reset role');assert.equal(await scalar('select count(*)::int from private.community_suspensions'),0);
}));
for(const exclusion of ['new','unverified','suspended','self','automatic','dismissed','false_positive'])test(`${exclusion} reports do not meet escalation threshold`,()=>isolated(async()=>{
  await report(peers[0]);await report(peers[1]);
  if(exclusion==='new')await db.query('update auth.users set created_at=now() where id=$1',[peers[2]]);
  if(exclusion==='unverified')await db.query('update auth.users set email_confirmed_at=null where id=$1',[peers[2]]);
  if(exclusion==='suspended')await db.query('insert into private.community_suspensions values($1)',[peers[2]]);
  const id=await report(exclusion==='self'?subject:peers[2],subject,'member',exclusion==='automatic'?'automatic':'member');
  if(exclusion==='dismissed')await db.query("update community_reports set status='dismissed' where id=$1",[id]);
  if(exclusion==='false_positive')await db.query("update private.security_report_evidence set review_status='false_positive' where report_id=$1",[id]);
  await actor();assert.deepEqual((await dashboard()).repeat_members,[]);
}));
test('same reporter across multiple targets counts once',()=>isolated(async()=>{
  await report(member);const q=await scalar("insert into questions(author_id,title,body) values($1,'Question','Detail') returning id",[subject]);await report(member,q,'question');await actor();assert.deepEqual((await dashboard()).repeat_members,[]);
}));
test('reviews are audited and optimistic version prevents overwriting another decision',()=>isolated(async()=>{
  await report();await actor();let data=await dashboard();const id=data.reports[0].id;
  await db.query("select security_review('report',$1,1,'reviewing','Checking the evidence')",[id]);data=await dashboard();assert.equal(data.reports[0].version,2);assert.equal(data.review_history.length,1);
  await assert.rejects(()=>db.query("select security_review('report',$1,1,'resolved','A stale decision')",[id]),error=>error.code==='40001');
}));
test('members cannot write reviews',()=>isolated(async()=>{await report();const id=await scalar('select id from private.security_report_evidence limit 1');await actor(member);await deny(()=>db.query("select security_review('report',$1,1,'resolved','Cannot do this')",[id]));}));
test('keyset pagination does not skip reports sharing a timestamp',()=>isolated(async()=>{
  for(let i=0;i<53;i++)await report(member,randomUUID(),'question');await actor();const page=await dashboard();assert.equal(page.reports.length,50);const last=page.reports.at(-1);const next=await dashboard([null,null,last.reported_at,last.id]);assert.equal(next.reports.length,3);assert.equal(new Set([...page.reports,...next.reports].map(x=>x.id)).size,53);
}));
test('retention removes expired evidence, preserves fresh data, cannot be called by member',()=>isolated(async()=>{
  await report();await db.exec("update private.security_report_evidence set reported_at=now()-interval '91 days';select private.security_evidence_cleanup()");assert.equal(await scalar('select count(*)::int from private.security_report_evidence'),0);await report(peers[0]);await db.exec('select private.security_evidence_cleanup()');assert.equal(await scalar('select count(*)::int from private.security_report_evidence'),1);await actor(member);await deny(()=>db.exec('select private.security_evidence_cleanup()'));
}));

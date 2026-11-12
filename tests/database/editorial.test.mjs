import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111', author='22222222-2222-4222-8222-222222222222', outsider='33333333-3333-4333-8333-333333333333';
const session='99999999-9999-4999-8999-999999999999';
const source='https://www.facebook.com/groups/123456789';
const read=name=>readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8');
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const hash=text=>createHash('sha256').update(text).digest('hex');
const row=(n=1)=>({id:hash(`${source}/posts/${n}`),source_key:source,source_url:`${source}/posts/${n}`,source_posted_at:'2026-09-03T18:46:59Z',source_hash:'a'.repeat(64),run_id:'I0AI56pOzxvFHTz40',title:'H-1B extension question from a member',body:'A member asks about a pending H-1B extension and whether a transfer is possible.',visa_type:'H-1B',post_kind:'question',experience_category:'',tags:['h1b','extension'],review_flags:[],expected_revision:0});
before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema private;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz,deleted_at timestamptz,is_anonymous boolean default false,banned_until timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create table public.profiles(id uuid primary key references auth.users);
    create table private.feedback_owner(user_id uuid);
    create table private.community_suspensions(user_id uuid);
    create table public.policy_acceptances(user_id uuid,policy_version text);
    create table public.questions(id uuid primary key default gen_random_uuid(),author_id uuid references public.profiles,title text check(length(title) between 15 and 180),body text check(length(body) between 30 and 10000),destination_country text,visa_type text,tags text[],post_kind text,experience_category text);
    grant usage on schema public,private,auth to authenticated;grant usage on schema public to anon,service_role;
    create function private.community_consume(text,integer,integer) returns void language plpgsql as $$begin return;end$$;`);
  const guard=await read('20261103010757_public_alias_and_contact_policy_v3.sql');
  await db.exec(guard.match(/create or replace function private\.community_write_guard\(\)[\s\S]*?\$\$;/)[0]);
  await db.exec(`create trigger guard before insert on public.questions for each row execute function private.community_write_guard();`);
  await db.exec((await read('20261013191116_private_owner_feedback.sql')).match(/create function private\.feedback_is_owner\(\)[\s\S]*?\$\$;/)[0]);
  await db.exec((await read('20261018063832_owner_launch_workspace.sql')).match(/create function private\.launch_assert_owner\(\)[\s\S]*?\$\$;/)[0]);
  const migration=await read('20261104035529_reviewed_editorial_queue.sql');
  // Compile the exact migration, then use a fixed transaction clock in its functions for deterministic time-window tests.
  await db.exec(migration);
  for(const fn of migration.matchAll(/create function [\s\S]*?\$\$;/g)) await db.exec(fn[0].replace('create function','create or replace function').replaceAll('now()',"'2026-11-03T18:00:00Z'::timestamptz"));
  // pg_cron itself is unavailable in PGlite; only its documented job-control
  // surface is replaced. The shutdown function is compiled unchanged.
  await db.exec(`create schema cron;
    create table cron.job(jobid bigint primary key,jobname text unique,active boolean);
    create function cron.alter_job(job_id bigint,active boolean default null) returns void language sql as
      $$update cron.job set active=coalesce(alter_job.active,job.active) where jobid=job_id$$;
    insert into cron.job values(1,'visathreads-reviewed-editorial',false),(2,'unrelated-retention',true);`);
  await db.exec(await read('20261109052645_editorial_operator_shutdown.sql'));
  await db.exec(`create schema security_ingress;
    grant usage on schema security_ingress to anon;
    create table private.security_ingest_key(key_hash bytea);
    insert into private.security_ingest_key values(sha256(convert_to(repeat('ab',32),'UTF8')));
    create table public.communities(id uuid,is_public boolean,is_active boolean);
    alter table public.questions add column status text default 'open',add column community_id uuid;
    create function cron.schedule(text,text,text) returns bigint language sql as $$select 3::bigint$$;`);
  await db.exec(await read('20261105055658_post_view_counts.sql'));
  await db.exec(await read('20261109055326_editorial_tactical_views.sql'));
  const growthMigration=await read('20261110014343_editorial_gradual_view_growth.sql');
  await db.exec(growthMigration);
  // Freeze production's transaction clock only in this isolated test runtime.
  for(const fn of growthMigration.matchAll(/create (?:or replace )?function [\s\S]*?\$\$;/g))
    await db.exec(fn[0].replace(/create (?:or replace )?function/,'create or replace function').replaceAll('now()',"'2026-11-03T18:00:00Z'::timestamptz"));
  for(const id of [owner,author,outsider]) {
    await db.query("insert into auth.users values($1,'2026-01-01',null,false,null)",[id]);
    await db.query('insert into public.profiles values($1)',[id]);
    await db.query("insert into public.policy_acceptances values($1,'2026-11-02-preview-v3')",[id]);
  }
  await db.query('insert into private.feedback_owner values($1)',[owner]);
  await db.query('insert into auth.sessions values($1,$2,null)',[session,owner]);
});
after(()=>db.close());
async function transaction(fn){await db.exec('begin');try{return await fn();}finally{await db.exec('rollback');}}
test('publisher requires the current website policy without creating acceptance or enabling the queue',()=>transaction(async()=>{
  await db.query("insert into public.policy_acceptances values($1,'2026-11-05-preview-v4')",[author]);
  const currentPolicy=await read('20261105060304_post_view_privacy_notice_v4.sql');
  await db.exec(currentPolicy.match(/create or replace function private\.community_write_guard\(\)[\s\S]*?\$\$;/)[0]);
  await db.exec("create policy record_current_policy on public.policy_acceptances to authenticated with check (policy_version in ('2026-11-02-preview-v3','2026-11-05-preview-v4'))");
  await db.exec(await read('20261112042514_editorial_accept_current_policy.sql'));
  assert.equal(await scalar('select private.editorial_author_eligible($1)',[author]),true);
  assert.equal(await scalar('select private.editorial_author_eligible($1)',[outsider]),false);
  assert.equal(await scalar('select enabled from private.editorial_settings'),false);
  assert.equal(await scalar("select active from cron.job where jobname='visathreads-reviewed-editorial'"),false);
  assert.equal(await scalar('select count(*)::int from private.editorial_consents'),0);
}));
async function claims(user=owner,role='authenticated'){
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,true)",[user?JSON.stringify({sub:user,session_id:session}):'{}']);
  await db.exec(`set local role ${role}`);
}
const action=(operation,payload)=>scalar('select public.editorial_owner_action($1,$2)',[operation,JSON.stringify(payload)]);
const stage=async(n=1)=>{await claims();return action('stage',{items:[row(n)]});};
async function ready(n=1){
  await stage(n);
  await action('review',{id:row(n).id,revision:1,decision:'approved',facts_verified:true,reuse_basis:'Written permission from the original author to adapt this post.',review_note:'Dates and every claim checked against source.'});
  await db.exec('reset role');await db.query('update auth.sessions set user_id=$1',[author]);await claims(author);
  await scalar('select public.editorial_consent($1,true,30,1)',[source]);
  await db.exec('reset role');await db.query('update auth.sessions set user_id=$1',[owner]);await claims();
  await action('source',{source_key:source,enabled:true});
  await action('schedule',{id:row(n).id,revision:1,author_id:author,scheduled_at:'2026-11-03T18:00:00Z'});
  await action('controls',{enabled:true,confirmation:'START APPROVED PUBLISHING'});
  await db.exec('reset role');await claims(null,'postgres');
}
const tick=()=>scalar('select private.editorial_publish_due()');
for(const role of ['anon','authenticated','service_role']) test(`${role} cannot read drafts or invoke publisher`,()=>transaction(async()=>{
  await claims(outsider,role);
  await assert.rejects(()=>db.query('select * from private.editorial_drafts'),/permission denied/);
}));
for(const role of ['anon','authenticated','service_role']) test(`${role} cannot execute the publisher`,()=>transaction(async()=>{
  await claims(null,role);await assert.rejects(()=>db.query('select private.editorial_publish_due()'),/permission denied/);
}));
test('only a currently authenticated owner can stage or review',()=>transaction(async()=>{
  await claims(outsider);await assert.rejects(()=>action('stage',{items:[row()]}),/Owner access required/);
}));
test('revoked owner session denied',()=>transaction(async()=>{
  await db.exec('delete from auth.sessions');await claims();await assert.rejects(()=>action('list',{}),/Owner access required/);
}));
test('initial queue is paused and cannot publish',()=>transaction(async()=>{
  await claims(null,'postgres');assert.deepEqual(await tick(),{status:'paused'});assert.equal(await scalar('select count(*)::int from public.questions'),0);
}));
test('stage stores private drafts and does not approve or publish',()=>transaction(async()=>{
  const [result]=await stage();assert.equal(result.status,'draft');assert.equal(result.revision,1);
  const list=await action('list',{});assert.equal(list.items[0].approved_by,null);assert.equal(list.settings.enabled,false);
}));
test('source ID must match canonical URL',()=>transaction(async()=>{
  await claims();await assert.rejects(()=>action('stage',{items:[{...row(),id:'b'.repeat(64)}]}),/Invalid draft/);
}));
test('stale CSV revision cannot replace a draft',()=>transaction(async()=>{
  await stage();await assert.rejects(()=>action('stage',{items:[row()]}),/Draft changed/);
}));
test('editing a reviewed draft clears approval and assignment',()=>transaction(async()=>{
  await ready();await claims();const [updated]=await action('stage',{items:[{...row(),expected_revision:1,body:'A member asks a changed question about the H-1B extension process.'}]});
  assert.equal(updated.revision,2);const item=(await action('list',{})).items[0];assert.equal(item.status,'draft');assert.equal(item.approved_revision,null);assert.equal(item.author_id,null);
}));
test('approval needs an explicit source reuse basis and fact review',()=>transaction(async()=>{
  await stage();await assert.rejects(()=>action('review',{id:row().id,revision:1,decision:'approved'}),/Approval requires/);
}));
test('cannot assign an email or account without its own consent',()=>transaction(async()=>{
  await stage();await action('review',{id:row().id,revision:1,decision:'approved',facts_verified:true,reuse_basis:'Written permission from original author.',review_note:'Verified the source and draft.'});
  await assert.rejects(()=>action('schedule',{id:row().id,revision:1,author_id:author,scheduled_at:'2026-11-03T18:00:00Z'}),/permission unavailable/);
}));
test('publish uses assigned author, preserves attribution/date and is idempotent',()=>transaction(async()=>{
  await ready();const result=await tick();assert.equal(result.status,'published');
  const q=(await db.query('select * from public.questions')).rows[0];assert.equal(q.author_id,author);assert.match(q.body,/Originally shared on 2026-09-03/);assert.match(q.body,/Source: https:\/\/www.facebook.com/);
  await tick();assert.equal(await scalar('select count(*)::int from public.questions'),1);
}));
for(const [label,change] of [
  ['revoked consent','update private.editorial_consents set enabled=false'],
  ['expired consent',"update private.editorial_consents set expires_at='2026-11-01'"],
  ['changed consent','update private.editorial_consents set version=version+1'],
  ['paused source','update private.editorial_sources set enabled=false'],
  ['deleted author',`update auth.users set deleted_at='2026-11-01' where id='${author}'`],
  ['unverified email',`update auth.users set email_confirmed_at=null where id='${author}'`],
  ['banned author',`update auth.users set banned_until='2027-01-01' where id='${author}'`],
  ['suspended author',`insert into private.community_suspensions values('${author}')`],
  ['missing policy',`delete from public.policy_acceptances where user_id='${author}'`],
  ['new policy',"update private.editorial_settings set policy_version='future-policy'"],
  ['revoked owner','delete from private.feedback_owner'],
  ['stale approval','update private.editorial_drafts set revision=revision+1'],
  ['expired schedule',"update private.editorial_drafts set scheduled_at='2026-11-01'"],
]) test(`${label} blocks before any post is inserted`,()=>transaction(async()=>{
  await ready();await db.exec(change);assert.equal((await tick()).status,'blocked');assert.equal(await scalar('select count(*)::int from public.questions'),0);
}));
test('pause prevents a valid approved job from publishing',()=>transaction(async()=>{
  await ready();await claims();await action('controls',{enabled:false});await claims(null,'postgres');assert.equal((await tick()).status,'paused');
}));
test('enable needs the explicit confirmation string',()=>transaction(async()=>{
  await claims();await assert.rejects(()=>action('controls',{enabled:true}),/Explicit publishing confirmation/);
}));
test('public content failure rolls back post and marks queue for review',()=>transaction(async()=>{
  await ready();await db.exec("alter table public.questions add constraint deny_test check(false)");
  assert.equal((await tick()).status,'blocked');assert.equal(await scalar('select count(*)::int from public.questions'),0);
  assert.equal(await scalar('select question_id from private.editorial_drafts'),null);
}));
test('daily author limit and global gap prevent bursts',()=>transaction(async()=>{
  await ready();assert.equal((await tick()).status,'published');
  await ready(2);assert.equal((await tick()).status,'spacing');
  await db.exec('update private.editorial_settings set last_published_at=null');assert.equal((await tick()).status,'author_budget');
  await db.exec('update private.editorial_settings set daily_limit=1');assert.equal((await tick()).status,'budget');
}));
test('withdrawal immediately invalidates scheduled jobs',()=>transaction(async()=>{
  await ready();await db.query('update auth.sessions set user_id=$1',[author]);await claims(author);
  await scalar('select public.editorial_consent($1,false,30,1)',[source]);await db.exec('reset role');
  assert.equal(await scalar('select status from private.editorial_drafts'),'blocked');
}));
test('duplicate source text cannot create a second website post',()=>transaction(async()=>{
  await ready();assert.equal((await tick()).status,'published');await ready(2);
  await db.exec('update private.editorial_settings set last_published_at=null');await db.exec('update private.editorial_consents set daily_limit=3');
  assert.equal((await tick()).status,'blocked');assert.equal(await scalar('select count(*)::int from public.questions'),1);
}));
for(const role of ['anon','authenticated','service_role']) for(const fn of ['editorial_operator_status','editorial_stop_all'])
  test(`${role} cannot invoke operator ${fn}`,()=>transaction(async()=>{
    await claims(null,role);await assert.rejects(()=>db.query(`select private.${fn}()`),/permission denied/);
  }));
test('complete shutdown disables only this timer and invalidates queued assignments',()=>transaction(async()=>{
  await ready();await db.exec("update cron.job set active=true where jobid=1");
  const state=await scalar('select private.editorial_stop_all()');
  assert.equal(state.enabled,false);assert.equal(state.timer_active,false);
  assert.equal(state.enabled_sources,0);assert.equal(state.enabled_consents,0);assert.equal(state.scheduled_posts,0);
  assert.equal(await scalar('select active from cron.job where jobid=2'),true);
  assert.deepEqual(await scalar('select jsonb_build_object(\'status\',status,\'author\',author_id,\'slot\',scheduled_at) from private.editorial_drafts'),{status:'blocked',author:null,slot:null});
  assert.equal((await tick()).status,'paused');assert.equal(await scalar('select count(*)::int from public.questions'),0);
  const version=await scalar('select version from private.editorial_consents');
  await scalar('select private.editorial_stop_all()');
  assert.equal(await scalar('select version from private.editorial_consents'),version);
}));
test('shutdown preserves published posts and their duplicate-prevention receipts',()=>transaction(async()=>{
  await ready();assert.equal((await tick()).status,'published');
  const state=await scalar('select private.editorial_stop_all()');
  assert.equal(state.published_posts,1);assert.equal(await scalar('select count(*)::int from public.questions'),1);
  assert.equal(await scalar('select status from private.editorial_drafts'),'published');
}));
const display=async id=>{
  await db.query("select set_config('request.headers',$1,true)",[JSON.stringify({'x-security-ingest-key':'ab'.repeat(32)})]);
  return (await scalar('select public.post_views($1)',[[id]]))[0]?.views;
};
test('tactical posts start at zero and keep a stable growth profile while measured analytics remain intact',()=>transaction(async()=>{
  await ready();const result=await tick();assert.equal(result.status,'published');
  const seed=await scalar('select starting_views from private.editorial_view_seeds');
  assert(seed>=500&&seed<=2500);assert.equal(await display(result.question_id),0);
  assert.equal(await display(result.question_id),0);assert.equal(await scalar('select count(*)::int from private.post_view_totals'),0);
  const counted=await scalar("select public.post_views($1,repeat('cd',32),(now() at time zone 'UTC')::date)",[[result.question_id]]);
  assert.equal(counted[0].views,1);assert.equal(await scalar('select views::int from private.post_view_totals'),1);
  assert.equal((await tick()).status,'spacing');assert.equal(await scalar('select count(*)::int from private.editorial_view_seeds'),1);
}));
test('ordinary posts are never seeded and tactical overrides can be disabled and restored without rerolling',()=>transaction(async()=>{
  await ready();const result=await tick();const seed=await display(result.question_id);
  const storedSeed=await scalar('select starting_views from private.editorial_view_seeds');
  await db.query("insert into public.questions(id,author_id,title,body) values($1,$2,'An ordinary member question','This ordinary member question must keep measured views only.')",['44444444-4444-4444-8444-444444444444',author]);
  assert.equal(await display('44444444-4444-4444-8444-444444444444'),0);
  assert.equal(await display('apify-unrelated'),0);
  await scalar('select private.editorial_configure_tactical_views(false)');assert.equal(await display(result.question_id),0);
  await scalar('select private.editorial_configure_tactical_views(true)');assert.equal(await display(result.question_id),seed);
  const status=await scalar('select private.editorial_stop_all()');assert.equal(status.tactical_views.active,false);
  assert.equal(await display(result.question_id),0);assert.equal(await scalar('select starting_views from private.editorial_view_seeds'),storedSeed);
}));
test('view configuration is dormant until publishing starts and supports inclusive 500 and 2500 bounds',()=>transaction(async()=>{
  const initial=await scalar('select private.editorial_operator_status()');
  assert.deepEqual(initial.tactical_views,{configured:true,active:false,minimum:500,maximum:2500,seeded_posts:0});
  await scalar('select private.editorial_configure_tactical_views(true,500,500)');
  await ready();await tick();assert.equal(await scalar('select starting_views from private.editorial_view_seeds'),500);
  await scalar('select private.editorial_configure_tactical_views(true,2500,2500)');
  await ready(2);await db.exec("update private.editorial_drafts set source_hash=repeat('b',64),body=body||' Additional source question.' where id<>'"+row().id+"';update private.editorial_consents set daily_limit=3;update private.editorial_settings set last_published_at=null");
  assert.equal((await tick()).status,'published');assert.equal(await scalar('select max(starting_views) from private.editorial_view_seeds'),2500);
}));
test('disabled tactical mode never seeds a newly published post',()=>transaction(async()=>{
  await scalar('select private.editorial_configure_tactical_views(false)');await ready();const result=await tick();
  assert.equal(result.status,'published');assert.equal(await scalar('select count(*)::int from private.editorial_view_seeds'),0);
  await scalar('select private.editorial_configure_tactical_views(true)');assert.equal(await display(result.question_id),0);
}));
for(const role of ['anon','authenticated','service_role']) for(const query of [
  'select * from private.editorial_view_seeds','select private.editorial_configure_tactical_views(true)',
  "select private.editorial_display_views('anything',0)",
]) test(`${role} cannot access tactical view configuration: ${query}`,()=>transaction(async()=>{
  await claims(null,role);await assert.rejects(()=>db.query(query),/permission denied/);
}));
test('tactical projection retains the ingress-key guard',()=>transaction(async()=>{
  await ready();const result=await tick();
  await db.query("select set_config('request.headers','{}',true)");
  await assert.rejects(()=>scalar('select public.post_views($1)',[[result.question_id]]),/Not authorized/);
}));
for(const args of [[true,499,2500],[true,500,2501],[true,1500,1000],[null,500,2500]])
  test(`invalid tactical view range is denied: ${JSON.stringify(args)}`,()=>transaction(async()=>{
    await claims(null,'postgres');
    await assert.rejects(()=>scalar('select private.editorial_configure_tactical_views($1,$2,$3)',args),/range within/);
  }));
const curve=(hours,freezeHours=336,settleHours=240)=>scalar(`select private.editorial_growth_at(
  '2026-11-03T18:00:00Z','2026-11-03T18:00:00Z'::timestamptz+make_interval(hours=>$2),
  '2026-11-03T18:00:00Z'::timestamptz+make_interval(hours=>$3),500,2000,4800,
  '2026-11-03T18:00:00Z'::timestamptz+make_interval(mins=>$1))`,[hours*60,freezeHours,settleHours]);
test('growth reaches two-hour and twelve-hour milestones, slows down and eventually stops',()=>transaction(async()=>{
  assert.equal(await curve(0),0);assert.equal(await curve(2),500);assert.equal(await curve(12),2000);
  const day=await curve(24),week=await curve(168),settled=await curve(240);
  assert(day>2000&&day<3000);assert(week>day&&week<=4800);assert.equal(settled,4800);
  assert.equal(await curve(720),settled);assert.equal(await curve(-1),0);
  let previous=0;
  for(let hour=1;hour<=336;hour++) {const value=await curve(hour);assert(value>=previous);assert(value-previous<=250);assert(value<=5000);previous=value;}
}));
test('campaign expiry freezes curves without accelerating late posts to their target',()=>transaction(async()=>{
  assert.equal(await curve(100,6),await curve(6,6));
  assert.equal(await curve(100,0),0);
}));
test('the unchanged view RPC returns gradual milestone counts without rerolling the stored profile',()=>transaction(async()=>{
  await ready();const result=await tick();
  await db.exec("update private.editorial_view_growth set started_at=started_at-interval '2 hours',settles_at=settles_at-interval '2 hours'");
  const checkpoint=await scalar('select two_hour_views from private.editorial_view_growth');
  assert.equal(await display(result.question_id),checkpoint);assert.equal(await display(result.question_id),checkpoint);
  await db.exec("update private.editorial_view_growth set started_at=started_at-interval '10 hours',settles_at=settles_at-interval '10 hours'");
  assert.equal(await display(result.question_id),await scalar('select twelve_hour_views from private.editorial_view_growth'));
  assert.equal(await scalar('select count(*)::int from private.post_view_totals'),0);
}));
test('only first activation starts the two-week window; off/on never renews it',()=>transaction(async()=>{
  let state=await scalar('select private.editorial_operator_status()');assert.equal(state.tactical_growth.started_at,null);
  await ready();const result=await tick();state=await scalar('select private.editorial_operator_status()');
  assert.equal(Date.parse(state.tactical_growth.ends_at)-Date.parse(state.tactical_growth.started_at),336*3600000);
  const before=state.tactical_growth;
  await scalar('select private.editorial_stop_all()');await claims();
  await action('controls',{enabled:true,confirmation:'START APPROVED PUBLISHING'});await claims(null,'postgres');
  state=await scalar('select private.editorial_operator_status()');assert.equal(state.tactical_growth.ends_at,before.ends_at);
  const profile=await scalar('select to_jsonb(g) from private.editorial_view_growth g');
  assert.equal(profile.post_id,result.question_id);assert(profile.final_views>=4200&&profile.final_views<=5000);
  assert.equal(profile.freeze_at,before.ends_at);
}));
test('tactical display has a hard 5000 cap while real totals and ordinary posts are uncapped',()=>transaction(async()=>{
  await ready();const result=await tick();await db.query('insert into private.post_view_totals values($1,6001)',[result.question_id]);
  assert.equal(await display(result.question_id),5000);assert.equal(await scalar('select views::int from private.post_view_totals'),6001);
  assert.equal(await scalar("select private.editorial_display_views('apify-unrelated',6001)"),6001);
  await scalar('select private.editorial_stop_all()');assert.equal(await display(result.question_id),6001);
}));
test('a publication after campaign expiry receives zero synthetic growth',()=>transaction(async()=>{
  await ready();await db.exec("update private.editorial_settings set tactical_growth_started_at='2026-10-01',tactical_growth_ends_at='2026-10-15'");
  const result=await tick();assert.equal(result.status,'published');
  const profile=await scalar('select to_jsonb(g) from private.editorial_view_growth g');
  assert.equal(profile.started_at,profile.freeze_at);assert.equal(await display(result.question_id),0);
}));
for(const role of ['anon','authenticated','service_role']) test(`${role} cannot read growth profiles or mutate the campaign`,()=>transaction(async()=>{
  await claims(null,role);await assert.rejects(()=>db.query('select * from private.editorial_view_growth'),/permission denied/);
}));
for(const role of ['anon','authenticated','service_role']) test(`${role} cannot extend the campaign deadline`,()=>transaction(async()=>{
  await claims(null,role);await assert.rejects(()=>db.query("update private.editorial_settings set tactical_growth_ends_at=now()+interval '1 year'"),/permission denied/);
}));
test('a stored profile cannot exceed the approved 5000 ceiling',()=>transaction(async()=>{
  await ready();await tick();await assert.rejects(()=>db.query('update private.editorial_view_growth set final_views=5001'),/check constraint/);
}));

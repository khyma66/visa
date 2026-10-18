import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import ts from 'typescript';

const db = new PGlite({ extensions: { pg_trgm } });
const uid = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const owner=uid(1), member=uid(2), moderator=uid(3), ownerSession=uid(90), memberSession=uid(91);
const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
const workspace=()=>scalar('select public.owner_launch_workspace()');
const history=(kind,id)=>scalar('select public.owner_launch_history($1,$2)',[kind,id]);
const update=(id,version,status='done',evidence='Reviewed actual verification evidence for this task.')=>scalar(
  'select public.owner_launch_task_update($1,$2,$3,$4,$5,$6)',[id,version,status,evidence,'Owner','2026-11-01']);
const experiment={title:'Contributor onboarding experiment',hypothesis:'Recruiting answerers improves genuine reply coverage.',
  start_on:'2026-10-18',end_on:'2026-11-18',cash_cost_usd:50,founder_hours:8,hour_value_usd:40,
  attributable_contribution_usd:null,decision:'observe',notes:'Measure before attributing any contribution.'};
const save=(id,version,input=experiment)=>scalar('select public.owner_launch_experiment_save($1,$2,$3)',[id,version,input]);
async function asUser(user,fn,{role='authenticated',session=ownerSession,claims={},prepare}={}) {
  await db.exec('begin');
  try {
    if(prepare) await prepare();
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user??'']);
    await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user,session_id:session,...claims})]);
    await db.exec(`set local role ${role}`);
    return await fn();
  } finally {await db.exec('rollback');}
}
async function rejected(fn,pattern) {
  await db.exec('savepoint expected_failure');
  await assert.rejects(fn,pattern);
  await db.exec('rollback to expected_failure');
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
    '20261006044132_visa_experiences.sql','20261013191116_private_owner_feedback.sql',
    '20261018063832_owner_launch_workspace.sql'])
    await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8'));
  for(const user of [owner,member,moderator]) await db.query('insert into auth.users(id) values($1)',[user]);
  await db.query('insert into private.feedback_owner(user_id) values($1)',[owner]);
  await db.query('insert into private.community_moderators values($1)',[moderator]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2),($3,$4)',[ownerSession,owner,memberSession,member]);
});
after(()=>db.close());

test('seeded task contract matches the UI and records no fictitious completion',()=>asUser(owner,async()=>{
  const {outputText}=ts.transpileModule(await readFile(new URL('../../src/lib/launch-workspace.ts',import.meta.url),'utf8'),
    {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
  const {LAUNCH_TASK_DEFINITIONS}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
  const result=await workspace();
  assert.equal(result.schema_version,1); assert.equal(result.tasks.length,16); assert.deepEqual(result.experiments,[]);
  for(const expected of LAUNCH_TASK_DEFINITIONS) {
    const row=result.tasks.find(task=>task.id===expected.id);
    for(const [key,value] of Object.entries(expected)) assert.deepEqual(row[key],value);
    assert.equal(row.status,'backlog'); assert.equal(row.evidence,''); assert.equal(row.completed_at,null);
  }
}));
for(const role of ['anon','service_role']) test(`${role} cannot call any launch RPC with owner-shaped claims`,()=>asUser(owner,async()=>{
  for(const fn of [workspace,()=>update('L01',1),()=>save(uid(100),0),()=>history('task','L01')])
    await rejected(fn,/permission denied/);
},{role}));
for(const user of [null,member,moderator]) test(`${user??'missing identity'} cannot obtain or change owner workspace`,()=>asUser(user,async()=>{
  for(const fn of [workspace,()=>update('L01',1),()=>save(uid(100),0),()=>history('task','L01')])
    await rejected(fn,/Owner access required/);
}));
test('editable user metadata does not grant owner access',()=>asUser(member,()=>assert.rejects(workspace,/Owner access required/),
  {session:memberSession,claims:{user_metadata:{owner:true,role:'owner'}}}));
for(const session of [null,'invalid',memberSession,uid(99)]) test(`invalid, foreign or revoked session ${session} is denied`,()=>asUser(owner,async()=>{
  await rejected(workspace,/Owner access required/); await rejected(()=>update('L01',1),/Owner access required/);
},{session}));
for(const [name,sql] of [
  ['revoked',`delete from auth.sessions where id='${ownerSession}'`],
  ['expired',`update auth.sessions set not_after=now()-interval '1 second' where id='${ownerSession}'`],
  ['banned',`update auth.users set banned_until=now()+interval '1 day' where id='${owner}'`],
  ['deleted',`update auth.users set deleted_at=now() where id='${owner}'`],
  ['anonymous',`update auth.users set is_anonymous=true where id='${owner}'`],
  ['suspended',`insert into private.community_suspensions(user_id,moderator_id) values('${owner}','${moderator}')`],
]) test(`${name} owner has no workspace access`,()=>asUser(owner,()=>assert.rejects(workspace,/Owner access required/),{prepare:()=>db.exec(sql)}));

test('dependencies, completion evidence, reopen ordering and optimistic versions are enforced',()=>asUser(owner,async()=>{
  await rejected(()=>update('L02',1),/Complete dependencies/);
  await rejected(()=>update('L01',1,'done','not enough'),/Completion requires evidence/);
  let task=await update('L01',1); assert.equal(task.version,2); assert(task.completed_at);
  assert.equal((await history('task','L01')).length,1);
  await rejected(()=>update('L01',1),/changed/);
  assert.equal((await history('task','L01')).length,1);
  await update('L02',1);
  await rejected(()=>update('L01',2,'in_review'),/Reopen completed dependents/);
  await update('L02',2,'in_review'); task=await update('L01',2,'in_review');
  assert.equal(task.completed_at,null); assert.equal(task.version,3);
  const audit=await history('task','L01'); assert.equal(audit.length,2);
  assert.equal(audit[0].snapshot.status,'in_review'); assert.equal(audit[1].snapshot.status,'done');
  assert(!JSON.stringify(audit).includes(owner)); assert.equal(audit[0].action,'task_update');
}));
test('owner cannot mutate table data, task definitions or immutable audit history directly',()=>asUser(owner,async()=>{
  await update('L01',1);
  for(const table of ['launch_tasks','launch_experiments','launch_events']) {
    await rejected(()=>db.exec(`select * from private.${table}`),/permission denied/);
    await rejected(()=>db.exec(`delete from private.${table}`),/permission denied/);
  }
  await rejected(()=>db.exec("update private.launch_tasks set dependencies='{}' where id='L02'"),/permission denied/);
}));
test('audit trigger blocks alteration even under table owner privileges',async()=>{
  await db.exec('begin');
  try {
    await db.query("insert into private.launch_events(entity_kind,entity_id,actor_id,action,snapshot) values('task','L01',$1,'task_update','{}')",[owner]);
    await rejected(()=>db.exec('update private.launch_events set snapshot=\'{}\''),/append-only/);
    await rejected(()=>db.exec('delete from private.launch_events'),/append-only/);
  }finally{await db.exec('rollback');}
});
test('unknown attributable contribution stays null; genuine zero is independently saved and audited',()=>asUser(owner,async()=>{
  const id=uid(100); let row=await save(id,0); assert.equal(row.attributable_contribution_usd,null);
  assert.equal(row.currency,'USD'); assert.equal(row.version,1);
  row=await save(id,1,{...experiment,attributable_contribution_usd:0,decision:'fix'});
  assert.equal(row.attributable_contribution_usd,0); assert.equal(row.version,2);
  const audit=await history('experiment',id); assert.equal(audit.length,2);
  assert.equal(audit[0].snapshot.attributable_contribution_usd,0); assert.equal(audit[1].snapshot.attributable_contribution_usd,null);
  await rejected(()=>save(id,1),/changed/); await rejected(()=>save(id,0),/changed/);
  assert.equal((await workspace()).experiments.length,1);
  assert.equal((await history('experiment',id)).length,2);
}));
test('invalid, excessive or unexpected experiment fields are rejected',()=>asUser(owner,async()=>{
  for(const patch of [{currency:'INR'},{cash_cost_usd:-1},{cash_cost_usd:'1'},{cash_cost_usd:1000000001},
    {founder_hours:100001},{hour_value_usd:100001},{attributable_contribution_usd:'unknown'},
    {end_on:'2026-10-01'},{start_on:'2026-02-30'},{title:'x'},{hypothesis:'x'},
    {decision:'approve'},{notes:'x'.repeat(5001)},{launch_approved:true},{title:null}])
    await rejected(()=>save(uid(101),0,{...experiment,...patch}),/Invalid|constraint|out of range|field value/);
  await rejected(()=>save(uid(101),0,{...experiment,attributable_contribution_usd:undefined}),/Invalid/);
  assert.deepEqual((await workspace()).experiments,[]);
}));
test('read/history scopes remain bounded and invalid filters do not leak data',()=>asUser(owner,async()=>{
  await rejected(()=>history('users','anything'),/Invalid history/);
  await rejected(()=>history('task','x'.repeat(65)),/Invalid history/);
  assert.deepEqual(await history('task','missing'),[]);
  assert.equal((await workspace()).tasks.length,16);
}));
test('experiment creation is capped without preventing updates to existing records',()=>asUser(owner,async()=>{
  await rejected(()=>save(uid(301),0),/experiment limit/);
  const row=await save(uid(200),1,{...experiment,decision:'stop'});
  assert.equal(row.version,2); assert.equal((await workspace()).experiments.length,100);
},{prepare:async()=>{
  for(let i=0;i<100;i++)await db.query(`insert into private.launch_experiments(id,title,hypothesis,start_on,end_on,cash_cost_usd,founder_hours,hour_value_usd)
    values($1,'Bounded experiment','A measured experiment hypothesis','2026-10-18','2026-11-18',0,0,0)`,[uid(200+i)]);
}}));
test('audit returns latest 100 revisions only and never includes actor identifiers',()=>asUser(owner,async()=>{
  const rows=await history('task','L01'); assert.equal(rows.length,100);
  assert(rows.every((row,index)=>index===0 || rows[index-1].id>row.id));
  assert(rows.every(row=>!Object.hasOwn(row,'actor_id')));
},{prepare:()=>db.query(`insert into private.launch_events(entity_kind,entity_id,actor_id,action,snapshot)
  select 'task','L01',$1,'task_update',jsonb_build_object('version',n) from generate_series(1,105)n`,[owner])}));
test('new private tables and functions have explicit least-privilege settings',async()=>{
  for(const table of ['launch_tasks','launch_experiments','launch_events'])
    assert.equal(await scalar('select relrowsecurity from pg_class where oid=$1::regclass',[`private.${table}`]),true);
  const functions=(await db.query(`select n.nspname,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.proname like 'owner_launch_%' order by n.nspname,p.proname`)).rows;
  assert.equal(functions.length,8);
  for(const fn of functions) {assert.equal(fn.prosecdef,fn.nspname==='private');assert(fn.proconfig.includes('search_path=""'));}
  assert.equal(await scalar("select has_function_privilege('anon','public.owner_launch_workspace()','EXECUTE')"),false);
  assert.equal(await scalar("select has_function_privilege('service_role','public.owner_launch_workspace()','EXECUTE')"),false);
  assert.equal(await scalar("select has_function_privilege('authenticated','private.launch_assert_owner()','EXECUTE')"),false);
});

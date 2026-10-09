// Application migrations run in an isolated PostgreSQL engine; hosted Auth and
// Realtime transport are represented by interfaces only. No production writes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const migration = await readFile(new URL('../supabase/migrations/20261006045523_public_community_lifecycle.sql', import.meta.url), 'utf8');
test('community upgrade preserves current policy, avatar and experience contracts', {timeout:60000}, async () => {
  const db = await baseDatabase();
  const owner = randomUUID();
  try {
    await db.exec("alter table auth.users add column raw_user_meta_data jsonb default '{}'::jsonb");
    for (const name of ['20261004221850_policy_acceptance_receipts.sql', '20261006042952_public_avatar_initials.sql',
      '20261006043113_avatar_name_policy_v2.sql', '20261006044132_visa_experiences.sql'])
      await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)', [owner, JSON.stringify({first_name:'Alice',last_name:'PrivateSurname'})]);
    const guard = (await db.query("select pg_get_functiondef('private.community_write_guard()'::regprocedure) definition")).rows[0].definition;
    await db.exec(migration);
    await db.exec(await readFile(new URL('../supabase/migrations/20261006051458_bounded_community_reads.sql', import.meta.url), 'utf8'));
    assert.equal((await db.query("select pg_get_functiondef('private.community_write_guard()'::regprocedure) definition")).rows[0].definition, guard);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec('set role authenticated');
    const create = () => db.query("select public.create_public_community('preview-group','Preview group','A community with enough detail for a compatibility test.','United States','General') id");
    await assert.rejects(create, /acknowledge/);
    await db.query("insert into policy_acceptances(user_id,policy_version,market,terms_accepted,privacy_acknowledged,adult_confirmed) values($1,'2026-10-06-preview-v2','US',true,true,true)", [owner]);
    const group = (await create()).rows[0].id;
    const post = (await db.query("insert into questions(author_id,title,body,post_kind,experience_category,community_id) values($1,'My interview experience','An actual interview experience with sufficient detail for this test.','experience','Other',$2) returning id", [owner,group])).rows[0].id;
    assert.equal((await db.query('select * from my_community_directory_page()')).rows[0].id, group);
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.exec('set role anon');
    const result = (await db.query("select * from community_post_page(filter_kind=>'experience')")).rows[0];
    assert.equal(result.id, post); assert.equal(result.community_id, group); assert.equal(result.experience_category, 'Other');
    assert.match(result.author_avatar_seed, /^initial:A:/); assert(!JSON.stringify(result).includes('PrivateSurname'));
    assert.equal((await db.query('select * from community_question_page()')).rows.length, 0);
    assert.equal((await db.query('select * from community_group_question_page($1)', [group])).rows[0].id, post);
    await db.exec('reset role');
    await db.query('update communities set is_public=false where id=$1', [group]);
    await db.exec('set role anon');
    assert.equal((await db.query("select * from community_post_page(filter_kind=>'experience')")).rows.length, 0);
    assert.equal((await db.query('select * from community_group_question_page($1)', [group])).rows.length, 0);
  } finally { await db.close(); }
});
async function baseDatabase() {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    create schema realtime; create table realtime.messages(topic text,extension text,payload jsonb);
    alter table realtime.messages enable row level security;
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
    create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$insert into realtime.messages values(topic,'broadcast',payload);$$;
    grant usage on schema realtime to authenticated; grant select on realtime.messages to authenticated;
    create publication supabase_realtime;
    -- Legacy community catalog (public.users is NOT automatically synced by Auth).
    create table public.users(id uuid primary key);
    create table public.communities(id uuid primary key default gen_random_uuid(),name varchar(100) unique not null,display_name varchar(100) not null,
      slug varchar(100) unique not null,description text,country varchar(50),category varchar(50),rules text[],moderators uuid[],
      member_count integer default 0,is_public boolean default true,is_active boolean default true,created_at timestamptz default now());
    create table public.community_members(id uuid primary key default gen_random_uuid(),community_id uuid references public.communities(id) on delete cascade,
      user_id uuid references public.users(id) on delete cascade,role varchar(20) default 'member',joined_at timestamptz default now(),is_active boolean default true,unique(community_id,user_id));
    grant all on public.communities,public.community_members to anon,authenticated,service_role;
    create policy "Public communities are viewable by everyone" on public.communities for select using(is_active=true);
    create policy "Authenticated users can join communities" on public.community_members for insert with check(auth.uid()=user_id);
    create policy "Users can view their community memberships" on public.community_members for select using(auth.uid()=user_id);`);
  for (const name of ['20260904032053_community_core.sql','20260907191603_secure_community_views.sql',
    '20260910031322_realtime_discovery_and_message_requests.sql','20260910034701_production_access_hardening.sql',
    '20260910035131_imported_comment_discovery.sql','20260910055528_launch_safety_and_moderation.sql',
    '20260911050812_community_write_guard_gaps.sql','20260928164013_community_membership_access_hardening.sql',
    '20260928164317_revoke_client_table_administration.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url),'utf8'));
  }
  return db;
}

test('public community lifecycle and question isolation', {timeout:60000}, async t => {
  const db=await baseDatabase();
  const [owner,member,outsider,suspended,rateUser]=Array.from({length:5},randomUUID);
  const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
  async function actor(id,role='authenticated') {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);
    if(role) await db.exec(`set role ${role}`);
  }
  const root=()=>actor(null,null);
  const create=(slug='h1b-dallas',overrides={})=>{
    const v={slug,name:'Dallas H1B members',description:'Discuss H1B appointments and experiences in Dallas.',country:'United States',category:'Work visas',rules:['Be respectful'],...overrides};
    return scalar('select public.create_public_community($1,$2,$3,$4,$5,$6)',[v.slug,v.name,v.description,v.country,v.category,v.rules]);
  };
  const count=id=>scalar('select member_count from public.community_directory where id=$1',[id]);
  const question=(group,author=member)=>scalar(`insert into public.questions(author_id,title,body,community_id) values($1,'Community question about visa appointments','Can anyone explain the appointment process for this visa category?',$2) returning id`,[author,group]);
  let group,privateGroup,inactiveGroup,groupQuestion,answer;
  try {
    await db.exec(migration);
    for(const id of [owner,member,outsider,suspended,rateUser]) await db.query('insert into auth.users values($1)',[id]);
    privateGroup=await scalar("insert into public.communities(name,slug,display_name,is_public) values('private','private','Private',false) returning id");
    inactiveGroup=await scalar("insert into public.communities(name,slug,display_name,is_active) values('inactive','inactive','Inactive',false) returning id");
    await db.query('insert into private.community_suspensions(user_id,moderator_id) values($1,$2)',[suspended,owner]);

    await t.test('authenticated creator owns a new public community and count starts at one',async()=>{
      await actor(owner); group=await create('  H1B-Dallas  ');
      assert.equal(await count(group),1);
      assert.deepEqual((await db.query('select role,is_active from public.community_members where community_id=$1',[group])).rows,[{role:'owner',is_active:true}]);
      assert.equal(await scalar('select slug from public.community_directory where id=$1',[group]),'h1b-dallas');
      assert.equal(await scalar('select created_by from public.community_directory where id=$1',[group]),owner);
      await root(); assert.equal(await scalar('select count(*)::integer from public.users'),0);
    });
    await t.test('anonymous directory excludes private and inactive communities',async()=>{
      await actor(null,'anon'); assert.deepEqual((await db.query('select id from public.community_directory')).rows,[{id:group}]);
    });
    await t.test('anonymous and missing-subject creation are rejected',async()=>{
      await assert.rejects(()=>create('anonymous'),/permission denied/);
      await actor(null); await assert.rejects(()=>create('missing-user'),/Authentication required/);
    });
    await t.test('forged authenticated subject without a profile is rejected',async()=>{
      await actor(randomUUID()); await assert.rejects(()=>create('fake-user'),/foreign key|Registered profile/);
    });
    for(const [name,overrides] of [
      ['short slug',{slug:'hi'}],['long slug',{slug:'a'.repeat(41)}],['invalid slug',{slug:'foo_bar'}],['double hyphen',{slug:'foo--bar'}],
      ['short name',{name:'x'}],['long name',{name:'x'.repeat(81)}],['short description',{description:'short'}],['long description',{description:'x'.repeat(501)}],
      ['empty country',{country:''}],['long country',{country:'x'.repeat(81)}],['invalid category',{category:'Spam'}],['too many rules',{rules:Array(6).fill('rule')}],['long rule',{rules:['x'.repeat(201)]}],['null rule',{rules:[null]}]]) {
      await t.test(`invalid ${name} rejected`,async()=>{await actor(member);await assert.rejects(()=>create('invalid-test',overrides));});
    }
    await t.test('case-insensitive duplicate slug rejected atomically',async()=>{
      await actor(member); await assert.rejects(()=>create('H1B-DALLAS'),e=>e.code==='23505');assert.equal(await count(group),1);
    });
    await t.test('join, duplicate join, leave, duplicate leave and rejoin keep exact counts',async()=>{
      await actor(member); await db.query('select public.join_public_community($1)',[group]);assert.equal(await count(group),2);
      await db.query('select public.join_public_community($1)',[group]);assert.equal(await count(group),2);
      await db.query('select public.leave_public_community($1)',[group]);assert.equal(await count(group),1);
      await db.query('select public.leave_public_community($1)',[group]);assert.equal(await count(group),1);
      await db.query('select public.join_public_community($1)',[group]);assert.equal(await count(group),2);
      assert.equal(await scalar('select role from public.community_members where community_id=$1',[group]),'member');
    });
    await t.test('owner cannot leave and duplicate join never downgrades owner',async()=>{
      await actor(owner);await assert.rejects(()=>db.query('select public.leave_public_community($1)',[group]),/Owners cannot leave/);
      await db.query('select public.join_public_community($1)',[group]);assert.equal(await scalar('select role from public.community_members where community_id=$1',[group]),'owner');
    });
    await t.test('private and inactive groups cannot be joined',async()=>{
      await actor(outsider);for(const id of [privateGroup,inactiveGroup,randomUUID()]) await assert.rejects(()=>db.query('select public.join_public_community($1)',[id]),/unavailable/);
    });
    for(const [name,sql,args] of [
      ['self-appointed owner',"insert into public.community_members(community_id,user_id,role) values($1,$2,'owner')",()=>[group,outsider]],
      ['direct ordinary join',"insert into public.community_members(community_id,user_id) values($1,$2)",()=>[group,outsider]],
      ['role escalation',"update public.community_members set role='owner'",()=>[]],
      ['counter tampering',"update public.communities set member_count=9999",()=>[]],
      ['membership deletion',"delete from public.community_members",()=>[]],
      ['group truncation',"truncate public.communities cascade",()=>[]],
      ['direct create',"insert into public.communities(name,slug,display_name) values('bad','bad','Bad')",()=>[]],
    ]) await t.test(`${name} is denied`,async()=>{await actor(outsider);await assert.rejects(()=>db.query(sql,args()),e=>e.code==='42501');});
    await t.test('members see only their own membership rows',async()=>{
      await actor(member);assert.deepEqual((await db.query('select user_id from public.community_members')).rows,[{user_id:member}]);
    });
    await t.test('suspended account cannot create, join or leave',async()=>{
      await actor(suspended);await assert.rejects(()=>create('suspended-group'),/suspended/);
      for(const fn of ['join','leave']) await assert.rejects(()=>db.query(`select public.${fn}_public_community($1)`,[group]),/suspended/);
    });
    await t.test('banned and suspended memberships cannot reactivate themselves',async()=>{
      await root();await db.query("insert into public.community_members(community_id,user_id,role,is_active) values($1,$2,'banned',false)",[group,outsider]);
      await actor(outsider);await assert.rejects(()=>db.query('select public.join_public_community($1)',[group]),/unavailable/);
      await root();await db.query("update public.community_members set role='suspended' where community_id=$1 and user_id=$2",[group,outsider]);
      await actor(outsider);await assert.rejects(()=>db.query('select public.join_public_community($1)',[group]),/unavailable/);
    });
    await t.test('member can ask a group question and global questions still work',async()=>{
      await actor(member);groupQuestion=await question(group);await question(null);
      assert.equal(await scalar('select community_id from public.question_feed where id=$1',[groupQuestion]),group);
      answer=await scalar('insert into public.answers(question_id,author_id,body) values($1,$2,$3) returning id',[groupQuestion,member,'This is an answer with sufficient content for the group test.']);
    });
    await t.test('outsider, private group and inactive group questions are rejected',async()=>{
      await actor(outsider);await assert.rejects(()=>question(group,outsider),/Join this community/);
      for(const id of [privateGroup,inactiveGroup]) await assert.rejects(()=>question(id,outsider),/unavailable/);
    });
    await t.test('author cannot reassign a question to another community',async()=>{
      await actor(member);await assert.rejects(()=>db.query('update public.questions set community_id=null where id=$1',[groupQuestion]),e=>e.code==='42501');
      await root();await assert.rejects(()=>db.query('update public.questions set community_id=null where id=$1',[groupQuestion]),/cannot be moved/);
    });
    await t.test('public community questions and answers are readable without membership',async()=>{
      await actor(null,'anon');assert.equal(await scalar('select count(*)::integer from public.question_feed where id=$1',[groupQuestion]),1);
      assert.equal(await scalar('select count(*)::integer from public.answer_feed where id=$1',[answer]),1);
    });
    for(const state of ['private','inactive']) await t.test(`group made ${state} hides questions and answers from all public read paths`,async()=>{
      await root();await db.query(state==='private'?'update public.communities set is_public=false where id=$1':'update public.communities set is_active=false where id=$1',[group]);
      for(const id of [null,member]) {
        await actor(id,id?'authenticated':'anon');
        for(const table of ['questions','question_feed']) assert.equal(await scalar(`select count(*)::integer from public.${table} where id=$1`,[groupQuestion]),0);
        for(const table of ['answers','answer_feed']) assert.equal(await scalar(`select count(*)::integer from public.${table} where id=$1`,[answer]),0);
        assert.equal(await scalar("select count(*)::integer from public.community_question_page() where id=$1",[groupQuestion]),0);
      }
      await root();await db.query('update public.communities set is_public=true,is_active=true where id=$1',[group]);
    });
    await t.test('leaving prevents new group questions without hiding existing public discussion',async()=>{
      await actor(member);await db.query('select public.leave_public_community($1)',[group]);await assert.rejects(()=>question(group),/Join this community/);
      assert.equal(await scalar('select count(*)::integer from public.question_feed where id=$1',[groupQuestion]),1);
    });
    await t.test('create limit permits three communities per UTC day then rejects the fourth',async()=>{
      await actor(rateUser);for(let n=0;n<3;n++) await create(`rate-group-${n}`);
      await assert.rejects(()=>create('rate-group-4'),/Too many requests/);
    });
    await t.test('trusted member removal reconciles count while RPCs cannot abuse counters',async()=>{
      await root();await db.query('delete from public.community_members where community_id=$1 and user_id=$2',[group,outsider]);
      assert.equal(await count(group),1);
      const {rows}=await db.query('select c.id,c.member_count,count(m.id)::integer as actual from public.communities c left join public.community_members m on m.community_id=c.id and m.is_active is true group by c.id having c.member_count<>count(m.id)');
      assert.deepEqual(rows,[]);
    });
    await t.test('new trigger helpers cannot be called by API roles and directory uses invoker security',async()=>{
      await root();for(const role of ['anon','authenticated']) for(const name of ['community_member_count_change','guard_question_community']) assert.equal(await scalar('select has_function_privilege($1,$2,$3)',[role,`private.${name}()`,'execute']),false);
      assert.equal(await scalar("select reloptions @> array['security_invoker=true'] from pg_class where oid='public.community_directory'::regclass"),true);
    });
    await t.test('future policy guard changes still apply to community creation and membership',async()=>{
      await root();const original=await scalar("select pg_get_functiondef('private.community_write_guard()'::regprocedure)");
      await db.exec(`create or replace function private.community_write_guard() returns trigger language plpgsql security definer set search_path='' as $$begin if (select auth.uid()) is not null then raise exception 'Current policies must be accepted'; end if; return new; end;$$;`);
      await actor(member);await assert.rejects(()=>create('needs-policy'),/policies/);
      await assert.rejects(()=>db.query('select public.join_public_community($1)',[group]),/policies/);
      await root();await db.exec(original);
    });
  } finally { await db.close(); }
});

test('migration rejects unknown legacy identities without silently losing members',{timeout:60000},async()=>{
  const db=await baseDatabase();
  try {
    const user=randomUUID();await db.query('insert into public.users values($1)',[user]);
    const group=(await db.query("insert into public.communities(name,slug,display_name) values('legacy','legacy','Legacy') returning id")).rows[0].id;
    await db.query('insert into public.community_members(community_id,user_id) values($1,$2)',[group,user]);
    await assert.rejects(()=>db.exec(migration),/identity reconciliation/);await db.exec('rollback');
    assert.equal((await db.query('select count(*)::integer as n from public.community_members')).rows[0].n,1);
  } finally {await db.close();}
});

// Simulate an independently deployed view extension so this migration cannot
// silently discard newer fields or weaken existing row filters.
test('migration preserves newer question feed columns and predicates',{timeout:60000},async()=>{
  const db=await baseDatabase();
  try {
    const prior=(await db.query("select pg_get_viewdef('public.question_feed'::regclass,true) as sql")).rows[0].sql.replace(/;\s*$/,'');
    await db.exec(`create or replace view public.question_feed with(security_invoker=true) as select v.*,char_length(v.title) as title_length from (${prior}) v where v.title not like 'Operator hidden%';`);
    await db.exec(migration);
    const user=randomUUID();await db.query('insert into auth.users values($1)',[user]);
    await db.query("insert into public.questions(author_id,title,body) values($1,'Operator hidden question about visas','This private moderation test has enough content for its body.'),($1,'Visible question about visa process','This visible test question has enough content for its body.')",[user]);
    await db.exec('set role anon');
    const {rows}=await db.query('select title_length,community_id from public.question_feed');
    assert.deepEqual(rows,[{title_length:'Visible question about visa process'.length,community_id:null}]);
  } finally {await db.close();}
});

test('migration reconciles valid legacy memberships and atomic count changes',{timeout:60000},async()=>{
  const db=await baseDatabase();
  try {
    const user=randomUUID();await db.query('insert into auth.users values($1)',[user]);await db.query('insert into public.users values($1)',[user]);
    const group=(await db.query("insert into public.communities(name,slug,display_name,member_count) values('old-group','old-group','Old group',987) returning id")).rows[0].id;
    await db.query('insert into public.community_members(community_id,user_id) values($1,$2)',[group,user]);
    await db.exec(migration);
    const count=async()=>(await db.query('select member_count from public.communities where id=$1',[group])).rows[0].member_count;
    assert.equal(await count(),1);
    await db.query('update public.community_members set is_active=false where user_id=$1',[user]);assert.equal(await count(),0);
    await db.query('update public.community_members set is_active=true where user_id=$1',[user]);assert.equal(await count(),1);
    await db.query('delete from public.community_members where user_id=$1',[user]);assert.equal(await count(),0);
    await assert.rejects(()=>db.query("insert into public.communities(name,slug,display_name,description,country,category,rules,created_by) values('bad-rules','bad-rules','Bad rules','Description long enough to satisfy other constraints','Worldwide','General',$1,$2)",[['a'.repeat(201)],user]),e=>e.code==='23514');
  } finally {await db.close();}
});

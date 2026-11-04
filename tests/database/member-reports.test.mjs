import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
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
    await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url),'utf8'));
  }
  return db;
}

test('member reports, owner review and community names enforce server boundaries', {timeout:60000}, async t => {
  const db = await baseDatabase();
  const [owner, member, spammer, outsider, moderator] = Array.from({length:5}, randomUUID);
  const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
  async function actor(id, role='authenticated') {
    await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? '']);
    if (role) await db.exec(`set role ${role}`);
  }
  const root=()=>actor(null,null);
  const apply=async name=>db.exec(await readFile(new URL(`../../supabase/migrations/${name}.sql`,import.meta.url),'utf8'));
  let conversation, legacy;
  const report=(id=conversation,reason='spam',details='Suspicious payment requests')=>scalar('select report_community_member($1,$2,$3)',[id,reason,details]);
  const queue=()=>scalar('select community_moderation_queue()');
  async function isolated(fn) { await root(); await db.exec('begin'); try { await fn(); } finally { await db.exec('rollback'); } }
  try {
    await apply('20261006045523_public_community_lifecycle');
    await apply('20261006051458_bounded_community_reads');
    await apply('20261013191116_private_owner_feedback');
    for(const id of [owner,member,spammer,outsider,moderator]) await db.query('insert into auth.users values($1)',[id]);
    await db.query("update profiles set username='reported-member' where id=$1",[spammer]);
    await db.query('insert into private.feedback_owner(user_id) values($1)',[owner]);
    await db.query('insert into private.community_moderators values($1)',[moderator]);
    conversation=await scalar('insert into direct_conversations(user_one_id,user_two_id) values(least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid)) returning id',[member,spammer]);
    await db.query("insert into direct_messages(conversation_id,sender_id,body) values($1,$2,'PRIVATE UNREPORTED MESSAGE')",[conversation,spammer]);
    legacy=await scalar("insert into communities(name,display_name,slug) values('h1b-visa','H-1B Visa Holders','h1b-visa') returning id");
    await apply('20261104042956_member_reports_and_community_names');
    await t.test('migration preserves IDs and URLs while normalizing existing names',async()=>{
      assert.deepEqual((await db.query('select id,slug,display_name from communities where id=$1',[legacy])).rows[0],{id:legacy,slug:'h1b-visa',display_name:'H1BVisaHolders'});
    });
    for (const role of ['anon','service_role']) await t.test(`${role} cannot submit reports`,()=>isolated(async()=>{
      await actor(member,role); await assert.rejects(()=>report(),/permission denied/);
    }));
    for (const who of [null,outsider]) await t.test(`${who ? 'outsider' : 'missing session'} cannot report another conversation`,()=>isolated(async()=>{
      await actor(who);await assert.rejects(()=>report(),/Authentication|Conversation unavailable/);
    }));
    await t.test('missing conversation cannot target an arbitrary account',()=>isolated(async()=>{
      await actor(member);await assert.rejects(()=>report(spammer),/Conversation unavailable/);
    }));
    for (const [reason,details] of [[null,''],['invalid',''],['spam','x'.repeat(1001)]]) await t.test('invalid report input is rejected',()=>isolated(async()=>{
      await actor(member);await assert.rejects(()=>report(conversation,reason,details),/Invalid report/);
    }));
    await t.test('duplicate requests persist one report, infer counterpart and do not consume extra quota',()=>isolated(async()=>{
      await actor(member); const id=await report();for(let i=0;i<12;i++)assert.equal(await report(),id);
      assert.equal((await db.query('select target_id from community_reports')).rows[0].target_id,spammer);
      await root();assert.equal(await scalar("select used from private.community_rate_windows where user_id=$1 and action='report'",[member]),1);
    }));
    await t.test('reporting works after blocking',()=>isolated(async()=>{
      await actor(member);await db.query("select respond_to_conversation($1,'blocked')",[conversation]);assert(await report());
    }));
    await t.test('suspended account cannot report',()=>isolated(async()=>{
      await db.query('insert into private.community_suspensions(user_id,moderator_id) values($1,$2)',[member,owner]);
      await actor(member);await assert.rejects(()=>report(),/suspended/);
    }));
    await t.test('members cannot read or resolve reports, nor see another reporter data',()=>isolated(async()=>{
      await actor(member); const id=await report();await assert.rejects(()=>queue(),/Moderator access/);
      // Failed statement aborts this transaction, so resolution checks use separate tests below.
    }));
    await t.test('reported member cannot see reports about them',()=>isolated(async()=>{
      await actor(member);await report();await actor(spammer);assert.equal(await scalar('select count(*)::int from community_reports'),0);
    }));
    await t.test('members cannot resolve reports',()=>isolated(async()=>{
      await actor(member);const id=await report();await assert.rejects(()=>db.query("select moderate_community_report($1,'dismissed')",[id]),/Moderator access/);
    }));
    for(const reviewer of [owner,moderator])await t.test('owner and approved moderator see account, reason and details without conversation text',()=>isolated(async()=>{
      await actor(member);const id=await report();await actor(reviewer);const rows=await queue();assert.equal(rows[0].id,id);assert.equal(rows[0].content,'u/reported-member');assert.equal(rows[0].reason,'spam');assert.equal(rows[0].details,'Suspicious payment requests');assert(!JSON.stringify(rows).includes('PRIVATE UNREPORTED MESSAGE'));
    }));
    for (const decision of ['dismissed','suspended']) await t.test(`owner can mark member report ${decision}`,()=>isolated(async()=>{
      await actor(member);const id=await report();await actor(owner);await db.query('select moderate_community_report($1,$2)',[id,decision]);assert.equal((await queue()).length,0);
      await root();assert.equal(await scalar('select status from community_reports where id=$1',[id]),decision);assert.equal(await scalar('select count(*)::int from private.community_suspensions where user_id=$1',[spammer]),decision==='suspended'?1:0);
      assert.equal(await scalar('select body from direct_messages where conversation_id=$1',[conversation]),'PRIVATE UNREPORTED MESSAGE');
    }));
    await t.test('member reports cannot use remove-content action',()=>isolated(async()=>{
      await actor(member);const id=await report();await actor(owner);await assert.rejects(()=>db.query("select moderate_community_report($1,'removed')",[id]),/Choose dismiss or suspend/);
    }));
    await t.test('old message reports still reveal only their explicitly reported message',()=>isolated(async()=>{
      const mid=await scalar('select id from direct_messages where conversation_id=$1',[conversation]);await actor(member);
      await db.query("select report_community_content('message',$1,'spam','')",[mid]);await actor(owner);assert.equal((await queue())[0].content,'PRIVATE UNREPORTED MESSAGE');
    }));
    await t.test('creation normalizes names and preserves searchable membership',()=>isolated(async()=>{
      await actor(member);const id=await scalar("select create_public_community('work-together','Work Visa Friends','Discuss visa work experiences and helpful guidance.','United States','General')");
      assert.equal(await scalar('select display_name from community_directory where id=$1',[id]),'WorkVisaFriends');
      for(const term of ['work visa','WorkVisa','work-together'])assert.equal((await db.query('select * from my_community_directory_page($1)',[term])).rows[0].id,id);
    }));
    await t.test('new duplicate names are rejected case-insensitively',()=>isolated(async()=>{
      await actor(member);await assert.rejects(()=>db.query("select create_public_community('another-address','h1b visa holders','Discuss visa work experiences and helpful guidance.','United States','General')"),/duplicate key/);
    }));
    await t.test('invalid symbol-only names cannot be written directly',()=>isolated(async()=>{
      await assert.rejects(()=>db.query("insert into communities(name,display_name,slug) values('bad-name','!!!','bad-name')"),/letters or numbers/);
    }));
  } finally { await db.close(); }
});

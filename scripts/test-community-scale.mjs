// Query-plan regression only: local, serial PostgreSQL/WASM is not a hosted
// capacity benchmark. Bulk fixture loading skips write hooks; reads use real RLS.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url),'utf8'));
  }
  return db;
}

const publicGroup='10000000-0000-0000-0000-000000000001';
const hiddenGroup='10000000-0000-0000-0000-000000010000';
const user='20000000-0000-0000-0000-000000000001';
const other='20000000-0000-0000-0000-000000000002';
const walk=node=>[node,...(node.Plans??[]).flatMap(walk)];

test('bounded community reads against 10000 groups and 100000 questions',{timeout:120000},async t=>{
  const db=await baseDatabase();
  const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
  async function actor(id,role='authenticated') {
    await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);
    if(role) await db.exec(`set role ${role}`);
  }
  const root=()=>actor(null,null);
  const explain=async(sql,args=[])=>{
    const row=(await db.query(`explain(analyze,format json,buffers) ${sql}`,args)).rows[0];return Object.values(row)[0][0];
  };
  try {
    await db.exec(await readFile(new URL('../supabase/migrations/20261006045523_public_community_lifecycle.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261006051458_bounded_community_reads.sql',import.meta.url),'utf8'));
    await db.query('insert into auth.users values($1),($2)',[user,other]);
    // Deterministic, synthetic data; no production content. Skipping trigger work
    // during fixture loading keeps this a read-plan test, not an ingestion test.
    await db.exec(`set session_replication_role=replica;
      insert into public.communities(id,name,slug,display_name,description,country,category,member_count)
        select ('10000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'group-'||lpad(i::text,5,'0'),'group-'||lpad(i::text,5,'0'),
          'Community '||i,'A synthetic community for query-plan checks only.',case when i%2=0 then 'United States' else 'Worldwide' end,
          case when i%100=0 then 'Study' else 'General' end,1 from generate_series(1,10000) i;
      insert into public.community_members(community_id,user_id,role,is_active)
        select id,'${user}'::uuid,'member',true from public.communities where slug<='group-05000';
      insert into public.community_members(community_id,user_id,role,is_active)
        values('${hiddenGroup}','${user}','member',true);
      insert into public.community_members(community_id,user_id,role,is_active)
        select id,'${other}'::uuid,'member',true from public.communities where slug between 'group-08000' and 'group-08049';
      insert into public.questions(id,author_id,title,body,community_id,created_at,tags)
        select ('30000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'${user}'::uuid,
          'Synthetic visa question number '||i,'A synthetic question body used only for isolated query planning.',
          case when i<=50000 then '${publicGroup}'::uuid else ('10000000-0000-0000-0000-'||lpad((2+i%9998)::text,12,'0'))::uuid end,
          '2026-01-01T00:00:00Z'::timestamptz+((i/3)::text||' seconds')::interval,
          case when i%1000=0 then array['rare-topic'] else array['general'] end from generate_series(1,100000) i;
      update public.communities set is_public=false where id='${hiddenGroup}';
      set session_replication_role=origin;
      analyze public.communities;analyze public.community_members;analyze public.questions;analyze public.profiles;`);

    await t.test('own communities are bounded, cursor-paged and actor-scoped',async()=>{
      await actor(user);
      const first=(await db.query('select * from public.my_community_directory_page()')).rows;
      assert.equal(first.length,25);assert.equal(first[0].slug,'group-00001');
      const next=(await db.query('select * from public.my_community_directory_page(after_slug=>$1)',[first[23].slug])).rows;
      assert.equal(next[0].slug,'group-00025');assert.equal(new Set([...first.slice(0,24),...next].map(x=>x.id)).size,49);
      assert.equal(await scalar('select count(*)::integer from public.my_community_directory_page(result_limit=>999999)'),25);
      assert.equal(await scalar('select count(*)::integer from public.my_community_directory_page(result_limit=>1)'),2);
      assert.equal(await scalar("select count(*)::integer from public.my_community_directory_page(query_text=>'group-10000')"),0);
      await actor(other);const theirs=(await db.query('select * from public.my_community_directory_page()')).rows;
      assert.equal(theirs[0].slug,'group-08000');assert.equal(theirs.length,25);
    });
    await t.test('own community filters use bounded input and literal wildcards',async()=>{
      await actor(user);const filtered=(await db.query("select * from public.my_community_directory_page(query_text=>'Community',filter_category=>'Study',filter_country=>'United States')")).rows;
      assert.equal(filtered.length,25);assert(filtered.every(x=>x.category==='Study'&&x.country==='United States'));
      assert.equal(await scalar("select count(*)::integer from public.my_community_directory_page(query_text=>'%')"),0);
      await assert.rejects(()=>db.query('select * from public.my_community_directory_page(query_text=>$1)',['a'.repeat(81)]),e=>e.code==='22023');
      await assert.rejects(()=>db.query("select * from public.my_community_directory_page(filter_category=>'Unknown')"),e=>e.code==='22023');
      await actor(null,'anon');await assert.rejects(()=>db.query('select * from public.my_community_directory_page()'),e=>e.code==='42501');
      await actor(null);await assert.rejects(()=>db.query('select * from public.my_community_directory_page()'),e=>e.code==='42501');
    });
    await t.test('question page preserves stable tie pagination and enforces its upper bound',async()=>{
      await actor(null,'anon');const first=(await db.query('select * from public.community_group_question_page($1)',[publicGroup])).rows;
      assert.equal(first.length,21);
      const cursor=first[19];const next=(await db.query('select * from public.community_group_question_page($1,$2,$3)',[publicGroup,cursor.created_at,cursor.id])).rows;
      assert.equal(next.length,21);assert.equal(new Set([...first.slice(0,20),...next].map(x=>x.id)).size,41);
      const tagged=(await db.query("select * from public.community_group_question_page($1,filter_tag=>'rare-topic')",[publicGroup])).rows;
      assert.equal(tagged.length,21);assert(tagged.every(x=>x.tags.includes('rare-topic')));
      await assert.rejects(()=>db.query('select * from public.community_group_question_page($1,$2,null)',[publicGroup,cursor.created_at]),e=>e.code==='22023');
      await assert.rejects(()=>db.query('select * from public.community_group_question_page($1,filter_tag=>$2)',[publicGroup,'x'.repeat(61)]),e=>e.code==='22023');
    });
    await t.test('private and inactive group questions stay invisible under both callers',async()=>{
      await root();await db.query('update public.communities set is_active=false where id=$1',[publicGroup]);
      for(const id of [null,user]) {await actor(id,id?'authenticated':'anon');assert.equal(await scalar('select count(*)::integer from public.community_group_question_page($1)',[publicGroup]),0);}
      await root();await db.query('update public.communities set is_active=true where id=$1',[publicGroup]);
    });
    await t.test('newer feed visibility predicates are applied before the lookahead limit',async()=>{
      await root();const original=await scalar("select pg_get_viewdef('public.question_feed'::regclass,true)");
      await db.exec(`create or replace view public.question_feed with(security_invoker=true) as select prior.* from (${original.replace(/;\s*$/,'')}) prior where prior.id<'30000000-0000-0000-0000-000000049971'::uuid;`);
      await actor(null,'anon');const page=(await db.query('select * from public.community_group_question_page($1)',[publicGroup])).rows;
      assert.equal(page.length,21);assert.equal(page[0].id,'30000000-0000-0000-0000-000000049970');
      await root();await db.exec(`create or replace view public.question_feed with(security_invoker=true) as ${original}`);
    });
    await t.test('sparse membership pagination uses the user membership index',async()=>{
      await actor(other);
      const sparse=await explain(`select d.* from public.community_directory d join public.community_members m on m.community_id=d.id
        where m.user_id=$1 and m.is_active is true order by d.slug limit 25`,[other]);
      const nodes=walk(sparse.Plan).filter(n=>n['Relation Name']==='community_members');
      assert.equal(sparse.Plan['Actual Rows'],25);
      assert(nodes.some(n=>(n['Index Name']??'').includes('community_members_user_active_idx')));
      assert.equal(nodes.reduce((n,p)=>n+p['Actual Rows']*(p['Actual Loops']??1),0),50);
      t.diagnostic(JSON.stringify({sparse_membership:{memberships:50,execution_ms:sparse['Execution Time'],membership_scan_rows:nodes.reduce((n,p)=>n+p['Actual Rows']*(p['Actual Loops']??1),0)}}));
    });
    await t.test('category directory and deep question cursor use bounded index paths',async()=>{
      await actor(null,'anon');
      const category=await explain("select * from public.community_directory where category='Study' and slug>'group-08000' order by slug limit 25");
      assert(walk(category.Plan).some(n=>n['Index Name']==='communities_public_category_slug_idx'));
      const cursor=(await db.query("select created_at,id from public.questions where community_id=$1 order by created_at desc,id desc offset 40000 limit 1",[publicGroup])).rows[0];
      const raw=await explain(`select f.* from public.question_feed f where f.community_id=$1 and f.status<>'archived'
        and (f.created_at<$2 or (f.created_at=$2 and f.id<$3)) order by f.created_at desc,f.id desc limit 21`,[publicGroup,cursor.created_at,cursor.id]);
      const bounded=await explain(`with page as materialized (select q.id,q.created_at from public.questions q join public.question_feed visible_feed on visible_feed.id=q.id where q.community_id=$1 and q.status<>'archived'
        and(q.created_at,q.id)<($2,$3) order by q.created_at desc,q.id desc limit 21)
        select f.* from page p join public.question_feed f on f.id=p.id order by p.created_at desc,p.id desc`,[publicGroup,cursor.created_at,cursor.id]);
      const index=walk(bounded.Plan).find(n=>n['Index Name']==='questions_community_new_idx');
      assert(index);assert.match(index['Index Cond'],/ROW\(created_at, id\)/);assert(index['Actual Rows']<=21);
      const summarize=plan=>({execution_ms:plan['Execution Time'],question_scan_rows:walk(plan.Plan).filter(n=>n['Relation Name']==='questions').reduce((n,p)=>n+(p['Actual Rows']+(p['Rows Removed by Filter']??0))*(p['Actual Loops']??1),0),shared_hit_blocks:plan.Plan['Shared Hit Blocks'],scan_nodes:walk(plan.Plan).filter(n=>n['Relation Name']==='questions').map(n=>({type:n['Node Type'],index:n['Index Name'],rows:n['Actual Rows'],loops:n['Actual Loops'],removed:n['Rows Removed by Filter']}))});
      t.diagnostic(JSON.stringify({fixture:{communities:10000,questions:100000,hot_group_questions:50000,deep_cursor_offset:40000},category:summarize(category),previous_view_query:summarize(raw),bounded_query:summarize(bounded)}));
    });
    await t.test('no-op membership changes avoid community row rewrites while counts remain exact',async()=>{
      await root();let xmin=await scalar('select xmin::text from public.communities where id=$1',[publicGroup]);
      await db.query('update public.community_members set is_active=true where community_id=$1 and user_id=$2',[publicGroup,user]);
      assert.equal(await scalar('select xmin::text from public.communities where id=$1',[publicGroup]),xmin);
      await db.query('update public.community_members set is_active=false where community_id=$1 and user_id=$2',[publicGroup,user]);
      assert.equal(await scalar('select member_count from public.communities where id=$1',[publicGroup]),0);
      xmin=await scalar('select xmin::text from public.communities where id=$1',[publicGroup]);
      await db.query('update public.community_members set is_active=false where community_id=$1 and user_id=$2',[publicGroup,user]);
      assert.equal(await scalar('select xmin::text from public.communities where id=$1',[publicGroup]),xmin);
      await db.query('update public.community_members set is_active=true where community_id=$1 and user_id=$2',[publicGroup,user]);
      assert.equal(await scalar('select member_count from public.communities where id=$1',[publicGroup]),1);
    });
  } finally {await db.close();}
});

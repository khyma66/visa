import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';

const migration = await readFile(new URL('../../supabase/migrations/20261003191043_production_legacy_access_hardening.sql', import.meta.url), 'utf8');
const membership = await readFile(new URL('../../supabase/migrations/20260928164013_community_membership_access_hardening.sql', import.meta.url), 'utf8');
const fixture = await readFile(new URL('./fixture.sql', import.meta.url), 'utf8');
const legacy = ['analytics_events','clusters','comment_likes','comments','countries','group_members','group_message_likes','group_messages','groups','message_read_receipts','notifications','post_likes','post_reactions','post_tags','posts','tags','user_interactions','user_presence','user_sessions','users','visa_requirements','visa_types'];
const sequences = ['clusters_id_seq','countries_id_seq','post_tags_id_seq','tags_id_seq','visa_requirements_id_seq','visa_types_id_seq'];
const functions = ['match_posts','match_posts_semantic','update_updated_at_column','update_cluster_post_count'];
const user = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const db = new PGlite();
await db.waitReady;
let beforeRows, beforeFunctions, beforeNativeAcl;

// PGlite here has no pgvector binary. A schema-bound stand-in type/operator
// exercises the real function bodies, overload/path resolution and permissions,
// not pgvector's mathematical implementation. The migration never moves vector.
async function setup(target) {
  await target.exec(fixture);
  await target.exec(membership);
  await target.exec(`
    create schema extensions;
    create schema storage;
    create table storage.buckets(id text primary key,public boolean,name text);
    insert into storage.buckets values ('posts',true,'posts'),('untouched',true,'untouched');
    create table storage.objects(id text primary key,bucket_id text,metadata jsonb);
    insert into storage.objects values ('preserve-object','posts','{"size":1327904}');
    grant usage on schema storage to service_role;
    grant all on storage.buckets,storage.objects to service_role;
    alter table public.users add column body text default 'preserve-users';
    alter table public.users add column updated_at timestamptz default '2000-01-01';
    alter table public.communities add column updated_at timestamptz default '2000-01-01';
    create type public.vector as (value double precision);
    create function public.vector_distance(public.vector,public.vector) returns double precision
      language sql immutable as $$ select abs(($1).value-($2).value) $$;
    create operator public.<=> (leftarg=public.vector,rightarg=public.vector,function=public.vector_distance);
    create table public.posts (
      id uuid primary key,title text,content text,url text,cluster_id text,created_at timestamptz default now(),
      group_id uuid,short_excerpt text,storage_path text,embedding public.vector,embedding_768 public.vector,body text
    );
    insert into public.posts(id,title,content,cluster_id,embedding,embedding_768,body)
      select gen_random_uuid(),'post '||n,'content '||n,'1',row(0.0)::public.vector,row(0.0)::public.vector,'preserve-post'
      from generate_series(1,500) n;
    create table public.clusters(id text primary key,post_count integer,updated_at timestamptz,body text);
    insert into public.clusters values('1',500,now(),'preserve-cluster');
  `);
  for (const table of legacy) {
    if (!['users','posts','clusters'].includes(table)) await target.exec(`create table public.${table}(id integer primary key,body text,updated_at timestamptz default '2000-01-01'); insert into public.${table}(id,body) values(1,'preserve-${table}');`);
    await target.exec(`grant all on public.${table} to public,anon,authenticated,service_role; grant select(body),insert(body),update(body),references(body) on public.${table} to public,anon,authenticated;`);
  }
  for (const sequence of sequences) await target.exec(`create sequence public.${sequence}; grant all on public.${sequence} to public,anon,authenticated,service_role;`);
  await target.exec(`
    create table public.questions(id integer,body text);
    insert into public.questions values(1,'native question');
    alter table public.questions enable row level security;
    grant select on public.questions to anon,authenticated;
    create policy visible_question on public.questions for select to anon,authenticated using(true);
    create table public.direct_messages(id integer,owner uuid,body text);
    insert into public.direct_messages values(1,'${user}','private message');
    alter table public.direct_messages enable row level security;
    grant select on public.direct_messages to authenticated;
    create policy own_message on public.direct_messages for select to authenticated using(owner=(select auth.uid()));

    create function public.match_posts(query_embedding public.vector,match_threshold double precision default 0.5,match_count integer default 5)
    returns table(id uuid,title text,content text,url text,similarity double precision,cluster_id text,created_at timestamptz)
    language sql stable as $$
      select posts.id,posts.title,posts.content,posts.url,1-(posts.embedding_768 <=> query_embedding) as similarity,posts.cluster_id,posts.created_at
      from posts where posts.embedding_768 is not null and 1-(posts.embedding_768 <=> query_embedding)>match_threshold
      order by similarity desc limit match_count;
    $$;
    create function public.match_posts_semantic(query_embedding public.vector,in_group_id uuid default null,limit_count integer default 30)
    returns table(id uuid,title text,short_excerpt text,storage_path text,score double precision)
    language sql stable as $$
      select p.id,p.title,coalesce(p.short_excerpt,left(coalesce(p.content,''),200)),
        coalesce(p.storage_path,concat('posts/',coalesce(p.group_id::text,'ungrouped'),'/',p.id::text,'.json')),
        1-(p.embedding <=> query_embedding)
      from public.posts p where (in_group_id is null or p.group_id=in_group_id) and p.embedding is not null
      order by p.embedding <=> query_embedding limit greatest(1,least(limit_count,1000));
    $$;
    create function public.update_cluster_post_count() returns trigger language plpgsql as $$
    begin
      if TG_OP='INSERT' or TG_OP='UPDATE' then
        update clusters set post_count=(select count(*) from posts where cluster_id=NEW.cluster_id),updated_at=now() where id=NEW.cluster_id;
      end if;
      if TG_OP='DELETE' then
        update clusters set post_count=(select count(*) from posts where cluster_id=OLD.cluster_id),updated_at=now() where id=OLD.cluster_id;
      end if;
      return null;
    end; $$;
    create function public.update_updated_at_column() returns trigger language plpgsql as $$
    begin NEW.updated_at=now(); return NEW; end; $$;
    grant execute on function public.match_posts(public.vector,double precision,integer),public.match_posts_semantic(public.vector,uuid,integer),public.update_cluster_post_count(),public.update_updated_at_column() to anon,authenticated,service_role;
    create trigger update_users_updated_at before update on public.users for each row execute function public.update_updated_at_column();
    create trigger update_groups_updated_at before update on public.groups for each row execute function public.update_updated_at_column();
    create trigger update_communities_updated_at before update on public.communities for each row execute function public.update_updated_at_column();
    -- Not attached in the live catalog, but retain its server-side compatibility.
    create trigger test_cluster_count after insert or update or delete on public.posts for each row execute function public.update_cluster_post_count();
  `);
}
async function asRole(role, uid, fn) {
  assert(['anon','authenticated','service_role'].includes(role));
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid ?? '']);
    return await fn();
  } finally { await db.exec('rollback'); }
}
async function tableRows() {
  return Object.fromEntries(await Promise.all(legacy.map(async table => [table,(await db.query(`select to_jsonb(t) row from public.${table} t order by id`)).rows])));
}
async function nativeAcl() {
  return (await db.query("select relname,relacl::text,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname=any($1) order by relname",[['communities','community_members','questions','direct_messages']])).rows;
}
before(async () => {
  await setup(db);
  beforeRows=await tableRows();
  beforeFunctions=(await db.query('select proname,prosrc from pg_proc where pronamespace=\'public\'::regnamespace and proname=any($1) order by proname',[functions])).rows;
  beforeNativeAcl=await nativeAcl();
  await db.exec(migration);
});
after(() => db.close());

test('promotion preserves every row in all 22 legacy tables, including 500 posts', async () => {
  assert.deepEqual(await tableRows(),beforeRows);
  assert.equal(beforeRows.posts.length,500);
  const snapshot=(await db.query("select metadata from private.security_change_snapshots where change_key='production-legacy-access-20261003'")).rows[0].metadata;
  assert.equal(Object.keys(snapshot.row_counts).length,22);
  for(const table of legacy) assert.equal(snapshot.row_counts[table],beforeRows[table].length);
  assert.equal(snapshot.posts_bucket.public,true);
  assert.equal(snapshot.posts_object_count,1);
  assert.equal(snapshot.functions.length,4);
  assert(snapshot.functions.every(f => f.config===null && f.definition && f.acl && f.owner));
  assert.equal(snapshot.relations.filter(r => r.kind==='S').length,6);
  assert(snapshot.column_acl.some(a => a.table==='posts' && a.column==='body'));
  assert(snapshot.schemas.some(s => s.name==='public' && s.acl));
});

test('all browser table, column and administrative privileges are removed; all server privileges remain', async () => {
  for(const table of legacy) {
    assert.equal((await db.query('select relrowsecurity from pg_class where oid=$1::regclass',['public.'+table])).rows[0].relrowsecurity,true);
    for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) {
      for(const role of ['anon','authenticated','service_role']) assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',[role,'public.'+table,privilege])).rows[0].allowed,role==='service_role',`${role} ${table} ${privilege}`);
    }
    for(const privilege of ['SELECT','INSERT','UPDATE','REFERENCES']) for(const role of ['anon','authenticated']) assert.equal((await db.query('select has_column_privilege($1,$2,\'body\',$3) allowed',[role,'public.'+table,privilege])).rows[0].allowed,false);
    for(const role of ['anon','authenticated']) await assert.rejects(() => asRole(role,user,() => db.query(`select body from public.${table}`)),{code:'42501'});
  }
  for(const sequence of sequences) for(const privilege of ['SELECT','UPDATE','USAGE']) for(const role of ['anon','authenticated','service_role']) assert.equal((await db.query('select has_sequence_privilege($1,$2,$3) allowed',[role,'public.'+sequence,privilege])).rows[0].allowed,role==='service_role');
  await asRole('service_role',null,async () => {
    assert.equal((await db.query('select count(*)::int n from public.posts')).rows[0].n,500);
    const id=(await db.query("insert into public.posts(id,title,cluster_id) values(gen_random_uuid(),'server import','1') returning id")).rows[0].id;
    await db.query('update public.posts set body=\'updated\' where id=$1',[id]);
    assert.equal((await db.query("select post_count from public.clusters where id='1'")).rows[0].post_count,501);
    await db.query('delete from public.posts where id=$1',[id]);
    assert.equal((await db.query("select post_count from public.clusters where id='1'")).rows[0].post_count,500);
    assert.equal((await db.query("select nextval('public.tags_id_seq')::int n")).rows[0].n,1);
  });
});

test('native access and reviewed community discovery/join/private-membership rules are unchanged', async () => {
  assert.deepEqual(await nativeAcl(),beforeNativeAcl);
  await asRole('anon',null,async () => {
    assert.deepEqual((await db.query('select name from public.communities')).rows,[{name:'open'}]);
    assert.equal((await db.query('select * from public.questions')).rows.length,1);
  });
  await asRole('authenticated',user,async () => {
    assert.deepEqual((await db.query('select name from public.communities')).rows,[{name:'open'}]);
    assert.equal((await db.query("insert into public.community_members(community_id,user_id) values('10000000-0000-0000-0000-000000000001',$1) returning role",[user])).rows[0].role,'member');
    assert.equal((await db.query('select * from public.direct_messages')).rows.length,1);
  });
  await asRole('authenticated',other,async () => {
    assert.deepEqual((await db.query('select name from public.communities order by name')).rows,[{name:'open'},{name:'private'}]);
    assert.equal((await db.query('select * from public.direct_messages')).rows.length,0);
  });
  await assert.rejects(() => asRole('authenticated',user,() => db.query("insert into public.community_members(community_id,user_id,role) values('10000000-0000-0000-0000-000000000001',$1,'admin')",[user])),{code:'42501'});
});

test('only legacy posts bucket becomes private; objects/metadata and server access are retained', async () => {
  assert.deepEqual((await db.query('select id,public from storage.buckets order by id')).rows,[{id:'posts',public:false},{id:'untouched',public:true}]);
  await asRole('service_role',null,async () => assert.deepEqual((await db.query('select * from storage.objects')).rows,[{id:'preserve-object',bucket_id:'posts',metadata:{size:1327904}}]));
});

test('legacy function bodies remain invoker-only, execute is server-only, and fixed paths resist caller/temp shadowing', async () => {
  const rows=(await db.query('select oid::regprocedure::text signature,proname,prosrc,prosecdef,proconfig from pg_proc where pronamespace=\'public\'::regnamespace and proname=any($1) order by proname',[functions])).rows;
  assert.deepEqual(rows.map(({proname,prosrc})=>({proname,prosrc})),beforeFunctions);
  for(const f of rows) {
    assert.equal(f.prosecdef,false);
    assert.deepEqual(f.proconfig,['search_path=pg_catalog, public, extensions, pg_temp']);
    for(const role of ['anon','authenticated','service_role']) assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,f.signature])).rows[0].allowed,role==='service_role');
  }
  for(const role of ['anon','authenticated']) await assert.rejects(() => asRole(role,user,() => db.query('select * from public.match_posts(row(0.0)::public.vector)')),{code:'42501'});
  await asRole('service_role',null,async () => {
    await db.exec("set local search_path=pg_temp,pg_catalog; create temporary table posts(id text); insert into posts values('shadow');");
    assert.equal((await db.query('select * from public.match_posts(row(0.0)::public.vector)')).rows.length,5);
    assert.equal((await db.query('select * from public.match_posts_semantic(row(0.0)::public.vector,null,9)')).rows.length,9);
    await db.exec("update public.groups set body='updated'; update public.users set body='updated'; update public.communities set display_name=display_name;");
    assert.equal((await db.query("select count(*)::int n from public.communities where updated_at>'2000-01-01'")).rows[0].n,4);
  });
  assert.equal((await db.query("select to_regtype('public.vector')::text name")).rows[0].name,'vector');
  for(const role of ['anon','authenticated']) for(const schema of ['public','extensions']) assert.equal((await db.query('select has_schema_privilege($1,$2,\'CREATE\') allowed',[role,schema])).rows[0].allowed,false);
});

test('existing trigger execution still works when browser direct function execution is revoked', async () => {
  await db.exec('begin');
  try {
    // This synthetic grant is only a compatibility probe: no migration grants it.
    await db.exec('grant update(display_name) on public.communities to authenticated; create policy test_update on public.communities for update to authenticated using(true) with check(true); set local role authenticated;');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
    assert.equal((await db.query("update public.communities set display_name='Open updated' where name='open' returning updated_at>'2000-01-01' as changed")).rows[0].changed,true);
  } finally { await db.exec('rollback'); }
});

test('private snapshot is inaccessible to browser roles and reapplying does not replace original metadata', async () => {
  for(const role of ['anon','authenticated']) await assert.rejects(() => asRole(role,user,() => db.query('select * from private.security_change_snapshots')),{code:'42501'});
  const previous=(await db.query('select * from private.security_change_snapshots')).rows;
  await db.exec(migration);
  assert.deepEqual((await db.query('select * from private.security_change_snapshots')).rows,previous);
});

test('containment fails atomically if revoking PUBLIC would silently remove a server privilege', async () => {
  const drift=new PGlite();
  try {
    await setup(drift);
    await drift.exec('revoke all on public.posts from service_role');
    assert.equal((await drift.query("select has_table_privilege('service_role','public.posts','SELECT') allowed")).rows[0].allowed,true);
    await assert.rejects(()=>drift.exec(migration),/Service-role privileges would change on posts/);
    await drift.exec('rollback');
    assert.equal((await drift.query("select has_table_privilege('anon','public.posts','SELECT') allowed")).rows[0].allowed,true);
    assert.equal((await drift.query("select public from storage.buckets where id='posts'")).rows[0].public,true);
    assert.equal((await drift.query('select count(*)::int n from public.posts')).rows[0].n,500);
  } finally { await drift.close(); }
});

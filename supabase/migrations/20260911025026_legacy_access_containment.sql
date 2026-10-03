begin;
set local lock_timeout = '5s';
create schema if not exists private;
create table if not exists private.security_change_snapshots (
  change_key text primary key,
  captured_at timestamptz not null default now(),
  metadata jsonb not null
);
alter table private.security_change_snapshots enable row level security;
revoke all on private.security_change_snapshots from public, anon, authenticated;

-- Preserve permission/definition metadata before reversible containment. No records deleted.
insert into private.security_change_snapshots(change_key,metadata)
select 'legacy-access-20260911',jsonb_build_object(
  'relations',(select jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'rls',c.relrowsecurity,'acl',c.relacl::text))
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','S')),
  'column_acl',(select jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'acl',a.attacl::text))
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attacl is not null),
  'policies',(select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname='public'),
  'functions',(select jsonb_agg(jsonb_build_object('definition',pg_get_functiondef(p.oid),'acl',p.proacl::text))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('match_posts','match_posts_semantic','update_updated_at_column','update_cluster_post_count')),
  'bucket',(select to_jsonb(b) from storage.buckets b where id='posts')
) on conflict(change_key) do nothing;

do $$
declare item text; column_list text; relation regclass;
begin
  foreach item in array array['analytics_events','clusters','comment_likes','comments','communities','community_members',
    'countries','group_members','group_message_likes','group_messages','groups','message_read_receipts','notifications',
    'post_likes','post_reactions','post_tags','posts','tags','user_interactions','user_presence','user_sessions','users','visa_requirements','visa_types'] loop
    relation := to_regclass(format('public.%I',item));
    if relation is null then continue; end if;
    execute format('alter table %s enable row level security',relation);
    execute format('revoke all privileges on table %s from public, anon, authenticated',relation);
    select string_agg(quote_ident(attname),',') into column_list from pg_attribute
      where attrelid=relation and attnum>0 and not attisdropped;
    execute format('revoke select (%s), insert (%s), update (%s), references (%s) on %s from public, anon, authenticated',
      column_list,column_list,column_list,column_list,relation);
  end loop;
  foreach item in array array['clusters_id_seq','countries_id_seq','post_tags_id_seq','tags_id_seq','visa_requirements_id_seq','visa_types_id_seq'] loop
    relation := to_regclass(format('public.%I',item));
    if relation is not null then execute format('revoke all privileges on sequence %s from public, anon, authenticated',relation); end if;
  end loop;
end $$;

-- Public asset URLs cease working, but the single stored object and its metadata stay intact.
update storage.buckets set public=false where id='posts';
revoke create on schema public from public, anon, authenticated;
create schema if not exists extensions;
do $$ begin
  if exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='vector' and n.nspname='public' and e.extrelocatable) then
    alter extension vector set schema extensions;
  end if;
end $$;
do $$
declare fn record;
begin
  for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('match_posts','match_posts_semantic','update_updated_at_column','update_cluster_post_count') loop
    execute format('alter function %s set search_path = pg_catalog, public, extensions, pg_temp',fn.signature);
    execute format('revoke all on function %s from public, anon, authenticated',fn.signature);
    execute format('grant execute on function %s to service_role',fn.signature);
  end loop;
end $$;
commit;

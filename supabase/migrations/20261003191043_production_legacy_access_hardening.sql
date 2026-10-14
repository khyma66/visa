-- Promotion of the existing project, not a data migration. The September
-- containment script predates the reviewed community membership contract:
-- deliberately do not replay it or revoke communities/community_members.
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
revoke select (change_key,captured_at,metadata), insert (change_key,captured_at,metadata),
  update (change_key,captured_at,metadata), references (change_key,captured_at,metadata)
  on private.security_change_snapshots from public, anon, authenticated;

-- Retain original ACLs (including sequence/column grants), policies, ownership,
-- function definitions/configuration and bucket visibility for an operator-led
-- rollback. No user content or credentials are copied into this private table.
insert into private.security_change_snapshots(change_key,metadata)
select 'production-legacy-access-20261003', jsonb_build_object(
  'relations', (select jsonb_agg(jsonb_build_object(
    'schema',n.nspname,'name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
    'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl::text))
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','v','S')),
  'column_acl', (select jsonb_agg(jsonb_build_object(
    'table',c.relname,'column',a.attname,'acl',a.attacl::text))
    from pg_attribute a join pg_class c on c.oid=a.attrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and a.attnum>0 and not a.attisdropped and a.attacl is not null),
  'policies', (select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname='public'),
  'functions', (select jsonb_agg(jsonb_build_object(
    'signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),
    'definition',pg_get_functiondef(p.oid),'acl',p.proacl::text,
    'config',p.proconfig,'security_definer',p.prosecdef))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'match_posts','match_posts_semantic','update_updated_at_column','update_cluster_post_count')),
  'schemas', (select jsonb_agg(jsonb_build_object(
    'name',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',n.nspacl::text))
    from pg_namespace n where n.nspname in ('public','extensions','private')),
  'default_acl', (select jsonb_agg(to_jsonb(d)) from pg_default_acl d),
  'vector_extension', (select jsonb_build_object('schema',n.nspname,'version',e.extversion)
    from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='vector'),
  'posts_bucket', (select to_jsonb(b) from storage.buckets b where b.id='posts'),
  'posts_object_count', (select count(*) from storage.objects where bucket_id='posts')
) on conflict(change_key) do nothing;

do $$
declare
  item text;
  column_list text;
  relation regclass;
  before_access boolean[];
  after_access boolean[];
  before_count bigint;
  after_count bigint;
  row_counts jsonb := '{}'::jsonb;
begin
  -- Enabling RLS must not unexpectedly disable the server-side importer.
  if not exists(select 1 from pg_roles where rolname='service_role' and rolbypassrls) then
    raise exception 'Expected service_role BYPASSRLS; review before legacy containment';
  end if;
  foreach item in array array[
    'analytics_events','clusters','comment_likes','comments','countries','group_members',
    'group_message_likes','group_messages','groups','message_read_receipts','notifications',
    'post_likes','post_reactions','post_tags','posts','tags','user_interactions',
    'user_presence','user_sessions','users','visa_requirements','visa_types'
  ] loop
    relation := to_regclass(format('public.%I',item));
    if relation is null then continue; end if;
    execute format('select count(*) from %s',relation) into before_count;
    row_counts := row_counts || jsonb_build_object(item,before_count);
    select array_agg(has_table_privilege('service_role',relation,p) order by p)
      into before_access from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p;
    execute format('alter table %s enable row level security',relation);
    execute format('revoke all privileges on table %s from public, anon, authenticated',relation);
    select string_agg(quote_ident(attname),',') into column_list from pg_attribute
      where attrelid=relation and attnum>0 and not attisdropped;
    if column_list is not null then
      execute format('revoke select (%s), insert (%s), update (%s), references (%s) on %s from public, anon, authenticated',
        column_list,column_list,column_list,column_list,relation);
    end if;
    select array_agg(has_table_privilege('service_role',relation,p) order by p)
      into after_access from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p;
    if before_access is distinct from after_access then
      raise exception 'Service-role privileges would change on %; review explicit grants first',relation;
    end if;
    execute format('select count(*) from %s',relation) into after_count;
    if before_count is distinct from after_count then
      raise exception 'Row count changed on % during containment',relation;
    end if;
  end loop;
  foreach item in array array[
    'clusters_id_seq','countries_id_seq','post_tags_id_seq','tags_id_seq','visa_requirements_id_seq','visa_types_id_seq'
  ] loop
    relation := to_regclass(format('public.%I',item));
    if relation is null then continue; end if;
    select array_agg(has_sequence_privilege('service_role',relation,p) order by p)
      into before_access from unnest(array['SELECT','UPDATE','USAGE']) p;
    execute format('revoke all privileges on sequence %s from public, anon, authenticated',relation);
    select array_agg(has_sequence_privilege('service_role',relation,p) order by p)
      into after_access from unnest(array['SELECT','UPDATE','USAGE']) p;
    if before_access is distinct from after_access then
      raise exception 'Service-role privileges would change on %; review explicit grants first',relation;
    end if;
  end loop;
  update private.security_change_snapshots
    set metadata=jsonb_set(metadata,'{row_counts}',row_counts)
    where change_key='production-legacy-access-20261003' and not (metadata ? 'row_counts');
end $$;

-- Retire the legacy unauthenticated asset URL. Object rows/bytes and service-role
-- access are retained. The current app serves its imported archive separately;
-- this does not add any storage policies or new browser download capability.
update storage.buckets set public=false where id='posts' and public is true;

-- Preserve existing unqualified SQL and public.vector types/operators. Moving
-- vector to extensions is explicitly deferred until old direct-SQL consumers
-- have been migrated; the extension-in-public advisory will remain for now.
revoke create on schema public from public, anon, authenticated;
do $$
begin
  if exists(select 1 from pg_namespace where nspname='extensions') then
    revoke create on schema extensions from public, anon, authenticated;
  end if;
end $$;

do $$
declare fn record;
begin
  for fn in select p.oid::regprocedure as signature,p.prosecdef
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'match_posts','match_posts_semantic','update_updated_at_column','update_cluster_post_count') loop
    if fn.prosecdef then
      raise exception 'Legacy function % is unexpectedly SECURITY DEFINER; review before containment',fn.signature;
    end if;
    execute format('alter function %s set search_path = pg_catalog, public, extensions, pg_temp',fn.signature);
    execute format('revoke all on function %s from public, anon, authenticated',fn.signature);
    execute format('grant execute on function %s to service_role',fn.signature);
  end loop;
end $$;
commit;

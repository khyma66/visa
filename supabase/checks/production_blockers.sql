-- READ ONLY. Each returned row is an unresolved blocker, not a remediation.
-- This is a targeted catalog gate, not a substitute for Supabase advisors or E2E tests.
with client_roles as (
  select rolname from pg_roles where rolname in ('anon','authenticated')
), public_tables as (
  select c.oid, c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p')
)
select 'exposed_table_without_rls' as check_name,
       'public.' || t.relname as object_name,
       r.rolname::text as affected_role
from public_tables t cross join client_roles r
where not t.relrowsecurity
  and has_table_privilege(r.rolname,t.oid,'SELECT,INSERT,UPDATE,DELETE')
union all
select 'client_table_administration','public.' || t.relname,r.rolname::text
from public_tables t cross join client_roles r
where has_table_privilege(r.rolname,t.oid,'TRUNCATE,TRIGGER,REFERENCES')
union all
select 'questions_missing_community_id','public.questions','application'
where not exists (
  select 1 from information_schema.columns where table_schema='public'
  and table_name='questions' and column_name='community_id'
)
order by check_name,object_name,affected_role;

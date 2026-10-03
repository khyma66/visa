begin;
set local lock_timeout = '5s';
-- Client roles need application operations, never table administration.
-- This deliberately leaves SELECT/INSERT/UPDATE/DELETE and service_role intact.
do $$
declare target record;
begin
  for target in
    select n.nspname, c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p')
  loop
    execute format(
      'revoke truncate, references, trigger on table %I.%I from public, anon, authenticated',
      target.nspname, target.relname
    );
  end loop;
end $$;
commit;

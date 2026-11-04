begin;
set local lock_timeout='5s';
create extension if not exists pg_cron with schema pg_catalog;
-- Install the timer disabled in the same transaction. Activation is a later, explicit owner decision.
do $$ declare job bigint;
begin
  if exists(select 1 from cron.job where jobname='visathreads-reviewed-editorial') then
    raise exception 'Editorial job already exists; inspect it before changing its configuration';
  end if;
  select cron.schedule('visathreads-reviewed-editorial','*/15 * * * *','select private.editorial_publish_due();') into job;
  perform cron.alter_job(job,active:=false);
end $$;
commit;

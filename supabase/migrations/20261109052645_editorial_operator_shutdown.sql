-- Version matches the migration receipt recorded by the production MCP deployment.
begin;
set local lock_timeout='5s';

-- Operator-only controls. No public API, triggers, jobs or frontend changes.
create function private.editorial_operator_status() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'enabled',(select enabled from private.editorial_settings),
    'timer_configured',exists(select 1 from cron.job where jobname='visathreads-reviewed-editorial'),
    'timer_active',exists(select 1 from cron.job where jobname='visathreads-reviewed-editorial' and active),
    'enabled_sources',(select count(*) from private.editorial_sources where enabled),
    'enabled_consents',(select count(*) from private.editorial_consents where enabled),
    'scheduled_posts',(select count(*) from private.editorial_drafts where status='scheduled'),
    'published_posts',(select count(*) from private.editorial_drafts where status='published'),
    'queue',coalesce((select jsonb_object_agg(status,total) from
      (select status,count(*) total from private.editorial_drafts group by status) counts),'{}'::jsonb),
    'policy_compatible',exists(select 1 from private.editorial_settings s where position(quote_literal(s.policy_version)
      in pg_get_functiondef('private.community_write_guard()'::regprocedure))>0),
    'limits',(select jsonb_build_object('daily',daily_limit,'monthly',monthly_limit,'minimum_gap_minutes',minimum_gap_minutes)
      from private.editorial_settings)
  );
$$;

create function private.editorial_stop_all() returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='10s' set lock_timeout='5s' as $$
declare job bigint;
begin
  -- The same lock serializes publishers, consent, review and shutdown. A committed
  -- shutdown guarantees no later tick can publish until explicitly reconfigured.
  perform pg_advisory_xact_lock(hashtextextended('editorial-publishing',0));
  update private.editorial_settings set enabled=false;
  for job in select jobid from cron.job where jobname='visathreads-reviewed-editorial' and active loop
    perform cron.alter_job(job,active:=false);
  end loop;
  update private.editorial_sources set enabled=false where enabled;
  update private.editorial_consents set enabled=false,version=version+1,updated_at=now() where enabled;
  update private.editorial_drafts set status='blocked',blocked_reason='Operator shutdown; rescheduling required',
    author_id=null,consent_version=null,scheduled_at=null,updated_at=now() where status='scheduled';
  insert into private.editorial_events(action) values('operator_shutdown');
  return private.editorial_operator_status();
end $$;

revoke all on function private.editorial_operator_status(),private.editorial_stop_all()
  from public,anon,authenticated,service_role;
commit;

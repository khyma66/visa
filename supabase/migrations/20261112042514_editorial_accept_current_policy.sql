-- Align the isolated publisher with the current website acknowledgement.
-- This does not create acceptance or account-consent records.
do $policy_alignment$
begin
  perform pg_advisory_xact_lock(hashtextextended('editorial-publishing', 0));
  if position(quote_literal('2026-11-05-preview-v4') in
       pg_get_functiondef('private.community_write_guard()'::regprocedure)) = 0
    or not exists (
      select 1 from pg_catalog.pg_policies
      where schemaname='public' and tablename='policy_acceptances'
        and policyname='record_current_policy'
        and with_check like '%2026-11-05-preview-v4%'
    ) then
    raise exception 'Current community policy is not enabled; no change made';
  end if;
  if exists (select 1 from private.editorial_settings where enabled)
    or exists (select 1 from cron.job where jobname='visathreads-reviewed-editorial' and active)
    or exists (select 1 from private.editorial_drafts where status='scheduled') then
    raise exception 'Pause and reconcile publishing before changing the policy requirement';
  end if;
  update private.editorial_settings set policy_version='2026-11-05-preview-v4'
  where singleton and policy_version='2026-11-02-preview-v3';
  if found then
    insert into private.editorial_events(action) values('policy_requirement_aligned_v4');
  elsif not exists (select 1 from private.editorial_settings where singleton and policy_version='2026-11-05-preview-v4') then
    raise exception 'Unexpected publishing policy; no change made';
  end if;
end
$policy_alignment$;

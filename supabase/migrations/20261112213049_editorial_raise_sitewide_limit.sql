-- Raise only the website-wide editorial budget. Account-specific consent,
-- approvals, spacing, source controls and real view counts stay unchanged.
begin;
set local lock_timeout='5s';
select pg_advisory_xact_lock(hashtextextended('editorial-publishing',0));
alter table private.editorial_settings
  drop constraint editorial_settings_daily_limit_check,
  drop constraint editorial_settings_monthly_limit_check,
  add constraint editorial_settings_daily_limit_check check (daily_limit between 1 and 12),
  add constraint editorial_settings_monthly_limit_check check (monthly_limit between 1 and 372);
update private.editorial_settings set daily_limit=12, monthly_limit=372 where singleton=true;
insert into private.editorial_events(action) values ('sitewide_limit_raised_12_per_day');
commit;

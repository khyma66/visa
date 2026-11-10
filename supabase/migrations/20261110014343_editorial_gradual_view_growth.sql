-- Version matches the production migration receipt.
begin;
set local lock_timeout='5s';

-- One approval window. Re-enabling the publisher never extends this deadline.
alter table private.editorial_settings
  add column tactical_growth_started_at timestamptz,
  add column tactical_growth_ends_at timestamptz,
  add constraint editorial_growth_window check(
    (tactical_growth_started_at is null and tactical_growth_ends_at is null) or
    (tactical_growth_started_at is not null and tactical_growth_ends_at is not null
      and tactical_growth_ends_at=tactical_growth_started_at+interval '336 hours'));

create function private.editorial_start_growth_window() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.enabled and new.tactical_views_enabled and new.tactical_growth_started_at is null then
    new.tactical_growth_started_at:=now();
    new.tactical_growth_ends_at:=now()+interval '336 hours';
    insert into private.editorial_events(action) values('tactical_growth_window_started');
  end if;
  return new;
end $$;
create trigger editorial_start_growth_window before update of enabled,tactical_views_enabled on private.editorial_settings
  for each row execute function private.editorial_start_growth_window();
-- Safe for a deployment where publication was already on; production is paused.
update private.editorial_settings set enabled=enabled where enabled and tactical_views_enabled;

create table private.editorial_view_growth (
  post_id text primary key references private.editorial_view_seeds(post_id) on delete cascade,
  started_at timestamptz not null,
  freeze_at timestamptz not null,
  settles_at timestamptz not null,
  two_hour_views integer not null check(two_hour_views between 450 and 550),
  twelve_hour_views integer not null check(twelve_hour_views between 1800 and 2200),
  final_views integer not null check(final_views between 4200 and 5000),
  check(freeze_at>=started_at),
  check(settles_at>=started_at+interval '168 hours' and settles_at<=started_at+interval '336 hours')
);
alter table private.editorial_view_growth enable row level security;
revoke all on private.editorial_view_growth from public,anon,authenticated,service_role;

-- Pure, deterministic curve: no random values, writes or timers on reads.
create function private.editorial_growth_at(started timestamptz,freeze_time timestamptz,settle_time timestamptz,
  at_two integer,at_twelve integer,peak integer,at_time timestamptz) returns bigint
language plpgsql immutable strict security invoker set search_path='' as $$
declare age_hours numeric:=greatest(0,extract(epoch from (least(at_time,freeze_time,settle_time)-started))/3600);
  settle_hours numeric:=extract(epoch from (settle_time-started))/3600; progress numeric; total numeric;
begin
  if age_hours<=2 then total:=at_two*age_hours/2;
  elsif age_hours<=12 then total:=at_two+(at_twelve-at_two)*(age_hours-2)/10;
  else
    progress:=least(1,greatest(0,(age_hours-12)/greatest(1,settle_hours-12)));
    total:=at_twelve+(peak-at_twelve)*(1-power(1-progress,2));
  end if;
  return floor(least(5000,greatest(0,total)))::bigint;
end $$;

-- Store each profile atomically with publication. Legacy seed records retain
-- their old behavior; no already-published content is rewritten or backfilled.
create or replace function private.editorial_seed_post_views() returns trigger
language plpgsql security invoker set search_path='' as $$
declare s private.editorial_settings;
begin
  select * into s from private.editorial_settings where enabled and tactical_views_enabled;
  if not found or s.tactical_growth_ends_at is null then return new; end if;
  insert into private.editorial_view_seeds(post_id,draft_id,starting_views)
    values(new.question_id::text,new.id,s.tactical_views_min+floor(random()*(s.tactical_views_max-s.tactical_views_min+1))::integer)
    on conflict(post_id) do nothing;
  insert into private.editorial_view_growth(post_id,started_at,freeze_at,settles_at,two_hour_views,twelve_hour_views,final_views)
    values(new.question_id::text,new.published_at,greatest(new.published_at,s.tactical_growth_ends_at),
      new.published_at+make_interval(hours=>168+floor(random()*169)::integer),
      450+floor(random()*101)::integer,1800+floor(random()*401)::integer,4200+floor(random()*801)::integer)
    on conflict(post_id) do nothing;
  return new;
end $$;

create or replace function private.editorial_display_views(target text,measured bigint) returns bigint
language sql stable security invoker set search_path='' as $$
  select coalesce((select case when s.enabled and s.tactical_views_enabled and v.post_id is not null then
    least(5000,measured+case when g.post_id is null then v.starting_views else
      private.editorial_growth_at(g.started_at,g.freeze_at,g.settles_at,g.two_hour_views,g.twelve_hour_views,g.final_views,now()) end)
    else measured end
    from private.editorial_settings s left join private.editorial_view_seeds v on v.post_id=target
    left join private.editorial_view_growth g on g.post_id=v.post_id where s.singleton),measured);
$$;

create or replace function private.editorial_operator_status() returns jsonb
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
      from private.editorial_settings),
    'tactical_views',(select jsonb_build_object('configured',tactical_views_enabled,'active',enabled and tactical_views_enabled,
      'minimum',tactical_views_min,'maximum',tactical_views_max,
      'seeded_posts',(select count(*) from private.editorial_view_seeds)) from private.editorial_settings),
    'tactical_growth',(select jsonb_build_object('hard_display_cap',5000,'approval_window_days',14,
      'started_at',tactical_growth_started_at,'ends_at',tactical_growth_ends_at,
      'growing',enabled and tactical_views_enabled and now()<tactical_growth_ends_at,
      'profiles',(select count(*) from private.editorial_view_growth)) from private.editorial_settings)
  );
$$;
revoke all on function private.editorial_start_growth_window(),
  private.editorial_growth_at(timestamptz,timestamptz,timestamptz,integer,integer,integer,timestamptz),
  private.editorial_seed_post_views(),private.editorial_display_views(text,bigint),private.editorial_operator_status()
  from public,anon,authenticated,service_role;
commit;

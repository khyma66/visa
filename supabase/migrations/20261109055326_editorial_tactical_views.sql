-- Version matches the recorded production migration receipt.
begin;
set local lock_timeout='5s';

-- Synthetic display offsets belong only to the reviewed tactical publisher.
-- Measured post-view totals, signatures, analytics and ordinary posts are unchanged.
alter table private.editorial_settings
  add column tactical_views_enabled boolean not null default true,
  add column tactical_views_min integer not null default 500 check(tactical_views_min between 500 and 2500),
  add column tactical_views_max integer not null default 2500 check(tactical_views_max between 500 and 2500),
  add constraint editorial_tactical_view_bounds check(tactical_views_min<=tactical_views_max);

create table private.editorial_view_seeds (
  post_id text primary key check(post_id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
  draft_id text not null unique references private.editorial_drafts(id) on delete cascade,
  starting_views integer not null check(starting_views between 500 and 2500),
  created_at timestamptz not null default now()
);
alter table private.editorial_view_seeds enable row level security;
revoke all on private.editorial_view_seeds from public,anon,authenticated,service_role;

create function private.editorial_seed_post_views() returns trigger
language plpgsql security invoker set search_path='' as $$
declare low integer; high integer;
begin
  select tactical_views_min,tactical_views_max into low,high from private.editorial_settings
    where enabled and tactical_views_enabled;
  if not found then return new; end if;
  insert into private.editorial_view_seeds(post_id,draft_id,starting_views)
    values(new.question_id::text,new.id,low+floor(random()*(high-low+1))::integer)
    on conflict(post_id) do nothing;
  return new;
end $$;
create trigger editorial_seed_post_views after update of status on private.editorial_drafts
  for each row when(new.status='published' and old.status is distinct from 'published')
  execute function private.editorial_seed_post_views();

create function private.editorial_display_views(target text,measured bigint) returns bigint
language sql stable security invoker set search_path='' as $$
  select measured+coalesce((select v.starting_views from private.editorial_view_seeds v
    join private.editorial_settings s on s.singleton
    where v.post_id=target and s.enabled and s.tactical_views_enabled),0);
$$;

-- Retain the deployed authentication, visible-post checks and real-view deduplication
-- verbatim. Fail closed if another release changed the projection unexpectedly.
do $$
declare definition text:=pg_get_functiondef('security_ingress.post_views(text[],text,date)'::regprocedure);
  old_expression text:='''views'',coalesce(t.views,0)';
begin
  if (length(definition)-length(replace(definition,old_expression,'')))/length(old_expression)<>1
    then raise exception 'Post view projection changed; inspect integration before deployment'; end if;
  execute replace(definition,old_expression,'''views'',private.editorial_display_views(p.id,coalesce(t.views,0))');
end $$;

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
      'seeded_posts',(select count(*) from private.editorial_view_seeds)) from private.editorial_settings)
  );
$$;

create function private.editorial_configure_tactical_views(enable boolean,minimum integer default 500,maximum integer default 2500) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='10s' set lock_timeout='5s' as $$
begin
  if enable is null or minimum is null or maximum is null or minimum<500 or maximum>2500 or minimum>maximum
    then raise exception 'Choose an enabled flag and a range within 500–2500'; end if;
  perform pg_advisory_xact_lock(hashtextextended('editorial-publishing',0));
  update private.editorial_settings set tactical_views_enabled=enable,tactical_views_min=minimum,tactical_views_max=maximum;
  insert into private.editorial_events(action) values('tactical_views_configured');
  return private.editorial_operator_status();
end $$;
revoke all on function private.editorial_seed_post_views(),private.editorial_display_views(text,bigint),
  private.editorial_operator_status(),private.editorial_configure_tactical_views(boolean,integer,integer)
  from public,anon,authenticated,service_role;
commit;

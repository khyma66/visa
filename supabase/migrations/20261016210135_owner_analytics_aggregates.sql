begin;
set local lock_timeout = '5s';

-- Explicit operator-maintained exclusions. User metadata is never an authority
-- for staff, test or automated accounts. No browser or service key can edit this.
create table private.analytics_excluded_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null check (reason in ('test','demo','automation'))
);
alter table private.analytics_excluded_users enable row level security;
revoke all on private.analytics_excluded_users from public,anon,authenticated,service_role;

create index profiles_analytics_created_idx on public.profiles(created_at,id);
create index answers_analytics_created_idx on public.answers(created_at,author_id,question_id) where status='active';
create index imported_answers_analytics_created_idx on public.imported_answers(created_at,author_id) where status='active';
create index reports_analytics_created_idx on public.community_reports(created_at);

create function private.owner_analytics(period_days integer) returns jsonb
language plpgsql stable security definer
set search_path='' set timezone='UTC' set statement_timeout='5s' as $$
declare
  me uuid := (select auth.uid());
  session_claim text := (select auth.jwt()->>'session_id');
  as_of timestamptz := now();
  window_start timestamptz;
  result jsonb;
begin
  -- Both API and database enforce owner authorization. A still-valid JWT from
  -- a deleted/revoked session must not keep access to this private dashboard.
  if me is null or not private.feedback_is_owner()
    or not exists(select 1 from auth.users u where u.id=me and u.deleted_at is null
      and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=as_of))
    or session_claim is null or session_claim !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then raise exception 'Owner access required' using errcode='42501'; end if;
  if not exists(select 1 from auth.sessions s where s.id=session_claim::uuid and s.user_id=me
    and (s.not_after is null or s.not_after>as_of))
  then raise exception 'Owner access required' using errcode='42501'; end if;
  if period_days is null or period_days not in (7,30,90) then
    raise exception 'Choose a 7, 30 or 90 day window' using errcode='22023';
  end if;
  window_start := date_trunc('day',as_of at time zone 'UTC') at time zone 'UTC'
    - make_interval(days=>period_days-1);

  with humans as materialized (
    select p.id,p.created_at from public.profiles p join auth.users u on u.id=p.id
    where not coalesce(u.is_anonymous,false) and u.deleted_at is null
      and not exists(select 1 from private.feedback_owner o where o.user_id=p.id)
      and not exists(select 1 from private.community_moderators m where m.user_id=p.id)
      and not exists(select 1 from private.analytics_excluded_users e where e.user_id=p.id)
  ), questions_current as materialized (
    select q.id,q.author_id,q.created_at,q.post_kind from public.questions q
      join humans h on h.id=q.author_id
    where q.status<>'archived' and q.created_at<as_of
  ), questions_window as materialized (
    select * from questions_current where created_at>=window_start
  ), answers_current as materialized (
    select a.author_id,a.question_id,a.created_at from public.answers a
      join humans h on h.id=a.author_id join public.questions q on q.id=a.question_id
    where a.status='active' and q.status<>'archived' and q.created_at<as_of
      and a.created_at>=q.created_at and a.created_at<as_of
  ), events as materialized (
    select h.created_at,h.id as author_id,'member'::text as kind from humans h
      where h.created_at>=window_start and h.created_at<as_of
    union all
    select q.created_at,q.author_id,q.post_kind from questions_window q
    union all
    select a.created_at,a.author_id,'answer' from answers_current a where a.created_at>=window_start
    union all
    select a.created_at,a.author_id,'imported_reply' from public.imported_answers a
      join humans h on h.id=a.author_id where a.status='active' and a.created_at>=window_start and a.created_at<as_of
  ), first_answers as materialized (
    select q.id,q.created_at,min(a.created_at) as first_answer_at from questions_current q
      left join answers_current a on a.question_id=q.id and a.author_id<>q.author_id
    where q.post_kind='question' group by q.id,q.created_at
  ), quality as (
    select count(*) filter(where created_at>=window_start) as questions_in_window,
      count(*) filter(where created_at>=window_start and first_answer_at is not null) as questions_with_human_answer,
      round((percentile_cont(0.5) within group(order by extract(epoch from(first_answer_at-created_at))/3600)
        filter(where created_at>=window_start and first_answer_at is not null))::numeric,2) as median_first_answer_hours,
      count(*) filter(where first_answer_at is null) as unanswered_questions_current from first_answers
  ), daily_counts as (
    select (created_at at time zone 'UTC')::date as day,
      count(*) filter(where kind='member') as members_joined,
      count(*) filter(where kind='question') as questions_created,
      count(*) filter(where kind='experience') as experiences_created,
      count(*) filter(where kind='answer') as answers_created,
      count(*) filter(where kind='imported_reply') as imported_replies_created,
      count(distinct author_id) filter(where kind<>'member') as distinct_contributors
    from events group by (created_at at time zone 'UTC')::date
  )
  select jsonb_build_object(
    'schema_version',1,'generated_at',as_of,
    'window',jsonb_build_object('days',period_days,'start_inclusive',window_start,'end_exclusive',as_of,
      'timezone','UTC','includes_partial_today',true),
    'overview',(select jsonb_build_object(
      'members_joined',count(*) filter(where kind='member'),
      'questions_created',count(*) filter(where kind='question'),
      'experiences_created',count(*) filter(where kind='experience'),
      'answers_created',count(*) filter(where kind='answer'),
      'imported_replies_created',count(*) filter(where kind='imported_reply'),
      'distinct_contributors',count(distinct author_id) filter(where kind<>'member')) from events),
    'quality',(select jsonb_build_object('questions_in_window',questions_in_window,
      'questions_with_human_answer',questions_with_human_answer,
      'answer_rate_percent',round(100.0*questions_with_human_answer/nullif(questions_in_window,0),1),
      'median_first_answer_hours',median_first_answer_hours,
      'unanswered_questions_current',unanswered_questions_current) from quality),
    'operations',jsonb_build_object(
      'reports_received',(select count(*) from public.community_reports where created_at>=window_start and created_at<as_of),
      'reports_pending_current',(select count(*) from public.community_reports where status='pending' and created_at<as_of),
      'feedback_received',(select count(*) from private.feedback_items where created_at>=window_start and created_at<as_of),
      'feedback_pending_current',(select count(*) from private.feedback_items where status in ('new','reviewing','planned','approved') and created_at<as_of)),
    'daily',(select jsonb_agg(jsonb_build_object('date',days.day,
      'members_joined',coalesce(d.members_joined,0),'questions_created',coalesce(d.questions_created,0),
      'experiences_created',coalesce(d.experiences_created,0),'answers_created',coalesce(d.answers_created,0),
      'imported_replies_created',coalesce(d.imported_replies_created,0),'distinct_contributors',coalesce(d.distinct_contributors,0)) order by days.day)
      from (select (window_start at time zone 'UTC')::date+n as day from generate_series(0,period_days-1) n) days
      left join daily_counts d on d.day=days.day),
    'limitations',jsonb_build_array(
      'Current retained records, not an immutable event history; deletion, archiving and account-role changes can change previous totals.',
      'Community counts exclude the owner, moderators, anonymous/deleted accounts and explicitly marked test, demo or automation accounts. Other fixture accounts must be marked by the operator.',
      'Contributors are distinct members who posted or replied, not visitors or sign-ins; daily distinct counts must not be summed for the period.',
      'Answer quality covers native questions only and requires an active reply by another eligible member. It excludes self, staff and archived replies.',
      'Native reply counts include replies to questions and experiences. Imported replies are member replies to imported threads, not external source posts.',
      'Pending operations and unanswered questions are current inventory across all dates. Reports and feedback include all submitters, including staff.',
      'Retention, visits, returning contributors, source-import freshness, AI and revenue are not measured by this database snapshot.'
    )
  ) into result;
  return result;
end $$;

-- PostgREST applies the exposed function's timeout before query execution.
create function public.owner_analytics(period_days integer default 30) returns jsonb
language sql stable security invoker set search_path='' set statement_timeout='5s'
as $$ select private.owner_analytics(period_days); $$;

revoke all on function private.owner_analytics(integer),public.owner_analytics(integer)
  from public,anon,authenticated,service_role;
grant execute on function private.owner_analytics(integer),public.owner_analytics(integer) to authenticated;
comment on function public.owner_analytics(integer) is 'Owner-only aggregate snapshot. Requires a live human owner session; contains no user identities or content. Windows are UTC calendar days including partial today.';
comment on table private.analytics_excluded_users is 'Operator-maintained analytics exclusions for known test/demo/automation account UUIDs. Never authorized by user metadata.';
commit;

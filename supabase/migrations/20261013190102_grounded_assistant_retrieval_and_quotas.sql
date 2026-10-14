-- Isolated-dev rollout first. Content retrieval always uses the caller's RLS.
begin;
set local lock_timeout = '5s';

-- These support time-window catch-up, including replies to older questions.
create index questions_assistant_recent_idx on public.questions(created_at desc,id desc)
  where status <> 'archived';
create index answers_assistant_recent_idx on public.answers(created_at desc,id desc)
  where status = 'active';

create function public.assistant_sources(
  target_community_id uuid default null,
  query_text text default '', query_tags text[] default '{}',
  since_time timestamptz default null, until_time timestamptz default null,
  result_limit integer default 48, target_question_id uuid default null
) returns table (
  source_id text, source_kind text, question_id uuid, community_id uuid,
  title text, body text, created_at timestamptz, updated_at timestamptz,
  parent_context text, parent_updated_at timestamptz
) language plpgsql volatile security invoker set search_path = '' as $$
declare
  any_terms tsquery;
  all_terms tsquery;
  terms_text text;
  question_filter text := '';
  answer_filter text := '';
  bounded_limit integer := least(greatest(coalesce(result_limit,48),1),48)+1;
  searching boolean := trim(coalesce(query_text,'')) <> '';
  statement text;
begin
  -- This RPC is also callable through PostgREST. Enforce the same account and
  -- resource guard here so direct clients cannot bypass the Worker endpoint.
  if not coalesce((select r.allowed from public.check_assistant_request_rate() r),false) then
    raise exception 'Assistant request rate exceeded' using errcode='PT429';
  end if;
  if char_length(coalesce(query_text,'')) > 1500 or cardinality(query_tags) > 16
      or exists(select 1 from unnest(query_tags) t where t is null or char_length(t)>60) then
    raise exception 'Invalid assistant search' using errcode='22023';
  end if;
  if (since_time is null) <> (until_time is null) or
      (since_time is not null and (since_time >= until_time or until_time-since_time > interval '31 days')) then
    raise exception 'Assistant window must be at most 31 days' using errcode='22023';
  end if;
  -- OR terms retain useful evidence for natural-language questions, while
  -- matching the complete query receives a relevance bonus. No raw tsquery or
  -- SQL text supplied by the user is interpolated into the statement.
  select string_agg(quote_literal(t),' | ') into terms_text from (
    select unnest(tsvector_to_array(to_tsvector('english',coalesce(query_text,'')))) t limit 24
  ) lexical;
  any_terms := to_tsquery('simple',coalesce(terms_text,''));
  all_terms := plainto_tsquery('english',coalesce(query_text,''));
  if target_community_id is not null then
    question_filter := question_filter || ' and q.community_id=$1';
    answer_filter := answer_filter || ' and q.community_id=$1';
  end if;
  if target_question_id is not null then
    question_filter := question_filter || ' and q.id=$7';
    answer_filter := answer_filter || ' and a.question_id=$7';
  end if;
  if since_time is not null then
    question_filter := question_filter || ' and q.created_at >= $4 and q.created_at < $5';
    answer_filter := answer_filter || ' and a.created_at >= $4 and a.created_at < $5';
  end if;
  if searching then
    question_filter := question_filter || ' and (q.search_document @@ $2 or q.tags && $3)';
    answer_filter := answer_filter || ' and (a.search_document @@ $2 or a.topic_tags && $3)';
  end if;
  -- Join current invoker views BEFORE limiting. Future view-level moderation
  -- predicates must not be bypassed by an older assistant implementation.
  -- Each candidate pool is bounded; we return one lookahead row so the server
  -- can disclose incomplete coverage instead of claiming an exhaustive digest.
  statement := 'with question_candidates as materialized (
    select q.id,q.community_id,f.title,f.body,f.created_at,f.updated_at,
      (ts_rank_cd(q.search_document,$8)*4 + ts_rank_cd(q.search_document,$2)
        + case when q.tags && $3 then 1 else 0 end)::real score
    from public.questions q join public.question_feed f on f.id=q.id
    where q.status<>''archived''' || question_filter || '
    order by score desc,q.created_at desc,q.id desc limit 49
  ), answer_candidates as materialized (
    select a.id,a.question_id,q.community_id,qf.title,af.body,af.created_at,af.updated_at,
      left(qf.body,1000) parent_context,qf.updated_at parent_updated_at,
      (ts_rank_cd(a.search_document,$8)*4 + ts_rank_cd(a.search_document,$2)
        + case when a.topic_tags && $3 then 1 else 0 end)::real score
    from public.answers a join public.answer_feed af on af.id=a.id
    join public.questions q on q.id=a.question_id
    join public.question_feed qf on qf.id=q.id
    where a.status=''active'' and q.status<>''archived''' || answer_filter || '
    order by score desc,a.created_at desc,a.id desc limit 49
  ), candidates as (
    select ''q:''||q.id source_id,''question'' source_kind,q.id question_id,q.community_id,
      q.title,q.body,q.created_at,q.updated_at,q.score,null::text parent_context,null::timestamptz parent_updated_at from question_candidates q
    union all
    select ''a:''||a.id,''reply'',a.question_id,a.community_id,
      a.title,a.body,a.created_at,a.updated_at,a.score,a.parent_context,a.parent_updated_at from answer_candidates a
  ) select c.source_id,c.source_kind,c.question_id,c.community_id,c.title,c.body,c.created_at,c.updated_at,c.parent_context,c.parent_updated_at
    from candidates c order by c.score desc,c.created_at desc,c.source_id limit $6';
  return query execute statement using target_community_id,any_terms,coalesce(query_tags,'{}'),
    since_time,until_time,bounded_limit,target_question_id,all_terms;
end $$;
revoke all on function public.assistant_sources(uuid,text,text[],timestamptz,timestamptz,integer,uuid) from public,anon,authenticated;
grant execute on function public.assistant_sources(uuid,text,text[],timestamptz,timestamptz,integer,uuid) to authenticated;

-- Budget state is private and contains counts only, never prompts or answers.
create table private.assistant_global_usage (
  usage_day date primary key,
  requests integer not null default 0 check(requests between 0 and 500)
);
create table private.assistant_user_usage (
  usage_day date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  requests integer not null default 0 check(requests between 0 and 20),
  primary key(usage_day,user_id)
);
create index assistant_user_usage_user_idx on private.assistant_user_usage(user_id);
create table private.assistant_burst_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  minute_start timestamptz not null,
  requests integer not null check(requests between 1 and 4)
);
create table private.assistant_request_windows (
  user_id uuid primary key references auth.users(id) on delete cascade,
  minute_start timestamptz not null,
  requests integer not null check(requests between 1 and 30)
);
alter table private.assistant_global_usage enable row level security;
alter table private.assistant_user_usage enable row level security;
alter table private.assistant_burst_usage enable row level security;
alter table private.assistant_request_windows enable row level security;
revoke all on private.assistant_global_usage,private.assistant_user_usage,private.assistant_burst_usage,private.assistant_request_windows
  from public,anon,authenticated,service_role;

-- This separate cheap gate runs before retrieval/cache lookup, so requests with
-- no evidence or a cached response cannot bypass all backend resource limits.
create function private.check_assistant_request_rate()
returns table(allowed boolean,reset_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare
  me uuid := (select auth.uid());
  minute_bucket timestamptz := date_trunc('minute',clock_timestamp());
  used integer;
begin
  if me is null or coalesce((select auth.jwt()->>'is_anonymous'),'false')='true' then
    raise exception 'Registered authentication required' using errcode='42501';
  end if;
  if not exists(select 1 from public.profiles where id=me)
      or exists(select 1 from private.community_suspensions where user_id=me) then
    raise exception 'Account unavailable' using errcode='42501';
  end if;
  insert into private.assistant_request_windows as w(user_id,minute_start,requests) values(me,minute_bucket,1)
    on conflict(user_id) do update set minute_start=excluded.minute_start,
      requests=case when w.minute_start=excluded.minute_start then w.requests+1 else 1 end
      where w.minute_start<>excluded.minute_start or w.requests<30
    returning requests into used;
  return query select used is not null,minute_bucket+interval '1 minute';
end $$;
create function public.check_assistant_request_rate()
returns table(allowed boolean,reset_at timestamptz)
language sql security invoker set search_path='' as $$select * from private.check_assistant_request_rate()$$;
revoke all on function private.check_assistant_request_rate(),public.check_assistant_request_rate() from public,anon,authenticated,service_role;
grant execute on function private.check_assistant_request_rate(),public.check_assistant_request_rate() to authenticated;

create function private.reserve_assistant_request()
returns table(allowed boolean,reason text,remaining_user integer,reset_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare
  me uuid := (select auth.uid());
  current_time_utc timestamptz := clock_timestamp();
  today_utc date := (current_time_utc at time zone 'UTC')::date;
  next_day timestamptz := (today_utc+1)::timestamp at time zone 'UTC';
  minute_bucket timestamptz := date_trunc('minute',current_time_utc);
  global_used integer;
  user_used integer;
  burst_used integer;
begin
  if me is null or coalesce((select auth.jwt()->>'is_anonymous'),'false')='true' then
    raise exception 'Registered authentication required' using errcode='42501';
  end if;
  if not exists(select 1 from public.profiles where id=me)
      or exists(select 1 from private.community_suspensions where user_id=me) then
    raise exception 'Account unavailable' using errcode='42501';
  end if;
  insert into private.assistant_global_usage(usage_day) values(today_utc) on conflict do nothing;
  -- One fixed lock order serializes grants across every Worker isolate. There
  -- is no caller-provided user id, budget, day, or way to reset these counters.
  select requests into global_used from private.assistant_global_usage where usage_day=today_utc for update;
  select coalesce((select requests from private.assistant_user_usage where usage_day=today_utc and user_id=me),0) into user_used;
  select coalesce((select requests from private.assistant_burst_usage where user_id=me and minute_start=minute_bucket),0) into burst_used;
  if global_used >= 500 then return query select false,'global_daily_limit'::text,greatest(20-user_used,0),next_day; return; end if;
  if user_used >= 20 then return query select false,'user_daily_limit'::text,0,next_day; return; end if;
  if burst_used >= 4 then return query select false,'user_minute_limit'::text,20-user_used,minute_bucket+interval '1 minute'; return; end if;
  update private.assistant_global_usage set requests=requests+1 where usage_day=today_utc;
  insert into private.assistant_user_usage as u(usage_day,user_id,requests) values(today_utc,me,1)
    on conflict(usage_day,user_id) do update set requests=u.requests+1;
  insert into private.assistant_burst_usage as b(user_id,minute_start,requests) values(me,minute_bucket,1)
    on conflict(user_id) do update set minute_start=excluded.minute_start,
      requests=case when b.minute_start=excluded.minute_start then b.requests+1 else 1 end;
  -- Once per new UTC day, retain only 30 days of aggregate accounting.
  if global_used=0 then
    delete from private.assistant_user_usage where usage_day<today_utc-30;
    delete from private.assistant_global_usage where usage_day<today_utc-30;
    delete from private.assistant_burst_usage where minute_start<current_time_utc-interval '30 days';
    delete from private.assistant_request_windows where minute_start<current_time_utc-interval '30 days';
  end if;
  return query select true,'reserved'::text,19-user_used,next_day;
end $$;
create function public.reserve_assistant_request()
returns table(allowed boolean,reason text,remaining_user integer,reset_at timestamptz)
language sql security invoker set search_path='' as $$select * from private.reserve_assistant_request()$$;
revoke all on function private.reserve_assistant_request(),public.reserve_assistant_request() from public,anon,authenticated,service_role;
grant usage on schema private to authenticated;
grant execute on function private.reserve_assistant_request(),public.reserve_assistant_request() to authenticated;

commit;

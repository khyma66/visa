-- Additive rollout: deploy this RPC before the application; keep v1 for rollback.
begin;
set local lock_timeout = '5s';

create function public.assistant_sources_v2(
  target_community_id uuid default null,
  query_text text default '', query_tags text[] default '{}',
  since_time timestamptz default null, until_time timestamptz default null,
  result_limit integer default 48, target_question_id uuid default null,
  required_locations text[] default '{}', required_visas text[] default '{}',
  required_event text default null, sort_newest boolean default false
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
  if not coalesce((select r.allowed from public.check_assistant_request_rate() r),false) then
    raise exception 'Assistant request rate exceeded' using errcode='PT429';
  end if;
  if char_length(coalesce(query_text,'')) > 1500 or cardinality(query_tags) > 16
      or exists(select 1 from unnest(query_tags) t where t is null or char_length(t)>60)
      or required_locations is null or cardinality(required_locations)>80
      or exists(select 1 from unnest(required_locations) t where t is null or char_length(t)>60 or t !~ '^[a-z][a-z0-9 ]{0,59}$')
      or required_visas is null or cardinality(required_visas)>16
      or exists(select 1 from unnest(required_visas) t where t is null or t !~ '^([hflbjo][124]b?|e3)$')
      or (required_event is not null and required_event not in ('stamping','biometrics','passport-delivery'))
      or sort_newest is null then
    raise exception 'Invalid assistant search' using errcode='22023';
  end if;
  -- Ask search can use a stated year; existing catch-up remains capped at 31
  -- days by its request parser and the unchanged v1 function.
  if (since_time is null) <> (until_time is null) or
      (since_time is not null and (since_time >= until_time or until_time-since_time > interval '366 days')) then
    raise exception 'Assistant window must be at most 366 days' using errcode='22023';
  end if;
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
  -- Invoker views and hard entity constraints are evaluated BEFORE candidate
  -- limits. Literal bounded words, not caller-supplied regular expressions.
  statement := $query$with question_eligible as (
    select q.id,q.community_id,f.title,f.body,f.created_at,f.updated_at,
      (ts_rank_cd(q.search_document,$8)*4 + ts_rank_cd(q.search_document,$2)
        + case when q.tags && $3 then 1 else 0 end)::real score,
      ' '||regexp_replace(regexp_replace(lower(f.title||' '||f.body),
        '\m([hflbjoe])[- ]?([1234])[- ]?(b?)\M','\1\2\3','g'),'[^a-z0-9]+',' ','g')||' ' content
    from public.questions q join public.question_feed f on f.id=q.id
    where q.status<>'archived'$query$ || question_filter || $query$
  ), answer_eligible as (
    select a.id,a.question_id,q.community_id,qf.title,af.body,af.created_at,af.updated_at,
      left(qf.body,1000) parent_context,qf.updated_at parent_updated_at,
      (ts_rank_cd(a.search_document,$8)*4 + ts_rank_cd(a.search_document,$2)
        + case when a.topic_tags && $3 then 1 else 0 end)::real score,
      ' '||regexp_replace(regexp_replace(lower(qf.title||' '||af.body||' '||left(qf.body,1000)),
        '\m([hflbjoe])[- ]?([1234])[- ]?(b?)\M','\1\2\3','g'),'[^a-z0-9]+',' ','g')||' ' content
    from public.answers a join public.answer_feed af on af.id=a.id
    join public.questions q on q.id=a.question_id
    join public.question_feed qf on qf.id=q.id
    where a.status='active' and q.status<>'archived'$query$ || answer_filter || $query$
  ), eligible as (
    select 'q:'||q.id source_id,'question' source_kind,q.id question_id,q.community_id,
      q.title,q.body,q.created_at,q.updated_at,q.score,q.content,null::text parent_context,null::timestamptz parent_updated_at from question_eligible q
    union all
    select 'a:'||a.id,'reply',a.question_id,a.community_id,
      a.title,a.body,a.created_at,a.updated_at,a.score,a.content,a.parent_context,a.parent_updated_at from answer_eligible a
  ) select c.source_id,c.source_kind,c.question_id,c.community_id,c.title,c.body,c.created_at,c.updated_at,c.parent_context,c.parent_updated_at
    from eligible c
    where (cardinality($9)=0 or exists(select 1 from unnest($9) t where position(' '||t||' ' in c.content)>0))
      and (cardinality($10)=0 or exists(select 1 from unnest($10) t where position(' '||t||' ' in c.content)>0))
      and ($11 is null or c.content ~ case $11
        when 'stamping' then '\m(stamp(ing|ed|s)?|drop ?box|221 ?g|administrative processing|consular processing|visa (interview|issuance|issued|appointment))\M|\mpassport\M.{0,60}\m(visa|consulate|embassy|ceac)\M'
        when 'biometrics' then '\m(biometric[a-z]*|fingerprints?)\M'
        when 'passport-delivery' then '\mpassport\M' end)
    order by case when $12 then c.created_at end desc nulls last,c.score desc,c.created_at desc,c.source_id limit $6$query$;
  return query execute statement using target_community_id,any_terms,coalesce(query_tags,'{}'),
    since_time,until_time,bounded_limit,target_question_id,all_terms,required_locations,required_visas,required_event,sort_newest;
end $$;
revoke all on function public.assistant_sources_v2(uuid,text,text[],timestamptz,timestamptz,integer,uuid,text[],text[],text,boolean) from public,anon,authenticated;
grant execute on function public.assistant_sources_v2(uuid,text,text[],timestamptz,timestamptz,integer,uuid,text[],text[],text,boolean) to authenticated;
comment on function public.assistant_sources_v2(uuid,text,text[],timestamptz,timestamptz,integer,uuid,text[],text[],text,boolean)
  is 'Caller-scoped, rate-limited assistant search with pre-limit location, visa, event and posting-date eligibility; v1 remains available for rollback.';
commit;

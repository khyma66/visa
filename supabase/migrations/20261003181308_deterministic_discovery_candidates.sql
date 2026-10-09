begin;
set local lock_timeout = '5s';

-- Bounded candidate pools are deliberately approximate, not a promise of a
-- global top-k ranking. Explicit ordering prevents old physical heap order
-- from permanently excluding new posts/comments on popular topics.
create or replace function public.discover_questions(
  source_id text default null, query_tags text[] default '{}', comment_tags text[] default '{}',
  query_text text default '', filter_visa text default '', result_limit integer default 5
) returns table (id text, title text, visa_type text, tags text[], vote_score integer,
  answer_count integer, created_at timestamptz, similarity_score real, matched_tags text[])
language sql stable security invoker set search_path = '' as $$
  with input as (
    select query_tags[1:16] as tags,
      websearch_to_tsquery('english', left(query_text, 500)) as terms
  ), candidates as materialized (
    (select q.id from public.questions q, input i
      where q.status <> 'archived' and q.id::text is distinct from source_id and q.tags && i.tags
      order by q.created_at desc,q.id desc limit 200)
    union
    (select q.id from public.questions q, input i
      where q.status <> 'archived' and q.id::text is distinct from source_id and q.search_document @@ i.terms
      order by ts_rank(q.search_document,i.terms) desc,q.created_at desc,q.id desc limit 200)
    union
    (select a.question_id from public.answers a, input i
      where a.status = 'active' and a.question_id::text is distinct from source_id and a.topic_tags && i.tags
      order by a.created_at desc,a.id desc limit 200)
    union
    (select a.question_id from public.answers a, input i
      where a.status = 'active' and a.question_id::text is distinct from source_id and a.search_document @@ i.terms
      order by ts_rank(a.search_document,i.terms) desc,a.created_at desc,a.id desc limit 200)
  ), ranked as (
    select q.*, matches.shared,
      (cardinality(matches.shared) * 2
        + (select count(*) from unnest(matches.shared) t where t = any(comment_tags[1:16])) * 4
        + least(ts_rank(q.search_document, i.terms) * 4, 4)
        + case when q.visa_type = filter_visa and filter_visa <> 'General' then 0.5 else 0 end)::real as score
    from candidates c join public.questions q on q.id = c.id cross join input i
    cross join lateral (
      select array(select distinct t from unnest(i.tags) t
        where t = any(q.tags) or exists (
          select 1 from public.answers a where a.question_id = q.id and a.status = 'active' and t = any(a.topic_tags)
        ) order by t) as shared
    ) matches
    where q.id::text is distinct from source_id and q.status <> 'archived'
  ) select r.id::text, r.title, r.visa_type, r.tags, r.vote_score, r.answer_count, r.created_at, r.score, r.shared
    from ranked r order by r.score desc, r.vote_score desc, r.created_at desc, r.id
    limit least(greatest(result_limit, 1), 12);
$$;
revoke all on function public.discover_questions(text,text[],text[],text,text,integer) from public;
grant execute on function public.discover_questions(text,text[],text[],text,text,integer) to anon, authenticated;

create or replace function public.discover_community(
  source_id text default null, query_tags text[] default '{}', comment_tags text[] default '{}',
  query_text text default '', filter_visa text default '', result_limit integer default 5
) returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'native', coalesce((select jsonb_agg(to_jsonb(q)) from public.discover_questions(source_id,query_tags,comment_tags,query_text,filter_visa,result_limit) q),'[]'::jsonb),
    'imported_topics', coalesce((
      with candidates as materialized (
        select a.question_id,a.topic_tags from public.imported_answers a
        where a.status='active' and a.question_id is distinct from source_id and a.topic_tags && query_tags[1:16]
        order by a.created_at desc,a.id desc limit 200
      ), grouped as (
        select question_id,array_agg(distinct t) as tags from candidates c cross join lateral unnest(c.topic_tags) t
        where t = any(query_tags[1:16]) group by question_id
      ) select jsonb_object_agg(question_id,to_jsonb(tags)) from grouped
    ),'{}'::jsonb)
  );
$$;
revoke all on function public.discover_community(text,text[],text[],text,text,integer) from public;
grant execute on function public.discover_community(text,text[],text[],text,text,integer) to anon,authenticated;

commit;

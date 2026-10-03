create index imported_answers_topics_idx on public.imported_answers using gin(topic_tags) where status='active';

-- One indexed lookup returns native results and topic hints for the imported
-- development archive. No comment body or private message content is returned.
create function public.discover_community(
  source_id text default null, query_tags text[] default '{}', comment_tags text[] default '{}',
  query_text text default '', filter_visa text default '', result_limit integer default 5
) returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'native', coalesce((select jsonb_agg(to_jsonb(q)) from public.discover_questions(source_id,query_tags,comment_tags,query_text,filter_visa,result_limit) q),'[]'::jsonb),
    'imported_topics', coalesce((
      with candidates as materialized (
        select a.question_id,a.topic_tags from public.imported_answers a
        where a.status='active' and a.topic_tags && query_tags[1:16] limit 200
      ), grouped as (
        select question_id,array_agg(distinct t) as tags from candidates c cross join lateral unnest(c.topic_tags) t
        where t = any(query_tags[1:16]) group by question_id
      ) select jsonb_object_agg(question_id,to_jsonb(tags)) from grouped
    ),'{}'::jsonb)
  );
$$;
revoke all on function public.discover_community(text,text[],text[],text,text,integer) from public;
grant execute on function public.discover_community(text,text[],text[],text,text,integer) to anon,authenticated;

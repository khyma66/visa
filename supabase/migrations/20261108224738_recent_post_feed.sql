-- Recent feed only: preserve historical posts, direct links, and existing RPC callers.
-- Apply the date predicate before sorting and LIMIT; retain invoker RLS.
create function public.recent_community_post_page(
  query_text text default '', filter_tag text default '', filter_visa text default '', sort_mode text default 'newest',
  before_time timestamptz default null, before_id uuid default null, before_score integer default null,
  filter_kind text default 'question', filter_category text default ''
) returns setof public.question_feed language sql stable security invoker set search_path = '' as $$
  select f.* from public.questions q join public.question_feed f on f.id=q.id
  where q.status <> 'archived' and q.post_kind = filter_kind
    and q.created_at >= ((now() at time zone 'UTC') - interval '2 months') at time zone 'UTC'
    and (filter_category = '' or q.experience_category = filter_category)
    and (query_text = '' or q.search_document @@ websearch_to_tsquery('english',left(query_text,500)))
    and (filter_tag = '' or q.tags @> array[filter_tag])
    and (filter_visa = '' or q.visa_type = filter_visa)
    and (sort_mode <> 'unanswered' or q.answer_count = 0)
    and (before_time is null or (
      case sort_mode when 'score' then q.vote_score when 'activity' then q.vote_score + q.answer_count * 2 else 0 end,
      q.created_at,q.id
    ) < (coalesce(before_score,0),before_time,before_id))
  order by case sort_mode when 'score' then q.vote_score when 'activity' then q.vote_score + q.answer_count * 2 else 0 end desc,
    q.created_at desc,q.id desc limit 50;
$$;
revoke all on function public.recent_community_post_page(text,text,text,text,timestamptz,uuid,integer,text,text) from public;
grant execute on function public.recent_community_post_page(text,text,text,text,timestamptz,uuid,integer,text,text) to anon,authenticated;


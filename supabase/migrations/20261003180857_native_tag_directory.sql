begin;
set local lock_timeout = '5s';

-- MVP aggregate: counts only rows visible under the caller's question RLS.
-- Archive summaries are presentation inputs, never authorization or stored data.
-- At larger scale replace the full aggregate with maintained per-tag counters.
create function public.community_tag_page(
  query_text text default '', sort_mode text default 'popular',
  after_tag text default null, before_count bigint default null,
  archive_counts jsonb default '[]'::jsonb
) returns table(tag text, question_count bigint, native_count bigint, archive_count bigint, example_title text)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if jsonb_typeof(archive_counts) is distinct from 'array' or jsonb_array_length(archive_counts)>1000 then
    raise exception 'Invalid archive tag summary';
  end if;
  if sort_mode is null or sort_mode not in ('popular','name') then raise exception 'Invalid tag sort'; end if;
  return query with native as (
    select t.slug, count(*)::bigint as count, min(left(q.title,160)) as example
    from public.questions q
    cross join lateral (select distinct value as slug from unnest(q.tags) value
      where value ~ '^[a-z0-9-]{1,40}$') t
    where q.status<>'archived' and position(lower(left(trim(coalesce(query_text,'')),40)) in t.slug)>0
    group by t.slug
  ), archive as (
    select item->>'tag' as slug,
      max(case when item->>'count' ~ '^[0-9]{1,7}$' then least((item->>'count')::bigint,5000) else 0 end) as count,
      min(left(item->>'example',160)) as example
    from jsonb_array_elements(archive_counts) item
    where item->>'tag' ~ '^[a-z0-9-]{1,40}$'
      and position(lower(left(trim(coalesce(query_text,'')),40)) in item->>'tag')>0
    group by item->>'tag'
  ), combined as (
    select coalesce(n.slug,a.slug) as slug,
      coalesce(n.count,0)+coalesce(a.count,0) as count,
      coalesce(n.count,0) as native_count, coalesce(a.count,0) as archive_count,
      coalesce(n.example,a.example,'') as example
    from native n full outer join archive a on n.slug=a.slug
  )
  select c.slug,c.count,c.native_count,c.archive_count,c.example
  from combined c where c.count>0 and (after_tag is null
    or (sort_mode='name' and c.slug>after_tag)
    or (sort_mode='popular' and (c.count<before_count or (c.count=before_count and c.slug>after_tag))))
  order by case when sort_mode='popular' then c.count else 0 end desc,c.slug asc limit 51;
end;
$$;
revoke all on function public.community_tag_page(text,text,text,bigint,jsonb) from public;
grant execute on function public.community_tag_page(text,text,text,bigint,jsonb) to anon,authenticated;

commit;

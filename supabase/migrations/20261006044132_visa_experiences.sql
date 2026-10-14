-- Experiences share the existing ownership, moderation, policy and rate-limit guards.
alter table public.questions
  add column post_kind text not null default 'question' check (post_kind in ('question','experience')),
  add column experience_category text,
  add constraint questions_experience_category_check check (
    (post_kind = 'question' and experience_category is null) or
    (post_kind = 'experience' and experience_category is not null and experience_category in (
      'Visa interview','Application & documents','Approval & timeline','Refusal & reapplication',
      'Renewal & extension','Travel & arrival','Other'))
  ),
  add constraint experiences_have_no_accepted_answer check (post_kind <> 'experience' or accepted_answer_id is null);
grant insert(post_kind,experience_category), update(experience_category) on public.questions to authenticated;

create or replace view public.question_feed with (security_invoker = true) as
select q.id,q.author_id,p.username as author_username,p.avatar_seed as author_avatar_seed,
  q.title,q.body,q.destination_country,q.visa_type,q.tags,q.status,q.vote_score,
  q.answer_count,q.view_count,q.accepted_answer_id,q.created_at,q.updated_at,q.post_kind,q.experience_category
from public.questions q join public.profiles p on p.id=q.author_id where q.status <> 'archived';

create index questions_kind_newest_idx on public.questions(post_kind,created_at desc,id desc) where status <> 'archived';
create index questions_experience_category_idx on public.questions(experience_category,created_at desc,id desc)
  where status <> 'archived' and post_kind = 'experience';

-- Filter before pagination, so a sparse category cannot disappear behind a full page.
create function public.community_post_page(
  query_text text default '', filter_tag text default '', filter_visa text default '', sort_mode text default 'newest',
  before_time timestamptz default null, before_id uuid default null, before_score integer default null,
  filter_kind text default 'question', filter_category text default ''
) returns setof public.question_feed language sql stable security invoker set search_path = '' as $$
  select f.* from public.questions q join public.question_feed f on f.id=q.id
  where q.status <> 'archived' and q.post_kind = filter_kind
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
revoke all on function public.community_post_page(text,text,text,text,timestamptz,uuid,integer,text,text) from public;
grant execute on function public.community_post_page(text,text,text,text,timestamptz,uuid,integer,text,text) to anon,authenticated;

-- Older clients retain their question-only feed during deployment.
create or replace function public.community_question_page(
  query_text text default '', filter_tag text default '', filter_visa text default '', sort_mode text default 'newest',
  before_time timestamptz default null, before_id uuid default null, before_score integer default null
) returns setof public.question_feed language sql stable security invoker set search_path = '' as $$
  select * from public.community_post_page(query_text,filter_tag,filter_visa,sort_mode,before_time,before_id,before_score,'question','');
$$;

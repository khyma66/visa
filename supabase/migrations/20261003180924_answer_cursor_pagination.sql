begin;
set local lock_timeout = '5s';

create index answers_rank_page_idx on public.answers(question_id,is_accepted desc,vote_score desc,id desc)
  where status='active';
create index imported_answers_rank_page_idx on public.imported_answers(question_id,is_accepted desc,vote_score desc,id desc)
  where status='active';

-- One lookahead row determines whether another page exists. The caller shows
-- 50 rows and uses its last displayed row as the next cursor, not the lookahead.
-- Both functions are invokers; archived-parent and answer RLS remain in force.
create function public.answer_page(
  target_question uuid, before_accepted boolean default null,
  before_score integer default null, before_id uuid default null
) returns setof public.answer_feed language sql stable security invoker set search_path='' as $$
  select a.* from public.answer_feed a
  where a.question_id=target_question and a.status='active'
    and (before_id is null or (a.is_accepted,a.vote_score,a.id) < (before_accepted,before_score,before_id))
  order by a.is_accepted desc,a.vote_score desc,a.id desc limit 51;
$$;
create function public.imported_answer_page(
  target_question text, before_accepted boolean default null,
  before_score integer default null, before_id uuid default null
) returns setof public.imported_answer_feed language sql stable security invoker set search_path='' as $$
  select a.* from public.imported_answer_feed a
  where a.question_id=target_question and a.status='active'
    and (before_id is null or (a.is_accepted,a.vote_score,a.id) < (before_accepted,before_score,before_id))
  order by a.is_accepted desc,a.vote_score desc,a.id desc limit 51;
$$;
revoke all on function public.answer_page(uuid,boolean,integer,uuid),public.imported_answer_page(text,boolean,integer,uuid)
  from public,anon,authenticated;
grant execute on function public.answer_page(uuid,boolean,integer,uuid),public.imported_answer_page(text,boolean,integer,uuid)
  to anon,authenticated;

commit;

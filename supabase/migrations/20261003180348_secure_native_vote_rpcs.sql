begin;
set local lock_timeout = '5s';

-- PostgREST's generic upsert attempts to UPDATE submitted primary-key columns.
-- Keep those columns immutable to browsers and expose a value-only upsert.
-- SECURITY INVOKER deliberately retains the caller's grants, ownership RLS,
-- parent-visibility policies, and existing rate/suspension triggers.
create function public.vote_question(target_question_id uuid, vote_value integer) returns integer
language plpgsql security invoker set search_path = '' as $$
declare me uuid := (select auth.uid()); score integer;
begin
  if me is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if vote_value is null or vote_value not in (-1,1) then
    raise exception 'Vote must be -1 or 1' using errcode = '22023';
  end if;
  insert into public.question_votes(question_id,user_id,value)
    values(target_question_id,me,vote_value)
    on conflict(question_id,user_id) do update set value=excluded.value;
  select q.vote_score into score from public.questions q where q.id=target_question_id;
  if not found then raise exception 'Question is unavailable' using errcode = '42501'; end if;
  return score;
end $$;

create function public.vote_answer(target_answer_id uuid, vote_value integer) returns integer
language plpgsql security invoker set search_path = '' as $$
declare me uuid := (select auth.uid()); score integer;
begin
  if me is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if vote_value is null or vote_value not in (-1,1) then
    raise exception 'Vote must be -1 or 1' using errcode = '22023';
  end if;
  insert into public.answer_votes(answer_id,user_id,value)
    values(target_answer_id,me,vote_value)
    on conflict(answer_id,user_id) do update set value=excluded.value;
  select a.vote_score into score from public.answers a where a.id=target_answer_id;
  if not found then raise exception 'Answer is unavailable' using errcode = '42501'; end if;
  return score;
end $$;

revoke all on function public.vote_question(uuid,integer), public.vote_answer(uuid,integer)
  from public, anon, authenticated;
grant execute on function public.vote_question(uuid,integer), public.vote_answer(uuid,integer)
  to authenticated;

commit;

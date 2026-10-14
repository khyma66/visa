begin;
set local lock_timeout = '5s';

-- Only the current community's write paths change. Legacy access is separate.
create or replace function private.accept_community_answer(target_answer_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); target_question uuid;
begin
  perform private.community_consume('accept-answer',30,60);
  select q.id into target_question from public.questions q join public.answers a on a.question_id=q.id
    where a.id=target_answer_id and a.status='active' and q.status='open' and q.author_id=me for update of q;
  if target_question is null then raise exception 'Only the question author can accept an answer on an open question'; end if;
  update public.answers a set is_accepted=false where a.question_id=target_question and a.is_accepted;
  update public.answers set is_accepted=true where id=target_answer_id;
  update public.questions set accepted_answer_id=target_answer_id where id=target_question;
end $$;
revoke all on function private.accept_community_answer(uuid) from public,anon;
grant execute on function private.accept_community_answer(uuid) to authenticated;

-- Bio/avatar updates must not be an unmetered publishing path for suspended users.
create trigger community_profile_limit before update of bio,avatar_seed on public.profiles
  for each row execute function private.community_write_guard();

commit;

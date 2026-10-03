begin;
set local lock_timeout = '5s';

-- Parent moderation must apply to every Data API path, not only question_feed.
-- Restrictive policies are ANDed with the existing ownership/status policies;
-- they do not grant access and do not delete or rewrite any existing content.
create policy answers_visible_parent on public.answers
  as restrictive for select to anon, authenticated
  using (exists (
    select 1 from public.questions q
    where q.id = answers.question_id and q.status <> 'archived'
  ));

-- Closed discussions remain readable/votable, but cannot receive new or edited
-- answers. Archived questions are hidden by questions' existing RLS policy.
create policy answers_open_parent_insert on public.answers
  as restrictive for insert to authenticated
  with check (exists (
    select 1 from public.questions q
    where q.id = answers.question_id and q.status = 'open'
  ));
create policy answers_open_parent_update on public.answers
  as restrictive for update to authenticated
  using (exists (
    select 1 from public.questions q
    where q.id = answers.question_id and q.status = 'open'
  ))
  with check (exists (
    select 1 from public.questions q
    where q.id = answers.question_id and q.status = 'open'
  ));

create policy question_votes_visible_target on public.question_votes
  as restrictive for all to authenticated
  using (exists (
    select 1 from public.questions q
    where q.id = question_votes.question_id and q.status <> 'archived'
  ))
  with check (exists (
    select 1 from public.questions q
    where q.id = question_votes.question_id and q.status <> 'archived'
  ));
create policy answer_votes_visible_target on public.answer_votes
  as restrictive for all to authenticated
  using (exists (
    select 1 from public.answers a join public.questions q on q.id = a.question_id
    where a.id = answer_votes.answer_id and a.status = 'active' and q.status <> 'archived'
  ))
  with check (exists (
    select 1 from public.answers a join public.questions q on q.id = a.question_id
    where a.id = answer_votes.answer_id and a.status = 'active' and q.status <> 'archived'
  ));

-- Lock the owning question and recheck the answer in the update itself. If a
-- moderator removes an answer during acceptance, never mark that removed row
-- accepted or leave the question's accepted_answer_id pointing to it.
create or replace function private.accept_community_answer(target_answer_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); target_question uuid;
begin
  perform private.community_consume('accept-answer',30,60);
  select q.id into target_question from public.questions q join public.answers a on a.question_id=q.id
    where a.id=target_answer_id and a.status='active' and q.status='open' and q.author_id=me for update of q;
  if target_question is null then raise exception 'Only the question author can accept an answer on an open question'; end if;
  update public.answers a set is_accepted=false where a.question_id=target_question and a.is_accepted;
  update public.answers set is_accepted=true where id=target_answer_id and question_id=target_question and status='active';
  if not found then raise exception 'This answer is no longer available'; end if;
  update public.questions set accepted_answer_id=target_answer_id where id=target_question;
end $$;
revoke all on function private.accept_community_answer(uuid) from public, anon;
grant execute on function private.accept_community_answer(uuid) to authenticated;

commit;

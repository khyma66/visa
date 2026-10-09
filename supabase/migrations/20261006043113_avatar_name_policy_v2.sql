begin;
set local lock_timeout = '5s';

-- Preserve prior receipts as evidence of what was accepted. A new notice adds
-- private name collection and public first-name initials; old assent is not
-- silently rewritten as acceptance of that change.
drop policy if exists record_current_policy on public.policy_acceptances;
create policy record_current_policy on public.policy_acceptances for insert to authenticated
  with check (user_id = (select auth.uid()) and policy_version = '2026-10-06-preview-v2');

create or replace function private.community_write_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;
  if not exists (select 1 from public.policy_acceptances
      where user_id=(select auth.uid()) and policy_version='2026-10-06-preview-v2') then
    raise exception 'Please review and acknowledge the current community policies.' using errcode='42501';
  end if;
  if tg_table_name='questions' and tg_op='INSERT' then
    perform private.community_consume('question',5,600);
  elsif tg_table_name in ('answers','imported_answers') and tg_op='INSERT' then
    perform private.community_consume('reply',30,600);
  elsif tg_table_name in ('question_votes','answer_votes') then
    perform private.community_consume('vote',120,60);
  else
    perform private.community_consume('community-write',120,60);
  end if;
  return new;
end $$;
revoke all on function private.community_write_guard() from public,anon,authenticated;

commit;

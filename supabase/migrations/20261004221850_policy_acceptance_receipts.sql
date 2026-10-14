begin;
set local lock_timeout = '5s';

-- Minimal evidence; no IP address, user agent, DOB or auth metadata is retained.
create table public.policy_acceptances (
  user_id uuid not null references auth.users(id) on delete cascade,
  policy_version text not null,
  market text not null check (market = 'US'),
  terms_accepted boolean not null check (terms_accepted),
  privacy_acknowledged boolean not null check (privacy_acknowledged),
  adult_confirmed boolean not null check (adult_confirmed),
  accepted_at timestamptz not null default now(),
  primary key (user_id, policy_version)
);
alter table public.policy_acceptances enable row level security;
revoke all on public.policy_acceptances from public, anon, authenticated;
grant select on public.policy_acceptances to authenticated;
-- Callers cannot choose a timestamp, edit an acceptance, or erase its evidence.
grant insert (user_id,policy_version,market,terms_accepted,privacy_acknowledged,adult_confirmed)
  on public.policy_acceptances to authenticated;
create policy own_policy_receipts on public.policy_acceptances for select to authenticated
  using (user_id = (select auth.uid()));
create policy record_current_policy on public.policy_acceptances for insert to authenticated
  with check (user_id = (select auth.uid()) and policy_version = '2026-10-04-preview-v1');

-- Existing triggers cover questions, native/imported answers, votes, new chats,
-- messages and profile publication. Reporting/blocking remain available.
create or replace function private.community_write_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;
  if not exists (select 1 from public.policy_acceptances
      where user_id=(select auth.uid()) and policy_version='2026-10-04-preview-v1') then
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

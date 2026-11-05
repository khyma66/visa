begin;
set local lock_timeout = '5s';

-- Preserve all historical receipts. During rolling deployment both reviewed
-- versions can be recorded; the new UI presents v4 without fabricating assent.
alter policy record_current_policy on public.policy_acceptances to authenticated
  with check (user_id = (select auth.uid()) and policy_version in ('2026-11-02-preview-v3','2026-11-05-preview-v4'));

create or replace function private.community_write_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;
  if not exists (select 1 from public.policy_acceptances
      where user_id=(select auth.uid()) and policy_version in ('2026-11-02-preview-v3','2026-11-05-preview-v4')) then
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

create or replace function private.set_post_award(target text,selected_badge text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid := (select auth.uid()); previous text;
begin
  if me is null or selected_badge is null or selected_badge not in ('helpful','support','insightful') then
    raise exception 'Invalid award request' using errcode='22023'; end if;
  if not exists(select 1 from auth.users u where u.id=me and u.deleted_at is null and not coalesce(u.is_anonymous,false)
    and (u.banned_until is null or u.banned_until<=now())) then raise exception 'Authentication required' using errcode='42501'; end if;
  if not exists(select 1 from public.policy_acceptances p where p.user_id=me and p.policy_version in ('2026-11-02-preview-v3','2026-11-05-preview-v4')) then
    raise exception 'Please review the community policies first' using errcode='42501'; end if;
  if target is null or not private.award_post_visible(target) then raise exception 'Post unavailable' using errcode='42501'; end if;
  if target !~ '^apify-' and exists(select 1 from public.questions q where q.id=target::uuid and q.author_id=me) then
    raise exception 'You cannot award your own post' using errcode='42501'; end if;
  perform private.community_consume('post-award',30,3600);
  perform pg_advisory_xact_lock(hashtextextended(me::text || ':' || target,0));
  select badge into previous from private.post_awards where post_id=target and user_id=me;
  if previous=selected_badge then
    delete from private.post_awards where post_id=target and user_id=me;
  else
    insert into private.post_awards(post_id,user_id,badge) values(target,me,selected_badge)
      on conflict(post_id,user_id) do update set badge=excluded.badge,created_at=now();
  end if;
  return private.post_award_summary(target);
end $$;

commit;

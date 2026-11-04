begin;
set local lock_timeout = '5s';

-- Free appreciation only: one active badge per member per public post.
create table private.post_awards (
  post_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  badge text not null check (badge in ('helpful','support','insightful')),
  created_at timestamptz not null default now(),
  primary key (post_id,user_id)
);
alter table private.post_awards enable row level security;
revoke all on private.post_awards from public,anon,authenticated,service_role;

-- Source discussions are public snapshot IDs; native posts must still be public.
create function private.award_post_visible(target text) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  if target ~ '^apify-[a-zA-Z0-9_-]{1,100}$' then return true; end if;
  if target !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return false; end if;
  return exists(select 1 from public.questions q where q.id=target::uuid and q.status <> 'archived'
    and (q.community_id is null or exists(select 1 from public.communities c where c.id=q.community_id and c.is_public is true and c.is_active is true)));
end $$;

create function private.post_award_summary(target text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if target is null or not private.award_post_visible(target) then raise exception 'Post unavailable' using errcode='42501'; end if;
  select jsonb_build_object('helpful',count(*) filter(where badge='helpful'),
    'support',count(*) filter(where badge='support'), 'insightful',count(*) filter(where badge='insightful'),
    'mine',max(badge) filter(where user_id=(select auth.uid()))) into result
    from private.post_awards where post_id=target;
  return result;
end $$;
create function public.post_award_summary(target text) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.post_award_summary(target); $$;

create function private.set_post_award(target text,selected_badge text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid := (select auth.uid()); previous text;
begin
  if me is null or selected_badge is null or selected_badge not in ('helpful','support','insightful') then
    raise exception 'Invalid award request' using errcode='22023'; end if;
  if not exists(select 1 from auth.users u where u.id=me and u.deleted_at is null and not coalesce(u.is_anonymous,false)
    and (u.banned_until is null or u.banned_until<=now())) then raise exception 'Authentication required' using errcode='42501'; end if;
  if not exists(select 1 from public.policy_acceptances p where p.user_id=me and p.policy_version='2026-11-02-preview-v3') then
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
create function public.set_post_award(target text,selected_badge text) returns jsonb
language sql security invoker set search_path='' as $$ select private.set_post_award(target,selected_badge); $$;

revoke all on function private.award_post_visible(text),private.post_award_summary(text),private.set_post_award(text,text),public.post_award_summary(text),public.set_post_award(text,text) from public,anon,authenticated,service_role;
grant execute on function private.post_award_summary(text),public.post_award_summary(text) to anon,authenticated;
grant execute on function private.set_post_award(text,text),public.set_post_award(text,text) to authenticated;
commit;

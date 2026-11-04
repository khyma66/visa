begin;
set local lock_timeout = '5s';

create table private.post_library (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id text not null,
  saved boolean not null default false,
  followed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(user_id,post_id),
  check (saved or followed)
);
create index post_library_recent on private.post_library(user_id,updated_at desc,post_id);
alter table private.post_library enable row level security;
revoke all on private.post_library from public,anon,authenticated,service_role;

create function private.library_member() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare me uuid := (select auth.uid());
begin
  if me is null or not exists(select 1 from auth.users u where u.id=me and u.deleted_at is null
    and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())) then
    raise exception 'Sign in to use your post library' using errcode='42501';
  end if;
  return me;
end $$;

create function private.library_post_visible(target text) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  if target ~ '^apify-[a-zA-Z0-9_-]{1,100}$' then return true; end if;
  if target is null or target !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return false; end if;
  return exists(select 1 from public.questions q where q.id=target::uuid and q.status<>'archived'
    and (q.community_id is null or exists(select 1 from public.communities c where c.id=q.community_id and c.is_public is true and c.is_active is true)));
end $$;

create function private.post_library_state(targets text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid := private.library_member(); result jsonb;
begin
  if targets is null or cardinality(targets)>100 then raise exception 'Invalid post list' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('post_id',post_id,'saved',saved,'followed',followed)),'[]') into result
    from private.post_library where user_id=me and post_id=any(targets);
  return result;
end $$;
create function public.post_library_state(targets text[]) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.post_library_state(targets); $$;

create function private.set_post_library(target text,selection text,enabled boolean,expected_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid := private.library_member(); entry private.post_library;
begin
  if expected_user is distinct from me then raise exception 'Account changed' using errcode='42501'; end if;
  if target is null or length(target)>106 or selection is null or selection not in ('saved','followed') or enabled is null then
    raise exception 'Invalid library request' using errcode='22023'; end if;
  -- Removing a bookmark remains possible after a post is hidden or removed.
  if enabled and not private.library_post_visible(target) then raise exception 'Post unavailable' using errcode='42501'; end if;
  perform private.community_consume('post-library',120,3600);
  perform pg_advisory_xact_lock(hashtextextended('library:'||me::text||':'||target,0));
  select * into entry from private.post_library where user_id=me and post_id=target;
  entry.saved := case when selection='saved' then enabled else coalesce(entry.saved,false) end;
  entry.followed := case when selection='followed' then enabled else coalesce(entry.followed,false) end;
  if not entry.saved and not entry.followed then
    delete from private.post_library where user_id=me and post_id=target;
  else
    insert into private.post_library(user_id,post_id,saved,followed) values(me,target,entry.saved,entry.followed)
      on conflict(user_id,post_id) do update set saved=excluded.saved,followed=excluded.followed,updated_at=now();
  end if;
  return jsonb_build_object('post_id',target,'saved',entry.saved,'followed',entry.followed);
end $$;
create function public.set_post_library(target text,selection text,enabled boolean,expected_user uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.set_post_library(target,selection,enabled,expected_user); $$;

create function private.list_post_library(selection text,page_number integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid := private.library_member(); result jsonb;
begin
  if selection is null or selection not in ('saved','followed') or page_number is null or page_number not between 0 and 10000 then
    raise exception 'Invalid library page' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(p)),'[]') into result from
    (select post_id,saved,followed,updated_at from private.post_library
     where user_id=me and case when selection='saved' then saved else followed end
     order by updated_at desc,post_id limit 21 offset page_number*20) p;
  return result;
end $$;
create function public.list_post_library(selection text,page_number integer default 0) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.list_post_library(selection,page_number); $$;

revoke all on function private.library_member(),private.library_post_visible(text),
  private.post_library_state(text[]),public.post_library_state(text[]),
  private.set_post_library(text,text,boolean,uuid),public.set_post_library(text,text,boolean,uuid),
  private.list_post_library(text,integer),public.list_post_library(text,integer) from public,anon,authenticated,service_role;
grant execute on function private.post_library_state(text[]),public.post_library_state(text[]),
  private.set_post_library(text,text,boolean,uuid),public.set_post_library(text,text,boolean,uuid),
  private.list_post_library(text,integer),public.list_post_library(text,integer) to authenticated;
commit;

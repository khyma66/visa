begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Publish only one name initial. Full names remain in the private Auth schema;
-- public handles, permissions, reputation and messages do not depend on metadata.
create or replace function private.avatar_initial_from_metadata(metadata jsonb)
returns text language plpgsql immutable parallel safe set search_path = '' as $$
declare field text; candidate text; initial text;
begin
  if jsonb_typeof(metadata) is distinct from 'object' then return '?'; end if;
  foreach field in array array['first_name','given_name','full_name','name'] loop
    if jsonb_typeof(metadata -> field) is distinct from 'string' then continue; end if;
    candidate := regexp_replace(metadata ->> field, '^[[:space:]]+|[[:space:]]+$', '', 'g');
    -- Never use an email as a display name, including provider fallbacks that
    -- placed the email in a name field. Ignore malformed or unbounded values.
    if candidate = '' or char_length(candidate) > 200 or position('@' in candidate) > 0 then continue; end if;
    initial := left(upper(left(normalize(candidate, NFC), 1)), 1);
    if initial ~ '^[[:alpha:]]$' then return initial; end if;
  end loop;
  return '?';
end $$;

create or replace function private.avatar_seed_from_metadata(metadata jsonb, existing_seed text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select 'initial:' || private.avatar_initial_from_metadata(metadata) || ':' ||
    regexp_replace(coalesce(existing_seed, ''), '^initial:[^:]*:', '');
$$;

-- avatar_seed has never been client-editable; explicitly retain that boundary.
-- Auth metadata updates can run with an end-user JWT before terms acceptance.
-- Only public bio publication uses the existing policy/suspension/rate guard;
-- a server-derived single character must not block signup or account recovery.
revoke update on public.profiles from public, anon, authenticated;
revoke update (avatar_seed) on public.profiles from public, anon, authenticated;
grant update (bio) on public.profiles to authenticated;
do $$ begin
  if has_column_privilege('anon', 'public.profiles', 'avatar_seed', 'UPDATE')
    or has_column_privilege('authenticated', 'public.profiles', 'avatar_seed', 'UPDATE') then
    raise exception 'Unexpected inherited avatar write privilege; review role grants before migrating';
  end if;
end $$;
drop trigger if exists community_profile_limit on public.profiles;
create trigger community_profile_limit before update of bio on public.profiles
  for each row execute function private.community_write_guard();

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_schema <> 'auth' or tg_table_name <> 'users' or tg_op <> 'INSERT' then
    raise exception 'This function is only for Auth profile creation';
  end if;
  insert into public.profiles (id, username, avatar_seed)
  values (new.id, private.random_username(),
    private.avatar_seed_from_metadata(new.raw_user_meta_data, replace(gen_random_uuid()::text, '-', '')))
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function private.sync_profile_avatar_initial()
returns trigger language plpgsql security definer set search_path = '' as $$
declare next_seed text;
begin
  if tg_table_schema <> 'auth' or tg_table_name <> 'users' or tg_op <> 'UPDATE' then
    raise exception 'This function is only for Auth avatar synchronization';
  end if;
  select private.avatar_seed_from_metadata(new.raw_user_meta_data, p.avatar_seed)
    into next_seed from public.profiles p where p.id = new.id;
  update public.profiles set avatar_seed = next_seed
    where id = new.id and avatar_seed is distinct from next_seed;
  return new;
end $$;

drop trigger if exists on_auth_user_avatar_changed on auth.users;
create trigger on_auth_user_avatar_changed after update of raw_user_meta_data on auth.users
  for each row when (old.raw_user_meta_data is distinct from new.raw_user_meta_data)
  execute function private.sync_profile_avatar_initial();

revoke all on function private.avatar_initial_from_metadata(jsonb),
  private.avatar_seed_from_metadata(jsonb,text), private.handle_new_user(),
  private.sync_profile_avatar_initial() from public, anon, authenticated;

-- Existing public views and RPCs already project avatar_seed. No full name or
-- new auth field is added to a publicly queryable table, view or endpoint.
update public.profiles p
  set avatar_seed = private.avatar_seed_from_metadata(u.raw_user_meta_data, p.avatar_seed)
  from auth.users u
  where u.id = p.id and p.avatar_seed is distinct from
    private.avatar_seed_from_metadata(u.raw_user_meta_data, p.avatar_seed);

commit;

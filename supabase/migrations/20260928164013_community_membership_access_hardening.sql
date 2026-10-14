-- Reviewed against the live visa catalog on 2026-09-28.
-- Stage and smoke-test with the September app before production rollout.
begin;
set local lock_timeout = '5s';

-- Do not silently combine these policies with an unreviewed permissive policy.
do $$
begin
  if exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename in ('communities', 'community_members')
      and policyname not in (
        'Public communities are viewable by everyone',
        'Authenticated users can join communities',
        'Users can view their community memberships'
      )
  ) then
    raise exception 'Community policies have drifted; review before applying';
  end if;
end $$;

alter table public.communities enable row level security;
alter table public.community_members enable row level security;

-- RLS does not protect TRUNCATE. Remove administrative and write grants too.
revoke all privileges on public.communities, public.community_members
  from public, anon, authenticated;
grant select on public.communities to anon, authenticated;
grant select, insert on public.community_members to authenticated;

-- Keep the membership lookup in a separate SELECT statement to avoid policy
-- rewrite recursion during INSERT ... RETURNING. This is SECURITY INVOKER:
-- the membership SELECT policy still enforces the caller's own identity.
create schema if not exists private;
create function private.visaflow_is_active_member(target_community uuid)
returns boolean language plpgsql stable security invoker set search_path = ''
as $$
begin
  return exists (
    select 1 from public.community_members m
    where m.community_id = target_community
      and m.user_id = (select auth.uid()) and m.is_active is true
  );
end;
$$;
revoke all on function private.visaflow_is_active_member(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.visaflow_is_active_member(uuid) to authenticated;

drop policy if exists "Public communities are viewable by everyone" on public.communities;
drop policy if exists "Authenticated users can join communities" on public.community_members;
drop policy if exists "Users can view their community memberships" on public.community_members;

create policy "Public active community discovery"
  on public.communities for select to anon, authenticated
  using (is_active is true and is_public is true);

create policy "Members can read their active private communities"
  on public.communities for select to authenticated
  using (is_active is true and private.visaflow_is_active_member(id));

create policy "Members read only their own memberships"
  on public.community_members for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users join public active communities as ordinary members"
  on public.community_members for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and role = 'member'
    and is_active is true
    and exists (
      select 1 from public.communities c
      where c.id = community_members.community_id
        and c.is_public is true and c.is_active is true
    )
  );

-- Private invitations, role assignment and membership removal remain server-owned.
-- Existing service_role grants and rows are intentionally preserved.
commit;

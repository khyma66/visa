-- Minimal schema matching the affected live columns/policies, not a production dump.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table public.users (id uuid primary key);
-- A legacy table with no RLS is intentionally retained to test the narrow
-- administration fix and ensure the release audit still reports row access.
create table public.legacy_fixture (id integer primary key);
grant all on public.legacy_fixture to anon, authenticated, service_role;
create table public.communities (
  id uuid primary key default gen_random_uuid(),
  name varchar(100) unique not null,
  display_name varchar(100) not null,
  slug varchar(100) unique not null,
  is_public boolean default true,
  is_active boolean default true
);
create table public.community_members (
  id uuid primary key default gen_random_uuid(),
  community_id uuid references public.communities(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  role varchar(20) default 'member',
  joined_at timestamptz default now(),
  is_active boolean default true,
  unique (community_id, user_id)
);
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
grant all on public.communities, public.community_members to anon, authenticated, service_role;
create policy "Public communities are viewable by everyone" on public.communities for select using (is_active = true);
create policy "Authenticated users can join communities" on public.community_members for insert with check (auth.uid() = user_id);
create policy "Users can view their community memberships" on public.community_members for select using (auth.uid() = user_id);
insert into public.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
insert into public.communities (id,name,display_name,slug,is_public,is_active) values
 ('10000000-0000-0000-0000-000000000001','open','Open','open',true,true),
 ('10000000-0000-0000-0000-000000000002','private','Private','private',false,true),
 ('10000000-0000-0000-0000-000000000003','disabled','Disabled','disabled',true,false),
 ('10000000-0000-0000-0000-000000000004','unknown','Unknown','unknown',null,true);
insert into public.community_members (community_id,user_id) values
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');

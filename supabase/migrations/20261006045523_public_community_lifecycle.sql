-- Public communities only. No hosted writes were used to develop this migration.
-- Apply to an isolated copy first: legacy membership identities must have profiles.
begin;
set local lock_timeout = '5s';

-- Lock while reconciling counters and moving the legacy identity foreign key.
lock table public.communities, public.community_members in share row exclusive mode;
do $$
begin
  if exists(select 1 from public.community_members m left join public.profiles p on p.id=m.user_id
      where m.user_id is not null and p.id is null) then
    raise exception 'Legacy memberships without profiles require reviewed identity reconciliation';
  end if;
  if exists(select 1 from public.communities group by lower(slug) having count(*)>1) then
    raise exception 'Case-insensitive community slug duplicates require reconciliation';
  end if;
end $$;
alter table public.community_members drop constraint community_members_user_id_fkey;
alter table public.community_members add constraint community_members_user_id_fkey
  foreign key(user_id) references public.profiles(id) on delete cascade;
alter table public.communities add column created_by uuid references public.profiles(id) on delete restrict;
alter table public.communities alter column country type varchar(80);
create unique index communities_slug_lower_idx on public.communities(lower(slug));
create index communities_created_by_idx on public.communities(created_by) where created_by is not null;
create index communities_public_new_idx on public.communities(created_at desc,id desc) where is_public is true and is_active is true;
create index communities_public_popular_idx on public.communities(member_count desc,id desc) where is_public is true and is_active is true;
create index communities_public_name_search_idx on public.communities using gin(display_name extensions.gin_trgm_ops) where is_public is true and is_active is true;
create index communities_public_slug_search_idx on public.communities using gin(slug extensions.gin_trgm_ops) where is_public is true and is_active is true;
create index communities_public_country_search_idx on public.communities using gin(country extensions.gin_trgm_ops) where is_public is true and is_active is true;
create index communities_public_slug_idx on public.communities(slug) where is_public is true and is_active is true;
create index communities_public_category_idx on public.communities(category,member_count desc,id desc) where is_public is true and is_active is true;
create index community_members_user_active_idx on public.community_members(user_id,community_id) where is_active is true;

-- Immutable shape validation makes trusted writes obey the same bounded rules.
create function private.community_rules_valid(candidate text[]) returns boolean
language sql immutable security invoker set search_path='' as $$
  select candidate is not null and cardinality(candidate)<=5 and coalesce(array_ndims(candidate),1)=1
    and not exists(select 1 from unnest(candidate) rule where rule is null or char_length(trim(rule)) not between 1 and 200);
$$;
revoke all on function private.community_rules_valid(text[]) from public,anon,authenticated;
grant execute on function private.community_rules_valid(text[]) to service_role;

-- Existing legacy rows are retained; new user-created groups obey this contract.
alter table public.communities add constraint community_created_fields check(created_by is null or (
  slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
  and slug not like '%--%'
  and char_length(trim(display_name)) between 3 and 80
  and description is not null and char_length(trim(description)) between 20 and 500
  and country is not null and char_length(trim(country)) between 1 and 80
  and category is not null and category in ('Work visas','Study','Family','Travel','Settlement','General')
  and private.community_rules_valid(rules)
));
update public.communities c set member_count=(select count(*)::integer from public.community_members m where m.community_id=c.id and m.is_active is true);
alter table public.communities alter column member_count set default 0;
alter table public.communities alter column member_count set not null;
alter table public.communities add constraint community_member_count_nonnegative check(member_count>=0);

-- All browser writes pass through the bounded, authenticated RPCs below.
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
revoke insert,update,delete,truncate,references,trigger on public.communities,public.community_members from public,anon,authenticated;
-- Remove any earlier column-level writes too; table REVOKE does not remove them.
do $$ declare item record;
begin
  for item in select table_name,string_agg(quote_ident(column_name),',') as columns from information_schema.columns
      where table_schema='public' and table_name in ('communities','community_members') group by table_name loop
    execute format('revoke insert (%s),update (%s),references (%s) on public.%I from public,anon,authenticated', item.columns,item.columns,item.columns,item.table_name);
  end loop;
end $$;

-- Incremental atomic updates also handle trusted moderation and profile deletion.
create function private.community_member_count_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op<>'INSERT' and old.is_active is true then
    update public.communities set member_count=member_count-1 where id=old.community_id;
  end if;
  if tg_op<>'DELETE' and new.is_active is true then
    update public.communities set member_count=member_count+1 where id=new.community_id;
  end if;
  return null;
end $$;
create trigger community_member_count_change after insert or delete or update of community_id,is_active on public.community_members
  for each row execute function private.community_member_count_change();
-- Reuse the deployed guard, including any newer policy-acknowledgement requirement.
create trigger community_create_guard before insert on public.communities
  for each row execute function private.community_write_guard();
create trigger community_membership_guard before insert or update on public.community_members
  for each row execute function private.community_write_guard();

create function private.create_public_community(community_slug text,community_name text,community_description text,community_country text,community_category text,community_rules text[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare me uuid:=(select auth.uid()); result uuid; clean_slug text:=lower(trim(community_slug)); clean_rules text[];
begin
  perform private.community_consume('create-community',3,86400);
  if not exists(select 1 from public.profiles where id=me) then raise exception 'Registered profile required' using errcode='42501'; end if;
  if clean_slug is null or (clean_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' or clean_slug like '%--%') then raise exception 'Community address must be 3 to 40 lowercase letters, numbers or hyphens'; end if;
  if community_name is null or char_length(trim(community_name)) not between 3 and 80 then raise exception 'Community name must be 3 to 80 characters'; end if;
  if community_description is null or char_length(trim(community_description)) not between 20 and 500 then raise exception 'Description must be 20 to 500 characters'; end if;
  if community_country is null or char_length(trim(community_country)) not between 1 and 80 then raise exception 'Country must be 1 to 80 characters'; end if;
  if community_category is null or community_category not in ('Work visas','Study','Family','Travel','Settlement','General') then raise exception 'Choose a valid community category'; end if;
  if cardinality(community_rules)>5 or array_ndims(community_rules)>1 or exists(select 1 from unnest(community_rules) r where r is null or char_length(trim(r)) not between 1 and 200) then raise exception 'Add up to five rules, each 1 to 200 characters'; end if;
  select coalesce(array_agg(trim(r) order by position),'{}'::text[]) into clean_rules from unnest(community_rules) with ordinality as item(r,position);
  insert into public.communities(name,slug,display_name,description,country,category,rules,created_by,is_public,is_active,member_count)
    values(clean_slug,clean_slug,trim(community_name),trim(community_description),trim(community_country),community_category,clean_rules,me,true,true,0)
    returning id into result;
  insert into public.community_members(community_id,user_id,role,is_active) values(result,me,'owner',true);
  return result;
end $$;
create function public.create_public_community(community_slug text,community_name text,community_description text,community_country text,community_category text,community_rules text[] default '{}') returns uuid
language sql security invoker set search_path='' as $$
  select private.create_public_community(community_slug,community_name,community_description,community_country,community_category,community_rules);
$$;

create function private.join_public_community(target_community uuid) returns void
language plpgsql security definer set search_path='' as $$
declare me uuid:=(select auth.uid()); membership public.community_members;
begin
  perform private.community_consume('join-community',30,60);
  if not exists(select 1 from public.profiles where id=me) then raise exception 'Registered profile required' using errcode='42501'; end if;
  -- Serializes join/leave and active-state changes for this community.
  perform 1 from public.communities where id=target_community and is_public is true and is_active is true for update;
  if not found then raise exception 'Community unavailable' using errcode='42501'; end if;
  select * into membership from public.community_members where community_id=target_community and user_id=me;
  if found and membership.role in ('banned','suspended') then raise exception 'Membership unavailable' using errcode='42501'; end if;
  if found and membership.is_active is true then return; end if;
  insert into public.community_members(community_id,user_id,role,is_active) values(target_community,me,'member',true)
    on conflict(community_id,user_id) do update set is_active=true,role='member',joined_at=now()
      where public.community_members.role='member' and public.community_members.is_active is not true;
  if not found then raise exception 'Membership must be restored by an operator' using errcode='42501'; end if;
end $$;
create function public.join_public_community(target_community uuid) returns void
language sql security invoker set search_path='' as $$select private.join_public_community(target_community);$$;

create function private.leave_public_community(target_community uuid) returns void
language plpgsql security definer set search_path='' as $$
declare me uuid:=(select auth.uid()); creator uuid; membership public.community_members;
begin
  perform private.community_consume('leave-community',30,60);
  select created_by into creator from public.communities where id=target_community and is_public is true and is_active is true for update;
  if not found then raise exception 'Community unavailable' using errcode='42501'; end if;
  select * into membership from public.community_members where community_id=target_community and user_id=me;
  if creator=me or membership.role='owner' then raise exception 'Owners cannot leave until ownership has been transferred'; end if;
  if membership.role in ('banned','suspended') then raise exception 'Membership unavailable' using errcode='42501'; end if;
  update public.community_members set is_active=false where community_id=target_community and user_id=me and is_active is true;
end $$;
create function public.leave_public_community(target_community uuid) returns void
language sql security invoker set search_path='' as $$select private.leave_public_community(target_community);$$;

create view public.community_directory with(security_invoker=true) as
  select id,slug,display_name,description,country,category,rules,member_count,created_at,created_by
  from public.communities where is_public is true and is_active is true;
revoke all on public.community_directory from public,anon,authenticated;
grant select on public.community_directory to anon,authenticated;

alter table public.questions add column community_id uuid references public.communities(id) on delete restrict;
-- Restrictive policies compose with existing policies, including newer production guards.
-- A previously public group later hidden by an operator cannot leak through global feeds.
create policy questions_public_community_read on public.questions as restrictive for select to anon,authenticated
  using(community_id is null or exists(select 1 from public.communities c where c.id=questions.community_id and c.is_public is true and c.is_active is true));
create policy answers_visible_question_read on public.answers as restrictive for select to anon,authenticated
  using(exists(select 1 from public.questions q where q.id=answers.question_id));
create index questions_community_new_idx on public.questions(community_id,created_at desc,id desc) where status<>'archived';
create index questions_community_score_idx on public.questions(community_id,vote_score desc,created_at desc,id desc) where status<>'archived';
create index questions_community_activity_idx on public.questions(community_id,(vote_score+answer_count*2) desc,created_at desc,id desc) where status<>'archived';

create function private.guard_question_community() returns trigger
language plpgsql security definer set search_path='' as $$
declare me uuid:=(select auth.uid());
begin
  if tg_op='UPDATE' then
    if new.community_id is distinct from old.community_id then raise exception 'A question cannot be moved between communities' using errcode='42501'; end if;
    return new;
  end if;
  if new.community_id is null then return new; end if;
  -- Lock the group and membership while inserting: leave/disable cannot race this check.
  perform 1 from public.communities where id=new.community_id and is_public is true and is_active is true for share;
  if not found then raise exception 'Community unavailable' using errcode='42501'; end if;
  if me is null or me<>new.author_id then raise exception 'Authentication required' using errcode='42501'; end if;
  perform 1 from public.community_members where community_id=new.community_id and user_id=me
    and is_active is true and role in ('member','moderator','admin','owner') for share;
  if not found then raise exception 'Join this community before posting' using errcode='42501'; end if;
  -- Existing question guard applies policy acknowledgement, suspension and rate limits.
  return new;
end $$;
create trigger question_community_guard before insert or update of community_id on public.questions
  for each row execute function private.guard_question_community();
grant insert(community_id) on public.questions to authenticated;
-- Production has newer feed columns than the recovered repository. Preserve
-- its actual projection and predicates; append only this migration's group id.
do $$ declare prior_query text;
begin
  prior_query:=regexp_replace(pg_get_viewdef('public.question_feed'::regclass,true), ';\s*$', '');
  execute 'create or replace view public.question_feed with(security_invoker=true) as '
    || 'select prior_feed.*,q.community_id from (' || prior_query || ') prior_feed '
    || 'join public.questions q on q.id=prior_feed.id';
end $$;

revoke all on function private.community_member_count_change(),private.guard_question_community(),
  private.create_public_community(text,text,text,text,text,text[]),private.join_public_community(uuid),private.leave_public_community(uuid),
  public.create_public_community(text,text,text,text,text,text[]),public.join_public_community(uuid),public.leave_public_community(uuid) from public,anon,authenticated;
grant execute on function private.create_public_community(text,text,text,text,text,text[]),private.join_public_community(uuid),private.leave_public_community(uuid),
  public.create_public_community(text,text,text,text,text,text[]),public.join_public_community(uuid),public.leave_public_community(uuid) to authenticated;
commit;

-- Bound result hydration and use indexable tuple cursors without replacing
-- existing views, policies, moderation guards or public/private visibility.
begin;
set local lock_timeout='5s';

-- The directory sorts by slug, not by member_count. This supports category pages.
create index communities_public_category_slug_idx on public.communities(category,slug)
  where is_public is true and is_active is true;

create function public.my_community_directory_page(
  query_text text default '',filter_category text default '',filter_country text default '',
  after_slug text default null,result_limit integer default 24
) returns setof public.community_directory
language plpgsql stable security invoker set search_path='' as $$
declare
  me uuid:=(select auth.uid());
  search_pattern text;
  country_pattern text;
  bounded_limit integer:=least(greatest(coalesce(result_limit,24),1),24)+1;
  statement text;
begin
  if me is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if char_length(coalesce(query_text,''))>80 or char_length(coalesce(filter_country,''))>80 then
    raise exception 'Community search terms must be at most 80 characters' using errcode='22023';
  end if;
  if coalesce(filter_category,'')<>'' and filter_category not in ('Work visas','Study','Family','Travel','Settlement','General') then
    raise exception 'Choose a valid community category' using errcode='22023';
  end if;
  if after_slug is not null and after_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then
    raise exception 'Invalid community cursor' using errcode='22023';
  end if;
  -- Treat wildcard characters literally; all user-controlled values stay bound.
  search_pattern:='%'||replace(replace(replace(trim(coalesce(query_text,'')),chr(92),chr(92)||chr(92)),'%',chr(92)||'%'),'_',chr(92)||'_')||'%';
  country_pattern:='%'||replace(replace(replace(trim(coalesce(filter_country,'')),chr(92),chr(92)||chr(92)),'%',chr(92)||'%'),'_',chr(92)||'_')||'%';
  statement:='select d.* from public.community_directory d join public.community_members m on m.community_id=d.id '
    ||'where m.user_id=$1 and m.is_active is true';
  if trim(coalesce(query_text,''))<>'' then statement:=statement||' and (d.display_name ilike $2 or d.slug ilike $2)'; end if;
  if coalesce(filter_category,'')<>'' then statement:=statement||' and d.category=$3'; end if;
  if trim(coalesce(filter_country,''))<>'' then statement:=statement||' and d.country ilike $4'; end if;
  if after_slug is not null then statement:=statement||' and d.slug>$5'; end if;
  statement:=statement||' order by d.slug limit $6';
  return query execute statement using me,search_pattern,filter_category,country_pattern,after_slug,bounded_limit;
end $$;

create function public.community_group_question_page(
  target_community uuid,before_time timestamptz default null,before_id uuid default null,filter_tag text default ''
) returns setof public.question_feed
language plpgsql stable security invoker set search_path='' as $$
declare statement text;
begin
  if target_community is null or ((before_time is null)<>(before_id is null)) then
    raise exception 'Invalid community question cursor' using errcode='22023';
  end if;
  if char_length(coalesce(filter_tag,''))>60 then raise exception 'Question tag must be at most 60 characters' using errcode='22023'; end if;
  -- Replan these small parameterized reads: optional OR predicates can otherwise
  -- turn deep-page seeks into scans when PostgreSQL chooses a generic plan.
  statement:='with page as materialized ('
    ||'select q.id,q.created_at from public.questions q join public.question_feed visible_feed on visible_feed.id=q.id '
    ||'where q.community_id=$1 and q.status<>''archived''';
  if before_time is not null then statement:=statement||' and (q.created_at,q.id)<($2,$3)'; end if;
  if coalesce(filter_tag,'')<>'' then statement:=statement||' and q.tags @> array[$4]'; end if;
  statement:=statement||' order by q.created_at desc,q.id desc limit 21) '
    ||'select f.* from page p join public.question_feed f on f.id=p.id order by p.created_at desc,p.id desc';
  return query execute statement using target_community,before_time,before_id,filter_tag;
end $$;

revoke all on function public.my_community_directory_page(text,text,text,text,integer),
  public.community_group_question_page(uuid,timestamptz,uuid,text) from public,anon,authenticated;
grant execute on function public.my_community_directory_page(text,text,text,text,integer) to authenticated;
grant execute on function public.community_group_question_page(uuid,timestamptz,uuid,text) to anon,authenticated;

-- Preserve exact counts and existing locks, but do not rewrite a hot community
-- row twice when an active membership update does not change its contribution.
create or replace function private.community_member_count_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.community_id is not distinct from old.community_id
      and (new.is_active is true)=(old.is_active is true) then return null; end if;
  if tg_op<>'INSERT' and old.is_active is true then
    update public.communities set member_count=member_count-1 where id=old.community_id;
  end if;
  if tg_op<>'DELETE' and new.is_active is true then
    update public.communities set member_count=member_count+1 where id=new.community_id;
  end if;
  return null;
end $$;
revoke all on function private.community_member_count_change() from public,anon,authenticated;
commit;

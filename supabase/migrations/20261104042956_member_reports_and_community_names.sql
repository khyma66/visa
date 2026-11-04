begin;
set local lock_timeout='5s';

-- Keep reports in the existing private-by-RLS queue and analytics counts.
alter table public.community_reports drop constraint community_reports_target_kind_check;
alter table public.community_reports add constraint community_reports_target_kind_check
  check(target_kind in ('question','answer','imported_answer','message','member'));
alter table public.community_reports drop constraint community_reports_status_check;
alter table public.community_reports add constraint community_reports_status_check
  check(status in ('pending','dismissed','removed','suspended'));

-- The caller supplies a conversation, never an arbitrary account or reporter ID.
-- Reported accounts remain reportable after the member blocks the conversation.
create function private.report_community_member(conversation_id uuid,report_reason text,report_details text) returns uuid
language plpgsql security definer set search_path='' as $$
declare me uuid:=(select auth.uid()); reported uuid; result uuid;
begin
  if me is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if exists(select 1 from private.community_suspensions where user_id=me) then raise exception 'Account suspended' using errcode='42501'; end if;
  if report_reason is null or report_reason not in ('spam','harassment','personal-information','scam','other')
    or char_length(coalesce(report_details,''))>1000 then raise exception 'Invalid report details' using errcode='22023'; end if;
  select case when c.user_one_id=me then c.user_two_id else c.user_one_id end into reported
    from public.direct_conversations c where c.id=conversation_id and me in (c.user_one_id,c.user_two_id);
  if reported is null or reported=me then raise exception 'Conversation unavailable' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('member-report:'||me::text,0));
  select id into result from public.community_reports where reporter_id=me and target_kind='member' and target_id=reported;
  if result is not null then return result; end if;
  perform private.community_consume('report',10,3600);
  insert into public.community_reports(reporter_id,target_kind,target_id,reason,details)
    values(me,'member',reported,report_reason,btrim(coalesce(report_details,''))) returning id into result;
  return result;
end $$;
create function public.report_community_member(conversation_id uuid,report_reason text,report_details text default '') returns uuid
language sql security invoker set search_path='' as $$ select private.report_community_member(conversation_id,report_reason,report_details); $$;
revoke all on function private.report_community_member(uuid,text,text),public.report_community_member(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function private.report_community_member(uuid,text,text),public.report_community_member(uuid,text,text) to authenticated;

create or replace function private.community_moderation_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not (private.community_is_moderator() or private.feedback_is_owner()) then raise exception 'Moderator access required'; end if;
  -- Only explicitly reported messages are visible to moderators, never full inboxes.
  select coalesce(jsonb_agg(to_jsonb(item)),'[]'::jsonb) into result from (
    select r.id,r.target_kind,r.target_id,r.reason,r.details,r.created_at,
      case r.target_kind when 'question' then (select title || E'\n' || body from public.questions where id=r.target_id)
        when 'answer' then (select body from public.answers where id=r.target_id)
        when 'imported_answer' then (select body from public.imported_answers where id=r.target_id)
        when 'member' then (select 'u/' || username from public.profiles where id=r.target_id)
        when 'message' then (select body from public.direct_messages where id=r.target_id) end as content
    from public.community_reports r where status='pending' order by created_at,id limit 50
  ) item;
  return result;
end $$;
create or replace function private.community_moderate(report_id uuid,decision text,suspend_author boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare report public.community_reports; author uuid;
begin
  if not (private.community_is_moderator() or private.feedback_is_owner()) then raise exception 'Moderator access required'; end if;
  if decision is null or decision not in ('dismissed','removed','suspended') then raise exception 'Invalid decision'; end if;
  select * into report from public.community_reports where id=report_id and status='pending' for update;
  if report.id is null then raise exception 'Report already resolved or unavailable'; end if;
  if report.target_kind='member' then
    if decision='removed' then raise exception 'Choose dismiss or suspend for a member report'; end if;
    if decision='suspended' then
      if report.target_id=(select auth.uid()) then raise exception 'Cannot suspend yourself'; end if;
      if exists(select 1 from private.feedback_owner where user_id=report.target_id) then raise exception 'The designated owner cannot be suspended here'; end if;
      insert into private.community_suspensions(user_id,moderator_id) values(report.target_id,(select auth.uid())) on conflict do nothing;
    end if;
  elsif decision='suspended' then raise exception 'Suspend decisions require a member report';
  end if;
  if decision='removed' then
    if report.target_kind='question' then
      update public.questions set status='archived' where id=report.target_id returning author_id into author;
    elsif report.target_kind='answer' then
      update public.answers set status='archived',is_accepted=false where id=report.target_id returning author_id into author;
      update public.questions set accepted_answer_id=null where accepted_answer_id=report.target_id;
    elsif report.target_kind='imported_answer' then
      update public.imported_answers set status='archived' where id=report.target_id returning author_id into author;
    elsif report.target_kind='message' then
      update public.direct_messages set body='[Removed by a moderator]' where id=report.target_id returning sender_id into author;
    end if;
    if suspend_author and author is not null then
      if author=(select auth.uid()) then raise exception 'Cannot suspend yourself'; end if;
      insert into private.community_suspensions(user_id,moderator_id) values(author,(select auth.uid())) on conflict do nothing;
    end if;
  end if;
  update public.community_reports set status=decision,resolved_at=now(),resolved_by=(select auth.uid()) where id=report.id;
end $$;

-- Display names follow one contract; IDs, URLs, posts and memberships stay intact.
create function private.community_handle(candidate text) returns text
language sql immutable strict security invoker set search_path='' as $$
  select coalesce(string_agg(upper(left(word,1))||substr(word,2),'' order by ordinal),'')
  from regexp_split_to_table(btrim(candidate),'[^A-Za-z0-9]+') with ordinality as parts(word,ordinal) where word<>'';
$$;
revoke all on function private.community_handle(text) from public,anon,authenticated,service_role;
create function private.community_name_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  new.display_name:=private.community_handle(new.display_name);
  if new.display_name is null or new.display_name !~ '^[A-Z0-9][A-Za-z0-9]{2,79}$' then
    raise exception 'Use 3 to 80 letters or numbers for the community name' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function private.community_name_guard() from public,anon,authenticated,service_role;
lock table public.communities in share row exclusive mode;
-- Fail rather than silently merging two communities or truncating a name.
do $$ begin
  if exists(select 1 from public.communities where private.community_handle(display_name) !~ '^[A-Z0-9][A-Za-z0-9]{2,79}$')
    or exists(select 1 from public.communities group by lower(private.community_handle(display_name)) having count(*)>1) then
    raise exception 'Existing community names require reviewed reconciliation';
  end if;
end $$;
update public.communities set display_name=private.community_handle(display_name)
  where display_name is distinct from private.community_handle(display_name);
alter table public.communities add constraint communities_handle_format check(display_name ~ '^[A-Z0-9][A-Za-z0-9]{2,79}$');
create unique index communities_display_name_lower_idx on public.communities(lower(display_name));
create trigger community_name_guard before insert or update of display_name on public.communities
  for each row execute function private.community_name_guard();

create or replace function public.my_community_directory_page(
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
  if trim(coalesce(query_text,''))<>'' then statement:=statement||' and (d.display_name ilike $7 or d.slug ilike $2)'; end if;
  if coalesce(filter_category,'')<>'' then statement:=statement||' and d.category=$3'; end if;
  if trim(coalesce(filter_country,''))<>'' then statement:=statement||' and d.country ilike $4'; end if;
  if after_slug is not null then statement:=statement||' and d.slug>$5'; end if;
  statement:=statement||' order by d.slug limit $6';
  return query execute statement using me,search_pattern,filter_category,country_pattern,after_slug,bounded_limit,regexp_replace(search_pattern,'[[:space:]-]+','','g');
end $$;


commit;

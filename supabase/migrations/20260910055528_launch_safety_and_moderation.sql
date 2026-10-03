begin;

-- This migration changes only VisaFlow community tables. Legacy data is untouched.
create table private.community_moderators (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table private.community_suspensions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  moderator_id uuid not null references auth.users(id)
);
create table private.community_rate_windows (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  used integer not null,
  primary key (user_id, action)
);
alter table private.community_moderators enable row level security;
alter table private.community_suspensions enable row level security;
alter table private.community_rate_windows enable row level security;
revoke all on private.community_moderators, private.community_suspensions, private.community_rate_windows from public, anon, authenticated;

create function private.community_consume(action_name text, maximum integer, seconds integer) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); bucket timestamptz; counter integer;
begin
  if me is null then raise exception 'Authentication required'; end if;
  if exists(select 1 from private.community_suspensions where user_id=me) then
    raise exception 'Your account is suspended. Contact the community operator.';
  end if;
  bucket := to_timestamp(floor(extract(epoch from now()) / seconds) * seconds);
  insert into private.community_rate_windows as r values(me,action_name,bucket,1)
    on conflict(user_id,action) do update set window_start=excluded.window_start,
      used=case when r.window_start=excluded.window_start then r.used+1 else 1 end
    returning used into counter;
  if counter > maximum then raise exception 'Too many requests. Please try again later.'; end if;
end $$;

create function private.community_write_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Trusted maintenance has no end-user JWT. Browser API roles always have one.
  if (select auth.uid()) is null then return new; end if;
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
create trigger community_question_limit before insert or update of title,body,tags,destination_country,visa_type on public.questions
  for each row execute function private.community_write_guard();
create trigger community_answer_limit before insert or update of body on public.answers
  for each row execute function private.community_write_guard();
create trigger community_imported_answer_limit before insert or update of body on public.imported_answers
  for each row execute function private.community_write_guard();
create trigger community_question_vote_limit before insert or update on public.question_votes
  for each row execute function private.community_write_guard();
create trigger community_answer_vote_limit before insert or update on public.answer_votes
  for each row execute function private.community_write_guard();
create trigger community_message_guard before insert on public.direct_messages
  for each row execute function private.community_write_guard();
create trigger community_chat_guard before insert on public.direct_conversations
  for each row execute function private.community_write_guard();
-- Owners must not restore content hidden by a moderator.
revoke update(status) on public.questions from authenticated;

create table public.community_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id),
  target_kind text not null check(target_kind in ('question','answer','imported_answer','message')),
  target_id uuid not null,
  reason text not null check(reason in ('spam','harassment','personal-information','scam','other')),
  details text not null default '' check(char_length(details)<=1000),
  status text not null default 'pending' check(status in ('pending','dismissed','removed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  unique(reporter_id,target_kind,target_id)
);
alter table public.community_reports enable row level security;
revoke all on public.community_reports from public,anon,authenticated;
create policy reports_own_read on public.community_reports for select to authenticated
  using (reporter_id=(select auth.uid()));
grant select on public.community_reports to authenticated;
create index community_reports_queue_idx on public.community_reports(created_at,id) where status='pending';
create index community_reports_resolved_by_idx on public.community_reports(resolved_by);

create function private.community_is_moderator() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.community_moderators where user_id=(select auth.uid()))
    and not exists(select 1 from private.community_suspensions where user_id=(select auth.uid()));
$$;
create function public.community_is_moderator() returns boolean
language sql stable security invoker set search_path = '' as $$ select private.community_is_moderator(); $$;

create function private.community_report(kind text,target uuid,report_reason text,report_details text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); result uuid; visible boolean := false;
begin
  perform private.community_consume('report',10,3600);
  if kind='question' then select exists(select 1 from public.questions where id=target and status<>'archived') into visible;
  elsif kind='answer' then select exists(select 1 from public.answers a join public.questions q on q.id=a.question_id where a.id=target and a.status='active' and q.status<>'archived') into visible;
  elsif kind='imported_answer' then select exists(select 1 from public.imported_answers where id=target and status='active') into visible;
  elsif kind='message' then select exists(select 1 from public.direct_messages m join public.direct_conversations c on c.id=m.conversation_id
    where m.id=target and me in (c.user_one_id,c.user_two_id)) into visible;
  end if;
  if not visible then raise exception 'Content unavailable'; end if;
  insert into public.community_reports(reporter_id,target_kind,target_id,reason,details)
    values(me,kind,target,report_reason,coalesce(report_details,''))
    on conflict(reporter_id,target_kind,target_id) do nothing returning id into result;
  if result is null then select id into result from public.community_reports where reporter_id=me and target_kind=kind and target_id=target; end if;
  return result;
end $$;
create function public.report_community_content(kind text,target uuid,report_reason text,report_details text default '') returns uuid
language sql security invoker set search_path = '' as $$ select private.community_report(kind,target,report_reason,report_details); $$;

create function private.community_moderation_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.community_is_moderator() then raise exception 'Moderator access required'; end if;
  -- Only explicitly reported messages are visible to moderators, never full inboxes.
  select coalesce(jsonb_agg(to_jsonb(item)),'[]'::jsonb) into result from (
    select r.id,r.target_kind,r.target_id,r.reason,r.details,r.created_at,
      case r.target_kind when 'question' then (select title || E'\n' || body from public.questions where id=r.target_id)
        when 'answer' then (select body from public.answers where id=r.target_id)
        when 'imported_answer' then (select body from public.imported_answers where id=r.target_id)
        when 'message' then (select body from public.direct_messages where id=r.target_id) end as content
    from public.community_reports r where status='pending' order by created_at,id limit 50
  ) item;
  return result;
end $$;
create function public.community_moderation_queue() returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.community_moderation_queue(); $$;

create function private.community_moderate(report_id uuid,decision text,suspend_author boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare report public.community_reports; author uuid;
begin
  if not private.community_is_moderator() then raise exception 'Moderator access required'; end if;
  if decision not in ('dismissed','removed') then raise exception 'Invalid decision'; end if;
  select * into report from public.community_reports where id=report_id and status='pending' for update;
  if report.id is null then raise exception 'Report already resolved or unavailable'; end if;
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
create function public.moderate_community_report(report_id uuid,decision text,suspend_author boolean default false) returns void
language sql security invoker set search_path = '' as $$ select private.community_moderate(report_id,decision,suspend_author); $$;

revoke all on function private.community_consume(text,integer,integer),private.community_write_guard(),
  private.community_is_moderator(),private.community_report(text,uuid,text,text),private.community_moderation_queue(),private.community_moderate(uuid,text,boolean),
  public.community_is_moderator(),public.report_community_content(text,uuid,text,text),public.community_moderation_queue(),public.moderate_community_report(uuid,text,boolean)
  from public,anon,authenticated;
grant execute on function private.community_is_moderator(),private.community_report(text,uuid,text,text),private.community_moderation_queue(),private.community_moderate(uuid,text,boolean),
  public.community_is_moderator(),public.report_community_content(text,uuid,text,text),public.community_moderation_queue(),public.moderate_community_report(uuid,text,boolean)
  to authenticated;
commit;

begin;
set local lock_timeout = '5s';

-- Durable recipient-only events. Never copy private message bodies into alerts.
create table private.member_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check(kind in ('reply','message')),
  answer_id uuid references public.answers(id) on delete cascade,
  message_id uuid references public.direct_messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check((kind='reply' and answer_id is not null and message_id is null) or
        (kind='message' and message_id is not null and answer_id is null)),
  unique(user_id,answer_id), unique(user_id,message_id)
);
create index member_notifications_recent on private.member_notifications(user_id,created_at desc,id desc);
create index member_notifications_unread on private.member_notifications(user_id) where read_at is null;
alter table private.member_notifications enable row level security;
revoke all on private.member_notifications from public,anon,authenticated,service_role;

create table private.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reply_in_app boolean not null default true,
  message_in_app boolean not null default true,
  reply_email boolean not null default false,
  message_email boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table private.notification_preferences enable row level security;
revoke all on private.notification_preferences from public,anon,authenticated,service_role;

create function private.notification_member() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare me uuid := (select auth.uid());
begin
  if me is null or not exists(select 1 from auth.users u where u.id=me and u.deleted_at is null
    and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())) then
    raise exception 'Sign in to view notifications' using errcode='42501';
  end if;
  return me;
end $$;

create function private.notification_visible(n private.member_notifications) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.direct_conversations c where c.request_status='blocked'
    and ((c.user_one_id=n.user_id and c.user_two_id=n.actor_id) or (c.user_two_id=n.user_id and c.user_one_id=n.actor_id)))
  and case when n.kind='reply' then exists(
    select 1 from public.answers a join public.questions q on q.id=a.question_id
    where a.id=n.answer_id and a.status='active' and q.status<>'archived' and q.author_id=n.user_id
      and (q.community_id is null or exists(select 1 from public.communities c where c.id=q.community_id and c.is_public and c.is_active)))
  else exists(select 1 from public.direct_messages m join public.direct_conversations c on c.id=m.conversation_id
    where m.id=n.message_id and n.user_id in(c.user_one_id,c.user_two_id) and c.request_status in('accepted','pending')) end;
$$;

create function private.member_notification_data(page_number integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid := private.notification_member(); items jsonb; prefs jsonb; unread bigint; messages bigint;
begin
  if page_number is null or page_number not between 0 and 1000 then raise exception 'Invalid notification page' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(item)),'[]') into items from (
    select n.id,n.kind,n.created_at,n.read_at,p.username as actor_username,
      case when n.kind='reply' then q.title else 'New Direct Message' end as title,
      case when n.kind='reply' then '/questions/'||q.id::text||'#answer-'||a.id::text
        else '/messages?to='||p.username||'&member='||p.id::text end as href
    from private.member_notifications n join public.profiles p on p.id=n.actor_id
      left join public.answers a on a.id=n.answer_id left join public.questions q on q.id=a.question_id
    where n.user_id=me and private.notification_visible(n)
    order by n.created_at desc,n.id desc limit 21 offset page_number*20
  ) item;
  select count(*) into unread from private.member_notifications n where n.user_id=me and n.read_at is null and private.notification_visible(n);
  select count(*) into messages from public.direct_messages m join public.direct_conversations c on c.id=m.conversation_id
    where me in(c.user_one_id,c.user_two_id) and m.sender_id<>me and m.read_at is null and c.request_status in('accepted','pending');
  select jsonb_build_object('reply_in_app',p.reply_in_app,'message_in_app',p.message_in_app,'reply_email',p.reply_email,'message_email',p.message_email)
    into prefs from private.notification_preferences p where p.user_id=me;
  return jsonb_build_object('items',items,'unreadNotifications',unread,'unreadMessages',messages,
    'preferences',coalesce(prefs,'{"reply_in_app":true,"message_in_app":true,"reply_email":false,"message_email":false}'::jsonb),
    'emailAvailable',false);
end $$;
create function public.member_notification_data(page_number integer default 0) returns jsonb
language sql stable security invoker set search_path='' as $$select private.member_notification_data(page_number);$$;

create function private.read_member_notifications(targets uuid[],expected_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare me uuid := private.notification_member();
begin
  if expected_user is distinct from me then raise exception 'Account changed' using errcode='42501'; end if;
  if targets is null or cardinality(targets)>100 then raise exception 'Invalid notification list' using errcode='22023'; end if;
  update private.member_notifications set read_at=now() where user_id=me and id=any(targets) and read_at is null;
end $$;
create function public.read_member_notifications(targets uuid[],expected_user uuid) returns void
language sql security invoker set search_path='' as $$select private.read_member_notifications(targets,expected_user);$$;

create function private.set_notification_preferences(reply_in_app boolean,message_in_app boolean,reply_email boolean,message_email boolean,expected_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare me uuid := private.notification_member();
begin
  if expected_user is distinct from me then raise exception 'Account changed' using errcode='42501'; end if;
  if reply_in_app is null or message_in_app is null or reply_email is null or message_email is null then
    raise exception 'Choose each notification preference' using errcode='22023'; end if;
  -- Enabling email is rejected until a verified sender and delivery worker exist.
  if reply_email or message_email then raise exception 'Notification email delivery is not connected yet' using errcode='22023'; end if;
  insert into private.notification_preferences(user_id,reply_in_app,message_in_app,reply_email,message_email)
    values(me,reply_in_app,message_in_app,reply_email,message_email)
    on conflict(user_id) do update set reply_in_app=excluded.reply_in_app,message_in_app=excluded.message_in_app,
      reply_email=excluded.reply_email,message_email=excluded.message_email,updated_at=now();
  perform realtime.send('{}'::jsonb,'changed','inbox:'||me::text,true);
end $$;
create function public.set_notification_preferences(reply_in_app boolean,message_in_app boolean,reply_email boolean,message_email boolean,expected_user uuid) returns void
language sql security invoker set search_path='' as $$select private.set_notification_preferences(reply_in_app,message_in_app,reply_email,message_email,expected_user);$$;

create function private.create_member_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare recipient uuid; enabled boolean;
begin
  if tg_table_name='answers' then
    if new.status<>'active' or new.author_id is null then return null; end if;
    if tg_op='UPDATE' and old.status is not distinct from new.status then return null; end if;
    select author_id into recipient from public.questions where id=new.question_id and status<>'archived';
    if recipient is null or recipient=new.author_id then return null; end if;
    select reply_in_app into enabled from private.notification_preferences where user_id=recipient;
    if coalesce(enabled,true) then
      insert into private.member_notifications(user_id,actor_id,kind,answer_id)
        values(recipient,new.author_id,'reply',new.id) on conflict do nothing;
    end if;
  else
    if tg_op='UPDATE' then
      if new.read_at is not null then update private.member_notifications set read_at=new.read_at where message_id=new.id and read_at is null; end if;
      return null;
    end if;
    select case when user_one_id=new.sender_id then user_two_id else user_one_id end into recipient
      from public.direct_conversations where id=new.conversation_id and request_status in('accepted','pending');
    if recipient is null or recipient=new.sender_id then return null; end if;
    select message_in_app into enabled from private.notification_preferences where user_id=recipient;
    if coalesce(enabled,true) then
      insert into private.member_notifications(user_id,actor_id,kind,message_id)
        values(recipient,new.sender_id,'message',new.id) on conflict do nothing;
    end if;
  end if;
  return null;
end $$;
create trigger member_reply_notification after insert or update of status on public.answers for each row execute function private.create_member_notification();
create trigger member_message_notification after insert or update of read_at on public.direct_messages for each row execute function private.create_member_notification();

create function private.broadcast_member_notification() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform realtime.send('{}'::jsonb,'changed','inbox:'||new.user_id::text,true);
  return null;
end $$;
create trigger member_notification_changed after insert or update on private.member_notifications for each row execute function private.broadcast_member_notification();

revoke all on function private.notification_member(),private.notification_visible(private.member_notifications),
  private.member_notification_data(integer),public.member_notification_data(integer),
  private.read_member_notifications(uuid[],uuid),public.read_member_notifications(uuid[],uuid),
  private.set_notification_preferences(boolean,boolean,boolean,boolean,uuid),public.set_notification_preferences(boolean,boolean,boolean,boolean,uuid),
  private.create_member_notification(),private.broadcast_member_notification() from public,anon,authenticated,service_role;
grant execute on function private.member_notification_data(integer),public.member_notification_data(integer),
  private.read_member_notifications(uuid[],uuid),public.read_member_notifications(uuid[],uuid),
  private.set_notification_preferences(boolean,boolean,boolean,boolean,uuid),public.set_notification_preferences(boolean,boolean,boolean,boolean,uuid) to authenticated;
commit;

begin;
set local lock_timeout = '5s';

-- "Notify me when others with this issue post": a member follows a post's
-- topics (anchored on the post id). New member questions and experiences that
-- share enough topics create a recipient-only 'issue' notification.
-- Imported earlier discussions (apify-*) live outside this database, so their
-- anchor is text and their topics are validated rather than looked up.
create table private.issue_follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  anchor_id text not null check(anchor_id ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|apify-[A-Za-z0-9_-]{1,160})$'),
  anchor_title text not null check(char_length(anchor_title) between 1 and 300),
  topics text[] not null check(cardinality(topics) between 1 and 5),
  created_at timestamptz not null default now(),
  unique(user_id,anchor_id)
);
create index issue_follows_topics on private.issue_follows using gin(topics);
create index issue_follows_member on private.issue_follows(user_id,created_at desc);
alter table private.issue_follows enable row level security;
revoke all on private.issue_follows from public,anon,authenticated,service_role;
-- Members can only ever see or remove their own follows. Creation goes through
-- private.follow_issue so topics, anchors and the per-member cap are validated.
create policy issue_follows_own_select on private.issue_follows for select to authenticated using (user_id=(select auth.uid()));
create policy issue_follows_own_delete on private.issue_follows for delete to authenticated using (user_id=(select auth.uid()));
grant select,delete on private.issue_follows to authenticated;

-- Extend the existing notification store with an 'issue' kind. At most one
-- issue notice per follower per post (unique user_id,question_id).
alter table private.member_notifications
  add column question_id uuid references public.questions(id) on delete cascade,
  add column follow_id uuid references private.issue_follows(id) on delete cascade;
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid='private.member_notifications'::regclass and contype='c' loop
    execute format('alter table private.member_notifications drop constraint %I',c.conname);
  end loop;
end $$;
alter table private.member_notifications
  add constraint member_notifications_kind_check check(kind in ('reply','message','issue')),
  add constraint member_notifications_target_check check(
    (kind='reply' and answer_id is not null and message_id is null and question_id is null and follow_id is null) or
    (kind='message' and message_id is not null and answer_id is null and question_id is null and follow_id is null) or
    (kind='issue' and question_id is not null and follow_id is not null and answer_id is null and message_id is null)),
  add constraint member_notifications_issue_once unique(user_id,question_id);
create index member_notifications_issue_recent on private.member_notifications(user_id,created_at) where kind='issue';

-- Members can turn followed-issue alerts off without unfollowing (future alerts only, like replies).
alter table private.notification_preferences add column issue_in_app boolean not null default true;

create function private.issue_topics(raw text[]) returns text[]
language sql immutable set search_path='' as $$
  select coalesce((select array_agg(s.t order by s.first) from (
    select lower(trim(u.v)) as t,min(u.ord) as first from unnest(coalesce(raw,'{}'::text[])) with ordinality as u(v,ord)
    where lower(trim(u.v)) ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(trim(u.v))<=48 and lower(trim(u.v))<>'visa-question'
    group by 1 order by 2 limit 5) s),'{}'::text[]);
$$;

create or replace function private.notification_visible(n private.member_notifications) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.direct_conversations c where c.request_status='blocked'
    and ((c.user_one_id=n.user_id and c.user_two_id=n.actor_id) or (c.user_two_id=n.user_id and c.user_one_id=n.actor_id)))
  and case when n.kind='reply' then exists(
    select 1 from public.answers a join public.questions q on q.id=a.question_id
    where a.id=n.answer_id and a.status='active' and q.status<>'archived' and q.author_id=n.user_id
      and (q.community_id is null or exists(select 1 from public.communities c where c.id=q.community_id and c.is_public and c.is_active)))
  when n.kind='issue' then exists(
    select 1 from public.questions q join private.issue_follows f on f.id=n.follow_id and f.user_id=n.user_id
    where q.id=n.question_id and q.status<>'archived' and q.author_id<>n.user_id
      and (q.community_id is null or exists(select 1 from public.communities c where c.id=q.community_id and c.is_public and c.is_active)))
  else exists(select 1 from public.direct_messages m join public.direct_conversations c on c.id=m.conversation_id
    where m.id=n.message_id and n.user_id in(c.user_one_id,c.user_two_id) and c.request_status in('accepted','pending')) end;
$$;

create or replace function private.member_notification_data(page_number integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid := private.notification_member(); items jsonb; prefs jsonb; unread bigint; messages bigint;
begin
  if page_number is null or page_number not between 0 and 1000 then raise exception 'Invalid notification page' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(item)),'[]') into items from (
    select n.id,n.kind,n.created_at,n.read_at,
      -- Issue notices never reveal who posted; the post itself shows its public author.
      case when n.kind='issue' then null else p.username end as actor_username,
      case when n.kind='reply' then rq.title when n.kind='issue' then iq.title else 'New Direct Message' end as title,
      case when n.kind='reply' then '/questions/'||rq.id::text||'#answer-'||a.id::text
        when n.kind='issue' then '/us/en/'||case when iq.post_kind='experience' then 'experiences' else 'questions' end||'/'||iq.id::text
        else '/messages?to='||p.username||'&member='||p.id::text end as href,
      f.anchor_id as issue_anchor_id,f.anchor_title as issue_title
    from private.member_notifications n join public.profiles p on p.id=n.actor_id
      left join public.answers a on a.id=n.answer_id left join public.questions rq on rq.id=a.question_id
      left join public.questions iq on iq.id=n.question_id left join private.issue_follows f on f.id=n.follow_id
    where n.user_id=me and private.notification_visible(n)
    order by n.created_at desc,n.id desc limit 21 offset page_number*20
  ) item;
  select count(*) into unread from private.member_notifications n where n.user_id=me and n.read_at is null and private.notification_visible(n);
  select count(*) into messages from public.direct_messages m join public.direct_conversations c on c.id=m.conversation_id
    where me in(c.user_one_id,c.user_two_id) and m.sender_id<>me and m.read_at is null and c.request_status in('accepted','pending');
  select jsonb_build_object('reply_in_app',p.reply_in_app,'message_in_app',p.message_in_app,'issue_in_app',p.issue_in_app,'reply_email',p.reply_email,'message_email',p.message_email)
    into prefs from private.notification_preferences p where p.user_id=me;
  return jsonb_build_object('items',items,'unreadNotifications',unread,'unreadMessages',messages,
    'preferences',coalesce(prefs,'{"reply_in_app":true,"message_in_app":true,"issue_in_app":true,"reply_email":false,"message_email":false}'::jsonb),
    'emailAvailable',false);
end $$;

create function private.set_notification_preferences(reply_in_app boolean,message_in_app boolean,issue_in_app boolean,reply_email boolean,message_email boolean,expected_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare me uuid := private.notification_member();
begin
  if expected_user is distinct from me then raise exception 'Account changed' using errcode='42501'; end if;
  if reply_in_app is null or message_in_app is null or issue_in_app is null or reply_email is null or message_email is null then
    raise exception 'Choose each notification preference' using errcode='22023'; end if;
  if reply_email or message_email then raise exception 'Notification email delivery is not connected yet' using errcode='22023'; end if;
  insert into private.notification_preferences(user_id,reply_in_app,message_in_app,issue_in_app,reply_email,message_email)
    values(me,reply_in_app,message_in_app,issue_in_app,reply_email,message_email)
    on conflict(user_id) do update set reply_in_app=excluded.reply_in_app,message_in_app=excluded.message_in_app,issue_in_app=excluded.issue_in_app,
      reply_email=excluded.reply_email,message_email=excluded.message_email,updated_at=now();
  perform realtime.send('{}'::jsonb,'changed','inbox:'||me::text,true);
end $$;
-- The original five-argument form stays for clients released before this migration; it leaves issue_in_app unchanged.
create function public.set_notification_preferences(reply_in_app boolean,message_in_app boolean,issue_in_app boolean,reply_email boolean,message_email boolean,expected_user uuid) returns void
language sql security invoker set search_path='' as $$select private.set_notification_preferences(reply_in_app,message_in_app,issue_in_app,reply_email,message_email,expected_user);$$;

create function private.member_issue_follows() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid := private.notification_member();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'anchor_id',f.anchor_id,'title',f.anchor_title,'topics',f.topics,'created_at',f.created_at)
    order by f.created_at desc,f.id desc) from private.issue_follows f where f.user_id=me),'[]'::jsonb);
end $$;
create function public.member_issue_follows() returns jsonb
language sql stable security invoker set search_path='' as $$select private.member_issue_follows();$$;

create function private.follow_issue(target text,target_title text,target_topics text[],expected_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid := private.notification_member(); clean_title text; clean_topics text[]; saved private.issue_follows;
begin
  if expected_user is distinct from me then raise exception 'Account changed' using errcode='42501'; end if;
  if target is null or target !~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|apify-[A-Za-z0-9_-]{1,160})$' then
    raise exception 'This post cannot be followed' using errcode='22023'; end if;
  if target like 'apify-%' then
    -- Earlier public discussions are not stored here; accept bounded, normalized topics only.
    clean_title := left(trim(regexp_replace(coalesce(target_title,''),'\s+',' ','g')),300);
    clean_topics := private.issue_topics(target_topics);
  else
    -- Member posts: trust only the database's own title and topic tags.
    select left(q.title,300),private.issue_topics(q.tags) into clean_title,clean_topics from public.questions q
      where q.id=target::uuid and q.status<>'archived'
        and (q.community_id is null or exists(select 1 from public.communities c where c.id=q.community_id and c.is_public and c.is_active));
    if not found then raise exception 'This post is no longer available' using errcode='22023'; end if;
  end if;
  if coalesce(clean_title,'')='' then raise exception 'This post cannot be followed' using errcode='22023'; end if;
  if cardinality(clean_topics)=0 then raise exception 'This post has no topics to follow yet' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(me::text,4401));
  if not exists(select 1 from private.issue_follows f where f.user_id=me and f.anchor_id=target)
    and (select count(*) from private.issue_follows f where f.user_id=me)>=50 then
    raise exception 'You can follow up to 50 issues. Unfollow one in Notifications to add another.' using errcode='P0001'; end if;
  insert into private.issue_follows(user_id,anchor_id,anchor_title,topics) values(me,target,clean_title,clean_topics)
    on conflict(user_id,anchor_id) do update set anchor_title=excluded.anchor_title,topics=excluded.topics
    returning * into saved;
  perform realtime.send('{}'::jsonb,'changed','inbox:'||me::text,true);
  return jsonb_build_object('id',saved.id,'anchor_id',saved.anchor_id,'title',saved.anchor_title,'topics',saved.topics,'created_at',saved.created_at);
end $$;
create function public.follow_issue(anchor text,anchor_title text,anchor_topics text[],expected_user uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.follow_issue(anchor,anchor_title,anchor_topics,expected_user);$$;

create function private.unfollow_issue(target text,expected_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare me uuid := private.notification_member();
begin
  if expected_user is distinct from me then raise exception 'Account changed' using errcode='42501'; end if;
  delete from private.issue_follows where user_id=me and anchor_id=target;
  perform realtime.send('{}'::jsonb,'changed','inbox:'||me::text,true);
end $$;
create function public.unfollow_issue(anchor text,expected_user uuid) returns void
language sql security invoker set search_path='' as $$select private.unfollow_issue(anchor,expected_user);$$;

-- Fan-out for a new public member post. A follow matches when the post shares
-- every topic of a one-topic follow, or at least two topics otherwise.
-- Limits: one notice per follower per post, ten issue notices per follower per
-- day, never the author's own post, never across a block, at most 500 per post.
create function private.create_issue_notifications() returns trigger
language plpgsql security definer set search_path='' as $$
declare post_topics text[] := private.issue_topics(new.tags);
begin
  if new.author_id is null or new.status='archived' or new.post_kind not in ('question','experience') or cardinality(post_topics)=0 then return null; end if;
  if new.community_id is not null and not exists(select 1 from public.communities c where c.id=new.community_id and c.is_public and c.is_active) then return null; end if;
  insert into private.member_notifications(user_id,actor_id,kind,question_id,follow_id)
  select m.user_id,new.author_id,'issue',new.id,m.id from (
    select distinct on (f.user_id) f.user_id,f.id
    from private.issue_follows f
      cross join lateral (select count(*) as shared from unnest(f.topics) t where t=any(post_topics)) s
    where f.topics && post_topics and f.user_id<>new.author_id and f.anchor_id<>new.id::text
      and s.shared>=least(2,cardinality(f.topics))
    order by f.user_id,s.shared desc,f.created_at
  ) m
  where not exists(select 1 from public.direct_conversations c where c.request_status='blocked'
      and ((c.user_one_id=m.user_id and c.user_two_id=new.author_id) or (c.user_two_id=m.user_id and c.user_one_id=new.author_id)))
    and (select count(*) from private.member_notifications n where n.user_id=m.user_id and n.kind='issue' and n.created_at>now()-interval '1 day')<10
    and coalesce((select p.issue_in_app from private.notification_preferences p where p.user_id=m.user_id),true)
  limit 500
  on conflict do nothing;
  return null;
end $$;
create trigger member_issue_notification after insert on public.questions for each row execute function private.create_issue_notifications();

revoke all on function private.issue_topics(text[]),
  private.set_notification_preferences(boolean,boolean,boolean,boolean,boolean,uuid),public.set_notification_preferences(boolean,boolean,boolean,boolean,boolean,uuid),private.member_issue_follows(),public.member_issue_follows(),
  private.follow_issue(text,text,text[],uuid),public.follow_issue(text,text,text[],uuid),
  private.unfollow_issue(text,uuid),public.unfollow_issue(text,uuid),private.create_issue_notifications()
  from public,anon,authenticated,service_role;
grant execute on function private.set_notification_preferences(boolean,boolean,boolean,boolean,boolean,uuid),public.set_notification_preferences(boolean,boolean,boolean,boolean,boolean,uuid),
  private.member_issue_follows(),public.member_issue_follows(),
  private.follow_issue(text,text,text[],uuid),public.follow_issue(text,text,text[],uuid),
  private.unfollow_issue(text,uuid),public.unfollow_issue(text,uuid) to authenticated;
commit;

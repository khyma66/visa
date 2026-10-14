-- Native posts are durable. Apify remains a development source adapter.
-- Run after community_core and secure_community_views in a dedicated dev DB.
begin;

create table public.tag_catalog (
  slug text primary key check (slug ~ '^[a-z0-9-]{1,40}$'),
  pattern text not null
);
alter table public.tag_catalog enable row level security;
create policy tag_catalog_read on public.tag_catalog for select to anon, authenticated using (true);
grant select on public.tag_catalog to anon, authenticated;
insert into public.tag_catalog (slug, pattern) values
 ('h1b', '\mh[ -]?1b\M'), ('h4', '\mh[ -]?4\M'), ('ead', '\mead\M|employment authorization'),
 ('opt', '\mopt\M|optional practical training'), ('f1', '\mf[ -]?1\M'),
 ('cpt', '\mcpt\M|curricular practical training'), ('i-140', '\mi[ -]?140\M'),
 ('uscis', '\muscis\M'), ('lottery', '\mlottery\M|registration selection'),
 ('transfer', '\mtransfer\M|change of employer'), ('premium-processing', 'premium processing'),
 ('rfe', '\mrfe\M|request for evidence'), ('ds-160', '\mds[ -]?160\M'),
 ('b1-b2', '\mb[ -]?1/?b[ -]?2\M'), ('interview', '\minterview\M|appointment slot'),
 ('stamping', '\mstamping\M|visa stamp'), ('biometrics', '\mbiometric'),
 ('work-permit', 'work (visa|permit)'), ('study-permit', 'study permit'),
 ('canada', '\mcanada\M'), ('schengen', '\mschengen\M'), ('timeline', '\mtimeline\M|how long|waiting');

create function private.infer_topic_tags(content text) returns text[]
language sql stable security invoker set search_path = '' as $$
  select coalesce(array_agg(slug order by slug), '{}') from public.tag_catalog where content ~* pattern;
$$;

alter table public.answers add column topic_tags text[] not null default '{}';
alter table public.answers add column search_document tsvector
  generated always as (to_tsvector('english', body)) stored;
create index answers_topic_tags_idx on public.answers using gin(topic_tags) where status = 'active';
create index answers_search_idx on public.answers using gin(search_document) where status = 'active';

create table public.imported_answers (
  id uuid primary key default gen_random_uuid(),
  question_id text not null check (question_id ~ '^apify-[a-zA-Z0-9_-]{1,100}$'),
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(trim(body)) between 20 and 10000),
  topic_tags text[] not null default '{}',
  vote_score integer not null default 0,
  is_accepted boolean not null default false,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index imported_answers_thread_idx on public.imported_answers(question_id, created_at desc, id);
create index imported_answers_author_idx on public.imported_answers(author_id);
alter table public.imported_answers enable row level security;
create policy imported_answers_read on public.imported_answers for select to anon, authenticated using (status = 'active');
create policy imported_answers_insert on public.imported_answers for insert to authenticated
  with check (author_id = (select auth.uid()));
grant select on public.imported_answers to anon, authenticated;
grant insert (question_id, author_id, body) on public.imported_answers to authenticated;
create view public.imported_answer_feed with (security_invoker = true) as
  select a.id, a.question_id, a.author_id, p.username as author_username, p.avatar_seed as author_avatar_seed,
    a.body, a.vote_score, a.is_accepted, a.status, a.created_at, a.updated_at
  from public.imported_answers a join public.profiles p on p.id = a.author_id where a.status = 'active';
grant select on public.imported_answer_feed to anon, authenticated;

create function private.set_answer_topics() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.topic_tags := private.infer_topic_tags(new.body);
  return new;
end;
$$;
create trigger answers_set_topics before insert or update of body on public.answers
  for each row execute function private.set_answer_topics();
create trigger imported_answers_set_topics before insert or update of body on public.imported_answers
  for each row execute function private.set_answer_topics();
update public.answers set topic_tags = private.infer_topic_tags(body);

create function private.prepare_question_tags() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if cardinality(new.tags) = 0 then
    new.tags := (private.infer_topic_tags(new.title || ' ' || new.body))[1:5];
  end if;
  return new;
end;
$$;
create trigger question_auto_tags before insert or update of title,body,tags on public.questions
  for each row execute function private.prepare_question_tags();

-- Incremental count maintenance avoids recounting a hot thread on every reply.
create or replace function private.refresh_answer_count() returns trigger
language plpgsql security definer set search_path = '' as $$
declare change integer;
begin
  change := case when tg_op <> 'DELETE' and new.status = 'active' then 1 else 0 end
    - case when tg_op <> 'INSERT' and old.status = 'active' then 1 else 0 end;
  if change <> 0 then update public.questions set answer_count = greatest(0,answer_count + change)
    where id = coalesce(new.question_id,old.question_id); end if;
  return null;
end;
$$;

create function public.discover_questions(
  source_id text default null, query_tags text[] default '{}', comment_tags text[] default '{}',
  query_text text default '', filter_visa text default '', result_limit integer default 5
) returns table (id text, title text, visa_type text, tags text[], vote_score integer,
  answer_count integer, created_at timestamptz, similarity_score real, matched_tags text[])
language sql stable security invoker set search_path = '' as $$
  with input as (
    select query_tags[1:16] as tags,
      websearch_to_tsquery('english', left(query_text, 500)) as terms
  ), candidates as materialized (
    (select q.id from public.questions q, input i
      where q.status <> 'archived' and q.tags && i.tags limit 200)
    union
    (select q.id from public.questions q, input i
      where q.status <> 'archived' and q.search_document @@ i.terms limit 200)
    union
    (select a.question_id from public.answers a, input i
      where a.status = 'active' and a.topic_tags && i.tags limit 200)
    union
    (select a.question_id from public.answers a, input i
      where a.status = 'active' and a.search_document @@ i.terms limit 200)
  ), ranked as (
    select q.*, matches.shared,
      (cardinality(matches.shared) * 2
        + (select count(*) from unnest(matches.shared) t where t = any(comment_tags[1:16])) * 4
        + least(ts_rank(q.search_document, i.terms) * 4, 4)
        + case when q.visa_type = filter_visa and filter_visa <> 'General' then 0.5 else 0 end)::real as score
    from candidates c join public.questions q on q.id = c.id cross join input i
    cross join lateral (
      select array(select distinct t from unnest(i.tags) t
        where t = any(q.tags) or exists (
          select 1 from public.answers a where a.question_id = q.id and a.status = 'active' and t = any(a.topic_tags)
        ) order by t) as shared
    ) matches
    where q.id::text is distinct from source_id and q.status <> 'archived'
  ) select r.id::text, r.title, r.visa_type, r.tags, r.vote_score, r.answer_count, r.created_at, r.score, r.shared
    from ranked r order by r.score desc, r.vote_score desc, r.created_at desc, r.id
    limit least(greatest(result_limit, 1), 12);
$$;
revoke all on function public.discover_questions(text,text[],text[],text,text,integer) from public;
grant execute on function public.discover_questions(text,text[],text[],text,text,integer) to anon, authenticated;

-- Cursor pagination is independent of the small Apify development archive.
create index questions_score_page_idx on public.questions(vote_score desc,created_at desc,id desc) where status <> 'archived';
create index questions_activity_page_idx on public.questions((vote_score + answer_count * 2) desc,created_at desc,id desc) where status <> 'archived';
create index questions_new_page_idx on public.questions(created_at desc,id desc) where status <> 'archived';
create function public.community_question_page(
  query_text text default '', filter_tag text default '', filter_visa text default '', sort_mode text default 'newest',
  before_time timestamptz default null, before_id uuid default null, before_score integer default null
) returns setof public.question_feed language sql stable security invoker set search_path = '' as $$
  select f.* from public.questions q join public.question_feed f on f.id = q.id
  where q.status <> 'archived'
    and (query_text = '' or q.search_document @@ websearch_to_tsquery('english',left(query_text,500)))
    and (filter_tag = '' or q.tags @> array[filter_tag])
    and (filter_visa = '' or q.visa_type = filter_visa)
    and (sort_mode <> 'unanswered' or q.answer_count = 0)
    and (before_time is null or (
      case sort_mode when 'score' then q.vote_score when 'activity' then q.vote_score + q.answer_count * 2 else 0 end,
      q.created_at,q.id
    ) < (coalesce(before_score,0),before_time,before_id))
  order by case sort_mode when 'score' then q.vote_score when 'activity' then q.vote_score + q.answer_count * 2 else 0 end desc,
    q.created_at desc,q.id desc limit 50;
$$;
revoke all on function public.community_question_page(text,text,text,text,timestamptz,uuid,integer) from public;
grant execute on function public.community_question_page(text,text,text,text,timestamptz,uuid,integer) to anon,authenticated;

-- Only small invalidations are broadcast. Clients fetch durable rows using RLS.
create function private.broadcast_discussion() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target_id text; topics text[]; topic text;
begin
  if tg_table_name = 'questions' then
    target_id := coalesce(new.id, old.id)::text;
    topics := coalesce(new.tags, '{}') || coalesce(old.tags, '{}');
  else
    target_id := coalesce(new.question_id, old.question_id)::text;
    topics := coalesce(new.topic_tags, '{}') || coalesce(old.topic_tags, '{}');
    if tg_table_name = 'answers' then
      topics := topics || coalesce((select tags from public.questions where id::text = target_id),'{}');
    end if;
  end if;
  perform realtime.send(jsonb_build_object('id',target_id), 'changed', 'question:' || target_id, true);
  for topic in select distinct t from unnest(topics) t limit 16 loop
    perform realtime.send(jsonb_build_object('id',target_id), 'changed', 'discovery:' || topic, true);
  end loop;
  return null;
end;
$$;
create trigger questions_broadcast after insert or update or delete on public.questions
  for each row execute function private.broadcast_discussion();
create trigger answers_broadcast after insert or update or delete on public.answers
  for each row execute function private.broadcast_discussion();
create trigger imported_answers_broadcast after insert or update or delete on public.imported_answers
  for each row execute function private.broadcast_discussion();

alter table public.direct_conversations
  add column request_status text not null default 'accepted' check (request_status in ('pending','accepted','declined','blocked')),
  add column requested_by uuid references public.profiles(id),
  add column blocked_by uuid references public.profiles(id),
  add constraint request_sender_participant check (requested_by is null or requested_by in (user_one_id,user_two_id)),
  add constraint block_sender_participant check (blocked_by is null or blocked_by in (user_one_id,user_two_id));
create index conversations_requested_by_idx on public.direct_conversations(requested_by, created_at desc);
create index conversations_blocked_by_idx on public.direct_conversations(blocked_by) where blocked_by is not null;
create index messages_sender_recent_idx on public.direct_messages(sender_id, created_at desc);
create index messages_page_idx on public.direct_messages(conversation_id, created_at desc, id desc);

create or replace view public.conversation_inbox with (security_invoker = true) as
select c.id, c.last_message_at, c.created_at,
  case when c.user_one_id = (select auth.uid()) then c.user_two_id else c.user_one_id end as other_user_id,
  p.username as other_username, p.avatar_seed as other_avatar_seed,
  latest.body as last_message, latest.created_at as last_message_created_at,
  (select count(*)::integer from public.direct_messages m where m.conversation_id = c.id
    and m.sender_id <> (select auth.uid()) and m.read_at is null) as unread_count,
  c.request_status, c.requested_by, c.blocked_by
from public.direct_conversations c
join public.profiles p on p.id = case when c.user_one_id = (select auth.uid()) then c.user_two_id else c.user_one_id end
left join lateral (select body, created_at from public.direct_messages m where m.conversation_id = c.id
  order by created_at desc, id desc limit 1) latest on true
where (select auth.uid()) in (c.user_one_id, c.user_two_id);

create function private.start_chat(other_username text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); other_user uuid; conversation public.direct_conversations;
begin
  if me is null then raise exception 'Authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(me::text, 0));
  select id into other_user from public.profiles where username = lower(trim(other_username));
  if other_user is null or other_user = me then raise exception 'Choose another registered community member'; end if;
  select * into conversation from public.direct_conversations
    where user_one_id = least(me,other_user) and user_two_id = greatest(me,other_user);
  if found then return conversation.id; end if;
  if (select count(*) from public.direct_conversations where requested_by = me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Daily chat request limit reached';
  end if;
  insert into public.direct_conversations(user_one_id,user_two_id,request_status,requested_by)
    values(least(me,other_user),greatest(me,other_user),'pending',me)
    on conflict(user_one_id,user_two_id) do update set updated_at = public.direct_conversations.updated_at
    returning * into conversation;
  return conversation.id;
end;
$$;
create or replace function public.start_direct_conversation(other_username text) returns uuid
language sql security invoker set search_path = '' as $$ select private.start_chat(other_username); $$;

create function private.respond_chat(target_conversation uuid, decision text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.direct_conversations;
begin
  if me is null then raise exception 'Authentication required'; end if;
  select * into c from public.direct_conversations where id = target_conversation for update;
  if not found or me not in (c.user_one_id,c.user_two_id) then raise exception 'Conversation unavailable'; end if;
  if decision not in ('accepted','declined','blocked') or decision is null then raise exception 'Invalid decision'; end if;
  if c.request_status in ('declined','blocked') then raise exception 'Conversation is closed'; end if;
  if decision <> 'blocked' and (c.request_status <> 'pending' or c.requested_by = me) then
    raise exception 'Only the recipient may accept or decline a request';
  end if;
  update public.direct_conversations set request_status = decision,
    blocked_by = case when decision = 'blocked' then me else null end, updated_at = now()
    where id = target_conversation;
end;
$$;
create function public.respond_to_conversation(target_conversation uuid, decision text) returns void
language sql security invoker set search_path = '' as $$ select private.respond_chat(target_conversation,decision); $$;

-- Lock conversation for request/send/block races. Idempotency is enforced by message UUID.
create function private.send_chat(target_conversation uuid, message_body text, message_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.direct_conversations; existing public.direct_messages;
begin
  if me is null then raise exception 'Authentication required'; end if;
  if message_id is null or char_length(trim(message_body)) not between 1 and 4000 or message_body is null then
    raise exception 'Message must contain 1 to 4000 characters';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(me::text, 1));
  select * into c from public.direct_conversations where id = target_conversation for update;
  if not found or me not in (c.user_one_id,c.user_two_id) then raise exception 'Conversation unavailable'; end if;
  select * into existing from public.direct_messages where id = message_id;
  if found then
    if existing.sender_id = me and existing.conversation_id = target_conversation and existing.body = trim(message_body) then return message_id; end if;
    raise exception 'Message identifier already used';
  end if;
  if c.request_status in ('declined','blocked') then raise exception 'Conversation is closed'; end if;
  if c.request_status = 'pending' and (c.requested_by <> me or exists(select 1 from public.direct_messages where conversation_id = c.id)) then
    raise exception 'Wait for your request to be accepted';
  end if;
  if (select count(*) from public.direct_messages where sender_id = me and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Please wait before sending more messages';
  end if;
  insert into public.direct_messages(id,conversation_id,sender_id,body) values(message_id,c.id,me,trim(message_body));
  return message_id;
end;
$$;
create function public.send_direct_message(target_conversation uuid, message_body text, message_id uuid) returns uuid
language sql security invoker set search_path = '' as $$ select private.send_chat(target_conversation,message_body,message_id); $$;
revoke insert on public.direct_messages from authenticated;
revoke insert (conversation_id,sender_id,body) on public.direct_messages from authenticated;

create function public.message_page(target_conversation uuid, before_time timestamptz default null, before_id uuid default null)
returns setof public.direct_messages language sql stable security invoker set search_path = '' as $$
  select * from public.direct_messages where conversation_id = target_conversation
    and (before_time is null or (created_at,id) < (before_time,before_id))
  order by created_at desc,id desc limit 50;
$$;

create function private.broadcast_chat() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.direct_conversations;
begin
  if tg_table_name = 'direct_conversations' then c := new;
  else select * into c from public.direct_conversations where id = new.conversation_id;
  end if;
  perform realtime.send(jsonb_build_object('id',c.id), 'changed', 'conversation:' || c.id::text, true);
  perform realtime.send(jsonb_build_object('id',c.id), 'changed', 'inbox:' || c.user_one_id::text, true);
  perform realtime.send(jsonb_build_object('id',c.id), 'changed', 'inbox:' || c.user_two_id::text, true);
  return null;
end;
$$;
-- The existing insert trigger touches the conversation and emits the new-message notification.
create trigger conversation_broadcast after insert or update on public.direct_conversations
  for each row execute function private.broadcast_chat();
create trigger message_read_broadcast after update of read_at on public.direct_messages
  for each row when (old.read_at is distinct from new.read_at) execute function private.broadcast_chat();

-- Channels authorize participants by exact topic. No client broadcast sends are granted.
create policy visaflow_receive_broadcast on realtime.messages for select to authenticated using (
  extension = 'broadcast' and topic = realtime.topic() and (
    realtime.topic() = 'inbox:' || (select auth.uid())::text
    or exists (select 1 from public.direct_conversations c where 'conversation:' || c.id::text = realtime.topic()
      and (select auth.uid()) in (c.user_one_id,c.user_two_id))
    or realtime.topic() ~ '^question:(apify-[a-zA-Z0-9_-]{1,100}|[a-f0-9-]{36})$'
    or realtime.topic() ~ '^discovery:[a-z0-9-]{1,40}$'
  )
);

revoke execute on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.start_chat(text), private.respond_chat(uuid,text), private.send_chat(uuid,text,uuid) to authenticated;
revoke all on function public.respond_to_conversation(uuid,text), public.send_direct_message(uuid,text,uuid), public.message_page(uuid,timestamptz,uuid) from public;
grant execute on function public.respond_to_conversation(uuid,text), public.send_direct_message(uuid,text,uuid), public.message_page(uuid,timestamptz,uuid) to authenticated;

commit;

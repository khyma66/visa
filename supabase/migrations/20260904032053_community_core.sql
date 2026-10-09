-- VisaFlow community core
-- RLS-first schema for anonymous public profiles, visa Q&A, related-question
-- discovery, accepted answers, voting, and private direct messages.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
-- Resumed projects can already have pg_trgm installed in public.
do $$ begin
  if exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_trgm' and n.nspname <> 'extensions') then
    alter extension pg_trgm set schema extensions;
  end if;
end $$;
grant usage on schema extensions to anon, authenticated;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  avatar_seed text not null default replace(gen_random_uuid()::text, '-', ''),
  bio text,
  reputation integer not null default 1 check (reputation >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z][a-z0-9-]{4,31}$'),
  constraint profiles_bio_length check (bio is null or char_length(bio) <= 280)
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  body text not null,
  destination_country text not null default 'United States',
  visa_type text not null default 'General',
  tags text[] not null default '{}',
  status text not null default 'open' check (status in ('open', 'closed', 'archived')),
  vote_score integer not null default 0,
  answer_count integer not null default 0 check (answer_count >= 0),
  view_count integer not null default 0 check (view_count >= 0),
  accepted_answer_id uuid,
  search_document tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(visa_type, '')), 'A')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint questions_title_length check (char_length(title) between 15 and 180),
  constraint questions_body_length check (char_length(body) between 30 and 10000),
  constraint questions_tags_count check (cardinality(tags) <= 5)
);

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null,
  vote_score integer not null default 0,
  is_accepted boolean not null default false,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint answers_body_length check (char_length(body) between 20 and 10000)
);

alter table public.questions
  add constraint questions_accepted_answer_id_fkey
  foreign key (accepted_answer_id) references public.answers(id) on delete set null;

create table if not exists public.question_votes (
  question_id uuid not null references public.questions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (question_id, user_id)
);

create table if not exists public.answer_votes (
  answer_id uuid not null references public.answers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (answer_id, user_id)
);

create table if not exists public.direct_conversations (
  id uuid primary key default gen_random_uuid(),
  user_one_id uuid not null references public.profiles(id) on delete cascade,
  user_two_id uuid not null references public.profiles(id) on delete cascade,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint direct_conversations_distinct_users check (user_one_id <> user_two_id),
  constraint direct_conversations_canonical_order check (user_one_id::text < user_two_id::text),
  unique (user_one_id, user_two_id)
);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint direct_messages_body_length check (char_length(body) between 1 and 4000)
);

create unique index if not exists answers_one_accepted_per_question_idx
  on public.answers (question_id) where is_accepted;
create index if not exists questions_feed_idx
  on public.questions (status, created_at desc);
create index if not exists questions_visa_feed_idx
  on public.questions (visa_type, status, created_at desc);
create index if not exists questions_author_id_idx on public.questions (author_id);
create index if not exists questions_search_document_idx
  on public.questions using gin (search_document);
create index if not exists questions_title_trgm_idx
  on public.questions using gin (title extensions.gin_trgm_ops);
create index if not exists questions_tags_idx on public.questions using gin (tags);
create index if not exists answers_question_created_idx
  on public.answers (question_id, is_accepted desc, vote_score desc, created_at);
create index if not exists answers_author_id_idx on public.answers (author_id);
create index if not exists question_votes_user_id_idx on public.question_votes (user_id);
create index if not exists answer_votes_user_id_idx on public.answer_votes (user_id);
create index if not exists direct_conversations_user_one_idx
  on public.direct_conversations (user_one_id, last_message_at desc);
create index if not exists direct_conversations_user_two_idx
  on public.direct_conversations (user_two_id, last_message_at desc);
create index if not exists direct_messages_conversation_created_idx
  on public.direct_messages (conversation_id, created_at);
create index if not exists direct_messages_unread_idx
  on public.direct_messages (conversation_id, sender_id, created_at) where read_at is null;

create or replace function private.random_username()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  adjectives constant text[] := array['brave','calm','clever','cosmic','gentle','hidden','kind','lucky','quiet','swift','warm','wise'];
  nouns constant text[] := array['badger','comet','falcon','fox','heron','lotus','otter','panda','raven','tiger','willow','yak'];
  candidate text;
begin
  loop
    candidate := adjectives[1 + floor(random() * cardinality(adjectives))::integer]
      || '-' || nouns[1 + floor(random() * cardinality(nouns))::integer]
      || '-' || lpad(floor(random() * 10000)::integer::text, 4, '0');
    exit when not exists (select 1 from public.profiles where username = candidate);
  end loop;
  return candidate;
end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, private.random_username())
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.refresh_question_vote_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
begin
  target_id := case when tg_op = 'DELETE' then old.question_id else new.question_id end;
  update public.questions
  set vote_score = coalesce((select sum(value) from public.question_votes where question_id = target_id), 0)
  where id = target_id;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.refresh_answer_vote_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
begin
  target_id := case when tg_op = 'DELETE' then old.answer_id else new.answer_id end;
  update public.answers
  set vote_score = coalesce((select sum(value) from public.answer_votes where answer_id = target_id), 0)
  where id = target_id;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.refresh_answer_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
begin
  target_id := case when tg_op = 'DELETE' then old.question_id else new.question_id end;
  update public.questions
  set answer_count = (select count(*) from public.answers where question_id = target_id and status = 'active')
  where id = target_id;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.direct_conversations
  set last_message_at = new.created_at, updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute function private.touch_updated_at();
drop trigger if exists questions_touch_updated_at on public.questions;
create trigger questions_touch_updated_at before update on public.questions
  for each row execute function private.touch_updated_at();
drop trigger if exists answers_touch_updated_at on public.answers;
create trigger answers_touch_updated_at before update on public.answers
  for each row execute function private.touch_updated_at();
drop trigger if exists question_votes_touch_updated_at on public.question_votes;
create trigger question_votes_touch_updated_at before update on public.question_votes
  for each row execute function private.touch_updated_at();
drop trigger if exists answer_votes_touch_updated_at on public.answer_votes;
create trigger answer_votes_touch_updated_at before update on public.answer_votes
  for each row execute function private.touch_updated_at();

drop trigger if exists question_votes_refresh_score on public.question_votes;
create trigger question_votes_refresh_score
  after insert or update or delete on public.question_votes
  for each row execute function private.refresh_question_vote_score();
drop trigger if exists answer_votes_refresh_score on public.answer_votes;
create trigger answer_votes_refresh_score
  after insert or update or delete on public.answer_votes
  for each row execute function private.refresh_answer_vote_score();
drop trigger if exists answers_refresh_count on public.answers;
create trigger answers_refresh_count
  after insert or update of status or delete on public.answers
  for each row execute function private.refresh_answer_count();
drop trigger if exists direct_messages_touch_conversation on public.direct_messages;
create trigger direct_messages_touch_conversation
  after insert on public.direct_messages
  for each row execute function private.touch_conversation();

create or replace view public.question_feed as
select
  q.id, q.author_id, p.username as author_username,
  p.avatar_seed as author_avatar_seed, q.title, q.body,
  q.destination_country, q.visa_type, q.tags, q.status, q.vote_score,
  q.answer_count, q.view_count, q.accepted_answer_id, q.created_at, q.updated_at
from public.questions q
join public.profiles p on p.id = q.author_id
where q.status <> 'archived';

create or replace view public.answer_feed as
select
  a.id, a.question_id, a.author_id, p.username as author_username,
  p.avatar_seed as author_avatar_seed, a.body, a.vote_score, a.is_accepted,
  a.status, a.created_at, a.updated_at
from public.answers a
join public.profiles p on p.id = a.author_id
where a.status = 'active';

create or replace view public.conversation_inbox as
select
  c.id, c.last_message_at, c.created_at,
  case when c.user_one_id = (select auth.uid()) then c.user_two_id else c.user_one_id end as other_user_id,
  p.username as other_username,
  p.avatar_seed as other_avatar_seed,
  latest.body as last_message,
  latest.created_at as last_message_created_at,
  (
    select count(*)::integer
    from public.direct_messages unread
    where unread.conversation_id = c.id
      and unread.sender_id <> (select auth.uid())
      and unread.read_at is null
  ) as unread_count
from public.direct_conversations c
join public.profiles p
  on p.id = case when c.user_one_id = (select auth.uid()) then c.user_two_id else c.user_one_id end
left join lateral (
  select body, created_at
  from public.direct_messages message
  where message.conversation_id = c.id
  order by created_at desc
  limit 1
) latest on true
where (select auth.uid()) in (c.user_one_id, c.user_two_id);

create or replace function public.search_questions(
  search_text text,
  filter_visa_type text default null,
  result_limit integer default 20
)
returns table (
  id uuid, author_id uuid, author_username text, author_avatar_seed text,
  title text, body text, destination_country text, visa_type text, tags text[],
  status text, vote_score integer, answer_count integer, view_count integer,
  accepted_answer_id uuid, created_at timestamptz, updated_at timestamptz,
  relevance real
)
language sql
stable
set search_path = ''
as $$
  select
    q.id, q.author_id, p.username, p.avatar_seed, q.title, q.body,
    q.destination_country, q.visa_type, q.tags, q.status, q.vote_score,
    q.answer_count, q.view_count, q.accepted_answer_id, q.created_at, q.updated_at,
    (ts_rank(q.search_document, websearch_to_tsquery('english', search_text))
      + extensions.similarity(q.title, search_text) * 0.45)::real as relevance
  from public.questions q
  join public.profiles p on p.id = q.author_id
  where q.status <> 'archived'
    and (filter_visa_type is null or q.visa_type = filter_visa_type)
    and (
      q.search_document @@ websearch_to_tsquery('english', search_text)
      or extensions.similarity(q.title, search_text) > 0.12
    )
  order by relevance desc, q.vote_score desc, q.created_at desc
  limit least(greatest(result_limit, 1), 50);
$$;

create or replace function public.related_questions(
  source_question_id uuid,
  result_limit integer default 6
)
returns table (
  id uuid, title text, visa_type text, tags text[], vote_score integer,
  answer_count integer, created_at timestamptz, similarity_score real
)
language sql
stable
set search_path = ''
as $$
  with source as (
    select title, visa_type, tags from public.questions
    where id = source_question_id and status <> 'archived'
  )
  select
    q.id, q.title, q.visa_type, q.tags, q.vote_score, q.answer_count, q.created_at,
    (
      extensions.similarity(q.title, source.title)
      + case when q.visa_type = source.visa_type then 0.25 else 0 end
      + least((
          select count(*) from (
            select unnest(q.tags)
            intersect
            select unnest(source.tags)
          ) shared_tags
        ), 3) * 0.12
    )::real as similarity_score
  from public.questions q
  cross join source
  where q.id <> source_question_id and q.status <> 'archived'
  order by similarity_score desc, q.vote_score desc
  limit least(greatest(result_limit, 1), 12);
$$;

create or replace function public.accept_answer(target_answer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_question_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select question_id into target_question_id
  from public.answers where id = target_answer_id and status = 'active';
  if target_question_id is null or not exists (
    select 1 from public.questions
    where id = target_question_id and author_id = (select auth.uid())
  ) then
    raise exception 'Only the question author can accept an answer';
  end if;
  update public.answers set is_accepted = false
  where question_id = target_question_id and is_accepted;
  update public.answers set is_accepted = true where id = target_answer_id;
  update public.questions set accepted_answer_id = target_answer_id where id = target_question_id;
end;
$$;

create or replace function public.start_direct_conversation(other_username text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  other_user uuid;
  first_user uuid;
  second_user uuid;
  conversation_id uuid;
begin
  if me is null then raise exception 'Authentication required'; end if;
  select id into other_user from public.profiles where username = lower(trim(other_username));
  if other_user is null then raise exception 'No user found with that anonymous handle'; end if;
  if other_user = me then raise exception 'You cannot message yourself'; end if;
  if me::text < other_user::text then
    first_user := me; second_user := other_user;
  else
    first_user := other_user; second_user := me;
  end if;
  insert into public.direct_conversations (user_one_id, user_two_id)
  values (first_user, second_user)
  on conflict (user_one_id, user_two_id)
  do update set updated_at = public.direct_conversations.updated_at
  returning id into conversation_id;
  return conversation_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.questions enable row level security;
alter table public.answers enable row level security;
alter table public.question_votes enable row level security;
alter table public.answer_votes enable row level security;
alter table public.direct_conversations enable row level security;
alter table public.direct_messages enable row level security;

create policy profiles_public_read on public.profiles for select
  to anon, authenticated using (true);
create policy profiles_owner_update on public.profiles for update
  to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy questions_public_read on public.questions for select
  to anon, authenticated using (status <> 'archived');
create policy questions_owner_insert on public.questions for insert
  to authenticated with check ((select auth.uid()) = author_id);
create policy questions_owner_update on public.questions for update
  to authenticated using ((select auth.uid()) = author_id) with check ((select auth.uid()) = author_id);
create policy answers_public_read on public.answers for select
  to anon, authenticated using (status = 'active');
create policy answers_owner_insert on public.answers for insert
  to authenticated with check ((select auth.uid()) = author_id);
create policy answers_owner_update on public.answers for update
  to authenticated using ((select auth.uid()) = author_id) with check ((select auth.uid()) = author_id);
create policy question_votes_owner_read on public.question_votes for select
  to authenticated using ((select auth.uid()) = user_id);
create policy question_votes_owner_insert on public.question_votes for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy question_votes_owner_update on public.question_votes for update
  to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy question_votes_owner_delete on public.question_votes for delete
  to authenticated using ((select auth.uid()) = user_id);
create policy answer_votes_owner_read on public.answer_votes for select
  to authenticated using ((select auth.uid()) = user_id);
create policy answer_votes_owner_insert on public.answer_votes for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy answer_votes_owner_update on public.answer_votes for update
  to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy answer_votes_owner_delete on public.answer_votes for delete
  to authenticated using ((select auth.uid()) = user_id);
create policy conversations_participant_read on public.direct_conversations for select
  to authenticated using ((select auth.uid()) in (user_one_id, user_two_id));
create policy messages_participant_read on public.direct_messages for select
  to authenticated using (exists (
    select 1 from public.direct_conversations conversation
    where conversation.id = conversation_id
      and (select auth.uid()) in (conversation.user_one_id, conversation.user_two_id)
  ));
create policy messages_participant_insert on public.direct_messages for insert
  to authenticated with check (
    sender_id = (select auth.uid()) and exists (
      select 1 from public.direct_conversations conversation
      where conversation.id = conversation_id
        and (select auth.uid()) in (conversation.user_one_id, conversation.user_two_id)
    )
  );
create policy messages_recipient_mark_read on public.direct_messages for update
  to authenticated
  using (sender_id <> (select auth.uid()) and exists (
    select 1 from public.direct_conversations conversation
    where conversation.id = conversation_id
      and (select auth.uid()) in (conversation.user_one_id, conversation.user_two_id)
  ))
  with check (sender_id <> (select auth.uid()));

revoke all on table public.profiles, public.questions, public.answers,
  public.question_votes, public.answer_votes, public.direct_conversations,
  public.direct_messages, public.question_feed, public.answer_feed,
  public.conversation_inbox from anon, authenticated;
grant select on public.profiles, public.questions, public.answers,
  public.question_feed, public.answer_feed to anon, authenticated;
grant select, delete on public.question_votes, public.answer_votes to authenticated;
grant insert (question_id, user_id, value) on public.question_votes to authenticated;
grant update (value) on public.question_votes to authenticated;
grant insert (answer_id, user_id, value) on public.answer_votes to authenticated;
grant update (value) on public.answer_votes to authenticated;
grant insert (author_id, title, body, destination_country, visa_type, tags)
  on public.questions to authenticated;
grant update (title, body, destination_country, visa_type, tags, status)
  on public.questions to authenticated;
grant insert (question_id, author_id, body) on public.answers to authenticated;
grant update (body) on public.answers to authenticated;
grant update (bio) on public.profiles to authenticated;
grant select on public.direct_conversations, public.direct_messages,
  public.conversation_inbox to authenticated;
grant insert (conversation_id, sender_id, body) on public.direct_messages to authenticated;
grant update (read_at) on public.direct_messages to authenticated;

revoke execute on function public.search_questions(text, text, integer) from public;
revoke execute on function public.related_questions(uuid, integer) from public;
revoke execute on function public.accept_answer(uuid) from public;
revoke execute on function public.start_direct_conversation(text) from public;
grant execute on function public.search_questions(text, text, integer) to anon, authenticated;
grant execute on function public.related_questions(uuid, integer) to anon, authenticated;
grant execute on function public.accept_answer(uuid) to authenticated;
grant execute on function public.start_direct_conversation(text) to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'direct_messages'
  ) then
    alter publication supabase_realtime add table public.direct_messages;
  end if;
end;
$$;

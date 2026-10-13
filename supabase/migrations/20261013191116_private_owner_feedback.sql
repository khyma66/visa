begin;
set local lock_timeout = '5s';

-- Separate from moderators. Empty until an operator verifies the owner's
-- authenticated UUID; no email, browser flag or user metadata grants access.
create table private.feedback_owner (
  singleton boolean primary key default true check(singleton),
  user_id uuid not null unique references auth.users(id) on delete cascade
);
create table private.feedback_items (
  id uuid primary key default gen_random_uuid(),
  submitter_id uuid references auth.users(id) on delete set null,
  request_id uuid not null,
  category text not null check(category in ('bug','idea','other')),
  message text not null check(char_length(message) between 10 and 3000),
  section text not null check(section in ('general','home','explore','communities','questions','experiences','news','tags','messages','account','login','policies')),
  status text not null default 'new' check(status in ('new','reviewing','planned','approved','done','declined')),
  plan text not null default '' check(char_length(plan)<=5000),
  plan_version integer not null default 0,
  approved_plan_version integer,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(submitter_id,request_id)
);
create table private.feedback_events (
  id bigint generated always as identity primary key,
  feedback_id uuid not null references private.feedback_items(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
alter table private.feedback_owner enable row level security;
alter table private.feedback_items enable row level security;
alter table private.feedback_events enable row level security;
revoke all on private.feedback_owner,private.feedback_items,private.feedback_events from public,anon,authenticated,service_role;
revoke all on sequence private.feedback_events_id_seq from public,anon,authenticated,service_role;
create index feedback_newest_idx on private.feedback_items(created_at desc,id desc);
create index feedback_status_newest_idx on private.feedback_items(status,created_at desc,id desc);
create index feedback_approver_idx on private.feedback_items(approved_by) where approved_by is not null;
create index feedback_history_idx on private.feedback_events(feedback_id,id desc);
create index feedback_actor_idx on private.feedback_events(actor_id) where actor_id is not null;

create function private.feedback_is_owner() returns boolean
language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null
    and exists(select 1 from private.feedback_owner where user_id=(select auth.uid()))
    and not exists(select 1 from private.community_suspensions where user_id=(select auth.uid()));
$$;
create function public.feedback_is_owner() returns boolean
language sql stable security invoker set search_path='' as $$ select private.feedback_is_owner(); $$;

create function private.feedback_submit(client_request_id uuid,feedback_category text,feedback_message text,page_section text) returns uuid
language plpgsql security definer set search_path='' as $$
declare me uuid := (select auth.uid()); existing private.feedback_items; result uuid;
begin
  if me is null then raise exception 'Sign in to send feedback' using errcode='42501'; end if;
  if not exists(select 1 from private.feedback_owner) then raise exception 'Feedback is not available yet' using errcode='P0001'; end if;
  if client_request_id is null or feedback_category is null or feedback_category not in ('bug','idea','other')
    or feedback_message is null or char_length(btrim(feedback_message)) not between 10 and 3000
    or page_section is null or page_section not in ('general','home','explore','communities','questions','experiences','news','tags','messages','account','login','policies') then
    raise exception 'Check your feedback fields' using errcode='22023';
  end if;
  if exists(select 1 from private.community_suspensions where user_id=me) then
    raise exception 'Feedback unavailable for this account' using errcode='42501';
  end if;
  -- Serializes retries and concurrent tabs per account; failed transactions do
  -- not charge the rate bucket, and a network retry cannot create a second item.
  perform pg_advisory_xact_lock(hashtextextended('feedback:' || me::text,0));
  select * into existing from private.feedback_items where submitter_id=me and request_id=client_request_id;
  if found then
    if existing.message<>btrim(feedback_message) or existing.category<>feedback_category or existing.section<>page_section then
      raise exception 'This request was already used' using errcode='22023';
    end if;
    return existing.id;
  end if;
  perform private.community_consume('feedback',5,3600);
  insert into private.feedback_items(submitter_id,request_id,category,message,section)
    values(me,client_request_id,feedback_category,btrim(feedback_message),page_section) returning id into result;
  return result;
end $$;
create function public.feedback_submit(client_request_id uuid,feedback_category text,feedback_message text,page_section text default 'general') returns uuid
language sql security invoker set search_path='' as $$ select private.feedback_submit(client_request_id,feedback_category,feedback_message,page_section); $$;

create function private.feedback_inbox(status_filter text,before_created_at timestamptz,before_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.feedback_is_owner() then raise exception 'Owner access required' using errcode='42501'; end if;
  if (before_created_at is null)<>(before_id is null) or (status_filter is not null and status_filter not in ('new','reviewing','planned','approved','done','declined')) then
    raise exception 'Invalid inbox filter' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc,item.id desc),'[]'::jsonb) into result from (
    select id,category,message,section,status,plan,plan_version,approved_plan_version,approved_at,version,created_at,updated_at
    from private.feedback_items where (status_filter is null or status=status_filter)
      and (before_created_at is null or (created_at,id)<(before_created_at,before_id))
    order by created_at desc,id desc limit 21
  ) item;
  return result;
end $$;
create function public.feedback_inbox(status_filter text default null,before_created_at timestamptz default null,before_id uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.feedback_inbox(status_filter,before_created_at,before_id); $$;

create function private.feedback_review(target_id uuid,expected_version integer,review_action text,proposed_plan text) returns void
language plpgsql security definer set search_path='' as $$
declare item private.feedback_items; next_status text;
begin
  if not private.feedback_is_owner() then raise exception 'Owner access required' using errcode='42501'; end if;
  perform private.community_consume('feedback-review',120,60);
  select * into item from private.feedback_items where id=target_id for update;
  if item.id is null then raise exception 'Feedback unavailable' using errcode='22023'; end if;
  if expected_version is null or item.version<>expected_version then raise exception 'Feedback changed; refresh before saving' using errcode='40001'; end if;
  if review_action='save_plan' then
    if proposed_plan is null or char_length(btrim(proposed_plan)) not between 20 and 5000 then raise exception 'Add a plan between 20 and 5000 characters' using errcode='22023'; end if;
    item.plan:=btrim(proposed_plan); item.plan_version:=item.plan_version+1;
    next_status:='planned';
  elsif review_action='approve' then
    if item.status<>'planned' or item.plan_version=0 then raise exception 'Save a plan before approving it' using errcode='22023'; end if;
    item.approved_plan_version:=item.plan_version; item.approved_by:=(select auth.uid()); item.approved_at:=now();
    next_status:='approved';
  elsif review_action='complete' then
    if item.status<>'approved' or item.approved_plan_version is distinct from item.plan_version then raise exception 'Approve the current plan first' using errcode='22023'; end if;
    next_status:='done';
  elsif review_action='review' then next_status:='reviewing';
  elsif review_action='decline' then next_status:='declined';
  elsif review_action='reopen' then next_status:='new';
  else raise exception 'Invalid review action' using errcode='22023';
  end if;
  if next_status not in ('approved','done') then
    item.approved_plan_version:=null; item.approved_by:=null; item.approved_at:=null;
  end if;
  update private.feedback_items set status=next_status,plan=item.plan,plan_version=item.plan_version,
    approved_plan_version=item.approved_plan_version,approved_by=item.approved_by,approved_at=item.approved_at,
    version=item.version+1,updated_at=now() where id=item.id;
  insert into private.feedback_events(feedback_id,actor_id,action,snapshot) values(item.id,(select auth.uid()),review_action,
    jsonb_build_object('status',next_status,'version',item.version+1,'plan',item.plan,'plan_version',item.plan_version,'approved_plan_version',item.approved_plan_version));
end $$;
create function public.feedback_review(target_id uuid,expected_version integer,review_action text,proposed_plan text default '') returns void
language sql security invoker set search_path='' as $$ select private.feedback_review(target_id,expected_version,review_action,proposed_plan); $$;

create function private.feedback_history(target_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.feedback_is_owner() then raise exception 'Owner access required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(item) order by item.id desc),'[]'::jsonb) into result from (
    select id,action,snapshot,created_at from private.feedback_events where feedback_id=target_id order by id desc limit 100
  ) item;
  return result;
end $$;
create function public.feedback_history(target_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.feedback_history(target_id); $$;

revoke all on function private.feedback_is_owner(),public.feedback_is_owner(),
  private.feedback_submit(uuid,text,text,text),public.feedback_submit(uuid,text,text,text),
  private.feedback_inbox(text,timestamptz,uuid),public.feedback_inbox(text,timestamptz,uuid),
  private.feedback_review(uuid,integer,text,text),public.feedback_review(uuid,integer,text,text),
  private.feedback_history(uuid),public.feedback_history(uuid) from public,anon,authenticated,service_role;
grant execute on function private.feedback_is_owner(),public.feedback_is_owner(),
  private.feedback_submit(uuid,text,text,text),public.feedback_submit(uuid,text,text,text),
  private.feedback_inbox(text,timestamptz,uuid),public.feedback_inbox(text,timestamptz,uuid),
  private.feedback_review(uuid,integer,text,text),public.feedback_review(uuid,integer,text,text),
  private.feedback_history(uuid),public.feedback_history(uuid) to authenticated;

comment on table private.feedback_items is 'Owner-only feedback. Not a public feed, AI input, or authorization to deploy. Retention needs operator review before launch.';
commit;

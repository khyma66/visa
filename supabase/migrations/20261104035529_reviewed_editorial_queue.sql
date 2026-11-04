begin;
set local lock_timeout='5s';

-- Entirely private staging. This migration never publishes a post or enables a job.
create table private.editorial_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  daily_limit integer not null default 5 check(daily_limit between 1 and 10),
  monthly_limit integer not null default 150 check(monthly_limit between 1 and 300),
  minimum_gap_minutes integer not null default 60 check(minimum_gap_minutes between 20 and 1440),
  policy_version text not null default '2026-11-02-preview-v3',
  last_published_at timestamptz
);
insert into private.editorial_settings(singleton) values(true);
create table private.editorial_sources (
  source_key text primary key check(source_key ~ '^https://www\.facebook\.com/groups/[A-Za-z0-9._-]+$'),
  enabled boolean not null default false
);
create table private.editorial_consents (
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null references private.editorial_sources,
  enabled boolean not null default false,
  expires_at timestamptz not null,
  daily_limit integer not null check(daily_limit between 1 and 3),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key(user_id,source_key)
);
create table private.editorial_drafts (
  id text primary key check(id ~ '^[a-f0-9]{64}$'),
  source_key text not null references private.editorial_sources,
  source_url text not null unique check(char_length(source_url)<=1000),
  source_posted_at timestamptz not null,
  source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
  run_id text not null check(run_id ~ '^[a-zA-Z0-9]{17}$'),
  title text not null check(char_length(title) between 15 and 180),
  body text not null check(char_length(body) between 30 and 9000),
  visa_type text not null check(visa_type in ('H-1B','H-4','H-4 EAD','F-1','L-1','L-2','B-1/B-2','Green Card','Other')),
  post_kind text not null check(post_kind in ('question','experience')),
  experience_category text,
  tags text[] not null default '{}' check(cardinality(tags)<=5),
  review_flags text[] not null default '{}',
  status text not null default 'draft' check(status in ('draft','approved','scheduled','published','rejected','blocked')),
  revision integer not null default 1 check(revision>0),
  reuse_basis text not null default '',
  review_note text not null default '',
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  approved_revision integer,
  author_id uuid references auth.users(id),
  consent_version integer,
  scheduled_at timestamptz,
  published_at timestamptz,
  question_id uuid unique references public.questions(id) on delete restrict,
  blocked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((post_kind='question' and experience_category is null) or
    (post_kind='experience' and experience_category is not null and experience_category in ('Visa interview','Application & documents','Approval & timeline','Refusal & reapplication','Renewal & extension','Travel & arrival','Other'))),
  check((status='published')=(question_id is not null and published_at is not null))
);
create index editorial_due_idx on private.editorial_drafts(scheduled_at,id) where status='scheduled';
create index editorial_published_idx on private.editorial_drafts(published_at,author_id) where status='published';
create unique index editorial_published_source_hash_idx on private.editorial_drafts(source_hash) where status='published';
create unique index editorial_published_body_idx on private.editorial_drafts(md5(lower(btrim(body)))) where status='published';
create index editorial_author_idx on private.editorial_drafts(author_id) where author_id is not null;
create index editorial_approver_idx on private.editorial_drafts(approved_by) where approved_by is not null;
create index editorial_source_idx on private.editorial_drafts(source_key);
create index editorial_consent_source_idx on private.editorial_consents(source_key);
create table private.editorial_events (
  id bigint generated always as identity primary key,
  draft_id text references private.editorial_drafts(id),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  created_at timestamptz not null default now()
);
create index editorial_event_draft_idx on private.editorial_events(draft_id,id desc);
create index editorial_event_actor_idx on private.editorial_events(actor_id) where actor_id is not null;
alter table private.editorial_settings enable row level security;
alter table private.editorial_sources enable row level security;
alter table private.editorial_consents enable row level security;
alter table private.editorial_drafts enable row level security;
alter table private.editorial_events enable row level security;
revoke all on private.editorial_settings,private.editorial_sources,private.editorial_consents,
  private.editorial_drafts,private.editorial_events from public,anon,authenticated,service_role;
revoke all on sequence private.editorial_events_id_seq from public,anon,authenticated,service_role;

-- Called by the owner API, or trusted one-off local preparation. Never approves.
create function private.editorial_stage(items jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p jsonb; old private.editorial_drafts; staged private.editorial_drafts; result jsonb:='[]'; expected integer;
begin
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 50 then raise exception 'Stage 1–50 drafts at a time'; end if;
  perform pg_advisory_xact_lock(hashtextextended('editorial-publishing',0));
  for p in select value from jsonb_array_elements(items) loop
    if p->>'source_url' is null or p->>'source_key' is null or p->>'source_posted_at' is null
      or p->>'id' is distinct from encode(sha256(convert_to(p->>'source_url','UTF8')),'hex')
      or not (p->>'source_url' ~ ('^' || replace(p->>'source_key','.','\.') || '/(posts|permalink)/[A-Za-z0-9._-]+$'))
      or (p->>'source_posted_at')::timestamptz > now() or (p->>'source_posted_at')::timestamptz < '2000-01-01'
      or coalesce(p->>'expected_revision','') !~ '^[0-9]{1,8}$'
      or jsonb_typeof(p->'tags') is distinct from 'array'
      or jsonb_typeof(p->'review_flags') is distinct from 'array'
      or exists(select 1 from jsonb_array_elements_text(p->'tags') t where t !~ '^[a-z0-9-]{1,40}$')
    then raise exception 'Invalid draft or source fields'; end if;
    expected:=(p->>'expected_revision')::integer;
    insert into private.editorial_sources(source_key) values(p->>'source_key') on conflict do nothing;
    select * into old from private.editorial_drafts where id=p->>'id' for update;
    if found and old.status='published' then raise exception 'Published drafts cannot be replaced'; end if;
    if found and (old.source_url<>p->>'source_url' or old.source_key<>p->>'source_key') then raise exception 'Source identity cannot change'; end if;
    if (old.id is null and expected<>0) or (old.id is not null and old.revision<>expected) then raise exception 'Draft changed; refresh the review file' using errcode='40001'; end if;
    insert into private.editorial_drafts(id,source_key,source_url,source_posted_at,source_hash,run_id,title,body,visa_type,post_kind,experience_category,tags,review_flags)
      values(p->>'id',p->>'source_key',p->>'source_url',(p->>'source_posted_at')::timestamptz,p->>'source_hash',p->>'run_id',
        btrim(p->>'title'),btrim(p->>'body'),p->>'visa_type',p->>'post_kind',nullif(p->>'experience_category',''),
        array(select jsonb_array_elements_text(p->'tags')),array(select jsonb_array_elements_text(p->'review_flags')))
      on conflict(id) do update set source_posted_at=excluded.source_posted_at,source_hash=excluded.source_hash,run_id=excluded.run_id,
        title=excluded.title,body=excluded.body,visa_type=excluded.visa_type,post_kind=excluded.post_kind,
        experience_category=excluded.experience_category,tags=excluded.tags,review_flags=excluded.review_flags,
        status='draft',revision=old.revision+1,reuse_basis='',review_note='',approved_by=null,approved_at=null,approved_revision=null,
        author_id=null,consent_version=null,scheduled_at=null,blocked_reason=null,updated_at=now()
      returning * into staged;
    insert into private.editorial_events(draft_id,actor_id,action) values(staged.id,auth.uid(),'staged');
    result:=result || jsonb_build_array(jsonb_build_object('id',staged.id,'revision',staged.revision,'status',staged.status));
  end loop;
  return result;
end $$;

create function private.editorial_author_eligible(who uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from auth.users u join public.profiles p on p.id=u.id
    where u.id=who and u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=now()))
    and not exists(select 1 from private.community_suspensions where user_id=who)
    and exists(select 1 from public.policy_acceptances p join private.editorial_settings s on s.policy_version=p.policy_version where p.user_id=who)
    -- If community policies change, fail closed until this integration is reviewed.
    and exists(select 1 from private.editorial_settings s where position(quote_literal(s.policy_version)
      in pg_get_functiondef('private.community_write_guard()'::regprocedure))>0);
$$;

create function private.editorial_consent(source text,allow_posting boolean,days_valid integer,per_day integer) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare me uuid:=auth.uid(); session_claim text:=auth.jwt()->>'session_id'; result private.editorial_consents;
begin
  if me is null or session_claim is null or not exists(select 1 from auth.sessions s where s.id::text=session_claim and s.user_id=me and (s.not_after is null or s.not_after>now()))
    then raise exception 'Sign in again to manage publishing permission' using errcode='42501'; end if;
  if allow_posting is null or days_valid is null or days_valid not between 1 and 90 or per_day is null or per_day not between 1 and 3 then raise exception 'Invalid consent limits'; end if;
  perform pg_advisory_xact_lock(hashtextextended('editorial-publishing',0));
  if allow_posting and not private.editorial_author_eligible(me) then raise exception 'Verify your account and accept current policies first'; end if;
  insert into private.editorial_consents(user_id,source_key,enabled,expires_at,daily_limit)
    values(me,source,allow_posting,now()+make_interval(days=>days_valid),per_day)
    on conflict(user_id,source_key) do update set enabled=excluded.enabled,expires_at=excluded.expires_at,daily_limit=excluded.daily_limit,
      version=private.editorial_consents.version+1,updated_at=now() returning * into result;
  -- Every grant change invalidates older assignments, including re-enabling consent.
  update private.editorial_drafts set status='blocked',blocked_reason='Publishing permission changed',updated_at=now()
    where author_id=me and source_key=source and status='scheduled';
  insert into private.editorial_events(actor_id,action) values(me,case when allow_posting then 'consent_granted' else 'consent_revoked' end);
  return jsonb_build_object('enabled',result.enabled,'expires_at',result.expires_at,'daily_limit',result.daily_limit,'version',result.version);
end $$;
create function public.editorial_consent(source text,allow_posting boolean,days_valid integer default 30,per_day integer default 1) returns jsonb
language sql security invoker set search_path='' as $$ select private.editorial_consent(source,allow_posting,days_valid,per_day); $$;

create function private.editorial_owner_action(operation text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='10s' set lock_timeout='3s' as $$
declare me uuid; item private.editorial_drafts; c private.editorial_consents; decision text; target_author uuid; at_time timestamptz; result jsonb;
begin
  me:=private.launch_assert_owner();
  if payload is null or jsonb_typeof(payload) is distinct from 'object' then raise exception 'Invalid request'; end if;
  perform pg_advisory_xact_lock(hashtextextended('editorial-publishing',0));
  if operation='stage' then return private.editorial_stage(payload->'items'); end if;
  if operation='list' then
    select coalesce(jsonb_agg(to_jsonb(d)),'[]') into result from
      (select * from private.editorial_drafts where id>coalesce(payload->>'after_id','') order by id limit 50)d;
    return jsonb_build_object('items',result,'settings',(select to_jsonb(s) from private.editorial_settings s));
  end if;
  if operation='controls' then
    if jsonb_typeof(payload->'enabled') is distinct from 'boolean' then raise exception 'Choose enabled or paused'; end if;
    if (payload->>'enabled')::boolean and payload->>'confirmation' is distinct from 'START APPROVED PUBLISHING' then raise exception 'Explicit publishing confirmation required'; end if;
    update private.editorial_settings set enabled=(payload->>'enabled')::boolean;
    insert into private.editorial_events(actor_id,action) values(me,case when (payload->>'enabled')::boolean then 'enabled' else 'paused' end);
    return jsonb_build_object('enabled',(payload->>'enabled')::boolean);
  end if;
  if operation='source' then
    if jsonb_typeof(payload->'enabled') is distinct from 'boolean' then raise exception 'Invalid source setting'; end if;
    update private.editorial_sources set enabled=(payload->>'enabled')::boolean where source_key=payload->>'source_key';
    if not found then raise exception 'Source unavailable'; end if;
    insert into private.editorial_events(actor_id,action) values(me,'source_updated');
    return jsonb_build_object('updated',true);
  end if;
  select * into item from private.editorial_drafts where id=payload->>'id' for update;
  if not found then raise exception 'Draft unavailable'; end if;
  if coalesce(payload->>'revision','') !~ '^[0-9]{1,8}$' or item.revision<>(payload->>'revision')::integer then raise exception 'Draft changed; refresh the review file' using errcode='40001'; end if;
  if item.status='published' then raise exception 'Use normal moderation for published posts'; end if;
  if operation='review' then
    decision:=payload->>'decision';
    if decision is null or decision not in ('approved','rejected') then raise exception 'Choose approved or rejected'; end if;
    if decision='approved' and (payload->>'facts_verified' is distinct from 'true'
      or char_length(btrim(coalesce(payload->>'reuse_basis','')))<20
      or char_length(btrim(coalesce(payload->>'review_note','')))<10) then raise exception 'Approval requires verified facts, reuse basis and a review note'; end if;
    if char_length(coalesce(payload->>'reuse_basis',''))>2000 or char_length(coalesce(payload->>'review_note',''))>2000 then raise exception 'Review text too long'; end if;
    update private.editorial_drafts set status=decision,approved_by=case when decision='approved' then me end,
      approved_at=case when decision='approved' then now() end,approved_revision=case when decision='approved' then revision end,
      reuse_basis=coalesce(payload->>'reuse_basis',''),review_note=coalesce(payload->>'review_note',''),scheduled_at=null,author_id=null,consent_version=null,blocked_reason=null,updated_at=now()
      where id=item.id;
  elsif operation='schedule' then
    if item.status not in ('approved','blocked') or item.approved_revision is distinct from item.revision or item.approved_by is null then raise exception 'Approve the current draft before scheduling'; end if;
    target_author:=(payload->>'author_id')::uuid; at_time:=(payload->>'scheduled_at')::timestamptz;
    if at_time is null or at_time<now() or at_time>now()+interval '90 days'
      or extract(hour from at_time at time zone 'America/Chicago') not between 8 and 20 then raise exception 'Schedule within 90 days, 8am–9pm America/Chicago'; end if;
    select * into c from private.editorial_consents where user_id=target_author and source_key=item.source_key;
    if not found or not c.enabled or c.expires_at<=at_time or not private.editorial_author_eligible(target_author) then raise exception 'Account publishing permission unavailable'; end if;
    update private.editorial_drafts set status='scheduled',author_id=target_author,consent_version=c.version,scheduled_at=at_time,blocked_reason=null,updated_at=now() where id=item.id;
  elsif operation='unschedule' then
    update private.editorial_drafts set status='draft',approved_revision=null,approved_by=null,approved_at=null,scheduled_at=null,author_id=null,consent_version=null,updated_at=now() where id=item.id;
  else raise exception 'Unknown editorial operation'; end if;
  insert into private.editorial_events(draft_id,actor_id,action) values(item.id,me,operation);
  return (select jsonb_build_object('id',id,'revision',revision,'status',status) from private.editorial_drafts where id=item.id);
end $$;
create function public.editorial_owner_action(operation text,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.editorial_owner_action(operation,payload); $$;

-- Post + queue receipt commit together. Retries and overlapping ticks cannot duplicate posts.
-- Only the database operator's inactive cron job can call this function.
create function private.editorial_publish_due() returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='10s' set lock_timeout='3s' as $$
declare s private.editorial_settings; item private.editorial_drafts; c private.editorial_consents;
  local_now timestamp:=now() at time zone 'America/Chicago'; q uuid; reason text; month_start timestamptz; day_start timestamptz;
begin
  if auth.uid() is not null then raise exception 'Scheduled publisher only'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('editorial-publishing',0)) then return '{"status":"busy"}'; end if;
  select * into s from private.editorial_settings for update;
  if not s.enabled then return '{"status":"paused"}'; end if;
  if extract(hour from local_now) not between 8 and 20 then return '{"status":"outside_hours"}'; end if;
  if s.last_published_at>now()-make_interval(mins=>s.minimum_gap_minutes) then return '{"status":"spacing"}'; end if;
  day_start:=date_trunc('day',local_now) at time zone 'America/Chicago';
  month_start:=date_trunc('month',local_now) at time zone 'America/Chicago';
  if (select count(*) from private.editorial_drafts where published_at>=day_start)>=s.daily_limit
    or (select count(*) from private.editorial_drafts where published_at>=month_start)>=s.monthly_limit then return '{"status":"budget"}'; end if;
  select * into item from private.editorial_drafts where status='scheduled' and scheduled_at<=now() order by scheduled_at,id limit 1 for update;
  if not found then return '{"status":"empty"}'; end if;
  select * into c from private.editorial_consents where user_id=item.author_id and source_key=item.source_key for share;
  if item.scheduled_at<now()-interval '24 hours' then reason:='Missed slot; review schedule';
  elsif item.approved_revision is distinct from item.revision or item.approved_by is null or char_length(item.reuse_basis)<20 then reason:='Approval unavailable';
  elsif not exists(select 1 from private.feedback_owner o join auth.users u on u.id=o.user_id where o.user_id=item.approved_by
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()))
    or exists(select 1 from private.community_suspensions where user_id=item.approved_by) then reason:='Approver unavailable';
  elsif not exists(select 1 from private.editorial_sources where source_key=item.source_key and enabled) then reason:='Source paused';
  elsif c.user_id is null or not c.enabled or c.expires_at<=now() or c.version is distinct from item.consent_version then reason:='Publishing permission unavailable';
  elsif not private.editorial_author_eligible(item.author_id) then reason:='Author unavailable or policy changed';
  end if;
  if reason is not null then
    update private.editorial_drafts set status='blocked',blocked_reason=reason,updated_at=now() where id=item.id;
    insert into private.editorial_events(draft_id,action) values(item.id,'blocked');
    return jsonb_build_object('status','blocked','id',item.id,'reason',reason);
  end if;
  if (select count(*) from private.editorial_drafts where author_id=item.author_id and published_at>=day_start)>=c.daily_limit then return '{"status":"author_budget"}'; end if;
  begin
    insert into public.questions(author_id,title,body,destination_country,visa_type,tags,post_kind,experience_category)
      values(item.author_id,item.title,
        'Community summary. Originally shared on ' || to_char(item.source_posted_at at time zone 'UTC','YYYY-MM-DD') || E' (UTC).\n\n' || item.body || E'\n\nSource: ' || item.source_url,
        'United States',item.visa_type,item.tags,item.post_kind,item.experience_category) returning id into q;
    update private.editorial_drafts set status='published',question_id=q,published_at=now(),updated_at=now() where id=item.id;
    update private.editorial_settings set last_published_at=now();
    insert into private.editorial_events(draft_id,action) values(item.id,'published');
  exception when others then
    -- The subtransaction also rolls back any post or trigger side effects.
    update private.editorial_drafts set status='blocked',blocked_reason='Publication failed; review required',updated_at=now() where id=item.id;
    insert into private.editorial_events(draft_id,action) values(item.id,'publish_failed');
    return jsonb_build_object('status','blocked','id',item.id);
  end;
  return jsonb_build_object('status','published','id',item.id,'question_id',q);
end $$;

revoke all on function private.editorial_stage(jsonb),private.editorial_author_eligible(uuid),private.editorial_publish_due(),
  private.editorial_consent(text,boolean,integer,integer),public.editorial_consent(text,boolean,integer,integer),
  private.editorial_owner_action(text,jsonb),public.editorial_owner_action(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.editorial_consent(text,boolean,integer,integer),public.editorial_consent(text,boolean,integer,integer),
  private.editorial_owner_action(text,jsonb),public.editorial_owner_action(text,jsonb) to authenticated;
commit;

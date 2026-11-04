begin;
set local lock_timeout='5s';

-- Separate ingress schema: do not grant anonymous USAGE on the existing private schema.
create schema security_ingress;
revoke all on schema security_ingress from public,anon,authenticated,service_role;
grant usage on schema security_ingress to anon;
create table private.security_ingest_key(singleton boolean primary key default true check(singleton),key_hash bytea not null,created_at timestamptz not null default now());
create table private.security_ingest_window(singleton boolean primary key default true check(singleton),started_at timestamptz not null,used integer not null);
create table private.security_traffic_events(
  id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('read_rate_limit','cross_site_read','probe_path','telemetry_check')),
  actor_hash text not null check(actor_hash~'^[a-f0-9]{64}$'),route_group text not null check(route_group in ('archive','discussion','directory','news','probe','health')),
  hour_start timestamptz not null default date_trunc('hour',now()),first_seen timestamptz not null default now(),last_seen timestamptz not null default now(),
  observations integer not null default 1,ray_id text,decision text not null check(decision in ('blocked','limited','observed')),
  review_status text not null default 'open' check(review_status in ('open','reviewing','resolved','false_positive')),version integer not null default 1,
  unique(kind,actor_hash,route_group,hour_start)
);
create index security_traffic_page on private.security_traffic_events(last_seen desc,id desc);
create table private.security_report_evidence(
  id uuid primary key default gen_random_uuid(),report_id uuid not null unique,
  subject_id uuid references auth.users(id) on delete set null,reporter_id uuid references auth.users(id) on delete set null,
  target_kind text not null,target_id uuid not null,reason text not null,details text not null,
  source text not null,reported_at timestamptz not null,captured_at timestamptz not null default now(),
  content_excerpt text,content_sha256 text,report_status text not null,qualifying_reporter boolean not null,
  review_status text not null default 'open' check(review_status in ('open','reviewing','resolved','false_positive')),version integer not null default 1
);
create index security_evidence_subject_time on private.security_report_evidence(subject_id,reported_at desc);
create index security_evidence_reporter on private.security_report_evidence(reporter_id);
create index security_evidence_page on private.security_report_evidence(reported_at desc,id desc);
create table private.security_review_events(
  id bigint generated always as identity primary key,case_kind text not null,case_id uuid not null,
  reviewer_id uuid references auth.users(id) on delete set null,decision text not null,note text not null,created_at timestamptz not null default now()
);
create index security_reviews_case on private.security_review_events(case_kind,case_id,id desc);
create index security_reviews_actor on private.security_review_events(reviewer_id);
create index security_reviews_retention on private.security_review_events(created_at);
create table private.security_alert_outbox(
  id uuid primary key default gen_random_uuid(),dedupe_key text not null unique,category text not null,created_at timestamptz not null default now(),
  status text not null default 'pending' check(status in ('pending','sent')),sent_at timestamptz
);
create index security_alert_pending on private.security_alert_outbox(created_at) where status='pending';
do $$ declare t text; begin
  foreach t in array array['security_ingest_key','security_ingest_window','security_traffic_events','security_report_evidence','security_review_events','security_alert_outbox'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

-- A still-valid JWT alone is insufficient for owner security evidence.
create function private.security_require_owner() returns void language plpgsql stable security definer set search_path='' as $$
declare session_id text:=auth.jwt()->>'session_id';
begin
  if private.feedback_is_owner() is not true or session_id is null or not exists(
    select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id::text=session_id and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now())
      and u.deleted_at is null and u.is_anonymous is not true
  ) then raise exception 'A current owner session is required' using errcode='42501'; end if;
end $$;

create function private.security_capture_report() returns trigger language plpgsql security definer set search_path='' as $$
declare subject uuid; body text; trusted boolean; peers integer;
begin
  if tg_op='UPDATE' then
    update private.security_report_evidence set report_status=new.status where report_id=new.id;
    return new;
  end if;
  case new.target_kind
    when 'question' then select author_id,title||E'\n'||q.body into subject,body from public.questions q where id=new.target_id;
    when 'answer' then select author_id,a.body into subject,body from public.answers a where id=new.target_id;
    when 'imported_answer' then select author_id,a.body into subject,body from public.imported_answers a where id=new.target_id;
    when 'message' then select sender_id,m.body into subject,body from public.direct_messages m where id=new.target_id;
    when 'member' then select id,'u/'||username into subject,body from public.profiles where id=new.target_id;
    else null;
  end case;
  -- Serialize threshold checks for the same reported member, including concurrent reports.
  if subject is not null then perform pg_advisory_xact_lock(hashtextextended('security-report:'||subject::text,0)); end if;
  select exists(select 1 from auth.users u where u.id=new.reporter_id
    and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null) and u.created_at<=now()-interval '24 hours'
    and u.deleted_at is null and u.is_anonymous is not true
    and not exists(select 1 from private.community_suspensions s where s.user_id=u.id)) into trusted;
  insert into private.security_report_evidence(report_id,subject_id,reporter_id,target_kind,target_id,reason,details,source,reported_at,content_excerpt,content_sha256,report_status,qualifying_reporter)
    values(new.id,subject,new.reporter_id,new.target_kind,new.target_id,new.reason,left(new.details,1000),new.source,new.created_at,
      left(body,6000),case when body is null then null else encode(sha256(convert_to(body,'UTF8')),'hex') end,new.status,trusted);
  -- Three distinct, established reporters flag a case; reports never auto-ban.
  select count(distinct reporter_id) into peers from private.security_report_evidence
    where subject_id=subject and source='member' and qualifying_reporter and reporter_id<>subject
      and reported_at>=now()-interval '7 days' and report_status<>'dismissed' and review_status<>'false_positive';
  if peers>=3 then
    insert into private.security_alert_outbox(dedupe_key,category) values('peer:'||subject::text||':'||(now() at time zone 'UTC')::date,'repeated_peer_reports') on conflict do nothing;
  end if;
  return new;
end $$;
create trigger security_capture_report after insert or update of status on public.community_reports for each row execute function private.security_capture_report();

-- Only the trusted edge holds this random capability. No browser-originated event API.
create function security_ingress.record_event(event jsonb) returns void language plpgsql security definer set search_path='' as $$
declare supplied text:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-security-ingest-key',''); used_count integer; observations_count integer;
begin
  if length(supplied)<>64 or not exists(select 1 from private.security_ingest_key where key_hash=sha256(convert_to(supplied,'UTF8'))) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  if event is null or jsonb_typeof(event)<>'object' or pg_column_size(event)>2048
    or exists(select 1 from jsonb_object_keys(event) k where k not in ('kind','actor_hash','route_group','ray_id','decision'))
    or coalesce(event->>'kind','') not in ('read_rate_limit','cross_site_read','probe_path','telemetry_check')
    or coalesce(event->>'route_group','') not in ('archive','discussion','directory','news','probe','health')
    or coalesce(event->>'decision','') not in ('blocked','limited','observed')
    or coalesce(event->>'actor_hash','')!~'^[a-f0-9]{64}$'
    or (event->>'ray_id' is not null and event->>'ray_id'!~'^[a-fA-F0-9]{16,32}(-[A-Z]{3})?$') then
    raise exception 'Invalid security event' using errcode='22023';
  end if;
  insert into private.security_ingest_window values(true,date_trunc('minute',now()),1)
    on conflict(singleton) do update set started_at=excluded.started_at,used=case when security_ingest_window.started_at=excluded.started_at then security_ingest_window.used+1 else 1 end returning used into used_count;
  if used_count>120 then return; end if; -- bound logging cost independently of abuse volume
  insert into private.security_traffic_events as e(kind,actor_hash,route_group,ray_id,decision)
    values(event->>'kind',event->>'actor_hash',event->>'route_group',event->>'ray_id',event->>'decision')
    on conflict(kind,actor_hash,route_group,hour_start) do update set last_seen=now(),observations=e.observations+1,ray_id=excluded.ray_id
    returning observations into observations_count;
  if observations_count=3 and event->>'kind'<>'telemetry_check' then
    insert into private.security_alert_outbox(dedupe_key,category) values('traffic:'||(event->>'actor_hash')||':'||(now() at time zone 'UTC')::date,'repeated_traffic_signal') on conflict do nothing;
  end if;
end $$;
create function public.record_security_event(event jsonb) returns void language sql security invoker set search_path='' as $$select security_ingress.record_event(event)$$;

create function private.owner_security_dashboard(traffic_before timestamptz,traffic_id uuid,report_before timestamptz,report_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.security_require_owner();
  select jsonb_build_object('generated_at',now(),'traffic',coalesce((select jsonb_agg(t order by t.last_seen desc,t.id desc) from
    (select * from private.security_traffic_events where last_seen>now()-interval '30 days' and (traffic_before is null or (last_seen,id)<(traffic_before,traffic_id)) order by last_seen desc,id desc limit 50) t),'[]'::jsonb),
    'reports',coalesce((select jsonb_agg(r order by r.reported_at desc,r.id desc) from
    (select e.*,p.username subject_username from private.security_report_evidence e left join public.profiles p on p.id=e.subject_id
      where reported_at>now()-interval '90 days' and (report_before is null or (reported_at,e.id)<(report_before,owner_security_dashboard.report_id)) order by reported_at desc,e.id desc limit 50) r),'[]'::jsonb),
    'repeat_members',coalesce((select jsonb_agg(c) from (
      select e.subject_id,p.username,count(distinct e.reporter_id) distinct_reporters,count(*) reports,max(e.reported_at) latest_at
      from private.security_report_evidence e left join public.profiles p on p.id=e.subject_id
      where e.reported_at>=now()-interval '7 days' and e.subject_id is not null and e.source='member' and e.qualifying_reporter
        and e.reporter_id<>e.subject_id and e.report_status<>'dismissed' and e.review_status<>'false_positive'
      group by e.subject_id,p.username having count(distinct e.reporter_id)>=3 order by max(e.reported_at) desc limit 50) c),'[]'::jsonb),
    'pending_alerts',(select count(*) from private.security_alert_outbox where status='pending'),
    'ingest_key_configured',exists(select 1 from private.security_ingest_key),
    'last_traffic_observed',(select max(last_seen) from private.security_traffic_events),
    'review_history',coalesce((select jsonb_agg(a order by a.id desc) from (select id,case_kind,case_id,decision,note,created_at from private.security_review_events order by id desc limit 50) a),'[]'::jsonb)) into result;
  return result;
end $$;
create function public.owner_security_dashboard(traffic_before timestamptz default null,traffic_id uuid default null,report_before timestamptz default null,report_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$select private.owner_security_dashboard(traffic_before,traffic_id,report_before,report_id)$$;

create function private.security_review(case_kind text,case_id uuid,expected_version integer,decision text,note text) returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.security_require_owner();
  if case_kind is null or case_kind not in ('traffic','report') or decision is null or decision not in ('reviewing','resolved','false_positive','open')
    or length(btrim(coalesce(note,''))) not between 5 and 1000 then raise exception 'Add a review decision and a 5–1000 character note' using errcode='22023'; end if;
  if case_kind='traffic' then update private.security_traffic_events set review_status=security_review.decision,version=version+1 where id=case_id and version=expected_version;
  else update private.security_report_evidence set review_status=decision,version=version+1 where id=case_id and version=expected_version; end if;
  if not found then raise exception 'This case changed. Refresh before reviewing.' using errcode='40001'; end if;
  insert into private.security_review_events(case_kind,case_id,reviewer_id,decision,note) values(case_kind,case_id,auth.uid(),decision,btrim(note));
end $$;
create function public.security_review(case_kind text,case_id uuid,expected_version integer,decision text,note text) returns void language sql security invoker set search_path='' as $$select private.security_review(case_kind,case_id,expected_version,decision,note)$$;

create function private.security_evidence_cleanup() returns void language sql security definer set search_path='' as $$
  delete from private.security_traffic_events where last_seen<now()-interval '30 days';
  delete from private.security_report_evidence where reported_at<now()-interval '90 days';
  delete from private.security_review_events where created_at<now()-interval '365 days';
  delete from private.security_alert_outbox where created_at<now()-interval '30 days';
$$;
revoke all on function private.security_require_owner(),private.security_capture_report(),private.owner_security_dashboard(timestamptz,uuid,timestamptz,uuid),private.security_review(text,uuid,integer,text,text),private.security_evidence_cleanup(),public.owner_security_dashboard(timestamptz,uuid,timestamptz,uuid),public.security_review(text,uuid,integer,text,text),security_ingress.record_event(jsonb),public.record_security_event(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.owner_security_dashboard(timestamptz,uuid,timestamptz,uuid),private.security_review(text,uuid,integer,text,text),public.owner_security_dashboard(timestamptz,uuid,timestamptz,uuid),public.security_review(text,uuid,integer,text,text) to authenticated;
grant execute on function security_ingress.record_event(jsonb),public.record_security_event(jsonb) to anon;
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('security-evidence-retention','19 4 * * *','select private.security_evidence_cleanup()');
  end if;
end $$;
commit;

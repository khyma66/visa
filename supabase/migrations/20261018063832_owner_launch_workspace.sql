begin;
set local lock_timeout = '5s';

create table private.launch_tasks (
  id text primary key check(id ~ '^[A-Z]{1,2}[0-9]{2}$'),
  title text not null check(char_length(title) between 3 and 160),
  priority text not null check(priority in ('P0','P1','P2')),
  dependencies text[] not null default '{}',
  acceptance text not null check(char_length(acceptance) between 20 and 2000),
  status text not null default 'backlog' check(status in ('backlog','ready','in_progress','in_review','done','blocked')),
  evidence text not null default '' check(char_length(evidence)<=5000),
  assigned_to text not null default '' check(char_length(assigned_to)<=80),
  due_on date check(due_on between date '2000-01-01' and date '2100-12-31'),
  version integer not null default 1 check(version>0),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((status='done')=(completed_at is not null)),
  check(status<>'done' or char_length(btrim(evidence))>=20)
);
create table private.launch_experiments (
  id uuid primary key,
  title text not null check(char_length(title) between 3 and 160),
  hypothesis text not null check(char_length(hypothesis) between 10 and 3000),
  start_on date not null check(start_on>=date '2000-01-01'),
  end_on date not null check(end_on<=date '2100-12-31' and end_on>=start_on and end_on-start_on<=3660),
  currency text not null default 'USD' check(currency='USD'),
  cash_cost_usd numeric(14,2) not null check(cash_cost_usd between 0 and 1000000000),
  founder_hours numeric(10,2) not null check(founder_hours between 0 and 100000),
  hour_value_usd numeric(10,2) not null check(hour_value_usd between 0 and 100000),
  attributable_contribution_usd numeric(14,2) check(attributable_contribution_usd between -1000000000 and 1000000000),
  decision text not null default 'observe' check(decision in ('observe','scale','fix','stop')),
  notes text not null default '' check(char_length(notes)<=5000),
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table private.launch_events (
  id bigint generated always as identity primary key,
  entity_kind text not null check(entity_kind in ('task','experiment')),
  entity_id text not null,
  actor_id uuid not null,
  action text not null check(action in ('task_update','experiment_create','experiment_update')),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
alter table private.launch_tasks enable row level security;
alter table private.launch_experiments enable row level security;
alter table private.launch_events enable row level security;
revoke all on private.launch_tasks,private.launch_experiments,private.launch_events from public,anon,authenticated,service_role;
revoke all on sequence private.launch_events_id_seq from public,anon,authenticated,service_role;
create index launch_event_history_idx on private.launch_events(entity_kind,entity_id,id desc);

insert into private.launch_tasks(id,title,priority,dependencies,acceptance) values
('L01','Confirm operator and launch scope','P0','{}','Record the actual legal operator, monitored contact, adult U.S. scope, production domain and service inventory in the reviewed operating record.'),
('L02','Verify account ownership and credential recovery','P0','{L01}','Verify administrator MFA, recovery and domain renewals; document credential rotation without pasting credentials or recovery codes.'),
('L03','Verify domain and sign-in journeys','P0','{L02}','Verify canonical HTTPS links, email delivery, signup, confirmation, recovery, logout and enabled OAuth on the live domain.'),
('L04','Verify private access and abuse controls','P0','{L03}','Run cross-account, anonymous and revoked-session checks for private records, owner tools, bot protection and enabled write paths.'),
('L05','Finalize privacy and community policies','P0','{L01}','Review actual vendors, retention, age policy, optional tracking and legal applicability; publish accurate policies with versioned acceptance.'),
('L06','Rehearse privacy requests and content removal','P0','{L04,L05}','Complete an identity-verified export/deletion and takedown rehearsal, including sessions, imported-content suppression, caches and backup exceptions.'),
('L07','Staff moderation and contributor support','P0','{L05}','Assign real moderators and a monitored support owner; test no-account reports, appeals and sensitive-data escalation.'),
('L08','Rehearse recovery and incident response','P0','{L04}','Verify backup restoration, scoped rollback, alert delivery, incident responsibilities and an initial operating-cost ceiling.'),
('S01','Verify public search templates and crawler policy','P1','{L04,L06}','Check real server-rendered public content, stable canonical links, accurate structured data and sitemap lifecycle; keep private pages and previews excluded.'),
('S02','Verify search ownership and submit sitemap','P1','{S01,L09}','Verify Google Search Console and Bing ownership using issued records, submit the approved canonical sitemap and inspect representative pages.'),
('A01','Reconcile owner metrics and exclusions','P1','{L04}','Reconcile retained activity with source records, designate test/staff exclusions, and document UTC periods, missing metrics and distinct-user definitions.'),
('C01','Recruit a narrow genuine contributor cohort','P1','{L07}','Recruit answerers for two or three U.S. visa topics and prepare original, dated resources; do not publish fabricated experiences or fake member activity.'),
('AI01','Review enabled AI quality and cost limits','P1','{L04,L05}','Record source-linked quality, conflicting/outdated evidence and access tests; verify quotas, failure behavior and observed provider cost before expansion.'),
('L09','Review the limited public-launch decision','P0','{L03,L04,L05,L06,L07,L08}','Review current release evidence, unresolved defects and staffed operations. Record the decision; deployment approval remains a separate guarded process.'),
('R01','Review the first measured growth experiment','P1','{A01,C01,L09}','Review qualified contribution and return, cash spend, founder time and attribution uncertainty; record an observe, improve, scale or stop decision.'),
('M01','Assess a delivered paid convenience pilot','P2','{R01,AI01}','Establish actual willingness to pay, delivered features, support/refunds, provider eligibility and server-verified entitlements before any payment or advertising activation.');

create function private.launch_assert_owner() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare me uuid:=(select auth.uid()); session_claim text:=(select auth.jwt()->>'session_id');
begin
  if me is null or not private.feedback_is_owner()
    or not exists(select 1 from auth.users u where u.id=me and u.deleted_at is null
      and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now()))
    or session_claim is null or session_claim !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then raise exception 'Owner access required' using errcode='42501'; end if;
  if not exists(select 1 from auth.sessions s where s.id=session_claim::uuid and s.user_id=me
    and (s.not_after is null or s.not_after>now()))
  then raise exception 'Owner access required' using errcode='42501'; end if;
  return me;
end $$;

create function private.launch_immutable_event() returns trigger
language plpgsql set search_path='' as $$ begin
  raise exception 'Launch history is append-only' using errcode='42501';
end $$;
create trigger launch_history_immutable before update or delete on private.launch_events
for each row execute function private.launch_immutable_event();

create function private.owner_launch_workspace() returns jsonb
language plpgsql stable security definer set search_path='' set statement_timeout='5s' as $$
begin
  perform private.launch_assert_owner();
  return jsonb_build_object('schema_version',1,'generated_at',now(),
    'tasks',(select coalesce(jsonb_agg(to_jsonb(t) order by t.priority,t.id),'[]'::jsonb) from private.launch_tasks t),
    'experiments',(select coalesce(jsonb_agg(to_jsonb(e) order by e.updated_at desc,e.id),'[]'::jsonb) from private.launch_experiments e));
end $$;
create function public.owner_launch_workspace() returns jsonb
language sql stable security invoker set search_path='' set statement_timeout='5s'
as $$ select private.owner_launch_workspace(); $$;

create function private.owner_launch_task_update(target_id text,expected_version integer,next_status text,evidence_text text,assignee text,due_date date) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='5s' set lock_timeout='3s' as $$
declare me uuid; item private.launch_tasks;
begin
  me:=private.launch_assert_owner();
  if target_id is null or expected_version is null or expected_version<1
    or next_status is null or next_status not in ('backlog','ready','in_progress','in_review','done','blocked')
    or evidence_text is null or char_length(btrim(evidence_text))>5000
    or assignee is null or char_length(btrim(assignee))>80
    or (due_date is not null and not(due_date between date '2000-01-01' and date '2100-12-31'))
  then raise exception 'Invalid task fields' using errcode='22023'; end if;
  -- Serialize graph transitions across tabs: a dependency cannot be reopened
  -- while another request is completing its dependent task.
  perform pg_advisory_xact_lock(hashtextextended('owner-launch-workspace',0));
  perform private.community_consume('launch-write',120,60);
  select * into item from private.launch_tasks where id=target_id for update;
  if not found then raise exception 'Task unavailable' using errcode='22023'; end if;
  if item.version<>expected_version then raise exception 'Task changed; refresh before saving' using errcode='40001'; end if;
  if next_status='done' then
    if char_length(btrim(evidence_text))<20 then raise exception 'Completion requires evidence' using errcode='22023'; end if;
    if exists(select 1 from unnest(item.dependencies) dep
      where not exists(select 1 from private.launch_tasks t where t.id=dep and t.status='done'))
    then raise exception 'Complete dependencies before marking done' using errcode='22023'; end if;
  elsif item.status='done' and exists(select 1 from private.launch_tasks t where item.id=any(t.dependencies) and t.status='done') then
    raise exception 'Reopen completed dependents first' using errcode='22023';
  end if;
  update private.launch_tasks set status=next_status,evidence=btrim(evidence_text),assigned_to=btrim(assignee),due_on=due_date,
    version=item.version+1,updated_at=now(),completed_at=case when next_status='done' then coalesce(item.completed_at,now()) else null end
    where id=item.id returning * into item;
  insert into private.launch_events(entity_kind,entity_id,actor_id,action,snapshot)
    values('task',item.id,me,'task_update',to_jsonb(item));
  return to_jsonb(item);
end $$;
create function public.owner_launch_task_update(target_id text,expected_version integer,next_status text,evidence_text text,assignee text default '',due_date date default null) returns jsonb
language sql security invoker set search_path='' set statement_timeout='5s' set lock_timeout='3s'
as $$ select private.owner_launch_task_update(target_id,expected_version,next_status,evidence_text,assignee,due_date); $$;

create function private.owner_launch_experiment_save(target_id uuid,expected_version integer,experiment jsonb) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='5s' set lock_timeout='3s' as $$
declare me uuid; item private.launch_experiments; prior private.launch_experiments; key text; action_name text;
begin
  me:=private.launch_assert_owner();
  if target_id is null or expected_version is null or expected_version<0
    or experiment is null or jsonb_typeof(experiment)<>'object'
  then raise exception 'Invalid experiment fields' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(experiment) k where k not in ('title','hypothesis','start_on','end_on',
    'cash_cost_usd','founder_hours','hour_value_usd','attributable_contribution_usd','decision','notes'))
    or not(experiment ?& array['title','hypothesis','start_on','end_on','cash_cost_usd','founder_hours','hour_value_usd','attributable_contribution_usd','decision','notes'])
  then raise exception 'Invalid experiment fields' using errcode='22023'; end if;
  foreach key in array array['title','hypothesis','start_on','end_on','decision','notes'] loop
    if jsonb_typeof(experiment->key)<>'string' then raise exception 'Invalid experiment fields' using errcode='22023'; end if;
  end loop;
  foreach key in array array['cash_cost_usd','founder_hours','hour_value_usd'] loop
    if jsonb_typeof(experiment->key)<>'number' then raise exception 'Invalid experiment amounts' using errcode='22023'; end if;
  end loop;
  if jsonb_typeof(experiment->'attributable_contribution_usd') not in ('number','null')
    or (experiment->>'start_on') !~ '^\d{4}-\d{2}-\d{2}$' or (experiment->>'end_on') !~ '^\d{4}-\d{2}-\d{2}$'
  then raise exception 'Invalid experiment fields' using errcode='22023'; end if;
  item.id:=target_id; item.title:=btrim(experiment->>'title'); item.hypothesis:=btrim(experiment->>'hypothesis');
  item.start_on:=(experiment->>'start_on')::date; item.end_on:=(experiment->>'end_on')::date;
  item.currency:='USD'; item.cash_cost_usd:=(experiment->>'cash_cost_usd')::numeric;
  item.founder_hours:=(experiment->>'founder_hours')::numeric; item.hour_value_usd:=(experiment->>'hour_value_usd')::numeric;
  item.attributable_contribution_usd:=(experiment->>'attributable_contribution_usd')::numeric;
  item.decision:=experiment->>'decision'; item.notes:=btrim(experiment->>'notes');
  perform pg_advisory_xact_lock(hashtextextended('owner-launch-workspace',0));
  perform private.community_consume('launch-write',120,60);
  select * into prior from private.launch_experiments where id=target_id for update;
  if found then
    if expected_version<>prior.version then raise exception 'Experiment changed; refresh before saving' using errcode='40001'; end if;
    update private.launch_experiments set title=item.title,hypothesis=item.hypothesis,start_on=item.start_on,end_on=item.end_on,
      cash_cost_usd=item.cash_cost_usd,founder_hours=item.founder_hours,hour_value_usd=item.hour_value_usd,
      attributable_contribution_usd=item.attributable_contribution_usd,decision=item.decision,notes=item.notes,
      version=prior.version+1,updated_at=now() where id=target_id returning * into item;
    action_name:='experiment_update';
  else
    if expected_version<>0 then raise exception 'Experiment changed; refresh before saving' using errcode='40001'; end if;
    if (select count(*) from private.launch_experiments)>=100 then raise exception 'Workspace experiment limit reached' using errcode='P0001'; end if;
    insert into private.launch_experiments(id,title,hypothesis,start_on,end_on,cash_cost_usd,founder_hours,hour_value_usd,
      attributable_contribution_usd,decision,notes) values(item.id,item.title,item.hypothesis,item.start_on,item.end_on,item.cash_cost_usd,
      item.founder_hours,item.hour_value_usd,item.attributable_contribution_usd,item.decision,item.notes) returning * into item;
    action_name:='experiment_create';
  end if;
  insert into private.launch_events(entity_kind,entity_id,actor_id,action,snapshot)
    values('experiment',item.id::text,me,action_name,to_jsonb(item));
  return to_jsonb(item);
end $$;
create function public.owner_launch_experiment_save(target_id uuid,expected_version integer,experiment jsonb) returns jsonb
language sql security invoker set search_path='' set statement_timeout='5s' set lock_timeout='3s'
as $$ select private.owner_launch_experiment_save(target_id,expected_version,experiment); $$;

create function private.owner_launch_history(target_kind text,target_id text) returns jsonb
language plpgsql stable security definer set search_path='' set statement_timeout='5s' as $$
begin
  perform private.launch_assert_owner();
  if target_kind is null or target_kind not in ('task','experiment') or target_id is null or char_length(target_id)>64
  then raise exception 'Invalid history target' using errcode='22023'; end if;
  return(select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc),'[]'::jsonb) from(
    select id,entity_kind,entity_id,action,snapshot,created_at from private.launch_events
    where entity_kind=target_kind and entity_id=target_id order by id desc limit 100
  )e);
end $$;
create function public.owner_launch_history(target_kind text,target_id text) returns jsonb
language sql stable security invoker set search_path='' set statement_timeout='5s'
as $$ select private.owner_launch_history(target_kind,target_id); $$;

revoke all on function private.launch_assert_owner(),private.launch_immutable_event(),
  private.owner_launch_workspace(),public.owner_launch_workspace(),
  private.owner_launch_task_update(text,integer,text,text,text,date),public.owner_launch_task_update(text,integer,text,text,text,date),
  private.owner_launch_experiment_save(uuid,integer,jsonb),public.owner_launch_experiment_save(uuid,integer,jsonb),
  private.owner_launch_history(text,text),public.owner_launch_history(text,text) from public,anon,authenticated,service_role;
grant execute on function private.owner_launch_workspace(),public.owner_launch_workspace(),
  private.owner_launch_task_update(text,integer,text,text,text,date),public.owner_launch_task_update(text,integer,text,text,text,date),
  private.owner_launch_experiment_save(uuid,integer,jsonb),public.owner_launch_experiment_save(uuid,integer,jsonb),
  private.owner_launch_history(text,text),public.owner_launch_history(text,text) to authenticated;
comment on table private.launch_tasks is 'Owner planning records only. Completion does not approve or deploy a public launch, change crawler policy or activate paid services. Keep credentials and sensitive user content out of evidence.';
comment on table private.launch_experiments is 'Owner-entered USD experiment observations, not verified accounting or inferred revenue. Nullable attributable contribution means unknown. Records and revisions are retained until an operator-reviewed retention process is applied.';
comment on table private.launch_events is 'Immutable application audit revisions. No browser/table grants; actor UUID retained for accountability and omitted from owner API responses.';
commit;

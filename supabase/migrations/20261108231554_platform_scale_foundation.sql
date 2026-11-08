begin;
set local lock_timeout='5s';
-- Durable public archive. Browser access obeys RLS; imports are operator-only.
create table public.archive_posts(
  id text primary key check(id ~ '^apify-[A-Za-z0-9_-]{1,160}$'),
  payload jsonb not null check(jsonb_typeof(payload)='object' and payload->>'id'=id and octet_length(payload::text)<=131072),
  source_answers jsonb not null default '[]' check(jsonb_typeof(source_answers)='array' and jsonb_array_length(source_answers)<=100),
  experience jsonb,
  created_at timestamptz not null,
  tags text[] not null default '{}', visa_type text not null default '',
  post_kind text not null default 'question', status text not null default 'open',
  vote_score integer not null default 0, answer_count integer not null default 0,
  search_document tsvector generated always as(to_tsvector('english'::regconfig,coalesce(payload->>'title','')||' '||coalesce(payload->>'body','')||' '||discussion_text)) stored,
  discussion_text text not null default '' check(length(discussion_text)<=20000),
  imported_at timestamptz not null default now()
);
alter table public.archive_posts enable row level security;
create policy archive_public_read on public.archive_posts for select to anon,authenticated using(status<>'archived');
grant select on public.archive_posts to anon,authenticated;
create index archive_posts_new on public.archive_posts(created_at desc,id desc) where status<>'archived';
create index archive_posts_score on public.archive_posts(vote_score desc,created_at desc,id desc) where status<>'archived';
create index archive_posts_activity on public.archive_posts((vote_score+answer_count*2) desc,created_at desc,id desc) where status<>'archived';
create index archive_posts_tags on public.archive_posts using gin(tags);
create index archive_posts_search on public.archive_posts using gin(search_document);

create table public.archive_metadata(id boolean primary key default true check(id),source jsonb not null);
alter table public.archive_metadata enable row level security;
create policy archive_metadata_read on public.archive_metadata for select to anon,authenticated using(true);
grant select on public.archive_metadata to anon,authenticated;

create function public.platform_related_posts(source_id text default '',query_tags text[] default '{}',query_text text default '',filter_visa text default '') returns setof jsonb
language sql stable security invoker set search_path='' set statement_timeout='5s' set plan_cache_mode='force_custom_plan' as $$
with candidates as (
 (select to_jsonb(f) as payload,q.id::text as id,q.tags,q.created_at from public.questions q join public.question_feed f on f.id=q.id
  where q.id::text<>source_id and q.status<>'archived' and q.created_at>=((now() at time zone 'UTC')-interval '2 months') at time zone 'UTC'
  and (q.tags && query_tags or (query_text<>'' and q.search_document @@ websearch_to_tsquery('english',left(query_text,500))))
  and (filter_visa='' or q.visa_type=filter_visa) order by q.created_at desc limit 100)
 union all
 (select a.payload,a.id,a.tags,a.created_at from public.archive_posts a
  where a.id<>source_id and a.status<>'archived' and a.post_kind<>'promotion'
  and a.created_at>=((now() at time zone 'UTC')-interval '2 months') at time zone 'UTC'
  and (a.tags && query_tags or (query_text<>'' and a.search_document @@ websearch_to_tsquery('english',left(query_text,500))))
  and (filter_visa='' or a.visa_type=filter_visa) order by a.created_at desc limit 100)
)
select payload||jsonb_build_object('matched_tags',to_jsonb(array(select t from unnest(tags) t where t=any(query_tags))),'match_reason','Shared topics and wording') from candidates
order by cardinality(array(select t from unnest(tags) t where t=any(query_tags))) desc,created_at desc,id desc limit 5;
$$;
revoke all on function public.platform_related_posts(text,text[],text,text) from public;
grant execute on function public.platform_related_posts(text,text[],text,text) to anon,authenticated;

-- Every source is filtered before keyset pagination. No OFFSET/full-archive download.
create function public.platform_post_page(query_text text default '',filter_tag text default '',filter_visa text default '',sort_mode text default 'newest',before_time timestamptz default null,before_id text default null,before_score integer default null,filter_kind text default '',filter_category text default '',filter_origin text default '') returns setof jsonb
language sql stable security invoker set search_path='' set statement_timeout='5s' set plan_cache_mode='force_custom_plan' as $$
with native as (
 select to_jsonb(f) as payload,q.id::text as id,q.created_at,
 case sort_mode when 'score' then q.vote_score when 'activity' then q.vote_score+q.answer_count*2 else 0 end as rank
 from public.questions q join public.question_feed f on f.id=q.id
 where filter_origin<>'archive' and q.status<>'archived'
 and q.created_at>=((now() at time zone 'UTC')-interval '2 months') at time zone 'UTC'
 and ((filter_kind='' and q.post_kind<>'experience') or q.post_kind=filter_kind)
 and (filter_category='' or q.experience_category=filter_category)
 and (query_text='' or q.search_document @@ websearch_to_tsquery('english',left(query_text,500)))
 and (filter_tag='' or q.tags @> array[filter_tag]) and (filter_visa='' or q.visa_type=filter_visa)
 and (sort_mode<>'unanswered' or q.answer_count=0)
 and (before_time is null or (case sort_mode when 'score' then q.vote_score when 'activity' then q.vote_score+q.answer_count*2 else 0 end,q.created_at,q.id::text)<(coalesce(before_score,0),before_time,before_id))
 order by rank desc,q.created_at desc,q.id::text desc limit 51
), imported as (
 select case when filter_kind='experience' then a.experience else a.payload end as payload,a.id,a.created_at,
 case sort_mode when 'score' then a.vote_score when 'activity' then a.vote_score+a.answer_count*2 else 0 end as rank
 from public.archive_posts a
 where filter_origin<>'member' and a.status<>'archived'
 and a.created_at>=((now() at time zone 'UTC')-interval '2 months') at time zone 'UTC'
 and (filter_kind<>'experience' or a.experience is not null)
 and (filter_kind in ('','experience') or a.post_kind=filter_kind)
 and (filter_category='' or a.experience->>'experience_category'=filter_category)
 and (query_text='' or a.search_document @@ websearch_to_tsquery('english',left(query_text,500)))
 and (filter_tag='' or a.tags @> array[filter_tag]) and (filter_visa='' or a.visa_type=filter_visa)
 and (sort_mode<>'unanswered' or (a.answer_count=0 and not exists(select 1 from public.imported_answers x where x.question_id=a.id and x.status='active')))
 and (before_time is null or (case sort_mode when 'score' then a.vote_score when 'activity' then a.vote_score+a.answer_count*2 else 0 end,a.created_at,a.id)<(coalesce(before_score,0),before_time,before_id))
 order by rank desc,a.created_at desc,a.id desc limit 51
)
select payload||jsonb_build_object('feed_rank',rank,'answer_count',coalesce((payload->>'answer_count')::integer,0)+case when id like 'apify-%' then (select count(*) from public.imported_answers x where x.question_id=posts.id and x.status='active') else 0 end)
from (select * from (select * from native union all select * from imported) combined order by rank desc,created_at desc,id desc limit 51) posts order by rank desc,created_at desc,id desc;
$$;
revoke all on function public.platform_post_page(text,text,text,text,timestamptz,text,integer,text,text,text) from public;
grant execute on function public.platform_post_page(text,text,text,text,timestamptz,text,integer,text,text,text) to anon,authenticated;

-- Scoped ingestion credential: cannot read private account/message tables.
create table private.archive_ingest_key(id boolean primary key default true check(id),token_hash text not null check(length(token_hash)=64));
alter table private.archive_ingest_key enable row level security;
revoke all on private.archive_ingest_key from public,anon,authenticated,service_role;
create function private.archive_ingest_batch(token text,posts jsonb,source_metadata jsonb default null) returns integer language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare changed integer;
begin
 if token is null or length(token)<>64 or not exists(select 1 from private.archive_ingest_key k where k.token_hash=encode(extensions.digest(token,'sha256'),'hex')) then raise exception 'Import access denied' using errcode='42501';end if;
 if jsonb_typeof(posts)<>'array' or jsonb_array_length(posts)>50 or octet_length(posts::text)>1000000 then raise exception 'Import batch exceeds bounds' using errcode='22023';end if;
 insert into public.archive_posts(id,payload,source_answers,experience,created_at,tags,visa_type,post_kind,status,vote_score,answer_count,discussion_text)
 select id,payload,source_answers,experience,created_at,tags,visa_type,post_kind,status,vote_score,answer_count,discussion_text from jsonb_to_recordset(posts) as x(id text,payload jsonb,source_answers jsonb,experience jsonb,created_at timestamptz,tags text[],visa_type text,post_kind text,status text,vote_score integer,answer_count integer,discussion_text text)
 on conflict(id) do update set payload=excluded.payload,source_answers=excluded.source_answers,experience=excluded.experience,created_at=excluded.created_at,tags=excluded.tags,visa_type=excluded.visa_type,post_kind=excluded.post_kind,status=excluded.status,vote_score=excluded.vote_score,answer_count=excluded.answer_count,discussion_text=excluded.discussion_text,imported_at=now()
 where (archive_posts.payload,archive_posts.source_answers,archive_posts.experience,archive_posts.status) is distinct from (excluded.payload,excluded.source_answers,excluded.experience,excluded.status);
 get diagnostics changed=row_count;
 if source_metadata is not null then
   if jsonb_typeof(source_metadata)<>'object' or source_metadata->>'name'<>'Apify' or octet_length(source_metadata::text)>20000 then raise exception 'Invalid source metadata' using errcode='22023';end if;
   insert into public.archive_metadata(id,source) values(true,source_metadata) on conflict(id) do update set source=excluded.source where archive_metadata.source is distinct from excluded.source;
 end if;
 return changed;
end $$;
create function public.archive_ingest_batch(token text,posts jsonb,source_metadata jsonb default null) returns integer language sql security definer set search_path='' as $$select private.archive_ingest_batch(token,posts,source_metadata)$$;
revoke all on function private.archive_ingest_batch(text,jsonb,jsonb),public.archive_ingest_batch(text,jsonb,jsonb) from public;
grant execute on function private.archive_ingest_batch(text,jsonb,jsonb),public.archive_ingest_batch(text,jsonb,jsonb) to anon,authenticated;

-- Capacity samples contain aggregate resource counts only; no account/message data.
create table private.capacity_settings(id boolean primary key default true check(id),database_limit_bytes bigint not null default 500000000 check(database_limit_bytes>0),realtime_limit integer not null default 200 check(realtime_limit>0),plan text not null default 'free');
insert into private.capacity_settings(id) values(true);
create table private.capacity_samples(at timestamptz primary key default now(),database_bytes bigint not null,connections integer not null,connection_limit integer not null,active_queries integer not null,waiting_queries integer not null);
create table private.capacity_alerts(metric text primary key,severity text not null,ratio numeric not null,opened_at timestamptz not null default now(),updated_at timestamptz not null default now(),resolved_at timestamptz);
create table private.capacity_monitor_key(id boolean primary key default true check(id),token_hash text not null check(length(token_hash)=64));
alter table private.capacity_settings enable row level security;
alter table private.capacity_samples enable row level security;
alter table private.capacity_alerts enable row level security;
alter table private.capacity_monitor_key enable row level security;
revoke all on private.capacity_settings,private.capacity_samples,private.capacity_alerts,private.capacity_monitor_key from public,anon,authenticated,service_role;
create function private.capacity_capture() returns void language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare sample private.capacity_samples; storage_limit bigint; v_metric text; v_ratio numeric; level text;
begin
 if not pg_try_advisory_xact_lock(83011234) then return; end if;
 sample.at:=now();sample.database_bytes:=pg_database_size(current_database());
 select count(*),count(*) filter(where state='active' and pid<>pg_backend_pid()),count(*) filter(where wait_event_type='Lock') into sample.connections,sample.active_queries,sample.waiting_queries from pg_stat_activity where datname=current_database();
 sample.connection_limit:=current_setting('max_connections')::integer;
 insert into private.capacity_samples values(sample.*) on conflict(at) do nothing;
 select database_limit_bytes into storage_limit from private.capacity_settings where id;
 for v_metric,v_ratio in select 'database_storage',sample.database_bytes::numeric/storage_limit union all select 'database_connections',sample.connections::numeric/sample.connection_limit loop
   -- Warn at 70%, critical at 85%; recover below 60% to avoid noisy flapping.
   level:=case when v_ratio>=0.85 then 'critical' when v_ratio>=0.70 then 'warning' else 'ok' end;
   if level<>'ok' then
     insert into private.capacity_alerts(metric,severity,ratio) values(v_metric,level,v_ratio)
     on conflict(metric) do update set severity=excluded.severity,ratio=excluded.ratio,opened_at=case when capacity_alerts.resolved_at is not null then now() else capacity_alerts.opened_at end,updated_at=now(),resolved_at=null;
   elsif v_ratio<0.60 then update private.capacity_alerts set resolved_at=now(),updated_at=now(),ratio=v_ratio where capacity_alerts.metric=v_metric and resolved_at is null;
   end if;
 end loop;
 delete from private.capacity_samples where at<now()-interval '30 days';
end $$;
revoke all on function private.capacity_capture() from public,anon,authenticated,service_role;
create function private.capacity_data() returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('sample',(select to_jsonb(s) from private.capacity_samples s order by at desc limit 1),'limits',(select to_jsonb(c)-'id' from private.capacity_settings c where id),'alerts',coalesce((select jsonb_agg(to_jsonb(a)) from private.capacity_alerts a where resolved_at is null),'[]'::jsonb),'coverage',jsonb_build_object('realtime','not-connected','cpu_memory','not-connected','external_probe','configured'));
$$;
revoke all on function private.capacity_data() from public,anon,authenticated,service_role;
create function private.owner_capacity_dashboard() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.security_require_owner(); return private.capacity_data(); end $$;
create function public.owner_capacity_dashboard() returns jsonb language sql security invoker set search_path='' as $$select private.owner_capacity_dashboard()$$;
revoke all on function private.owner_capacity_dashboard(),public.owner_capacity_dashboard() from public,anon,authenticated,service_role;
grant execute on function private.owner_capacity_dashboard(),public.owner_capacity_dashboard() to authenticated;
-- External monitor holds a dedicated read-only token, never a service-role key.
create function private.capacity_probe(token text) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
begin
 if token is null or length(token)<>64 or not exists(select 1 from private.capacity_monitor_key k where k.token_hash=encode(extensions.digest(token,'sha256'),'hex')) then raise exception 'Monitor access denied' using errcode='42501'; end if;
 return private.capacity_data();
end $$;
create function public.capacity_probe(token text) returns jsonb language sql security definer set search_path='' as $$select private.capacity_probe(token)$$;
revoke all on function private.capacity_probe(text),public.capacity_probe(text) from public;
grant execute on function private.capacity_probe(text),public.capacity_probe(text) to anon,authenticated;
create function private.owner_capacity_limits(database_bytes bigint,realtime_connections integer,plan_name text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.security_require_owner();
 if database_bytes<1000000 or database_bytes>100000000000000 or realtime_connections<1 or realtime_connections>1000000 or plan_name not in ('free','pro','team','enterprise','custom') then raise exception 'Invalid capacity limits' using errcode='22023';end if;
 update private.capacity_settings set database_limit_bytes=database_bytes,realtime_limit=realtime_connections,plan=plan_name where id;
end $$;
create function public.owner_capacity_limits(database_bytes bigint,realtime_connections integer,plan_name text) returns void language sql security invoker set search_path='' as $$select private.owner_capacity_limits(database_bytes,realtime_connections,plan_name)$$;
revoke all on function private.owner_capacity_limits(bigint,integer,text),public.owner_capacity_limits(bigint,integer,text) from public,anon,authenticated,service_role;
grant execute on function private.owner_capacity_limits(bigint,integer,text),public.owner_capacity_limits(bigint,integer,text) to authenticated;
select private.capacity_capture();
select cron.schedule('visathreads-capacity-sample','*/5 * * * *','select private.capacity_capture()');
commit;

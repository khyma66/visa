begin;
create table private.capacity_provider_samples(at timestamptz primary key default now(),metrics jsonb not null,cpu_ratio numeric,memory_ratio numeric);
alter table private.capacity_provider_samples enable row level security;
revoke all on private.capacity_provider_samples from public,anon,authenticated,service_role;
create function private.record_provider_capacity(metrics jsonb) returns void language plpgsql security definer set search_path='' as $$
declare previous jsonb;cpu numeric;memory numeric;total numeric;idle numeric;mem_total numeric;mem_available numeric;v_metric text;v_ratio numeric;level text;
begin
 if jsonb_typeof(metrics)<>'object' or octet_length(metrics::text)>2000 or exists(select 1 from jsonb_object_keys(metrics) k where k not in ('cpu_total','cpu_idle','cpu_cores','load1','memory_total','memory_available')) then raise exception 'Invalid provider metrics' using errcode='22023';end if;
 if not pg_try_advisory_xact_lock(83011235) then return;end if;
 if exists(select 1 from private.capacity_provider_samples where at>now()-interval '60 seconds') then return;end if;
 total:=(metrics->>'cpu_total')::numeric;idle:=(metrics->>'cpu_idle')::numeric;mem_total:=(metrics->>'memory_total')::numeric;mem_available:=(metrics->>'memory_available')::numeric;
 if total is null or idle is null or mem_total is null or mem_available is null or mem_total<=0 or mem_available<0 or mem_available>mem_total or idle<0 or total<idle then raise exception 'Incomplete provider metrics' using errcode='22023';end if;
 select s.metrics into previous from private.capacity_provider_samples s where at>now()-interval '1 hour' order by at desc limit 1;
 if previous is not null and total>(previous->>'cpu_total')::numeric and idle>=(previous->>'cpu_idle')::numeric then cpu:=greatest(0,least(1,1-(idle-(previous->>'cpu_idle')::numeric)/(total-(previous->>'cpu_total')::numeric)));end if;
 memory:=1-mem_available/mem_total;
 insert into private.capacity_provider_samples(metrics,cpu_ratio,memory_ratio) values(metrics,cpu,memory);
 for v_metric,v_ratio in select 'cpu_usage',cpu union all select 'memory_usage',memory loop
  if v_ratio is null then continue;end if;
  level:=case when v_ratio>=0.9 then 'critical' when v_ratio>=0.8 then 'warning' else 'ok' end;
  if level<>'ok' then
   insert into private.capacity_alerts(metric,severity,ratio) values(v_metric,level,v_ratio)
   on conflict(metric) do update set severity=excluded.severity,ratio=excluded.ratio,opened_at=case when capacity_alerts.resolved_at is not null then now() else capacity_alerts.opened_at end,updated_at=now(),resolved_at=null;
  elsif v_ratio<0.7 then update private.capacity_alerts set resolved_at=now(),updated_at=now(),ratio=v_ratio where capacity_alerts.metric=v_metric and resolved_at is null;end if;
 end loop;
 delete from private.capacity_provider_samples where at<now()-interval '30 days';
end $$;
create function public.record_provider_capacity(metrics jsonb) returns void language sql security definer set search_path='' as $$select private.record_provider_capacity(metrics)$$;
revoke all on function private.record_provider_capacity(jsonb),public.record_provider_capacity(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_provider_capacity(jsonb) to service_role;
create or replace function private.capacity_data() returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('sample',(select to_jsonb(s) from private.capacity_samples s order by at desc limit 1),'provider',(select to_jsonb(p) from private.capacity_provider_samples p order by at desc limit 1),'limits',(select to_jsonb(c)-'id' from private.capacity_settings c where id),'alerts',coalesce((select jsonb_agg(to_jsonb(a)) from private.capacity_alerts a where resolved_at is null),'[]'::jsonb),'coverage',jsonb_build_object('realtime','not-connected','cpu_memory',case when exists(select 1 from private.capacity_provider_samples where at>now()-interval '20 minutes') then 'connected' else 'stale-or-not-connected' end,'external_probe','configured'));
$$;
commit;

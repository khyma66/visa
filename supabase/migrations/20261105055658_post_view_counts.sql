begin;
set local lock_timeout='5s';
-- Counts start at rollout; legacy view_count fields are deliberately untouched.
create table private.post_view_totals(post_id text primary key,views bigint not null default 0 check(views>=0));
create table private.post_view_dedup(post_id text not null,fingerprint text not null check(fingerprint~'^[a-f0-9]{64}$'),day date not null,primary key(post_id,fingerprint,day));
create index post_view_dedup_retention on private.post_view_dedup(day);
alter table private.post_view_totals enable row level security;
alter table private.post_view_dedup enable row level security;
revoke all on private.post_view_totals,private.post_view_dedup from public,anon,authenticated,service_role;

create function security_ingress.post_views(targets text[],fingerprint text default null,view_day date default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare supplied text:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-security-ingest-key',''); target text; valid text[]:='{}'; inserted integer; result jsonb;
begin
  if length(supplied)<>64 or not exists(select 1 from private.security_ingest_key where key_hash=sha256(convert_to(supplied,'UTF8'))) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  if targets is null or cardinality(targets) not between 1 and 50 or array_ndims(targets)<>1
    or (fingerprint is not null and (cardinality(targets)<>1 or fingerprint!~'^[a-f0-9]{64}$' or view_day is distinct from (now() at time zone 'UTC')::date)) then
    raise exception 'Invalid view request' using errcode='22023';
  end if;
  foreach target in array targets loop
    -- Imported membership is checked against the deployed snapshot at the trusted edge.
    if target ~ '^apify-[a-zA-Z0-9_-]{1,160}$' or
      (target ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' and exists(
        select 1 from public.questions q where q.id::text=target and q.status<>'archived'
        and (q.community_id is null or exists(select 1 from public.communities c where c.id=q.community_id and c.is_public and c.is_active)))) then
      valid:=array_append(valid,target);
    end if;
  end loop;
  if fingerprint is not null and cardinality(valid)=1 then
    insert into private.post_view_dedup values(valid[1],fingerprint,view_day) on conflict do nothing;
    get diagnostics inserted=row_count;
    if inserted=1 then
      insert into private.post_view_totals values(valid[1],1) on conflict(post_id) do update set views=post_view_totals.views+1;
    end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('post_id',p.id,'views',coalesce(t.views,0))),'[]') into result
    from (select distinct unnest(valid) id) p left join private.post_view_totals t on t.post_id=p.id;
  return result;
end $$;
create function public.post_views(targets text[],fingerprint text default null,view_day date default null) returns jsonb
language sql security invoker set search_path='' as $$select security_ingress.post_views(targets,fingerprint,view_day)$$;
revoke all on function security_ingress.post_views(text[],text,date),public.post_views(text[],text,date) from public,anon,authenticated,service_role;
grant execute on function security_ingress.post_views(text[],text,date),public.post_views(text[],text,date) to anon;
-- Daily network/browser signatures are never public and expire within three days.
select cron.schedule('post-view-dedup-retention','37 3 * * *', $job$delete from private.post_view_dedup where day < (now() at time zone 'UTC')::date-2$job$);
commit;

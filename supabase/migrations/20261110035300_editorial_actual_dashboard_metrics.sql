-- Version matches the production migration receipt.
begin;
set local lock_timeout='5s';

-- Operator-only aggregate helper. The caller-facing owner RPC below retains
-- its existing live-session authorization before this helper can run.
create function private.editorial_actual_metrics(window_start timestamptz,as_of timestamptz) returns jsonb
language sql stable security invoker set search_path='' as $$
  with published as materialized (
    select question_id,published_at from private.editorial_drafts
    where status='published' and published_at<as_of
  )
  select jsonb_build_object(
    'measured_total',(select coalesce(sum(views),0) from private.post_view_totals),
    'posts_with_measured_views',(select count(*) from private.post_view_totals where views>0),
    'measured_scheduled_total',(select coalesce(sum(v.views),0) from private.post_view_totals v
      join published p on p.question_id::text=v.post_id),
    'scheduled_published_total',(select count(*) from published),
    'scheduled_published_in_period',(select count(*) from published where published_at>=window_start)
  );
$$;
revoke all on function private.editorial_actual_metrics(timestamptz,timestamptz)
  from public,anon,authenticated,service_role;
comment on function private.editorial_actual_metrics(timestamptz,timestamptz) is
  'Actual retained view-ledger totals and successful reviewed-publication receipts. Never reads synthetic display counters. View totals are all-time, not historical-window counts or unique visitors.';

-- Fail closed if another change has altered either expected insertion point.
-- Preserve owner authorization, session revocation, timeout and RPC privileges.
do $patch$
declare
  definition text:=pg_get_functiondef('private.owner_analytics(integer)'::regprocedure);
  predicate text:='where q.status<>''archived'' and q.created_at<as_of';
  ending text:='return result;';
begin
  if (length(definition)-length(replace(definition,predicate,'')))/length(predicate)<>1
    or (length(definition)-length(replace(definition,ending,'')))/length(ending)<>1
  then raise exception 'Unexpected owner analytics definition; review before migration'; end if;
  definition:=replace(definition,predicate,predicate || E'\n      and not exists(select 1 from private.editorial_drafts d where d.status=''published'' and d.question_id=q.id)');
  definition:=replace(definition,ending,
    'return result || jsonb_build_object(''post_views'',private.editorial_actual_metrics(window_start,as_of));');
  execute definition;
end $patch$;
notify pgrst,'reload schema';
commit;

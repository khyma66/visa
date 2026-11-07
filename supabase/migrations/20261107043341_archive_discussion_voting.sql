begin;
set local lock_timeout='5s';
-- Local votes are separate from immutable source reaction counts. The edge
-- validates every target against the published archive before calling these RPCs.
create table private.archive_votes (
  kind text not null check(kind in ('question','answer')),
  target text not null check(target ~ '^apify-[a-zA-Z0-9_-]{1,160}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  value integer not null check(value in (-1,1)),
  primary key(kind,target,user_id)
);
create index archive_votes_user on private.archive_votes(user_id);
alter table private.archive_votes enable row level security;
revoke all on private.archive_votes from public,anon,authenticated,service_role;

create function security_ingress.archive_vote_summary(kind text,targets text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare supplied text:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-security-ingest-key','');result jsonb;
begin
  if length(supplied)<>64 or not exists(select 1 from private.security_ingest_key where key_hash=sha256(convert_to(supplied,'UTF8'))) then
    raise exception 'Trusted edge required' using errcode='42501'; end if;
  if kind is null or kind not in ('question','answer') or targets is null or cardinality(targets)>50
    or exists(select 1 from unnest(targets) t where t is null or t !~ '^apify-[a-zA-Z0-9_-]{1,160}$') then raise exception 'Invalid vote list' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(s)),'[]') into result from (
    select t as id,coalesce(sum(v.value),0)::integer as score,coalesce(max(v.value) filter(where v.user_id=auth.uid()),0) as value
    from (select distinct unnest(targets) t) ids left join private.archive_votes v on v.target=ids.t and v.kind=archive_vote_summary.kind group by t
  ) s;
  return result;
end $$;
create function public.archive_vote_summary(kind text,targets text[]) returns jsonb
language sql stable security invoker set search_path='' as $$select security_ingress.archive_vote_summary(kind,targets);$$;

create function private.set_archive_vote(kind text,target text,selected integer,expected_user uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare supplied text:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-security-ingest-key','');me uuid;score integer;
begin
  if length(supplied)<>64 or not exists(select 1 from private.security_ingest_key where key_hash=sha256(convert_to(supplied,'UTF8'))) then
    raise exception 'Trusted edge required' using errcode='42501'; end if;
  me:=private.library_member();
  if expected_user is distinct from me then raise exception 'Account changed. Please sign in again.' using errcode='42501'; end if;
  if kind is null or kind not in ('question','answer') or target is null or target !~ '^apify-[a-zA-Z0-9_-]{1,160}$' or selected is null or selected not in (-1,0,1) then raise exception 'Invalid vote' using errcode='22023'; end if;
  if not exists(select 1 from public.policy_acceptances where user_id=me and policy_version in ('2026-11-02-preview-v3','2026-11-05-preview-v4')) then
    raise exception 'Please review and acknowledge the current community policies.' using errcode='42501'; end if;
  perform private.community_consume('vote',120,60);
  perform pg_advisory_xact_lock(hashtextextended('archive-vote:'||kind||':'||target,0));
  if selected=0 then delete from private.archive_votes v where v.kind=set_archive_vote.kind and v.target=set_archive_vote.target and v.user_id=me;
  else insert into private.archive_votes as v(kind,target,user_id,value) values(kind,target,me,selected)
    on conflict on constraint archive_votes_pkey do update set value=excluded.value; end if;
  select coalesce(sum(v.value),0)::integer into score from private.archive_votes v where v.kind=set_archive_vote.kind and v.target=set_archive_vote.target;
  return score;
end $$;
create function public.set_archive_vote(kind text,target text,selected integer,expected_user uuid) returns integer
language sql security invoker set search_path='' as $$select private.set_archive_vote(kind,target,selected,expected_user);$$;
revoke all on function security_ingress.archive_vote_summary(text,text[]),public.archive_vote_summary(text,text[]),private.set_archive_vote(text,text,integer,uuid),public.set_archive_vote(text,text,integer,uuid) from public,anon,authenticated,service_role;
grant usage on schema security_ingress to authenticated;
grant execute on function security_ingress.archive_vote_summary(text,text[]),public.archive_vote_summary(text,text[]) to anon,authenticated;
grant execute on function private.set_archive_vote(text,text,integer,uuid),public.set_archive_vote(text,text,integer,uuid) to authenticated;
commit;

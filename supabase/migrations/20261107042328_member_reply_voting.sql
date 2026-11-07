begin;
set local lock_timeout='5s';

-- Reuse native vote policies, score/reputation triggers and identity checks.
create function public.set_native_vote(kind text,target uuid,selected integer,expected_user uuid) returns integer
language plpgsql security invoker set search_path='' as $$
declare score integer;
begin
  if auth.uid() is null or auth.uid() is distinct from expected_user then raise exception 'Account changed. Please sign in again.' using errcode='42501'; end if;
  if kind is null or kind not in ('question','answer') or selected is null or selected not in (-1,0,1) then raise exception 'Invalid vote' using errcode='22023'; end if;
  if kind='question' then
    if selected<>0 then return public.vote_question(target,selected); end if;
    delete from public.question_votes where question_id=target and user_id=auth.uid();
    select vote_score into score from public.questions where id=target;
  else
    if selected<>0 then return public.vote_answer(target,selected); end if;
    delete from public.answer_votes where answer_id=target and user_id=auth.uid();
    select vote_score into score from public.answers where id=target;
  end if;
  if score is null then raise exception 'Contribution unavailable' using errcode='42501'; end if;
  return score;
end $$;
revoke all on function public.set_native_vote(text,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.set_native_vote(text,uuid,integer,uuid) to authenticated;

-- Member-authored replies on imported threads have their own table. Original
-- imported comments and reaction totals are never mutated by this feature.
create table private.imported_reply_votes (
  answer_id uuid not null references public.imported_answers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  value integer not null check(value in (-1,1)),
  primary key(answer_id,user_id)
);
create index imported_reply_votes_user on private.imported_reply_votes(user_id);
alter table private.imported_reply_votes enable row level security;
revoke all on private.imported_reply_votes from public,anon,authenticated,service_role;

create function private.refresh_imported_reply_votes() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid:=case when tg_op='DELETE' then old.answer_id else new.answer_id end;
  delta integer:=case when tg_op='INSERT' then new.value when tg_op='DELETE' then -old.value else new.value-old.value end;
begin
  perform 1 from public.imported_answers where id=target for update;
  update public.imported_answers set vote_score=vote_score+delta where id=target;
  return null;
end $$;
create trigger imported_reply_vote_score after insert or update or delete on private.imported_reply_votes
for each row execute function private.refresh_imported_reply_votes();

create function private.imported_reply_vote_state(targets uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid:=private.library_member(); result jsonb;
begin
  if targets is null or cardinality(targets)>50 then raise exception 'Invalid reply list' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',v.answer_id,'value',v.value)),'[]') into result
    from private.imported_reply_votes v join public.imported_answers a on a.id=v.answer_id
    where v.user_id=me and v.answer_id=any(targets) and a.status='active';
  return result;
end $$;
create function public.imported_reply_vote_state(targets uuid[]) returns jsonb
language sql stable security invoker set search_path='' as $$select private.imported_reply_vote_state(targets);$$;

create function private.vote_imported_reply(target uuid,vote_value integer,expected_user uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare me uuid:=private.library_member(); reply public.imported_answers; score integer;
begin
  if expected_user is distinct from me then raise exception 'Account changed. Please sign in again.' using errcode='42501'; end if;
  if vote_value is null or vote_value not in (-1,0,1) then raise exception 'Invalid vote' using errcode='22023'; end if;
  if not exists(select 1 from public.policy_acceptances where user_id=me and policy_version in ('2026-11-02-preview-v3','2026-11-05-preview-v4')) then
    raise exception 'Please review and acknowledge the current community policies.' using errcode='42501'; end if;
  perform private.community_consume('vote',120,60);
  select * into reply from public.imported_answers where id=target for update;
  if not found or reply.status<>'active' then raise exception 'Comment unavailable' using errcode='42501'; end if;
  if reply.author_id=me then raise exception 'You cannot vote on your own contribution.' using errcode='42501'; end if;
  if vote_value=0 then delete from private.imported_reply_votes where answer_id=target and user_id=me;
  else insert into private.imported_reply_votes(answer_id,user_id,value) values(target,me,vote_value)
    on conflict(answer_id,user_id) do update set value=excluded.value;
  end if;
  select vote_score into score from public.imported_answers where id=target;
  return score;
end $$;
create function public.vote_imported_reply(target uuid,vote_value integer,expected_user uuid) returns integer
language sql security invoker set search_path='' as $$select private.vote_imported_reply(target,vote_value,expected_user);$$;

revoke all on function private.refresh_imported_reply_votes(),private.imported_reply_vote_state(uuid[]),public.imported_reply_vote_state(uuid[]),
  private.vote_imported_reply(uuid,integer,uuid),public.vote_imported_reply(uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function private.imported_reply_vote_state(uuid[]),public.imported_reply_vote_state(uuid[]),
  private.vote_imported_reply(uuid,integer,uuid),public.vote_imported_reply(uuid,integer,uuid) to authenticated;
commit;

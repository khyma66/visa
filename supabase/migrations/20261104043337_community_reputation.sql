begin;
set local lock_timeout = '5s';

-- Server-owned awards are durable identities. Undo/retry never creates a second
-- earning opportunity, and caps count original awards even after withdrawal.
create table private.reputation_awards (
  id bigint generated always as identity primary key,
  kind text not null check(kind in ('question_upvote','answer_upvote','accepted_answer')),
  target_id uuid not null,
  question_id uuid not null,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  beneficiary_id uuid not null references public.profiles(id) on delete cascade,
  points smallint not null check(points in (0,2,5,10)),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique(kind,target_id,actor_id),
  check(actor_id<>beneficiary_id)
);
create index reputation_awards_beneficiary_day on private.reputation_awards(beneficiary_id,created_at);
create index reputation_awards_actor on private.reputation_awards(actor_id,beneficiary_id,created_at);
create index reputation_awards_question on private.reputation_awards(question_id);
create index reputation_awards_target on private.reputation_awards(target_id);
alter table private.reputation_awards enable row level security;
revoke all on private.reputation_awards from public,anon,authenticated;

create table private.reputation_events (
  id bigint generated always as identity primary key,
  beneficiary_id uuid not null references public.profiles(id) on delete cascade,
  award_id bigint not null,
  kind text not null,
  delta smallint not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index reputation_events_member_page on private.reputation_events(beneficiary_id,id desc);
alter table private.reputation_events enable row level security;
revoke all on private.reputation_events from public,anon,authenticated;

-- This internal routine only derives awards from saved content/votes. Never
-- grant it to clients. Row locking serializes the recipient's caps and total.
create function private.reputation_sync(award_kind text,target uuid,actor uuid,event_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare recipient uuid; parent uuid; wanted boolean := false; amount integer; used integer; paired integer;
  award private.reputation_awards; day_start timestamptz := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
begin
  perform pg_advisory_xact_lock(hashtextextended(actor::text,772));
  if award_kind='question_upvote' then
    select q.author_id,q.id,q.status<>'archived' and exists(select 1 from public.question_votes v where v.question_id=q.id and v.user_id=actor and v.value=1)
      into recipient,parent,wanted from public.questions q where q.id=target;
    amount:=2;
  else
    select a.author_id,q.id,a.status='active' and q.status<>'archived' and
      case when award_kind='answer_upvote' then exists(select 1 from public.answer_votes v where v.answer_id=a.id and v.user_id=actor and v.value=1)
      else a.is_accepted and q.author_id=actor end
      into recipient,parent,wanted from public.answers a join public.questions q on q.id=a.question_id where a.id=target;
    amount:=case when award_kind='answer_upvote' then 5 else 10 end;
  end if;
  select * into award from private.reputation_awards where kind=award_kind and target_id=target and actor_id=actor;
  recipient:=coalesce(award.beneficiary_id,recipient);
  if recipient is null or recipient=actor then return; end if;
  perform 1 from public.profiles where id=recipient for update;
  if not found then return; end if;
  -- Re-read after the recipient lock: parallel retries must see the committed award.
  select * into award from private.reputation_awards where kind=award_kind and target_id=target and actor_id=actor;
  wanted:=coalesce(wanted,false) and not exists(select 1 from private.community_suspensions where user_id in (actor,recipient));
  if award.id is null then
    if not wanted or not exists(select 1 from auth.users u join public.profiles p on p.id=u.id
      where u.id=actor and p.created_at<=now()-interval '24 hours'
        and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)) then return; end if;
    select coalesce(sum(points),0),coalesce(sum(points) filter(where actor_id=actor),0) into used,paired
      from private.reputation_awards where beneficiary_id=recipient and created_at>=day_start;
    if used+amount>100 or paired+amount>20 then amount:=0; end if;
    insert into private.reputation_awards(kind,target_id,question_id,actor_id,beneficiary_id,points)
      values(award_kind,target,parent,actor,recipient,amount) returning * into award;
  end if;
  if award.active is not distinct from wanted then return; end if;
  update private.reputation_awards set active=wanted where id=award.id;
  amount:=case when wanted then award.points else -award.points end;
  if amount<>0 then
    update public.profiles set reputation=reputation+amount where id=recipient;
    insert into private.reputation_events(beneficiary_id,award_id,kind,delta,reason)
      values(recipient,award.id,award_kind,amount,event_reason);
  end if;
end $$;

-- Block self-voting through RPCs AND direct Data API writes, including edits.
create function private.reputation_vote_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare author uuid; parent uuid; row_data jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  if tg_table_name='question_votes' then parent:=(row_data->>'question_id')::uuid;
  else select question_id into parent from public.answers where id=(row_data->>'answer_id')::uuid; end if;
  -- Serialize votes with parent removal and existing score triggers, not just
  -- with one another. No external calls are made while holding these locks.
  perform 1 from public.questions where id=parent for update;
  if tg_op='DELETE' then
    if auth.uid() is not null then perform private.community_consume('vote',120,60); end if;
    return old;
  end if;
  if tg_table_name='question_votes' then select author_id into author from public.questions where id=new.question_id;
  else select author_id into author from public.answers where id=new.answer_id; end if;
  if author=new.user_id then raise exception 'You cannot vote on your own contribution.' using errcode='42501'; end if;
  return new;
end $$;
create trigger reputation_question_vote_guard before insert or update or delete on public.question_votes for each row execute function private.reputation_vote_guard();
create trigger reputation_answer_vote_guard before insert or update or delete on public.answer_votes for each row execute function private.reputation_vote_guard();

create function private.reputation_vote_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare row_data jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  perform private.reputation_sync(case when tg_table_name='question_votes' then 'question_upvote' else 'answer_upvote' end,
    coalesce(row_data->>'question_id',row_data->>'answer_id')::uuid,(row_data->>'user_id')::uuid,
    case when tg_op='DELETE' then 'Vote withdrawn' else 'Helpful vote updated' end);
  return null;
end $$;
create trigger reputation_question_vote_changed after insert or update or delete on public.question_votes for each row execute function private.reputation_vote_changed();
create trigger reputation_answer_vote_changed after insert or update or delete on public.answer_votes for each row execute function private.reputation_vote_changed();

create function private.reputation_content_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare a private.reputation_awards; question_author uuid;
begin
  -- Status restoration only reinstates existing awards. No retroactive farming
  -- of historical/archive records, nor minting points during maintenance.
  for a in select * from private.reputation_awards
    where (tg_table_name='questions' and question_id=old.id) or (tg_table_name='answers' and target_id=old.id)
    order by beneficiary_id,id loop
    perform private.reputation_sync(a.kind,a.target_id,a.actor_id,'Contribution availability changed');
  end loop;
  if tg_table_name='answers' and tg_op='UPDATE' then
    if new.is_accepted and not old.is_accepted then
      select author_id into question_author from public.questions where id=new.question_id;
      perform private.reputation_sync('accepted_answer',new.id,question_author,'Answer accepted');
    end if;
  end if;
  return null;
end $$;
create trigger reputation_question_status after update of status or delete on public.questions for each row execute function private.reputation_content_changed();
create trigger reputation_answer_status after update of status,is_accepted or delete on public.answers for each row execute function private.reputation_content_changed();

create function private.reputation_answer_lock() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.questions where id=old.question_id for update;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger reputation_answer_lock before update of status,is_accepted or delete on public.answers for each row execute function private.reputation_answer_lock();

create function private.reputation_suspension_lock() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(case when tg_op='DELETE' then old.user_id::text else new.user_id::text end,772));
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger reputation_suspension_lock before insert or delete on private.community_suspensions for each row execute function private.reputation_suspension_lock();

create function private.reputation_suspension_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare member uuid := case when tg_op='DELETE' then old.user_id else new.user_id end; a private.reputation_awards;
begin
  for a in select * from private.reputation_awards where actor_id=member or beneficiary_id=member order by beneficiary_id,id loop
    perform private.reputation_sync(a.kind,a.target_id,a.actor_id,'Account moderation updated');
  end loop;
  return null;
end $$;
create trigger reputation_suspension_changed after insert or delete on private.community_suspensions for each row execute function private.reputation_suspension_changed();

-- Account deletion removes its identifying records and reverses votes it gave.
create function private.reputation_award_deleted() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.active and old.points>0 then
    update public.profiles set reputation=reputation-old.points where id=old.beneficiary_id;
    if found then insert into private.reputation_events(beneficiary_id,award_id,kind,delta,reason)
      values(old.beneficiary_id,old.id,old.kind,-old.points,'Award removed after account deletion'); end if;
  end if;
  return old;
end $$;
create trigger reputation_award_deleted before delete on private.reputation_awards for each row execute function private.reputation_award_deleted();

create function private.my_reputation(before_event bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid:=auth.uid(); result jsonb;
begin
  if me is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select jsonb_build_object('total',p.reputation,'events',coalesce((select jsonb_agg(e order by e.id desc) from
    (select id,kind,delta,reason,created_at from private.reputation_events where beneficiary_id=me
      and (before_event is null or id<before_event) order by id desc limit 21) e),'[]'::jsonb)) into result
    from public.profiles p where p.id=me;
  if result is null then raise exception 'Profile unavailable' using errcode='42501'; end if;
  return result;
end $$;
create function public.my_reputation(before_event bigint default null) returns jsonb
language sql security invoker set search_path='' as $$select private.my_reputation(before_event)$$;
revoke all on function private.reputation_sync(text,uuid,uuid,text),private.reputation_vote_guard(),private.reputation_vote_changed(),
  private.reputation_content_changed(),private.reputation_suspension_changed(),private.reputation_award_deleted(),
  private.reputation_answer_lock(),private.reputation_suspension_lock(),
  private.my_reputation(bigint),public.my_reputation(bigint) from public,anon,authenticated;
grant execute on function private.my_reputation(bigint),public.my_reputation(bigint) to authenticated;

-- Preserve the separately deployed member-report workflow and its owner check.
-- This later migration also retains automatic-screening provenance on fresh installs.
create or replace function private.community_moderation_queue() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not (private.community_is_moderator() or private.feedback_is_owner()) then raise exception 'Moderator access required'; end if;
  select coalesce(jsonb_agg(to_jsonb(item)),'[]'::jsonb) into result from (
    select r.id,r.target_kind,r.target_id,r.reason,r.details,r.source,r.created_at,
      case r.target_kind when 'question' then (select title || E'\n' || body from public.questions where id=r.target_id)
        when 'answer' then (select body from public.answers where id=r.target_id)
        when 'imported_answer' then (select body from public.imported_answers where id=r.target_id)
        when 'member' then (select 'u/' || username from public.profiles where id=r.target_id)
        when 'message' then (select body from public.direct_messages where id=r.target_id) end as content
    from public.community_reports r where status='pending' order by created_at,id limit 50
  ) item;
  return result;
end $$;
commit;

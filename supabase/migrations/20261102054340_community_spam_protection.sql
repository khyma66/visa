begin;
set local lock_timeout = '5s';

-- The existing designated owner must be able to act on reports. No client-editable
-- metadata or embedded email addresses are used to assign authority.
insert into private.community_moderators(user_id)
  select user_id from private.feedback_owner on conflict(user_id) do nothing;

-- These rules apply to public community contributions, not private inboxes.
-- Keep the existing consent, suspension, RLS and rate-limit guards intact.
create table private.community_spam_recent (
  user_id uuid not null references auth.users(id) on delete cascade,
  slot smallint not null check(slot between 0 and 31),
  target_kind text not null,
  target_id uuid not null,
  fingerprint text not null,
  has_link boolean not null,
  seen_at timestamptz not null default now(),
  primary key(user_id,slot)
);
alter table private.community_spam_recent enable row level security;
revoke all on private.community_spam_recent from public,anon,authenticated;
-- A bounded ring retains at most 32 fingerprints per author, never message bodies.
create table private.community_blocked_domains (
  domain text primary key check(domain = lower(domain) and domain ~ '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$'),
  reason text not null check(char_length(reason) between 5 and 300),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id)
);
alter table private.community_blocked_domains enable row level security;
revoke all on private.community_blocked_domains from public,anon,authenticated;

create index community_blocked_domains_operator_idx on private.community_blocked_domains(updated_by);
create table private.community_spam_domain_audit (
  id bigint generated always as identity primary key,
  domain text not null,
  action text not null check(action in ('block','unblock')),
  reason text not null,
  operator_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index community_spam_domain_audit_operator_idx on private.community_spam_domain_audit(operator_id);
alter table private.community_spam_domain_audit enable row level security;
revoke all on private.community_spam_domain_audit from public,anon,authenticated;

alter table public.community_reports add column source text not null default 'member'
  check(source in ('member','automatic'));
alter table public.community_reports add column reviewed_fingerprint text;

-- No network calls: submitted URLs never trigger fetches or disclose content to scanners.
create function private.community_spam_signals(content text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare normalized text := lower(translate(content,U&'\200B\200C\200D\2060\FEFF',''));
  link text; host text; reasons text[] := '{}'; blocked text; links integer := 0;
begin
  -- Also recognize pasted bare domains; leave deliberately defanged hxxps URLs alone.
  normalized := regexp_replace(normalized,'(^|[[:space:](])((?:[a-z0-9-]+\.)+[a-z]{2,63})(?=[:/[:space:]),.!?]|$)', '\1https://\2','g');
  for link in select m[1] from regexp_matches(normalized, '(?:https?://|www\.)[^\s<>"'']+', 'g') m loop
    links := links+1;
    host := regexp_replace(link,'^https?://','');
    host := split_part(split_part(split_part(host,'/',1),'?',1),'#',1);
    host := regexp_replace(host,'[.,;!)]*$','');
    if host ~ '@|%|\\' then blocked := 'This link hides its destination. Use a direct HTTPS link without login information or encoded host characters.'; end if;
    host := regexp_replace(host,':[0-9]+$','');
    host := rtrim(host,'.');
    if host ~ '(^|\.)(uscis\.gov|state\.gov|dhs\.gov|gov\.uk|canada\.ca|homeaffairs\.gov\.au)\.' then
      blocked := 'This link resembles an official website but leads to a different domain. Check the address. To discuss a scam, replace https:// with hxxps://.';
    end if;
    if exists(select 1 from private.community_blocked_domains d where host=d.domain or right(host,length(d.domain)+1)='.'||d.domain) then
      blocked := 'This website has been blocked after moderator review. Remove the link, or contact the community operator if this is a mistake.';
    end if;
    if host ~ '(^|\.)(bit\.ly|tinyurl\.com|t\.co|shorturl\.at|is\.gd|cutt\.ly|rb\.gy)$' then reasons := array_append(reasons,'shortened destination'); end if;
    if host ~ '(^|\.)xn--' or host ~ U&'[^\0001-\007F]' then reasons := array_append(reasons,'internationalized domain: verify the destination'); end if;
  end loop;
  if links >= 5 then reasons := array_append(reasons,'many links in one contribution'); end if;
  if normalized ~ '(guaranteed? (visa|approval)|100% (visa|approval)|visa (guaranteed|guarantee)|no rejection)'
    and normalized ~ '(whatsapp|telegram|dm me|contact me|pay|payment|deposit|send money)' then
    reasons := array_append(reasons,'visa guarantee combined with contact or payment solicitation');
  end if;
  if normalized ~ '(send|share|provide).{0,35}(otp|one.time password|recovery phrase|seed phrase)'
    and normalized ~ '(dm me|contact me|whatsapp|telegram|send me|payment|verify your)' then
    reasons := array_append(reasons,'possible credential solicitation');
  end if;
  select coalesce(array_agg(distinct value),'{}'::text[]) into reasons from unnest(reasons) value;
  return jsonb_build_object('blocked',blocked,'has_link',links>0,'reasons',to_jsonb(reasons));
end $$;

create function private.community_spam_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); content text; normalized text; content_fingerprint text;
  signals jsonb; kind text; next_slot smallint; duplicates integer; link_posts integer; new_member boolean;
begin
  if me is null then return new; end if; -- trusted archive maintenance
  content := case when tg_table_name='questions' then coalesce(to_jsonb(new)->>'title','')||E'\n' else '' end || new.body;
  if tg_op='UPDATE' and new.body is not distinct from old.body
    and (to_jsonb(new)->>'title') is not distinct from (to_jsonb(old)->>'title') then return new; end if;
  kind := case tg_table_name when 'questions' then 'question' when 'answers' then 'answer' else 'imported_answer' end;
  normalized := lower(regexp_replace(translate(new.body,U&'\200B\200C\200D\2060\FEFF',''),'\s+',' ','g'));
  content_fingerprint := md5(trim(normalized));
  signals := private.community_spam_signals(content);
  if signals->>'blocked' is not null then raise exception '%',signals->>'blocked' using errcode='P0001'; end if;
  -- Serialize a user's parallel submissions before checking the bounded history.
  perform pg_advisory_xact_lock(hashtextextended(me::text,771));
  select count(*) filter(where r.fingerprint=content_fingerprint), count(*) filter(where r.has_link)
    into duplicates,link_posts from private.community_spam_recent r
    where r.user_id=me and r.seen_at>now()-interval '10 minutes'
      and (r.target_kind<>kind or r.target_id<>new.id);
  if length(normalized)>=80 and duplicates >= 2 then
    raise exception 'You have recently posted this text several times. Add a relevant, original reply or wait before posting it again.';
  end if;
  select p.created_at>now()-interval '7 days' into new_member from public.profiles p where p.id=me;
  if (signals->>'has_link')::boolean and link_posts >= (case when coalesce(new_member,true) then 3 else 10 end) then
    raise exception 'You have shared several links in a short time. Please wait ten minutes before posting another link.';
  end if;
  -- Updating an existing contribution replaces its slot rather than creating history spam.
  select r.slot into next_slot from private.community_spam_recent r where r.user_id=me and r.target_kind=kind and r.target_id=new.id;
  if next_slot is null then
    select s::smallint into next_slot from generate_series(0,31) s
      where not exists(select 1 from private.community_spam_recent r where r.user_id=me and r.slot=s) order by s limit 1;
  end if;
  if next_slot is null then select r.slot into next_slot from private.community_spam_recent r where r.user_id=me order by r.seen_at,r.slot limit 1; end if;
  insert into private.community_spam_recent values(me,next_slot,kind,new.id,content_fingerprint,(signals->>'has_link')::boolean,now())
    on conflict(user_id,slot) do update set target_kind=excluded.target_kind,target_id=excluded.target_id,
      fingerprint=excluded.fingerprint,has_link=excluded.has_link,seen_at=excluded.seen_at;
  return new;
end $$;

create function private.community_spam_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); content text; signals jsonb; kind text; fingerprint text;
begin
  if me is null then return new; end if;
  content := case when tg_table_name='questions' then coalesce(to_jsonb(new)->>'title','')||E'\n' else '' end || new.body;
  signals := private.community_spam_signals(content);
  if jsonb_array_length(signals->'reasons')=0 then return new; end if;
  kind := case tg_table_name when 'questions' then 'question' when 'answers' then 'answer' else 'imported_answer' end;
  fingerprint := md5(lower(regexp_replace(content,'\s+',' ','g')));
  insert into public.community_reports as r(reporter_id,target_kind,target_id,reason,details,source,reviewed_fingerprint)
    values(me,kind,new.id,'scam','Automatic screening: '||(select string_agg(value,'; ') from jsonb_array_elements_text(signals->'reasons'))||'. Review context; this may be a legitimate warning or reference.','automatic',fingerprint)
    on conflict(reporter_id,target_kind,target_id) do update set details=excluded.details,status='pending',
      resolved_at=null,resolved_by=null,reviewed_fingerprint=excluded.reviewed_fingerprint
    where r.source='automatic' and r.reviewed_fingerprint is distinct from excluded.reviewed_fingerprint;
  return new;
end $$;

create trigger community_spam_question before insert or update of title,body on public.questions for each row execute function private.community_spam_guard();
create trigger community_spam_answer before insert or update of body on public.answers for each row execute function private.community_spam_guard();
create trigger community_spam_imported_answer before insert or update of body on public.imported_answers for each row execute function private.community_spam_guard();
create trigger community_spam_question_review after insert or update of title,body on public.questions for each row execute function private.community_spam_review();
create trigger community_spam_answer_review after insert or update of body on public.answers for each row execute function private.community_spam_review();
create trigger community_spam_imported_answer_review after insert or update of body on public.imported_answers for each row execute function private.community_spam_review();

create function private.community_spam_domains(action text,domain_name text,explanation text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare host text := lower(trim(domain_name)); result jsonb; previous_reason text;
begin
  if not private.community_is_moderator() then raise exception 'Moderator access required' using errcode='42501'; end if;
  if action='block' then
    if host !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' or length(host)>253
      or host in ('gov.uk','com.au','co.uk','org.uk','co.in','com','org','net','gov') then raise exception 'Enter a full website domain, without a path or scheme.'; end if;
    insert into private.community_blocked_domains values(host,explanation,now(),auth.uid())
      on conflict(domain) do update set reason=excluded.reason,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
    insert into private.community_spam_domain_audit(domain,action,reason,operator_id) values(host,action,explanation,auth.uid());
  elsif action='unblock' then
    delete from private.community_blocked_domains where domain=host returning reason into previous_reason;
    if found then insert into private.community_spam_domain_audit(domain,action,reason,operator_id) values(host,action,previous_reason,auth.uid()); end if;
  elsif action<>'list' or action is null then raise exception 'Invalid action'; end if;
  select coalesce(jsonb_agg(to_jsonb(d) - 'updated_by'),'[]'::jsonb) into result from private.community_blocked_domains d;
  return result;
end $$;
create function public.community_spam_domains(action text default 'list',domain_name text default '',explanation text default '') returns jsonb
language sql security invoker set search_path = '' as $$ select private.community_spam_domains(action,domain_name,explanation); $$;

-- Preserve the established queue, including its message privacy boundary.
create or replace function private.community_moderation_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.community_is_moderator() then raise exception 'Moderator access required'; end if;
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
revoke all on function private.community_spam_signals(text),private.community_spam_guard(),private.community_spam_review(),
  private.community_spam_domains(text,text,text),public.community_spam_domains(text,text,text) from public,anon,authenticated;
grant execute on function private.community_spam_domains(text,text,text),public.community_spam_domains(text,text,text) to authenticated;
commit;

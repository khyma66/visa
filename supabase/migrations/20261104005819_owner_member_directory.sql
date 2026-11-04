begin;
set local lock_timeout = '5s';

-- Account data stays in auth; never copy email into public profiles or views.
create table private.member_access_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('view','export')),
  row_count integer not null check (row_count between 0 and 50),
  created_at timestamptz not null default now()
);
alter table private.member_access_events enable row level security;
create index member_access_events_created_at_idx on private.member_access_events(created_at);
revoke all on private.member_access_events from public,anon,authenticated,service_role;
revoke all on sequence private.member_access_events_id_seq from public,anon,authenticated,service_role;

create function private.owner_members(search_text text,account_filter text,joined_days integer,before_created_at timestamptz,before_id uuid,export_page boolean) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare me uuid; result jsonb; needle text := lower(btrim(search_text));
begin
  me := private.launch_assert_owner();
  if search_text is null or char_length(search_text)>200 or account_filter is null
    or account_filter not in ('all','verified','unverified','suspended')
    or joined_days is null or joined_days not in (0,7,30,90) or export_page is null
    or (before_created_at is null)<>(before_id is null)
  then raise exception 'Invalid member filters' using errcode='22023'; end if;
  perform set_config('response.headers','[{"Cache-Control":"private, no-store"},{"X-Robots-Tag":"noindex, nofollow"}]',true);
  -- Rolling audit retention, containing no emails, search terms or session IDs.
  delete from private.member_access_events where created_at < now()-interval '90 days';
  with accounts as materialized (
    select u.id,u.email,p.username,u.created_at,u.last_sign_in_at,
      u.email_confirmed_at is not null as email_verified,
      (coalesce(u.banned_until>now(),false) or exists(select 1 from private.community_suspensions s where s.user_id=u.id)) as suspended,
      exists(select 1 from private.feedback_owner o where o.user_id=u.id) as is_owner
    from auth.users u left join public.profiles p on p.id=u.id
    where u.deleted_at is null and not coalesce(u.is_anonymous,false)
  ), matched as materialized (
    select * from accounts a where
      (needle='' or strpos(lower(coalesce(a.email,'')),needle)>0 or strpos(lower(coalesce(a.username,'')),needle)>0)
      and (joined_days=0 or a.created_at>=now()-make_interval(days=>joined_days))
      and (account_filter='all' or (account_filter='verified' and a.email_verified)
        or (account_filter='unverified' and not a.email_verified) or (account_filter='suspended' and a.suspended))
  ), window_rows as materialized (
    select * from matched where before_created_at is null or (created_at,id)<(before_created_at,before_id)
    order by created_at desc,id desc limit 51
  ), page as materialized (
    select * from window_rows order by created_at desc,id desc limit 50
  ), rows as (
    select p.*,
      (select count(*) from public.questions q where q.author_id=p.id and q.status<>'archived' and q.post_kind='question') as questions,
      (select count(*) from public.questions q where q.author_id=p.id and q.status<>'archived' and q.post_kind='experience') as experiences,
      (select count(*) from public.answers a where a.author_id=p.id and a.status='active')+
      (select count(*) from public.imported_answers a where a.author_id=p.id and a.status='active') as replies
    from page p
  ) select jsonb_build_object('generated_at',now(),'matched',(select count(*) from matched),
    'total',(select count(*) from accounts),'verified',(select count(*) from accounts where email_verified),
    'joined_7_days',(select count(*) from accounts where created_at>=now()-interval '7 days'),
    'items',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc) from rows r),'[]'::jsonb),
    'next_cursor',case when (select count(*) from window_rows)>50 then
      (select jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1) else null end)
  into result;
  insert into private.member_access_events(actor_id,action,row_count)
    values(me,case when export_page then 'export' else 'view' end,jsonb_array_length(result->'items'));
  return result;
end $$;
create function public.owner_members(search_text text default '',account_filter text default 'all',joined_days integer default 0,before_created_at timestamptz default null,before_id uuid default null,export_page boolean default false) returns jsonb
language sql security invoker set search_path='' as $$
  select private.owner_members(search_text,account_filter,joined_days,before_created_at,before_id,export_page);
$$;
revoke all on function private.owner_members(text,text,integer,timestamptz,uuid,boolean),public.owner_members(text,text,integer,timestamptz,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function private.owner_members(text,text,integer,timestamptz,uuid,boolean),public.owner_members(text,text,integer,timestamptz,uuid,boolean) to authenticated;
commit;

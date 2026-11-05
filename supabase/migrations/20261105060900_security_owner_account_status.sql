begin;
set local lock_timeout='5s';

-- Auth bans can outlive an already-issued access token. Recheck account state
-- as well as the owner assignment and live session on every evidence operation.
create or replace function private.security_require_owner() returns void
language plpgsql stable security definer set search_path='' as $$
declare session_id text:=auth.jwt()->>'session_id';
begin
  if private.feedback_is_owner() is not true or session_id is null or not exists(
    select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id::text=session_id and s.user_id=auth.uid()
      and (s.not_after is null or s.not_after>now())
      and u.deleted_at is null and u.is_anonymous is not true
      and (u.banned_until is null or u.banned_until<=now())
  ) then raise exception 'A current owner session is required' using errcode='42501'; end if;
end $$;
revoke all on function private.security_require_owner() from public,anon,authenticated,service_role;
commit;

begin;
set local lock_timeout = '5s';

-- Stable cursor ordering gives every participant access to their full inbox.
create index if not exists conversations_user_one_page_idx
  on public.direct_conversations(user_one_id, last_message_at desc, id desc);
create index if not exists conversations_user_two_page_idx
  on public.direct_conversations(user_two_id, last_message_at desc, id desc);
create function public.conversation_page(before_time timestamptz default null, before_id uuid default null)
returns setof public.conversation_inbox language sql stable security invoker set search_path = '' as $$
  select * from public.conversation_inbox
  where before_time is null or (last_message_at,id) < (before_time,before_id)
  order by last_message_at desc,id desc limit 50;
$$;
revoke all on function public.conversation_page(timestamptz,uuid) from public,anon;
grant execute on function public.conversation_page(timestamptz,uuid) to authenticated;

-- Only displayed, received messages get a server-generated read timestamp.
-- This invoker function still relies on the participant RLS and column grant.
create function public.mark_direct_messages_read(target_conversation uuid, message_ids uuid[])
returns void language sql security invoker set search_path = '' as $$
  update public.direct_messages set read_at=now()
  where conversation_id=target_conversation and id=any(message_ids[1:50])
    and sender_id<>(select auth.uid()) and read_at is null;
$$;
revoke all on function public.mark_direct_messages_read(uuid,uuid[]) from public,anon;
grant execute on function public.mark_direct_messages_read(uuid,uuid[]) to authenticated;

-- Moderator redaction must invalidate open chats and inbox previews too.
drop trigger if exists message_read_broadcast on public.direct_messages;
create trigger message_change_broadcast after update of read_at,body on public.direct_messages
  for each row when (old.read_at is distinct from new.read_at or old.body is distinct from new.body)
  execute function private.broadcast_chat();

commit;

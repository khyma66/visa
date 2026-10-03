begin;

-- Scoped to the new community API only. Legacy access changes require a
-- separate review; no restored legacy table grants or policies are changed.

create function private.accept_community_answer(target_answer_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); target_question uuid;
begin
  if me is null then raise exception 'Authentication required'; end if;
  select q.id into target_question from public.questions q join public.answers a on a.question_id=q.id
    where a.id=target_answer_id and a.status='active' and q.author_id=me for update of q;
  if target_question is null then raise exception 'Only the question author can accept an answer'; end if;
  update public.answers a set is_accepted=false where a.question_id=target_question and a.is_accepted;
  update public.answers set is_accepted=true where id=target_answer_id;
  update public.questions set accepted_answer_id=target_answer_id where id=target_question;
end $$;
create or replace function public.accept_answer(target_answer_id uuid) returns void
language sql security invoker set search_path = '' as $$ select private.accept_community_answer(target_answer_id); $$;
revoke all on function private.accept_community_answer(uuid),public.accept_answer(uuid) from public,anon;
grant execute on function private.accept_community_answer(uuid),public.accept_answer(uuid) to authenticated;
-- Supabase default privileges can grant anon EXECUTE explicitly, independently of PUBLIC.
revoke execute on function public.start_direct_conversation(text), public.respond_to_conversation(uuid,text),
  public.send_direct_message(uuid,text,uuid),public.message_page(uuid,timestamptz,uuid) from anon;

create or replace function private.random_username() returns text
language plpgsql volatile set search_path = '' as $$
declare
  adjectives constant text[] := array['brave','calm','clever','cosmic','gentle','hidden','kind','lucky','quiet','swift','warm','wise'];
  nouns constant text[] := array['badger','comet','falcon','fox','heron','lotus','otter','panda','raven','tiger','willow','yak'];
  candidate text;
begin
  loop
    candidate := adjectives[1+floor(random()*cardinality(adjectives))::integer] || '-'
      || nouns[1+floor(random()*cardinality(nouns))::integer] || '-'
      || substr(replace(gen_random_uuid()::text,'-',''),1,10);
    exit when not exists(select 1 from public.profiles where username=candidate);
  end loop;
  return candidate;
end $$;
revoke execute on function private.random_username() from public,anon,authenticated;

commit;

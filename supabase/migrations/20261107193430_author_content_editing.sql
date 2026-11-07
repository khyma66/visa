begin;
set local lock_timeout='5s';
-- Activity timestamps also change on votes/counts. Keep content edits separate.
alter table public.questions add column edited_at timestamptz;
alter table public.answers add column edited_at timestamptz;
alter table public.imported_answers add column edited_at timestamptz;
create function private.stamp_content_edit() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then new.edited_at:=null;
  elsif new.body is distinct from old.body or (tg_table_name='questions' and to_jsonb(new)->>'title' is distinct from to_jsonb(old)->>'title') then
    new.edited_at:=clock_timestamp();
  else new.edited_at:=old.edited_at;
  end if;
  return new;
end $$;
create trigger questions_content_edit before insert or update on public.questions for each row execute function private.stamp_content_edit();
create trigger answers_content_edit before insert or update on public.answers for each row execute function private.stamp_content_edit();
create trigger imported_answers_content_edit before insert or update on public.imported_answers for each row execute function private.stamp_content_edit();
revoke all on function private.stamp_content_edit() from public,anon,authenticated;
-- Append metadata without losing columns or visibility rules from earlier migrations.
do $$ declare item record; definition text; begin
 for item in select * from (values ('question_feed','questions'),('answer_feed','answers'),('imported_answer_feed','imported_answers')) as v(view_name,table_name) loop
  definition:=rtrim(pg_get_viewdef(('public.'||item.view_name)::regclass,true), E';\n ');
  execute format('create or replace view public.%I with(security_invoker=true) as select prior.*, content.edited_at from (%s) prior join public.%I content on content.id=prior.id',item.view_name,definition,item.table_name);
 end loop;
end $$;
-- Narrow, author-only operations. Deletion uses the existing moderation archive
-- path so counts, reputation, visibility and realtime stay consistent.
create function private.manage_own_content(kind text,target uuid,operation text,new_body text,new_title text,expected_body text,expected_title text,expected_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare me uuid:=private.library_member(); row_data record; parent uuid; table_name text;
begin
 if me is distinct from expected_user then raise exception 'Account changed. Sign in again.' using errcode='42501'; end if;
 if kind is null or kind not in ('question','answer','imported_answer') or operation is null or operation not in ('edit','delete') then raise exception 'Invalid content action' using errcode='22023'; end if;
 perform private.community_consume('manage-content',60,600);
 table_name:=case kind when 'question' then 'questions' when 'answer' then 'answers' else 'imported_answers' end;
 -- Match the existing parent-before-answer lock order used by reputation.
 if kind='answer' then
  select question_id into parent from public.answers where id=target;
  perform 1 from public.questions where id=parent for update;
 end if;
 execute format('select id,author_id,body,status,to_jsonb(t)->>''title'' as title from public.%I t where id=$1 for update',table_name) into row_data using target;
 if row_data.id is null or row_data.author_id is distinct from me or row_data.status='archived' then raise exception 'Content unavailable or not yours.' using errcode='42501'; end if;
 if kind='question' and not private.library_post_visible(target::text) then raise exception 'Post unavailable' using errcode='42501'; end if;
 if kind='answer' and not private.library_post_visible(parent::text) then raise exception 'Post unavailable' using errcode='42501'; end if;
 if row_data.body is distinct from expected_body or (kind='question' and row_data.title is distinct from expected_title) then raise exception 'This content changed. Reload before trying again.' using errcode='40001'; end if;
 if operation='edit' then
  if (kind='question' and row_data.status<>'open') or (kind='answer' and not exists(select 1 from public.questions where id=parent and status='open')) then raise exception 'This discussion is closed to edits.' using errcode='42501'; end if;
  if new_body is null or length(trim(new_body)) not between 20 and 10000 then raise exception 'Use between 20 and 10,000 characters.' using errcode='22023'; end if;
  if kind='question' then
   if length(trim(new_body))<30 then raise exception 'Use at least 30 characters.' using errcode='22023'; end if;
   if new_title is null or length(trim(new_title)) not between 15 and 180 then raise exception 'Use a title between 15 and 180 characters.' using errcode='22023'; end if;
   update public.questions set title=trim(new_title),body=trim(new_body) where id=target;
  else execute format('update public.%I set body=trim($1) where id=$2',table_name) using new_body,target;
  end if;
 else
  if kind='answer' then
   update public.answers set status='archived',is_accepted=false where id=target;
   update public.questions set accepted_answer_id=null where id=parent and accepted_answer_id=target;
  else execute format('update public.%I set status=''archived'' where id=$1',table_name) using target;
  end if;
 end if;
end $$;
create function public.manage_own_content(kind text,target uuid,operation text,new_body text,new_title text,expected_body text,expected_title text,expected_user uuid) returns void
language sql security invoker set search_path='' as $$ select private.manage_own_content(kind,target,operation,new_body,new_title,expected_body,expected_title,expected_user); $$;
revoke all on function private.manage_own_content(text,uuid,text,text,text,text,text,uuid),public.manage_own_content(text,uuid,text,text,text,text,text,uuid) from public,anon;
grant execute on function private.manage_own_content(text,uuid,text,text,text,text,text,uuid),public.manage_own_content(text,uuid,text,text,text,text,text,uuid) to authenticated;
commit;

begin;
set local lock_timeout = '5s';

-- Older Supabase default grants left these relations table-wide writable even
-- after the original column-level INSERT grant. RLS limits authorship, but does
-- not prevent an author from forging score, accepted status or timestamps.
-- Preserve all rows, existing RLS, triggers and service_role access.
revoke all privileges on table public.imported_answers, public.imported_answer_feed
  from public, anon, authenticated;

-- Table-level REVOKE does not remove separately granted column privileges.
-- Resolve columns only on these two exact relations; do not change other tables.
do $$
declare target regclass; columns text;
begin
  foreach target in array array['public.imported_answers'::regclass,'public.imported_answer_feed'::regclass] loop
    select string_agg(format('%I',attname),',' order by attnum) into columns
      from pg_attribute where attrelid=target and attnum>0 and not attisdropped;
    execute format('revoke all privileges (%s) on table %s from public,anon,authenticated',columns,target);
  end loop;
end $$;

grant select on table public.imported_answers, public.imported_answer_feed to anon, authenticated;
grant insert (question_id,author_id,body) on table public.imported_answers to authenticated;

commit;

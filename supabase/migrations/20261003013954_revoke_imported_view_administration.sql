begin;
set local lock_timeout = '5s';
-- The earlier table-only grant cleanup intentionally skipped views.
-- Preserve row-operation grants and service_role, removing administrative ACLs.
revoke truncate, references, trigger on public.imported_answer_feed
  from public, anon, authenticated;
commit;

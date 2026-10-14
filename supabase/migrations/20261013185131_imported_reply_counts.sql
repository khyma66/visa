begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Match the reply page exactly: active rows, visible through the caller's
-- existing RLS and profile join. No reply bodies or private identities are added.
create view public.imported_reply_counts with (security_invoker = true) as
  select question_id, count(*)::bigint as answer_count
  from public.imported_answer_feed
  group by question_id;

revoke all on public.imported_reply_counts from public, anon, authenticated;
grant select on public.imported_reply_counts to anon, authenticated, service_role;
comment on view public.imported_reply_counts is
  'Exact visible VisaThreads reply counts for archive threads; source-platform comments are counted separately.';
commit;

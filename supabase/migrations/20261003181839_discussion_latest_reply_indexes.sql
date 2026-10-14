begin;
set local lock_timeout = '5s';

-- Related-question context reads the newest replies independently of answer rank.
create index answers_latest_context_idx on public.answers(question_id,created_at desc,id desc)
  where status='active';
create index imported_answers_latest_context_idx on public.imported_answers(question_id,created_at desc,id desc)
  where status='active';

commit;

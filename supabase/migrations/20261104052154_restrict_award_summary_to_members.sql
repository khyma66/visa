begin;
-- The private schema is intentionally not accessible to anonymous clients.
-- Sign-in is required for both the award summary and the write operation.
revoke execute on function public.post_award_summary(text),private.post_award_summary(text) from anon,public;
commit;

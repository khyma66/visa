-- Make every exposed view evaluate access with the caller's permissions so
-- row-level policies on the underlying tables remain authoritative.
alter view public.question_feed set (security_invoker = true);
alter view public.answer_feed set (security_invoker = true);
alter view public.conversation_inbox set (security_invoker = true);

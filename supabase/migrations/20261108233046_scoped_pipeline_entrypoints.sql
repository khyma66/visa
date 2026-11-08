-- Keep private schema inaccessible to anonymous roles. These narrow entrypoints
-- forward to token-checking private functions, with no dynamic SQL or general grants.
alter function public.archive_ingest_batch(text,jsonb,jsonb) security definer;
alter function public.capacity_probe(text) security definer;
revoke all on function public.archive_ingest_batch(text,jsonb,jsonb),public.capacity_probe(text) from public;
grant execute on function public.archive_ingest_batch(text,jsonb,jsonb),public.capacity_probe(text) to anon,authenticated;

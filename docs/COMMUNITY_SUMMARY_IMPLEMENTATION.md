# Community interval summaries

The summary endpoint is GET or POST at /api/communities/:id/summary?hours=6|12|24|72.

The endpoint rounds the cutoff down to the UTC hour, filters the community's
authorized questions and replies, and stores one artifact per community,
interval, cutoff and source fingerprint. Public communities can be read
without logging in. Private communities require an active membership on every
request.

Generation uses two grounded calls:

1. Granite 4.0 H Micro extracts claims, disagreements and unresolved points.
2. Qwen3 30B A3B FP8 writes the final summary from those extracts.

Every key point and disagreement must cite a source ID. Unsupported or
malformed output is rejected and is never saved.

Configure these as server-only deployment secrets:

- SUPABASE_SERVICE_ROLE_KEY
- CF_ACCOUNT_ID
- CF_API_TOKEN with permission to run Workers AI

Apply supabase/migrations/20261006053000_community_summary_artifacts.sql
after the community lifecycle migrations. The service-role key is never sent
to the browser. Summary artifacts are not exposed through the Supabase Data
API; the route performs the membership check before reading them.

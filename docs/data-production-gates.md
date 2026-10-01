# Post publication gates — 1 October 2026 UTC

No posts were copied, deleted, reassigned or published during this work.

## Confirmed inventory

The connected `visa` project, `cycnichledvqbxevrwnt`, has 500 imported posts. All 500 have `group_id = NULL`. It has zero comments, zero questions, zero answers, zero communities and one group. Latest post update: 2026-10-01 02:11:13.893 UTC (30 September, 9:11 PM America/Chicago). Latest created timestamp: 2026-02-11 08:12:03.07 UTC. Neither timestamp establishes a successful new ingestion run.

Only one VisaFlow database was identified among accessible projects. No separate source/target pair for a production copy was verified. Copying these records back into the same database would not make the product production-ready and could duplicate records.

The repository-linked Pages deployment `https://be366747.visa-1.pages.dev` serves the old advertisement/information landing page. It does not identify the September application whose login screen was referenced. Cloudflare CLI authentication is unavailable in this environment.

## Required before a data move

1. Identify the actual deployed application and exact source/target project refs. Confirm whether the 500 records are already in the target.
2. Rotate exposed service and storage credentials; close exposed database row-access paths. Do not use credentials from Git history.
3. Recover the current importer and application source. The old importer can acknowledge a source key after failed upserts; repair and test retries before trusting it.
4. Decide public eligibility and provenance for each imported record. Preserve source IDs, attribution and timestamps; do not convert imported content into fabricated user questions or answers.
5. Create a backup and verified restore point. Use a deterministic source-ID uniqueness key and idempotent upsert. Preserve relationships; explicitly map groups instead of treating every record as a USA-community post.
6. Dry-run the mapping, rejected-record list and counts. Apply once to the verified target, then compare source/target ID sets, normalized payload hashes and relationship counts. Rerunning must add zero duplicates.
7. Record source cursor, started/completed timestamps, success/failure, inserted/updated/rejected counts and errors in an ingestion-run ledger; then test the actual production feed and access rules.

`supabase/checks/post_inventory.sql` is a read-only starting point. It is not a migration or an import command.

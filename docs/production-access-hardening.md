# VISAFLOW access hardening — 28 September 2026

This branch contains staged database fixes, not a production deployment. It is based on the accessible January `main` branch, but the two community tables, policies and grants were checked against the live September database (`cycnichledvqbxevrwnt`). The current September frontend/backend source is still unidentified. Do not treat this branch as that application.

## Implemented

- Only active public communities are anonymously discoverable. Active members can read their active private community; inactive memberships no longer grant access.
- Self-join requires the caller's own user ID, an active public community, ordinary `member` role and active membership. Privileged self-assignment, private joins and client role changes are rejected.
- Membership SELECT remains limited to the caller. Server-owned invitations and role assignment retain their existing service-role access.
- Client `TRUNCATE`, `TRIGGER`, and `REFERENCES` privileges are revoked across existing public tables, including legacy tables. This does not fix legacy row-level exposure or future default grants.
- A read-only catalog check reports remaining exposed tables, administrative grants and missing question/community linkage.

The membership lookup uses a private, fixed-search-path **SECURITY INVOKER** PL/pgSQL function. It runs a separate membership SELECT under the caller's RLS to avoid the policy rewrite cycle encountered with inline subqueries on `INSERT ... RETURNING`. It does not bypass RLS. The migration aborts on unexpected community policies instead of combining with unreviewed permissive policies.

## Validation

Run `npm ci --ignore-scripts --prefix tests/database`, then `npm test --prefix tests/database`.

The test fixture reproduces affected live columns, grants, and original policies. PGlite executes PostgreSQL RLS and actual role changes locally. Tests cover both allowed operations and rejected operations, inactive/private membership visibility, service-role preservation, policy drift, and remaining blockers. This is not a hosted Supabase, JWT validation, browser, or complete migration-chain test. CI runs this suite independently of the existing broken application workflow.

## Deployment gates

1. Identify the deployed September repository/branch and reconcile its seven September migrations. Do not blindly run the January migration chain against production.
2. Restore the actual schema into an isolated staging database; verify all policies, grants, triggers, functions and application dependencies. No Supabase development branch existed during this inspection. No paid branch was created.
3. Apply these two new migrations to staging in order. Run the regression suite plus real authenticated and anonymous API calls, including `INSERT ... RETURNING`, invitations, private community discovery, and imported feed compatibility.
4. Run `supabase/checks/production_blockers.sql` and Supabase advisors. The check is read-only and reports remaining defects; it must not be interpreted as a full security certification.
5. Resolve the remaining launch blockers below, validate backups/restore and deploy with monitored rollback. The migration lock timeout is five seconds; investigate contention rather than retrying blindly. Do not roll back by reinstating anonymous table-administration access.

## Remaining blockers

| Blocker | Next concrete dependency/action |
|---|---|
| 15 public tables have RLS disabled | Define and test table-specific read/write ownership using the deployed application. Imported posts/comments and private group messages cannot safely share one permissive policy. Table-administration revocation does not close SELECT/INSERT/UPDATE/DELETE exposure. |
| September application source/deployment missing | Provide/connect the deployed project or repository; then test and integrate this patch there. |
| Thousands of scoped Q&A communities incomplete | `questions` lacks `community_id`. Add/backfill it and enforce community permissions in feeds, search, answers, voting and moderation together. Preserve Q&A format and canonical tags. A column alone is not sufficient. |
| Latest ingestion not auditable | Add an ingestion-run ledger to the actual deployed importer, with status, counts, cursor, completion time and last successful watermark. Do not label post `updated_at` as ingestion success. |
| Other advisor findings | Review four mutable-search-path functions, seven missing FK indexes, per-row auth checks, and leaked-password protection. Preserve intentionally private no-policy tables. |
| Production readiness unverified | Staging E2E, workload-specific load tests, deployment provenance, monitoring and restore checks remain outstanding. |

## Documentation checked

- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes
- https://pglite.dev/docs/

No live data, production grants, or production policies were changed by this work.

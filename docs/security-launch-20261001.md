# VISAFLOW security review — 2026-10-01 UTC

Scope: the accessible `khyma66/visa` repository, on the October auth/launch branch.
The September application source and the currently deployed runtime have not been
identified. These are code findings, not claims that the same routes are deployed.
No production database writes or content migration were performed in this review.

## Changes made

- Removed credential literals from `docs/REQUIRED_CREDENTIALS.md`; `.env.example`
  was sanitized in the same launch work. Added a metadata-only secret check and
  regression tests. The check reports file, line, and credential type only.
- Disabled public R2 upload, deletion, and fetch proxies; arbitrary cache reads;
  and clustering queue forwarding. Each returns HTTP 503 with a clear unavailable
  message and `Cache-Control: no-store`. None reads incoming payloads or forwards
  a request with a privileged credential.

The disabled endpoints require authenticated ownership/visibility checks, bounded
payloads, and verified integration before they can safely return to service.

## Blocking findings

| Finding | Evidence | Release gate |
| --- | --- | --- |
| Previously committed privileged credentials | Former `.env.example` and `docs/REQUIRED_CREDENTIALS.md` contained a Supabase service-role JWT and R2 credentials | Revoke/replace exposed credentials, update legitimate consumers, verify old credentials no longer work; deletion from HEAD alone is insufficient |
| Server source is incomplete | Several active Next API routes import missing `src/lib/supabase`, `post-service`, `cluster-service`, or `search-service` | Recover intended implementation and pass full build and endpoint tests |
| Client-controlled like identity | `src/app/api/likes/{post,comment}/route.ts` trusts supplied `userId`; no route authentication | Derive actor from verified session and test user A cannot write or inspect user B's private actions |
| Anonymous post submission | `src/app/api/posts/route.ts` accepts a body and calls storage without route authentication | Verified session, content validation, permission checks, and abuse limits |
| Backend writes use a test identity | `backend/src/main.py` creates posts and comments with the zero UUID through its privileged Supabase client | Use verified actor identity and enforce target group access; test cross-group denial |
| Profile overexposure | `backend/src/main.py` selects all profile columns by arbitrary user ID; `endpoints/users.py` returns email in other users' profiles/search | Explicit public-field projection; test email and subscription/internal fields absent |
| Community chat lacks target access checks | `endpoints/chat.py` and `services/chat_service.py` query/write supplied community IDs without membership validation | Test public, private, inactive-member, and blocked-user cases at the actual service boundary |
| Backend is internally inconsistent | Main Settings validation references missing `supabase_service_role_key`; dependencies have missing imports/schema modules; Worker imports nonexistent `save_to_supabase` | Choose active runtime and pass startup plus integration tests |

The earlier live audit also reported legacy public tables without RLS and
questions without community linkage. Re-run `supabase/checks/production_blockers.sql`
and Supabase advisors against the intended target after schema reconciliation;
local tests cannot establish production permissions.

## Why the old importer cannot move everything safely

`backend/src/supabase_client.py` prints errors for failed post/comment HTTP writes
but does not fail the batch. `backend/src/worker.py` then marks the R2 key processed
and logs success. Its exception handler does not explicitly retry or rethrow.
Consequently failed imports can be recorded as successful.

`backend/src/index.py` exposes queue triggering, upload, and AI calls without
authentication in the checked-in code. It is also incomplete and must not be
deployed as an importer merely because credentials can be supplied.

Before a production content move:

1. Identify source and destination projects, storage objects, and all content
   tables. Record counts and stable IDs; separate public imported posts from
   private/member content and record moderation status.
2. Rehearse against an isolated restored target. Preserve IDs, parent-child
   relationships, provenance, timestamps, visibility, and attachments. Never
   replay `supabase_migrations/CLEANUP.sql`, which drops content tables.
3. Make every failed write fail the batch; retry safely using stable source IDs.
   Mark success only after verified writes. Record run ID, counts, and errors in
   an ingestion ledger, without raw private content or credentials in logs.
4. Prove repeat runs create no duplicates and forced partial failures remain
   retryable. Reconcile counts and orphan checks before enabling public reads.
5. Verify the production application against that target: anonymous read limits,
   verified sign-up/login, per-user writes, cross-user/private-group denial, and
   recovery/logout. Release only after the full application build and smoke tests
   pass; passing the focused hardening tests alone is insufficient.

## Focused verification

```sh
node scripts/check-secrets.mjs
node --test tests/security/*.test.mjs
```

The security tests run on Node 24, which can import these TypeScript route files.
They verify fail-closed responses, no outbound calls or input parsing, no secret
disclosure, and metadata-only scanner results. They do not test live credentials,
deployed routes, or database policies. The scanner is deliberately targeted and
does not scan Git history or prove all secret formats are absent.

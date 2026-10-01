# VISAFLOW: PR-to-production runbook

Verified 1 October 2026 UTC / 30 September 2026 America/Chicago. This is an ordered completion plan, not a record that production has been released.

## Current status

| Item | Verified state |
|---|---|
| PR #1 — database access | Open draft, targets `main`; database CI passes, legacy CI fails |
| PR #2 — auth and launch security | Open draft, targets PR #1's branch; auth/security and database CI pass, production build fails |
| Local validation | 35 auth + 11 security + 42 database tests pass; scoped auth typecheck and four auth-page HTTP checks pass |
| Hosted auth | Apple disabled, Google disabled, email enabled with email confirmation; real email/OAuth/CAPTCHA flows untested |
| Connected data | 500 imported posts, all without a group; zero comments, questions, answers and communities |
| Production | No code deployment, schema migration or data copy performed |

PR links: https://github.com/khyma66/visa/pull/1 and https://github.com/khyma66/visa/pull/2.

Only #1 and #2 exist. The additional PR names below are planned work, not created PR numbers. Account owner means the person authorized to operate the project's accounts; engineering means work Codex can carry out once the correct source and access are available.

## 0. Confirm the actual project and contain exposed credentials

Owner: account owner + engineering. This work starts immediately, before merging.

1. Open the current app you intend to launch and record its URL. In Cloudflare Workers & Pages, identify its project, connected repository, deployment branch, last deployment commit and environment. Compare this with `khyma66/visa`. The known `be366747.visa-1.pages.dev` serves the old information/advertising page; it is not evidence that the newer app is recovered.
2. Provide project/repository access through the connected account or normal authenticated tooling. Do not paste secret values into chat or Git.
3. Record separate staging and production project refs, storage buckets, queue names and deployment names. If there is no separate production data destination, do not invent a copy operation.
4. Review which deployments and jobs use the exposed Supabase and R2 credentials. Disable unsafe consumers or public writes during containment. If abuse is suspected, revoke first and accept controlled downtime rather than extending exposure.
5. Supabase project Settings > API Keys: create the appropriate new server-only secret key, migrate compatible trusted consumers and confirm they work. Use a publishable key in the frontend. Then explicitly deactivate the exposed legacy keys and verify they fail a harmless read-only probe. Creating a new secret key does not revoke the old `service_role` JWT. Coordinate any legacy `anon` consumers affected by deactivation. JWT signing-key rotation is a separate decision with session implications, not a substitute chosen blindly.
6. Cloudflare R2 > Account Details > Manage API Tokens: create replacement credentials with only the required object permissions and bucket scope, update legitimate consumers, test them, then revoke the token corresponding to the exposed access-key ID. Verify the old credentials are rejected.
7. Record rotation completion using key IDs/names and timestamps, never key values. Scan current source and artifacts. Review logs for unexplained access. A Git-history cleanup, if needed, is separate coordinated work; it does not replace revocation.

Done when: the current deployment/source is identified; new credentials work only in intended components; old exposed credentials fail; staging/production destinations are recorded.

New Supabase secret keys are not JWTs. Check Edge Function and custom gateway compatibility during migration; never disable JWT verification without replacing it with tested caller authentication and authorization.

## 1. New PR: `fix/runtime-and-release-pipeline`

Owner: engineering. Base: current confirmed `main`.

1. Recover the actual implementations of `src/lib/supabase`, `post-service`, `search-service` and `cluster-service` from the correct source. Do not add success-returning stubs or disable TypeScript checks.
2. Reconcile the seven September database migrations into version control and choose the actual backend runtime. Resolve its startup/import/settings failures.
3. Fix the legacy CI paths: it references a nonexistent `frontend/` directory and scripts. Run the real application build, tests and backend checks.
4. Replace placeholder deployment and health-check echo commands with real commands. Remove automatic production `alembic upgrade head` on ordinary `main` merges. Production migrations and deployment must be a separate explicitly triggered release job targeting the protected production environment.
5. Keep staging deployment independent of production-only prerequisites. Configure the actual full-stack Cloudflare target and a compatible, tested Next.js adapter; uploading `.next/static` alone does not deploy this application's server routes.
6. Require applicable passing checks before merge. Configure production deployment protection using available repository-plan features; do not assume a required-reviewer gate exists until verified.

Done when: a clean checkout installs, starts and builds; real endpoint tests pass; all required CI passes; merging a PR cannot unexpectedly modify the production database.

Merge this prerequisite PR first. If current-source recovery changes the architecture, port #1/#2 onto that source and rerun their tests rather than treating the January checkout as authoritative.

## 2. Complete existing PR #1: database access hardening

1. Update `fix/visaflow-community-access-20260928` from the repaired `main` and review the resulting diff.
2. Provision an isolated local/staging database. Reproduce the actual current schema; do not replay the old January migration chain or `CLEANUP.sql` against production.
3. Apply the two new migrations in timestamp order to staging: community membership/access hardening, then client table-administration revocation.
4. Run the database suite and real API tests: anonymous discovery excludes private communities; public self-join succeeds as an ordinary member; self-assigned moderator/admin roles fail; inactive members lose private access; server-owned invitations still work.
5. Run Supabase advisors and `supabase/checks/production_blockers.sql`. Record remaining unrelated legacy findings explicitly. This PR does not solve all 15 legacy tables.
6. Review Files changed, require green applicable checks, select Ready for review, then merge into `main`. Use Create a merge commit for this existing branch chain to preserve ancestry. Keep its branch until PR #2 is retargeted and verified.

Done when: migration tests and staging API tests pass, compatibility is verified, and PR #1 is merged. A merged SQL file is not an applied production migration.

## 3. Complete existing PR #2: login and security controls

1. After #1 merges, open PR #2 > Edit and set its base to `main` if GitHub has not already retargeted it. Update its branch with `main` and confirm Files changed does not reintroduce #1's changes as new work. Resolve conflicts deliberately and rerun checks.
2. Deploy to isolated staging. Configure browser-safe Supabase URL/key; keep all privileged credentials in server secrets.
3. Configure email OTP, SMTP, Google, recovery redirects, password policy and Turnstile as described below. Keep Apple disabled. Keep the Google feature flag false until the real provider test passes.
4. Integrate browser auth with backend authorization: verified bearer tokens or a reviewed SSR-cookie design. Derive actor IDs from the verified session, not request-body `userId`. A working login page alone does not secure APIs.
5. Remove private fields from public profile responses; enforce group access on writes and chat. Restore any required blocked R2/cache/queue feature only with tested ownership/admin checks, payload limits and safe credentials. A 503 is safe containment, not a completed feature.
6. Run all tests below and real hosted browser tests. Only then mark ready and merge into `main`.

Done when: full build, applicable CI, real signup/login/recovery/logout and cross-user authorization tests pass. Mocked auth tests alone do not satisfy this step.

### Hosted auth configuration

Owner: account owner supplies/configures credentials; engineering wires and tests them.

- Supabase Auth URL Configuration: exact staging/production Site URLs and callback/recovery allowlists. Keep preview environments separate; avoid broad production redirect wildcards.
- Custom SMTP: verified sender with provider-required DNS authentication. Test actual inbox delivery. Magic Link and Confirm Signup templates must support the six-digit `{{ .Token }}` UI; recovery retains its confirmation link.
- Password controls: enforce the agreed minimum on Supabase, not only in the UI; enable leaked-password protection where supported.
- Google: create a Web OAuth client. Configure the application origin and copy the Supabase callback URL from the Google provider setup. Store the client secret in Supabase, not frontend variables. The Google-to-Supabase callback differs from the app's `/auth/callback`.
- Turnstile: create the widget for the actual hosts; put its secret in Supabase Auth CAPTCHA settings and its site key in `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Supabase verifies the token; do not consume the same single-use token in a second independent validation call.
- The public browser variables are `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED` and, when configured, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

Test success, incorrect/reused/expired OTP, resend limits, wrong password, reset in the requesting browser, provider cancellation, hostile return URLs, missing CAPTCHA, refresh expiry, and logout. Do not turn off verification or authorization to make a test pass.

## 4. New PR: `fix/legacy-row-access`

Base: updated `main`. Inventory all 15 affected tables and their actual consumers. Define public, owner, member and administrator operations per table; apply grants and RLS together. Review views and security-definer functions for bypasses. Fix mutable search paths and authorization gaps without granting everyone access to intentionally private tables.

Test as anonymous, user A, user B, active/private member, inactive member and authorized administrator. Verify direct REST/RPC access, not only hidden UI buttons. Review FK indexes and representative query plans; do not delete unused indexes solely because an advisor lists them.

Done when: targeted production blocker checks and advisors show no unresolved release-blocking access findings, and allowed and denied operations both pass in staging. Merge only after review.

## 5. New PR: `feat/community-qa-isolation`

Base: updated `main`. Add explicit community ownership to questions, a reviewed backfill, indexes and community-aware permissions across answers, votes, accepted answers, tags, moderation, feeds and search. Retain the Stack Overflow question/answer structure and canonical tags. Keep shared tables keyed by community instead of creating a table for every group.

Done when: existing data has an explicit valid mapping, private communities remain isolated, pagination works and representative load tests meet a documented target. A million registered accounts is not a claim of a million concurrent users.

## 6. New PR: `fix/import-retries-and-ledger`

Base: updated `main`. Make every failed write fail the batch. Mark a source key processed only after verified successful writes. Add bounded retries, idempotent source-ID upserts, durable run status/counts/errors/cursors and a last-success watermark. Preserve attribution, original timestamps, attachments, visibility and parent-child relationships.

Done when: importing the same batch twice creates no duplicates; forced partial failure remains retryable; successful counts reconcile; failure is visible and does not advance the success watermark. Merge, then rehearse a full import in staging.

## 7. New PR: `ops/cloudflare-release`

Base: updated `main`. Configure separate staging/production bindings and secrets, real deploy/health-check commands, response headers on the actual host, logging with sensitive fields redacted, abuse limits, alerts and rollback. Test the chosen adapter with the actual auth/API routes.

Account owner chooses the domain and budget. `visathread.com` is the conditional first choice, `visacommons.com` the backup; final Cloudflare registration/renewal quotes are not verified. Confirm availability before purchase. Enable account MFA, domain protections, DNS and HTTPS. Configure the final auth/OAuth/SMTP/Turnstile host settings and retest them after the domain changes.

Done when: a tagged commit deploys reproducibly to staging, secrets stay server-side, actual smoke checks run, alerts work and rollback is rehearsed. Merge after review; do not switch public traffic yet.

## 8. Rehearse and perform the production data operation

1. Take a backup and prove restoration into an isolated target.
2. Compare source/target IDs and inventories using `supabase/checks/post_inventory.sql`; record all content types, not just post count.
3. If the 500 posts already reside in the actual production database, do not copy them into it again. Publish through the correct feed/visibility mapping instead. Do not assign every record to a USA group without reviewing the mapping.
4. Otherwise rehearse the reviewed, idempotent transfer to staging. Reconcile IDs, normalized payload hashes, group mappings, attachments and relationship counts. Record rejected/quarantined content and its reason.
5. Run the same versioned import against the confirmed production destination during the controlled release. If users can still write, account for the final delta or use a planned write pause.
6. Verify counts/IDs again; do not delete the source as part of this operation.

Done when: every intended eligible record is accounted for, private content remains private, no duplicate/orphan is introduced and the ingestion ledger records the successful run. 'Updated at' alone is not proof.

## 9. Final release verification and traffic switch

Run real browser/API tests on the intended release: email and Google auth, recovery/logout, profiles, Q&A/tags/accepted answers, moderation, public/private groups, messages, restored media operations, imports and search. Repeat access tests with two independent users. Confirm HTTPS, headers, rate limits, logs, backup restore and rollback. Record the exact commit, migration versions and import run ID.

Deploy the approved release artifact, apply only reconciled release migrations, verify production smoke checks, then enable public traffic. Monitor errors, latency, auth failures, database load and import failures against predetermined thresholds. Revert application traffic if needed; use a reviewed data/schema recovery plan rather than restoring insecure grants or deleting new user records.

Done when: all intended features work, authorization tests pass, no launch-blocking finding is open, data reconciles and rollback/monitoring are proven. Until then the status remains staging/blocked.

## Common local verification commands

From the repository root, using Node 24 for the auth/security suite:

```sh
npm ci --ignore-scripts
node scripts/check-secrets.mjs
npm --prefix tests/auth test
npm --prefix tests/auth run typecheck
node --test tests/security/*.test.mjs
npm ci --ignore-scripts --prefix tests/database
npm test --prefix tests/database
npm audit --audit-level=high
npm run build
```

Run the actual backend and browser/integration suites as well after runtime recovery. An intentionally skipped test, placeholder deployment step, or disabled required feature is not a passing release gate.

## Repeat this PR process for every new engineering change

Branch from the updated intended base; keep the PR scoped; implement and test; open a draft PR; include problem/change/migration/validation/rollback details; deploy and verify staging; resolve review findings; require passing applicable checks; mark ready; merge. Refresh dependent branches and recheck their diffs after a parent merges. Never interpret a green focused suite as evidence that the whole application builds or production is secure.

## Official references

- Supabase key selection and legacy-key deactivation: https://supabase.com/docs/guides/getting-started/api-keys
- R2 scoped API credentials: https://developers.cloudflare.com/r2/api/tokens/
- SMTP: https://supabase.com/docs/guides/auth/auth-smtp
- Google: https://supabase.com/docs/guides/auth/social-login/auth-google
- CAPTCHA: https://supabase.com/docs/guides/auth/auth-captcha
- Redirects: https://supabase.com/docs/guides/auth/redirect-urls
- GitHub base-branch changes: https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/changing-the-base-branch-of-a-pull-request
- Cloudflare Next.js deployment: https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/

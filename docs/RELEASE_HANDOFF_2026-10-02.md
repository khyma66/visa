# VisaFlow release handoff — October 2, 2026 (America/Chicago)

## October 3 approved containment and member-post experience — latest update

**Published:** https://visa-central.com, preview Worker version `b2297cd3-6fa1-472c-aefd-07680f8f5d79`. Public-launch gates remain closed. Previous preview `dc3cf6b9-f0fc-447b-9104-135675451654` remains a rollback reference; rolling back the UI does not roll back database permissions.

- The exact owner-approved legacy hardening is live, with all rows/files preserved (evidence below). The former public storage URL now refuses downloads (HTTP 400). All four current public views are security-invoker and no public SECURITY DEFINER function is browser-executable; the obsolete historical definer views do not exist in this database.
- Feed, cards, tags and detail pages use ordinary community language, without imported-post badges or source-pipeline diagnostics. Reactions remain distinct from native votes. Compact original-discussion/comment attribution remains in detail. Source-only contributors are not represented as registered profiles and have no messaging link, including missing-source-flag/link cases.
- Native question/reply authors have ID-bound messaging links, excluding oneself. Login preserves the chosen member; entry verifies the real profile and opens an existing conversation without creating a request. New requests require an explicit action. Consent, one introduction before acceptance, blocking, rate limits and participant-only access remain enforced. Folder selection and slow-response navigation races were fixed; account changes remount private state. Messages are **not end-to-end encrypted**.
- Verified **231 automated checks**, typecheck, development build, all 563 archive IDs and 157 bundle files for known-secret patterns. The final two display corrections reran 31 relevant tests plus typecheck/build/archive/bundle checks. Database test files now run serially to avoid the observed parallel PGlite startup timeout; no assertion or timeout was weakened. Working-tree pattern scan: 289 files, no matches (not a key-revocation/history audit).
- Browser checks confirmed 563 normal feed posts, source detail without author messaging, compact attribution, related suggestions, 21 unified tag entries, and signed-out messaging preserving its selected-recipient login URL. Both hosted origins passed route/security-header/nonce/404 checks; approved legacy-denial/current-community smoke also passed. Actual email/Google and two-account authenticated browser delivery remain unverified; no real accounts or messages were created for testing.

Existing blockers remain: auth/domain/email/Google configuration and human acceptance, exposed historical credential revocation, dependency advisory, backup/restore, operational/privacy/moderation and load/cost readiness. See `release-review.json`; do not equate this completed containment with approval for a public launch.

## October 3 production-target decision — supersedes the separate-project plan

The owner chose to use **the existing Supabase project `cycnichledvqbxevrwnt` as production**. No project copy or user migration is needed. Supabase already calls its main branch Production; that label does not certify readiness. The Cloudflare website remains the working, noindex development preview below, not a public-production launch.

Prepared and independently reviewed `20261003191043_production_legacy_access_hardening.sql`. Eight dedicated regressions pass, plus the 42 existing membership tests. It preserves all rows and server privileges while containing 22 obsolete tables, six sequences and four functions; it makes the old posts bucket private without deleting its object. The reviewed current community membership, Q&A and messaging tables remain unchanged. Original ACLs/configuration and count-only preservation evidence are snapshotted privately, and the transaction aborts if service privileges or counts would regress. Vector stays in public because old SQL consumers still use that type/search path.

**Applied after explicit owner approval:** local migration `20261003191043_production_legacy_access_hardening.sql` is recorded remotely as `20261003204619`. The initial attempt was blocked; after the owner specifically approved legacy tables, functions and storage becoming server-only, the same reviewed migration succeeded through the normal migration tool. All 22 before/after row counts match, including 500 legacy posts; the one Auth account/profile and one stored object remain intact. Browser table/column/sequence grants are zero, all four legacy functions deny browser execution, service-role access is preserved, and the posts bucket is private. Current community/Q&A/messaging tables are unchanged. No public table remains without RLS. The rollback metadata snapshot is private; nothing was deleted. Do not replay the historical September containment migration.

Live read-only verification passed: `node scripts/smoke-community.mjs https://visa-central.com --verify-promotion` confirms all 22 old browser APIs deny access while the 563-post/628-comment archive, tags and current public RPCs remain available. Private messaging/voting RPCs deny anonymous callers. The advisor no longer reports disabled RLS or mutable function paths. Remaining findings: public vector extension (1), GraphQL schema discovery (9 anonymous / 16 authenticated tables, not itself proof of row leakage), disabled leaked-password protection (1), and intentionally policy-free server-only tables (23 informational). [Extension remediation](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [GraphQL review](https://supabase.com/docs/guides/database/database-linter?lint=0026_pg_graphql_anon_table_exposed), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Dashboard access is now available. Read-only inspection found Site URL `http://localhost:3000`, no redirect allowlist, built-in email delivery (not custom SMTP), CAPTCHA disabled, leaked-password protection disabled and available only on Pro+, an eight-digit OTP and one-hour expiration. Approval for owned-domain redirect settings and branded code templates is pending. No auth settings, provider credentials, keys or subscription plans were changed.

The project is on Free and PostgreSQL 17.6. Review the provider's supported security upgrade/maintenance and backup options before launch; no engine upgrade or downtime was initiated. Compatibility prechecks found zero ltree indexes, float GiST indexes, custom nonextension estimator operators or legacy-cipher references in application functions/code. This is not a backup/restore drill. [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod), [PostgreSQL security rollout](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).

Fresh dependency investigation still reports 11 high findings (7 when production-classified dependencies only are audited), propagated from braces. Its latest version is still affected and the upstream fix is not released; no force downgrade, audit suppression or package change was made. The public-launch gate remains closed. [Upstream advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

Development safeguards are implemented: supported local dev commands reject hosted database targets, `npm run dev:demo` uses empty database settings and browser-local demo state, and the live mutation suite requires a separate disposable target and synthetic accounts. Four obsolete upload/seed/deployment/write-test scripts now refuse before opening connections. Cloudflare build/deploy and the existing preview are unchanged. The standalone VisaFlow local Supabase bootstrap is not yet validated; StayHub's Docker stack was left untouched. See `ENVIRONMENT_ISOLATION.md`.

Promotion-preparation verification: **201 tests passed**, typecheck, build, archive and 155-file bundle scan passed; the working-tree secret pattern scan found no matches in 288 files (not a history/revocation audit). Local demo `/`, `/ask`, `/messages` and `/api/health` returned 200 with empty compiled database settings. Its verification server was stopped. After explicit approval, hosted legacy retirement checks also passed as recorded above. No account creation, email, payment or Git push was performed.

## October 3 continuation — current evidence

**Earlier preview checkpoint:** https://visa-central.com (HTTPS verified), backed by `visaflow-dev`, version `dc3cf6b9-f0fc-447b-9104-135675451654`; superseded by the version at the top of this document. The existing workers.dev URL serves the same deployment. The domain is intentionally bound to the development environment, noindex remains enabled, and the page shows an early-preview notice. This is not approval to open production. No existing DNS records were overwritten and no service plans were purchased. Prior preview version: `1dfedea6-402b-4222-908e-fec20d450e68`.

Implemented and deployed:

- Hidden-parent RLS for native answers/votes; answering and accepting on closed questions is refused.
- Native voting via authenticated security-invoker RPCs, deriving voter identity instead of generic key-column upserts.
- Full inbox/message paging, reconnect-window repair, displayed-message-only read receipts, and moderator-redaction refresh. Chat remains access-controlled, **not end-to-end encrypted**.
- Ranked answer cursor pages beyond 100, preserved imported source comments, and no messaging links that pretend imported source identities are accounts.
- Related suggestions use the newest 12 visible replies across the whole discussion independently of ranked answer pages. Candidate pools are deterministically ordered so new posts/comments are not excluded by old storage order. Results are approximate bounded candidates, not globally exhaustive top-k or a latency guarantee.
- Native-plus-import tag directory with cursor pagination, summary-only archive reads, separate source counts and focus/manual refresh. Native aggregation is an MVP implementation, not million-row capacity certification.
- Replaced remaining misleading "anonymous" interface labels with public-username language. Browser checks confirmed tag filtering, question details with five related suggestions, signed-out inbox protection, and the email-code form. No verification email was sent.
- All four matching completed Apify runs merged: **563 posts, 628 comments, 21 tags**, from 1,593 source rows. Zero prior posts/comments lost. The latest source run is September 12, not today. No new scraper run was started; no Apify secret was uploaded.

Verification: **163 tests passed**, TypeScript and development build passed, all 563 expected post IDs found in the compiled archive, 155 bundle files passed the known-secret scan. Both public origins passed 13 route/header checks, fresh CSP nonce/untrusted-header tests, and real 404 checks. `scripts/smoke-community.mjs` verified the deployed archive and tag counts, public discovery/answer RPCs, and anonymous denial for private inbox/read-receipt/voting RPCs without writing records. Actual two-device authenticated browser, email delivery, backup/restore and capacity tests remain unperformed in this pass. Fresh dependency audit still reports **11 high findings** through the braces chain; the release gate was not bypassed.

Additional live migration mapping (preserves content; applied only to the current community tables):

| Local version | Hosted version | Migration |
| --- | --- | --- |
| 20261003175707 | 20261003180542 | native_parent_visibility_hardening |
| 20261003175714 | 20261003180919 | messaging_delivery_reliability |
| 20261003180348 | 20261003180927 | secure_native_vote_rpcs |
| 20261003180857 | 20261003182005 | native_tag_directory |
| 20261003180924 | 20261003182012 | answer_cursor_pagination |
| 20261003181308 | 20261003181611 | deterministic_discovery_candidates |
| 20261003181839 | 20261003183206 | discussion_latest_reply_indexes |

The earlier 15 disabled-RLS and four mutable-search-path findings were resolved by the owner-approved promotion recorded above. The existing project is the selected production database. Keep code/schema and approved imports aligned, not bidirectional private-user/message replication; see PLATFORM_AND_SCALE.md.

The owner explicitly confirmed imported republication rights, recorded in release-review.json. Public takedown/retention, reviewed production ingestion and other release checks remain separate blockers. Supabase dashboard access is now available, but new-domain redirect/template changes await explicit approval; SMTP/Google configuration and real email checks still require credentials and an approved test inbox. No accounts, passwords or private chats were copied or fabricated.

The optional Stripe foundation is isolated in `feature/business-subscriptions`, disabled by default and not deployed. The reviewed foundation commit `fe8b2d6` includes release `af22073`; **188 tests** passed (163 community plus 25 billing), along with typecheck/build/archive/bundle checks. Independent review confirmed the cancellation-UI fix: retired or unavailable sale prices do not hide existing customers' management action. It requires 10,000 confirmed native accounts plus explicit enablement and configured prices. Imported author handles do not count. Real Stripe sandbox lifecycle validation, actual premium-feature authorization, reconciliation/alerts and pricing/terms remain prerequisites; nothing will charge automatically at 10,000 users. See the billing branch's `docs/BUSINESS_SUBSCRIPTIONS.md`.

Source publication is separate from the authorized preview deployment. The attempted release-branch push was blocked by auto-review because publishing code/history to the public repository needs explicit approval. No alternate publishing path was used. Reviewed commits and the billing branch remain local pending the owner's response; the private archive and local credentials remain excluded from Git.

## Earlier October 2 baseline (historical)

Status: development preview, not approved for public launch. Domain selection alone will not make this production-ready. This file supersedes older audit/deployment counts.

Review: [draft PR #3](https://github.com/khyma66/visa/pull/3), branch `release/visaflow-consolidated-20261002`. Application commit `fdacf9e`. Development deployment: `c31c7b0e-a70e-403d-999b-ed5c733c7624` at [VisaFlow preview](https://visaflow-dev.varunchinna5966.workers.dev). Production was not deployed.

## Consolidated implementation

- Preserved the newer local Q&A, tags, comment-aware discovery, private messaging, reporting, and moderation implementation instead of reverting to January GitHub main.
- Incorporated the two September 28 database-hardening migrations and 42 database tests from PR #1. Ported the requested email verification/password/Google direction from PR #2 into the newer application; did not merge its obsolete application tree.
- Login supports password and email code; signup verifies email before password setup. Google uses PKCE and remains unavailable until the provider is configured. Apple is removed.
- Fixed the incomplete mobile navigation markup. Added signup to private-page and hosted smoke checks.
- All seven test suites now run through `npm test`; the manual production workflow includes auth and database tests. Production remains deliberately closed and imported distribution disabled.
- Kept the actual imported archive and temporary export out of the public repository. CI/production resolve a synthetic fixture, while local development may use the existing private archive. Snapshot updates use a same-directory rename to avoid truncating the previous good file.
- Patched Next.js and build infrastructure dependencies; no force upgrade or audit suppression.

## Changes applied to the live Supabase project

Project: `cycnichledvqbxevrwnt`. No post/message records were deleted or imported.

| Local migration | Recorded hosted migration | Result |
| --- | --- | --- |
| 20260928164317_revoke_client_table_administration | 20261003013836 | Removes browser TRUNCATE/REFERENCES/TRIGGER, preserves row operations and service role |
| 20260928164013_community_membership_access_hardening | 20261003013937 | Own-membership reads, ordinary-role public joins, restricted private discovery |
| 20261003013954_revoke_imported_view_administration | 20261003014107 | Removes remaining administrative ACLs on imported_answer_feed |

Post-change catalog check: **zero** administrative grants to PUBLIC/anon/authenticated across public tables and views. Community tables were empty before the membership migration. The local negative-access tests pass, including self-selected administrator roles and private membership discovery.

Do not blindly run `supabase db push` or replay all legacy SQL. Hosted timestamps differ from repository timestamps, and the separate legacy-containment migration has NOT been approved/applied. Reconcile the migration ledger with the existing mapping in PRODUCTION_READINESS.md first. A full reset from this repository is not yet a validated new-project bootstrap.

## Verification and its limits

The consolidated local check passed: 71 tests (8 auth, 42 community access, 6 security, 2 notices, 2 archive, 8 release, 3 realtime/database), type checking, and Worker build. A repeated CI-mode run stalled once in the embedded database suite; the bounded isolated rerun passed. The test command now has a 60-second timeout so it cannot hang indefinitely. This is not a hosted load test.

Development bundle scanning passed for known local secrets and privileged database keys. This is a pattern check, not proof that all historical secrets are revoked. Existing history remains unchanged.

GitHub's clean runner successfully completed npm ci and the full code check on the initial consolidated commit; the job correctly failed at the remaining high-severity dependency audit. A hosted smoke check caught fixture data selected in the first preview build; the archive resolution was corrected and a compiled-artifact check was added. Development must contain all 549 existing snapshot posts; CI/production must contain only the 42 synthetic posts and none of the private post IDs. The actual Apify source was not refreshed in this release pass.

Browser checks confirmed the updated login and signup screens render and navigate correctly. No real email or password was submitted. Google is visibly unavailable until provider configuration is completed.

Dependency patch versions: Next.js 16.3.8, eslint-config-next 16.3.8, Cloudflare Vite plugin 1.62.5, Wrangler 4.147.0; compatible brace-expansion and fast-uri fixes are pinned. Fresh full audit after installation: **11 high findings**, all in the unresolved braces dependency chain. The high-severity CI/release gate is intentionally not bypassed. See [upstream braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). Earlier “zero vulnerabilities” statements are historical and do not apply now.

Public release review entries remain pending. No real signup email, Google login, production backup restore, production capacity test, or operator acceptance is claimed by these automated checks.

## Minimal owner handoff

1. **Dashboard access:** the selected domain is already connected to the development preview. Sign in to the open Supabase dashboard, Google Cloud, and the selected email provider. Do not paste passwords or private keys into chat. No new paid service has been purchased.
2. **One compatibility decision:** confirm whether the legacy app/tables are unused and may become server-only, or approve a separate production database. This is the main database release blocker.
3. **Identity setup:** provide an approved test inbox; configure the verified sender/SMTP and branded code templates, Google OAuth credentials, redirect allowlist, backend password policy and abuse controls. See AUTH_SETUP.md for exact paths. A custom auth domain is optional if the Supabase host must disappear from Google consent/redirects.
4. **Security ownership:** rotate/revoke previously exposed Supabase, Apify, and Cloudflare/R2 credentials at their providers; confirm replacements work. Choose the moderator account, support/deletion contact, approved privacy/retention rules, and pilot budget.
5. **Final acceptance:** approve CAPTCHA widget/domain/secret configuration and perform real email/Google and two-account messaging checks. Review the protected GitHub production environment before launch.

These are owner decisions/access tasks, not a claim that all remaining engineering is finished.

## Remaining engineering before a public pilot

- Resolve the unpatched build dependency chain through a tested upstream replacement/update; keep audit blocking until then.
- Apply and verify the chosen legacy isolation strategy. Advisors still report 15 non-RLS legacy public tables, four mutable function search paths, and other legacy findings. [RLS remediation](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public).
- Verify auth delivery/provider flow and server-enforced bot protection. CAPTCHA was not provisioned while domain/account confirmations were unavailable.
- Implement the agreed privacy export/deletion and retention process, plus source-content takedown if imports are enabled. Assign a real moderator and alert destinations.
- Verify backup restoration, error alerts, accessibility/mobile flows, and measured pilot load/cost. Do not claim million-user or unlimited-message capacity.
- If separate/private communities are required, add community-scoped questions, search, and policies; hardening membership tables alone does not provide feed isolation.
- If Apify remains part of production, build durable idempotent ingestion with a run ledger/retries. Current bundled snapshot is development-only, requires refresh/redeploy, and is not a daily production importer. Reconcile legacy post IDs with imported IDs; do not add 500 legacy rows to 549 snapshot rows as if all were unique.

## Release and rollback

Keep the consolidated branch under review; do not independently merge the old PR #2 app tree over it. Run `npm ci`, `npm run check`, the full audit, and actual hosted acceptance checks. Only then record real evidence in release-review.json, configure the production origin, and approve the production gate.

Use the manual production workflow from the reviewed main commit. It does not automatically migrate the database. Record the deployed Worker version and known-good rollback version; application rollback does not undo SQL changes. Start with a limited pilot.

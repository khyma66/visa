# VisaFlow release handoff — October 2, 2026 (America/Chicago)

## October 3 continuation — current evidence

**Live preview:** https://visa-central.com (HTTPS verified), backed by `visaflow-dev`, version `dc3cf6b9-f0fc-447b-9104-135675451654`. The existing workers.dev URL serves the same deployment. The domain is intentionally bound to the development environment, noindex remains enabled, and the page shows an early-preview notice. This is not approval to open production. No existing DNS records were overwritten and no service plans were purchased. Last known-good previous preview version: `1dfedea6-402b-4222-908e-fec20d450e68`.

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

Post-migration advisor review still finds the 15 legacy tables without RLS, four mutable search paths, public vector extension and disabled leaked-password protection. GraphQL discovery notices need interpretation alongside RLS; they are not automatically proof of row leakage. [RLS remediation](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public). Legacy containment remains unapplied because the owner wants to preserve development. A separate production project is recommended and awaits the exact project/organization/plan decision. Keep code/schema and approved imports aligned, not bidirectional private-user/message replication; see PLATFORM_AND_SCALE.md.

The owner explicitly confirmed imported republication rights, recorded in release-review.json. Public takedown/retention, reviewed production ingestion and other release checks remain separate blockers. Supabase's browser dashboard is signed out; it was left at the login handoff. New-domain redirect/SMTP/Google configuration and real email checks need that access and an approved test inbox. No accounts, passwords or private chats were copied or fabricated.

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

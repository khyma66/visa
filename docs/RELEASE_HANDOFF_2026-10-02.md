# VisaFlow release handoff — October 2, 2026 (America/Chicago)

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

1. **Domain + dashboard access:** choose the domain and sign in to Supabase, Cloudflare, Google Cloud, and the selected email provider. Do not paste passwords or private keys into chat. No new paid service has been purchased.
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

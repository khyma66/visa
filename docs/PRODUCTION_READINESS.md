# VisaFlow public-launch readiness

**Current status:** see [October 2 release handoff](RELEASE_HANDOFF_2026-10-02.md). The dated evidence below is historical, not proof of current deployment or a clean dependency audit.

Updated September 10, 2026. **Status: hardened development preview, not approved for general public launch.**

**September 11 UTC follow-up:** See the [current security review](SECURITY_REVIEW_2026-09-11.md) and [ordered launch checklist](GO_LIVE_CHECKLIST.md). Live checks reconfirmed anonymous read/write grants on 15 non-RLS legacy tables and found a public legacy storage bucket. Full dependency audit: 10 findings (7 high, 1 moderate, 2 low); production-only audit: 0. New policy notices are preview drafts. The previously timed-out database test passed on the latest bounded rerun; human signoff remains missing.

Preview: https://visaflow-dev.varunchinna5966.workers.dev

Latest development deployment version: `2ff753fd-57b4-4ef9-a786-64331430728a` (includes the archive, question/tag browsing and contextual safety/privacy notices; Cloudflare reported successful deployment; hosted browser verification remains blocked).

The community uses real Supabase accounts and durable data when configured. At this audit the database had no native questions or disposable test accounts. A later user-requested development update added a combined, sanitized API snapshot without transferring the Apify secret: see [current archive coverage](API_ARCHIVE.md). Production launch/import approvals remain pending.

## Completed in this production-hardening pass

| Area | Implemented and checked |
| --- | --- |
| Reporting | Members can report native questions, answers, VisaFlow replies on imports, and individual private messages. Duplicate reports are idempotent. Members can read only their own reports. |
| Moderation | `/moderation` provides an operator-approved review queue, dismissal, content removal, and optional author suspension. Roles live in a private allowlist, not editable profile metadata. No real moderator has been appointed. |
| Private messages | Moderators can inspect explicitly reported messages, not arbitrary conversations through the moderation API. Reporting explains this disclosure. Infrastructure administrators still have privileged database access; chat is not end-to-end encrypted. |
| Abuse controls | Database-enforced limits: 5 new questions per 10-minute fixed window, 30 replies per 10-minute window, 120 vote changes/minute, 10 report attempts/hour, and a shared 120/minute limit for other guarded writes. Existing chat request/send limits remain. Suspensions block new questions, replies, votes, conversations and messages. This does not prevent multi-account/Sybil abuse. |
| Removal safety | Ordinary authors cannot change question status to restore moderated content. Removed accepted answers are unaccepted. No user content was removed during implementation. |
| Accounts | Password recovery and update screens; signup confirmation redirects back to the current site. Real email delivery still needs verification. |
| Public rendering | Native question bodies/answers are server-rendered using anonymous reads only, without forwarding session cookies. Metadata uses the actual question title. Imports remain a development/client-loaded archive. |
| Web hardening | Anti-framing, no-referrer, MIME-sniffing protection, restricted browser permissions, HTTPS HSTS, and a limited CSP. Private pages are uncached and unindexed; preview pages are unindexed. The CSP is not a complete nonce-based XSS policy. |
| Safe release | Separate production environment, default maintenance gate, production demo refusal, guarded build/deploy commands, and review evidence tied to exact site/database origins. Imported redistribution is off by default in production. |
| Delivery | Manual GitHub production-release workflow with tests, dependency audit, bundle-secret checks and smoke tests. It must be committed/pushed and its GitHub environment configured before it can run. |
| Ingestion reliability | The latest-run request explicitly filters for `SUCCEEDED`, avoiding selection of a running or failed refresh. |

The migration `20260910055528_launch_safety_and_moderation.sql` was applied to project `cycnichledvqbxevrwnt`. It changes only the new VisaFlow community system; it does not alter legacy access or delete data.

The connector assigns application-time versions, which differ from the local filenames. Existing-project migration reconciliation must use this mapping and compare SQL before any CLI history repair or push; do not replay already-applied migrations:

| Local migration version | Hosted applied version | Migration |
| --- | --- | --- |
| 20260904032053 | 20260910034158 | community_core |
| 20260907191603 | 20260910034229 | secure_community_views |
| 20260910031322 | 20260910034240 | realtime_discovery_and_message_requests |
| 20260910034701 | 20260910035130 | production_access_hardening / community_api_access_hardening |
| 20260910035131 | 20260910035321 | imported_comment_discovery |
| 20260910055528 | 20260910060605 | launch_safety_and_moderation |
| 20260911050812 | 20260911051823 | community_write_guard_gaps |

Latest remediation and owner handoff: [SECURITY_FIXES_2026-09-11.md](SECURITY_FIXES_2026-09-11.md). The separate local legacy containment migration remains unapplied pending explicit compatibility approval; do not run an unreviewed migration push to reconcile these histories.

## Verified evidence and its limits

The following is the earlier baseline. For subsequent 20-test verification, zero full-tree dependency findings, nonce CSP and hosted write guards, use [the current remediation handoff](SECURITY_FIXES_2026-09-11.md).

- Six release tests: configuration/secret rejection, matching release evidence, imported-distribution gate, anonymous server rendering, maintenance/private-page headers, and successful-run selection.
- Three existing realtime/discovery/database tests, expanded to exercise moderation and rate limits in real embedded PostgreSQL with three separate identities. Tests include outsider-report denial, self-promotion denial, report privacy, removal, restoration denial and suspended-message denial.
- Hosted database permission checks confirm anonymous report reads and moderation are denied, member self-promotion is denied, member question-status changes are denied, and seven write guards are installed.
- TypeScript, development Worker build, and deployment dry run pass.
- Local generated Worker smoke tests pass for eight routes, security/cache headers, configured health, and a genuine missing-page 404.
- Production dependency audit reported zero known vulnerabilities at the time checked. This is not a guarantee against undisclosed flaws.
- Bundle checks found no known local secrets or privileged Supabase keys. The scanner does not replace a complete history/security audit.
- Cloudflare confirmed a successful preview deployment. Hosted browser verification was blocked because the computer's admin browser policy could not be verified. That restriction was not bypassed. Local checks do not establish hosted browser correctness.
- The release gate intentionally fails today. No public-production Worker was created in this pass.
- No external signup/recovery emails, production load test, restore drill, or end-to-end browser signup test were performed. Previous disposable hosted realtime fixtures have been cleaned up; no new fixtures were created in this pass.

## Required before public signup

### 1. Resolve legacy database access — blocking

The current Supabase security advisor reports 15 legacy public tables without row-level security:

`post_likes`, `countries`, `visa_types`, `visa_requirements`, `post_tags`, `tags`, `group_messages`, `group_message_likes`, `message_read_receipts`, `user_presence`, `posts`, `clusters`, `comments`, `comment_likes`, `post_reactions`.

Choose one reviewed path:

- **Lock down unused legacy access:** inventory old consumers, preserve a schema/grant backup, enable RLS and remove unneeded browser grants, then explicitly restore only necessary read/write policies. Keeping these tables server-only preserves their data but can break old clients/scripts. Owner approval is required before applying this compatibility-affecting change.
- **Isolate the public community:** provision a clean production Supabase project and apply only the six September community migrations. Keep the old system out of the public app. This needs approval for a new project/plan, separate authentication configuration, and any agreed data migration. It does not remediate exposure in the old project itself.

Also review the remaining legacy function search-path/extension findings and intentional GraphQL exposure. Private tables with RLS and no policies are intentionally inaccessible to browser roles. Public feed/profile visibility is intentional; private-message membership policies must continue to hold.

### 2. Rotate previously exposed credentials — blocking

Revoke/rotate the Supabase and Cloudflare/R2 credentials previously exposed in tracked files/history. File cleanup is not credential rotation. Validate replacement keys, remove old access, and review Git history before transferring/publishing a destination repository. Do not expose service-role or secret keys in any `NEXT_PUBLIC_` variable. No history rewriting or provider credential rotation was performed here.

### 3. Verify real identity delivery and bot protection — blocking

Configure a production email sender and exact allowed redirect URLs for the chosen site, including `/login` and `/account/update-password`. Keep localhost/preview settings scoped appropriately. Test signup, confirmation, login, logout, expired confirmation/recovery links, recovery from another device, and password changes using an operator-controlled mailbox. Confirm server-side password rules and Auth rate limits. Add and verify bot challenges before unrestricted registration; UI posting limits alone cannot stop mass account creation.

### 4. Appoint the operator and moderator — blocking

Supply the operator identity, support/deletion/appeal contact, intended user age policy, retention decisions and reviewed privacy/terms text. `/community-safety` honestly explains current behavior but is not a substitute for those policies. Account deletion/export and a retention job are not yet implemented; existing content ownership foreign keys require an explicit deletion/anonymization design.

Choose a real registered username for moderation. An authorized administrator can resolve that exact profile ID and add it to `private.community_moderators`. Do not grant moderation to the first signup or derive it from user-editable metadata. Suspension appeals/restoration currently require an operator database action. Agree review coverage and response expectations before inviting the public.

### 5. Backups, deployment and pilot acceptance — blocking

- Select the public origin and production service plans/budget. Paid plan changes were not made.
- Establish backups, perform a restore into an isolated target, and record recovery expectations.
- Run desktop/mobile browser checks, accessibility checks, and a small realistic pilot load test. The current `vinext` and Cloudflare adapter versions are beta; explicitly assess runtime compatibility and rollback before broad production use.
- Monitor HTTP errors, database load, email failures, report backlog, websocket reconnects and spending. `/api/health` reports liveness/configuration, not database or email availability.
- Require review/branch protections for the GitHub `production` environment. The workflow declaration alone does not create those protections.

### 6. Decide whether imports belong in the public product

Native Q&A and messaging can launch without Apify. Public redistribution of imported discussions needs a source-permission/privacy review and a takedown process, including the risk that source links and quoted text identify people despite pseudonymous handles. Keep `IMPORTED_CONTENT_APPROVED=false` until that is settled. The current reports UI covers member content, not source-owned original posts/comments.

Uploading the existing local `APIFY_TOKEN` to the Cloudflare **development** Worker was blocked by automatic approval review because the secret/destination transfer was not explicitly approved. It was not retried indirectly. If the owner approves that specific transfer, `node scripts/sync-preview-secret.mjs` uploads only that credential to `visaflow-dev`; it never uploads it to production. Alternatively, the owner can enter the secret directly in the development Worker's dashboard. This is optional for a native-community launch.

## Release procedure after the blockers are resolved

1. Record actual evidence and reviewer names in `docs/release-review.json`, tied to the selected site/database. Do not mark pending checks verified merely to pass the script.
2. Configure ignored `.env.production.local` (or equivalent CI variables) with the real `NEXT_PUBLIC_SUPABASE_URL`, browser-safe publishable key, `NEXT_PUBLIC_APP_ENV=production`, and `NEXT_PUBLIC_SITE_URL`.
3. After approval, set the production Worker's `PUBLIC_LAUNCH_APPROVED` configuration to `true`. Leave imported content disabled unless separately reviewed.
4. Run `npm run check:release`, then `npm run deploy:prod`. Production deployment runs release/realtime tests, TypeScript, the production build and bundle checks. The GitHub manual workflow additionally audits dependencies and tests the deployed URL.
5. Run `node scripts/smoke-site.mjs https://YOUR-APP-ORIGIN` and the actual cross-account browser flows. Record the deployment version and results. If any check fails, close traffic or roll back the Worker to the exact known-good version. A Worker rollback does not undo database migrations.
6. Begin with a limited pilot, verify errors and cost, then progressively widen access. No million-user capacity claim is supported by these tests.

Use `npm run build:dev` / `npm run deploy:dev` for preview work; do not deploy an artifact without checking its generated Worker name. The old `scripts/deploy-all.sh` and other legacy deployment scripts are not the production release path.

## How much work remains?

The core product and a substantial safety layer are implemented. A responsible small public pilot still needs roughly **several focused engineering days to two weeks after the necessary access and owner decisions are available**, plus provider/email/domain/policy-review waiting time. This is a planning estimate, not a maximum or guarantee; a separate production database or deletion/export implementation increases the scope.

Millions of registered users is a separate capacity target from millions of simultaneous connections. Measure concurrent active users, hot-topic fan-out, message rate, database size, search latency and budget before estimating that phase. Known work includes older-answer/inbox pagination, durable imported ingestion if retained, moderation staffing, anti-Sybil controls, performance/load tests, backup drills and operational alerting. Do not buy a complex distributed chat stack before workload measurements justify it.

## Guidance used

The Supabase and Cloudflare skills drove database-level enforcement, narrow grants, private moderation roles, secret separation, and explicit release gates. Current references: [Supabase RLS remediation](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public), [password recovery](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail), [Workers production practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/), and [Apify successful-run filtering](https://docs.apify.com/api/v2/actor-runs-last-get).

# Private analytics operations

## Scope

`/admin/analytics` is a public sign-in shell. Reports are served only through
`/api/admin/analytics?days=7|30|90` after server verification of the caller's
Supabase access token, and database verification of the existing designated
owner plus a live, unexpired session. No service key is used. Responses are
private/no-store, the page is noindex, and report data is cleared on failures
and identity changes. The owner is the existing `private.feedback_owner`, not
a client flag, email match, moderator status or user-editable metadata.

The additive `owner_analytics_aggregates` migration creates one private exclusion
table, four indexes, a private owner-checked aggregate function and an exposed
invoker wrapper. It does not modify posts, accounts, policies or schedules.
Removing this UI/API leaves the additive migration inert; do not drop account
or community data to roll it back.

## Metric dictionary

- UTC calendar windows include the current partial day; the start is inclusive
  and the report time exclusive. Available windows are 7, 30 and 90 days.
- Member counts describe retained profile records. Contributions describe
  currently retained nonarchived questions/experiences and active replies.
- Owner, moderator, anonymous/deleted and explicitly excluded test/demo/automation
  accounts do not count as member traction. An operator must classify any other
  known fixtures in `private.analytics_excluded_users`; they are not guessed.
- Distinct contributors count each eligible author once across the window.
  Monthly unique counts are not sums of daily unique counts.
- Answer rate concerns questions created in the window that have an active
  reply by another eligible human before report time. Staff and self replies
  do not qualify. Median response time excludes unanswered questions, and both
  rate and latency are null when there is no relevant denominator.
- Unanswered questions, pending reports and pending feedback are current
  inventory across all time. Operations include all submitters, including staff.
- Native replies are replies to native questions/experiences. Imported replies
  mean replies written on this site to imported threads, not scraped comments.
- Deletion, archival and role changes can change earlier totals. These are not
  an immutable event history. Visits, D7 retention, AI savings and revenue are
  deliberately not inferred from missing data.

## Imports

The dashboard summarizes the same server-only archive used by the public feed.
It does not start an Apify run, import a new dataset or restart a scheduler.
Capture time and original post time remain separate. The freshness warning is
triggered when the newest original post is over 48 hours old, absent, or a post
date is invalid/future. This threshold is an operator attention signal, not a
claim that an upstream scrape failed. Synthetic fixtures never count as live
inventory. Empty-item rejection is not a complete moderation rejection metric.

## Free-resource boundary

The dashboard uses existing Supabase and Cloudflare resources, no new paid
vendor, tracking SDK, analytics server or polling schedule. Data is loaded on
page entry, period change and explicit refresh. Do not cache owner responses
in shared edge caches. Aggregate SQL has bounded windows and a five-second
PostgREST timeout; revisit query plans before significant growth.

Cloudflare/Supabase native dashboards remain the source for platform usage and
billing. Traffic analytics is explicitly not integrated in this release. If
added later, scope collection to reviewed public routes, sanitize URLs, disclose
the vendor/retention, and keep auth, private messages, feedback and admin pages
out of collection. Umami's hosted free tier does not include its reporting API.
Do not enable session replay or duplicate event collectors by default.

References checked October 16, 2026:
- https://developers.cloudflare.com/web-analytics/
- https://developers.cloudflare.com/workers/platform/limits/
- https://supabase.com/pricing
- https://supabase.com/docs/guides/platform/backups
- https://umami.is/pricing

## Launch and search safeguards

Saved launch-check statuses are historical evidence, not current signoff.
This feature release must not flip `PUBLIC_LAUNCH_APPROVED` or import approval.
The live site is an existing early preview. Sitemap/robots are implemented but
enumerate no pages until approved production configuration is explicitly set.
Private routes remain excluded after approval. Sandbox never enables indexing.

Before a general-public launch, obtain current evidence for credential rotation,
backup plus isolated restore (including Storage objects), delivery/recovery,
cross-account browser tests, retention/deletion/export, responsible moderation,
support staffing, operator details and appropriate legal review. Existing
database advisory warnings must be reviewed rather than blanket-granting access.
Do not use synthetic tests as evidence of real recovery-email delivery.

## Acceptance and rollback

Run the analytics HTTP/unit tests, analytics database tests, SEO tests, existing
full suite, typecheck, dependency audit and guarded build. The isolated release
must descend from the current live source, retain archive parity, preserve all
assistant configuration, keep schedules absent, and pass existing hosted
assistant acceptance requirements. Recheck the active deployment immediately
before release; stop if another task changed it. Rollback may target only the
recorded previous version and only while this task's version remains active.

Post-release check: anonymous API returns 401/no-store; ordinary member is denied;
owner report loads; sign-out clears reports; 7/30/90 periods reconcile; a revoked
session is denied; sitemap stays empty in preview. Human owner browser acceptance
is distinct from transaction-scoped simulated owner database verification.

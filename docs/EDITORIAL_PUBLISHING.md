# Reviewed community publishing

The pipeline prepares attributed community summaries for local review. Exporting,
rewriting, staging, reviewing, and scheduling are separate operations. None of
them activates publication. It does not access Gmail or store account passwords.

## Initial review batch

The November 3, 2026 request uses September 3 at midnight America/Chicago through
November 3 (exclusive end November 4 at midnight). These translate to
`2026-09-03T05:00:00Z` and `2026-11-04T06:00:00Z`, spanning the DST change.

The completed Apify runs available when checked contain 2,592 rows. Filtering by
the **original post date** and deduplicating canonical post URLs yields 496 posts.
The newest completed scrape finished October 8; selected posts run from September
3 through October 7. This is the available archive, not proof of complete coverage
through November 3. New scraping requires a separate bounded run. Existing source
schedules are unchanged.

The CSV includes every selected source post, its complete original text, proposed
title/body, original date, source URL, category, review flags, decision, review
notes, and reuse basis. Identical text at different source URLs is retained for
review and flagged as a duplicate; it cannot be published twice by this queue.
Raw source files and drafts stay outside Git and outside the public website.

## Collection and local rewriting

Use the existing `APIFY_CREDENTIAL_FILE` or an `APIFY_TOKEN` environment variable.
Tokens go only to `api.apify.com` in authorization headers. The collector checks
the baseline run's exact group configuration, paginates completed runs and every
dataset, verifies counts, and fails instead of silently returning a partial page.
It never starts an Actor.

```sh
node scripts/editorial-apify.mjs \
  --from 2026-09-03T05:00:00.000Z --until 2026-11-04T06:00:00.000Z \
  --out /absolute/private/output-directory
```

The offline rewriter accepts only the temporary local Ollama endpoint
`http://127.0.0.1:11439/api/chat`. Qwen 3 4B is the default. Run a compatible local
Ollama server and install that model before invoking it. No source post is sent
to an external inference provider. Drafts are cached by source hash, model, and
rewrite version. Restarting continues missing rows. Every row starts pending.

```sh
node scripts/editorial-rewrite.mjs \
  --input /absolute/private/output-directory/source-posts.json \
  --out /absolute/private/output-directory/drafts

node scripts/editorial-export.mjs \
  --sources /absolute/private/output-directory/source-posts.json \
  --drafts /absolute/private/output-directory/drafts \
  --out /absolute/private/output-directory/review.csv
```

Export requires a complete batch, resets every row to pending and refuses to
overwrite an existing CSV. Never regenerate over a human-edited review file.

Rewriting preserves the member's account and unanswered questions. It adds no
immigration advice and does not turn another person's experience into the
publishing member's experience. Known contact and case identifiers are redacted.
Automated checks flag added/omitted numbers, possible identifiers and overly
short summaries. They do not prove semantic accuracy: the original and proposed
text must be compared during review. Source text is untrusted input, not model
instructions. No model has tools, credentials or publishing access.

## CSV review and round trip

Edit `title`, `body`, categories/tags, `reviewer_notes`, `reuse_basis`, and
`review_decision` (`pending`, `approved`, `rejected`). Keep the original text,
source IDs/URLs/dates/hashes and `backend_revision` intact. Tags and review flags
are JSON arrays. Approval requires a concrete reuse basis and a note confirming
the source/draft comparison. Rewording alone does not establish reuse permission.

Validate a file without changing the backend:

```sh
node scripts/editorial-review.mjs --file /absolute/review.csv \
  --sources /absolute/source-posts.json
```

The command reports a SHA-256 of the exact file. Backend operations additionally
require `--action stage|review|schedule --apply --confirmed-sha256 HASH`, plus:

- `EDITORIAL_SUPABASE_URL`: the exact production or isolated development origin.
- `EDITORIAL_PUBLISHABLE_KEY`: that project's public client key.
- `EDITORIAL_OWNER_ACCESS_TOKEN`: a current signed-in owner's access token.

Never place access tokens in the CSV, shell arguments, Git, or logs. The backend
checks the actual owner's live session on every operation. It does not trust
email addresses, user-editable profile metadata or a CSV approval flag alone.
Service-role clients have no access to these endpoints or tables.

Stage only the intended changed rows. Staging increments the revision and removes
all old approval/assignment information. On complete success, the command creates
a separate CSV with the returned revisions and preserves the human decisions and
source fields. Use that new file and its new checksum for review and scheduling;
the original CSV is untouched. A stale revision fails
instead of overwriting newer work. Receipts are saved after each successful batch.
After an uncertain response, use `editorial_owner_action('list', {after_id: ...})`
to reconcile the current revision; do not blindly repeat a mutating command.

`review` records approved/rejected rows and ignores pending rows. `schedule`
requires an approved revision, an account UUID with valid source-specific
permission, and an ISO timestamp. All 15 email addresses must first correspond
to real verified VisaThreads accounts; providing a Gmail roster grants no posting
permission and requires no Gmail API connection.

## Account permission

A signed-in, verified member who accepted current community policies calls
`editorial_consent(source, allow_posting, days_valid, per_day)` as themselves.
The permission covers a specified source for 1–90 days and 1–3 posts per day.
It may be revoked using the same API with `allow_posting=false`. Changing or
revoking permission blocks previously scheduled assignments immediately.
The owner cannot use this API to consent for another account.

The initial migration grants no account consent. Account onboarding UI can expose
this existing API when the owner supplies the approved contributor roster.

For a small owner-controlled batch, run `node scripts/editorial-consent.mjs` in an
interactive terminal once as each account owner. The utility asks for the account
email, shows the exact source, duration and limit, and requires an explicit ALLOW
before asking for the website password with terminal echo disabled. It keeps the
session in memory and signs out that temporary session after the grant. It does
not create accounts, accept policies, approve drafts, schedule or publish. The
utility does not support accounts requiring an additional CAPTCHA or MFA step;
those accounts must use their normal sign-in and a compatible authorization flow.
Never send passwords or tokens in chat or store them in the CSV.

## Backend and activation

All five editorial tables use the unexposed `private` schema, RLS and revoked
direct table grants. Public functions are invoker wrappers around narrow,
authenticated owner/member operations. Only the database operator can execute
the internal publisher. The production tables for ordinary questions, replies,
auth and moderation are unchanged.

The timer is installed as **inactive**, and `editorial_settings.enabled=false`.
Source switches are also false. After human approval, reuse review, verified
account consent and a small pilot, activation requires both the authenticated
owner control (`START APPROVED PUBLISHING`) and activating the named cron job.
The source must be enabled independently. Do not activate any of these during
initial preparation.

Defaults: one due post per tick, at least 60 minutes apart, at most 5 total per day
and 150 per month, between 8am and 9pm America/Chicago. Database constraints limit
configuration to 10/day and 300/month. Counters use Chicago calendar boundaries,
including DST. Slots older than 24 hours require rescheduling instead of a burst.

The publisher rechecks current consent/version/expiry, verification, suspension,
ban/deletion, policy acceptance, source state, current approval and quotas before
inserting. A changed community-policy guard fails closed pending integration
review. It publishes only to the general public feed, never a private group.
The public body includes the original source date and link and identifies itself
as a community summary. The current publication timestamp is not substituted for
the original experience date.

The post and publication receipt commit in one transaction. A lock serializes
ticks and approvals. Unique constraints prevent duplicate source text or identical
summaries being published under multiple IDs. Failed publication rolls back its
post and marks the draft blocked. Use existing moderation to remove a published
post; its receipt prevents it reappearing on retry.

Pause through the owner controls API. For a complete timer stop, deactivate only
`visathreads-reviewed-editorial` in Supabase Cron. Other schedules are unaffected.
Cron history is visible in the Supabase dashboard. Editorial events log IDs and
actions, not source text, email addresses or credentials. Keep source CSVs private
and remove local copies under the operator's retention policy after review.

## Verification

`node --test scripts/test-editorial.mjs tests/database/editorial.test.mjs` covers
date bounds, pagination completeness, CSV quoting/formula safety, immutable
source fields, authorization, review revisions, account consent/revocation,
policy changes, duplicate prevention, posting limits and transaction rollback.
Database tests use synthetic accounts in an isolated PostgreSQL runtime. No live
test accounts or public posts are created by the suite.

## Operator status and complete shutdown

The private operator functions are callable only through the database operator,
not from the website, ordinary authenticated clients or the service-role API.
There are no new website routes, controls, banners or account labels in this
release. The production application and its Cloudflare configuration are unchanged.

```sql
select private.editorial_operator_status();
select private.editorial_stop_all();
```

`editorial_stop_all()` takes the same lock as the publisher, switches publication
off, deactivates only `visathreads-reviewed-editorial`, disables every editorial
source and consent, and blocks all scheduled drafts while clearing their assigned
account and time. It preserves drafts, published posts and audit receipts. After
it commits, subsequent publisher ticks return `paused`. A publication that already
committed before shutdown remains available to normal moderation.

Restart needs fresh member permission, source activation, deliberate rescheduling,
the explicit owner enable command and timer activation. Turning on the timer
alone cannot replay the old queue. Repeated shutdown calls do not advance disabled
consent versions. No shutdown is scheduled automatically after a few weeks; the
owner decides when to activate or stop this separate workflow.

## Prepare a CSV schedule with account rotation

The existing review CSV remains the publishing contract. The two-column
`description,reframed` download is a review convenience; restore its source and
review metadata before staging. Gmail addresses or usernames are resolved to
verified website account UUIDs during the later account setup, without requesting
Gmail access or passwords. Each account grants the existing source-specific
publishing consent API through its signed-in website session.

After staging and reviewing the approved rows, export the verified consent records
privately as JSON with `author_id`, `source_key`, `enabled`, `daily_limit`, and
`expires_at`. The offline planner creates a new reviewable schedule file:

```sh
node scripts/editorial-plan.mjs --file reviewed-staged.csv \
  --accounts verified-consents.json --from 2026-12-01T14:00:00Z \
  --out proposed-schedule.csv
```

The helper rotates accounts, observes Chicago publishing hours and DST, consent
expiry, source scope, per-account limits, a 60-minute gap and default 5/day and
150/month caps. It preserves pending/rejected rows, refuses existing assignments,
and fails instead of writing a partial schedule when capacity is insufficient.
It does not connect to the backend or activate publishing. Its capacity estimates
assume an empty publication schedule; reconcile existing posts and slots first
when adding a later batch. The publisher remains the authority for live quotas.

Proposed slots now span the whole publishing day instead of filling an early
five-hour burst. Slot variation is stable for the batch and Chicago date, so a
rerun produces the same proposal. No post receives views merely because another
post was scheduled or published. Do not use account rotation to imply independent
firsthand authorship: source attribution and real account consent still apply.

Validate the resulting file against the original sources, review its checksum,
then use the existing `editorial-review.mjs --action schedule` operation. Backend
approval revisions and current account permission are rechecked at scheduling
and publication. A schedule proposal never grants account permission or approval.

For this low-volume CSV workflow, the existing Supabase timer avoids an additional
Worker, stored account refresh tokens and a second scheduling system. Apify import
and rewriting remain explicit preparation steps; this release does not enable
continuous scraping or model inference. Initial preparation installs no accounts,
stages no posts, starts no new paid resources, and leaves publication paused.

## Actual readership reporting

The owner dashboard reads actual opens from `private.post_view_totals`, never
generated display offsets. It shows all-time measured opens, posts with recorded
opens, actual opens on reviewed/scheduled publications, successful publication
receipts in the selected period, and all-time successful receipts. Drafts and
planned slots are not publications. Reviewed publications are excluded from
organic question/experience counts; genuine member replies remain real activity.

Post-view totals begin at the view-tracking rollout, apply the existing daily
repeat-open filtering, and are not unique visitor counts. The retained counter
does not support historical 7/30/90-day view totals; only publications use that
period selector. Missing metrics on an older isolated environment display as
unavailable, never fabricated zero. No public operations panel or extra tracker
is added. The live owner/session authorization stays in place.

## Legacy tactical view implementation (inactive; not approved for activation)

Generated counts are not actual readership. Keep this legacy feature disabled;
the current release does not activate it or publish invented views. Use any
24/36/48-hour scenario only as a private forecast, not a public counter. The
implementation below documents the earlier inactive migration for operators.

The private `tactical_views_enabled` setting is configured on, while the global
publisher and its timer stay off. It does not start publication or change any
current post count. Newly published tactical posts use a gradual synthetic curve
instead of receiving the earlier immediate 500–2500 starting value.

At successful publication, a private profile stores random milestones once:
450–550 at two hours, 1800–2200 at twelve hours, then a slowing curve toward a
4200–5000 target over 7–14 days. The synthetic curve starts at zero. Reads and
retries never reroll it. Growth is calculated from original publication time on
existing view API reads, without extra jobs, polling services or hourly writes.
Existing browser cache behavior remains unchanged; an already-open page is not
guaranteed to refresh its displayed value without another read or navigation.

Measured opens are added for display with a hard 5000 cap while tactical mode is
active. `private.post_view_totals` continues to store all actual measured opens,
including any above 5000. Synthetic values are not added to analytics, ranking or
ordinary member/imported posts. These are generated display offsets, not measured
traffic or historical visitor estimates. Disabling tactical mode restores the
measured count, which can exceed 5000.

The first activation records a fixed 336-hour campaign deadline. Synthetic growth
freezes at that deadline even for posts that have not reached their final target;
late posts are not accelerated. Posts published after expiry receive no synthetic
growth. Actual measured opens can continue contributing up to the tactical display
cap. Switching off and back on never extends the campaign, rerolls profiles or
raises the cap. A further campaign or a cap above 5000 requires another owner signoff
and an explicit backend change. No automatic campaign renewal is installed.

Operator-only configuration, with no frontend controls or operation labels:

```sql
select private.editorial_configure_tactical_views(true,500,2500);
select private.editorial_configure_tactical_views(false);
```

The old 500–2500 parameters remain for compatibility with legacy seed records;
they do not change the new curve milestones, deadline or hard 5000 cap.
Disabling the setting removes the offset from subsequent backend responses.
`editorial_stop_all()` also removes offsets from responses by switching the global
publisher off. Seeds remain private so re-enabling does not generate a different
number for an existing post. Already-open browser tabs can retain cached counts
until reloaded. No source or existing post is backfilled. Campaign dates and
profile counts appear only in the existing private operator status response.

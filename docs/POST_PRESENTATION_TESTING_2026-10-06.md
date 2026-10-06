# Post presentation and ten-user messaging verification

Checked October 6, 2026 UTC (October 5 evening, America/Chicago).

## Implemented in this PR

Remove import badges, import counters, archive/run summaries, original-source links,
source-specific notices, and source-comment labels from feed, tags, questions and
answers. Keep provenance fields in data for maintenance; no source data is deleted.
Use neutral score/reply wording. Do not relabel source shares as member view counts
or add nonfunctional voting buttons.

Only native content with a nonempty account ID and username offers Message author.
Imported records remain ineligible even when a forged author ID is present or
source URL is absent. Own posts do not offer self-messaging. Real member replies
to imported questions remain messageable. Guest links lead through the existing
login flow. Database RPCs still resolve registered profiles and enforce chat access.
The preview-only local conversation path also rejects accountless/imported authors.

## Live observations (read-only)

Preview: https://visaflow-dev.varunchinna5966.workers.dev/

- Browser audit traversed all 29 pages: 563 unique post cards, all using the existing
  apify-prefixed IDs. Zero per-card messaging links, zero source links, zero import
  badges. One text scan match was the word “imported” in a user's discussion of
  pharmaceutical products, not a UI label; original content was not rewritten.
- Sample detail page `apify-2286637262151389` still displays Originally shared,
  Original discussion, Original comment, source guidance, and source-reaction ARIA
  text. No author-message action was present. A second detail was also inspected.
  This is not an individual detail-page inspection of all 563 records.
- The separate legacy Supabase posts table contains 500 r2 records. All 500 have
  external IDs and R2 keys; none resolves to a profile through user_id or
  created_user_id. Do not add these to the 563 as if they were distinct records.
- Hosted database currently has zero native questions, two profiles, and zero
  direct messages. No hosted test records were inserted.
- A visible feed post contains contact information; masking of imported text is
  incomplete. This presentation PR does not certify every post for public release.

## Automated evidence

`npm run typecheck`, `npm test`, `npm run build`, and `npm run check:secrets` pass.
98 tests across nine suites, including:

- 12 rendered component tests use actual QuestionCard/QuestionDetail/helper code.
  Cover source URL present/missing, spoofed imported author, missing account,
  self, guest, registered author, and mixed imported/native replies. Test visible
  markup and ARIA labels, not just string searches in component source.
- 15 ten-user messaging tests run the application's seven messaging/core migrations
  in disposable PGlite PostgreSQL. Ten auth rows trigger ten unique usernames;
  ten synthetic questions, ten conversations, and thirty messages are exercised.
  All eighty outsider/conversation combinations deny reads, sends, conversation
  responses, and private broadcast access. Tests also cover request acceptance,
  idempotent send retries, read receipts, blocking, anonymous/self/unknown-recipient
  attempts, and forged direct-table writes.
- Topic references are three inspected public posts: passport processing,
  H-1B extension/premium-processing timelines, and Canada/Mexico stamping.
  The test fixture stores only IDs/topics, never copied personal stories.

Run focused checks:

```sh
npm run test:presentation
npm run test:messaging
```

These are ten isolated test identities, not ten hosted signups or ten autonomous
LLM users. Auth and Realtime infrastructure interfaces are emulated; application
SQL, triggers, functions, grants and RLS are real. Email delivery, CAPTCHA,
OAuth, hosted browser interactions, and WebSocket network transport were not
verified by these tests. Temporary data disappears when the test database closes.

## Deployment boundary

Base: `release/visaflow-consolidated-20261002` at
`9fd9c6fafe58600f69b82c9810962dc8a2c0e89a`.

The live preview is branded VisaThreads and includes additional changes absent
from this newest available GitHub branch. Searches did not recover its newer
source. This PR must be ported onto that deployed source before release; do not
overwrite the newer preview with this older base. No merge, deployment, or
production migration was performed. Existing production gates still apply.

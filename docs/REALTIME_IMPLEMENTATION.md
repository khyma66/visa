# Connected realtime MVP — September 10, 2026

Later production-hardening work added moderation, posting limits, recovery screens, release gates and a republished preview. See [the current production-readiness record](PRODUCTION_READINESS.md); the details below describe the earlier realtime implementation and its verification.

Verified development URL: http://localhost:3000. Supabase project: `cycnichledvqbxevrwnt` (resumed and active). The existing hosted Worker preview was not republished in this change.

## What is actually implemented

| Area | Connected implementation |
| --- | --- |
| Accounts | Supabase email/password sessions, automatic pseudonymous profiles, profile hydration outside the auth callback lock |
| Native questions | Durable questions/answers/votes and author-only accepted answers; server-side permissions, indexed search and 50-row cursor feed pages |
| Tags | 22 canonical deterministic topic rules; automatic inference when question tags are empty; user-selected question tags remain curated |
| Discussion awareness | Answer topics are indexed separately. Comments contribute to retrieval without rewriting the question’s curated tags. Draft suggestions debounce 200 ms and discard stale responses. |
| Imported posts | Existing paged daily Apify feed; new VisaFlow replies live in `imported_answers`, shared across users, never posted back to Facebook. New reply topics also participate in discovery. |
| Live updates | Database changes emit ID-only invalidations to question/topic/conversation/user channels. Logged-in clients re-read authorized durable data; shared subscriptions avoid duplicate channels. Reconnection and browser focus reconcile missed changes. |
| Direct messages | Persistent one-to-one conversations, request/accept/decline/block, one introductory message before acceptance, read receipts, 50-message history cursors, retry-safe message IDs, server-side send/request limits |
| Privacy | Private-channel membership checks plus table RLS. Outsiders cannot read/send messages or join a conversation channel. Anonymous browsing remains available; background live subscriptions require login. |

## End-to-end flow

1. While a user types, the client extracts canonical topics and keywords without an AI request. After a 200 ms pause, `discover_community` queries indexed native questions/answer topics and imported-comment topic hints. A cached client index covers the small imported archive. The top five mixed candidates show matching-topic reasons.
2. Publishing a question or reply authenticates the author and commits the row to PostgreSQL. Triggers derive topics, maintain counts and broadcast an ID-only `changed` event to affected topics and the question.
3. Other signed-in viewers subscribed to those topics re-fetch the visible data and related matches. Unsaved drafts influence only that author’s suggestions, not other people’s feeds.
4. Sending a message locks and checks the conversation/request state, checks the sender limit, and stores a unique message ID. Broadcast notifications reach only the participant conversation and inbox channels. Recipients fetch messages through RLS-protected reads. Retries reuse the ID instead of inserting duplicates.
5. Apify remains a development/source-ingestion path, independent from member posting. The configured daily run is discovered through the latest-successful-run endpoint with a five-minute source cache. This archive is not a permanent accumulation of every historical run: durable ingestion of all previous runs is still a separate backlog item.

The ranking is our deterministic MVP algorithm, not a claim to reproduce Stack Overflow’s proprietary recommendations. There is no per-post LLM/embedding bill. Scoped broadcasts reduce unrelated fan-out; database/realtime reads and deliveries still incur provider usage.

The layout takes inspiration from [Stack Overflow’s post summaries](https://stackoverflow.design/system/components/post-summary), and chat requests/acceptance from [Reddit’s chat workflow](https://support.reddithelp.com/hc/en-us/articles/39411701270036-How-to-use-Reddit-Chat). The implementation uses the existing React interface, not copied platform internals. [Supabase recommends Broadcast](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes) for scalability over broad Postgres Changes subscriptions, with [authorization policies](https://supabase.com/docs/guides/realtime/authorization) on private topics.

## Applied database changes

The community core and security-invoker views, realtime discovery/message requests, narrow community API hardening, and imported-comment discovery migrations were applied to the resumed project. Existing legacy posts were preserved. The core migration also accommodates an existing `pg_trgm` extension installed in a different schema.

The hardening migration covers only the new community APIs. It removes anonymous execution of private chat/accepted-answer operations and enforces answer ownership. It does **not** lock down legacy tables or unrelated legacy functions.

## Verification evidence

- Local PostgreSQL tests: request lifecycle, outsider denial, direct-insert denial, idempotent sends, blocking, accepted-answer ownership, comment-derived tags, archived-answer exclusion, imported-comment discovery, small broadcast payloads, and cursor pagination with 60 tied timestamps.
- Client tests: draft/comment topic boosts, aliases, archive/promotion/self exclusion, remotely derived imported topics, shared channel lifetime and cleanup.
- Hosted Supabase test: three separately authenticated disposable accounts; actual WebSocket inbox/question/chat events; message delivery, request restriction, outsider channel/read denial, acceptance/reply/read/block, native tagging, accepted-answer authorization, and anonymous public mixed discovery.
- One hosted message delivery measured 275 ms (another run: 307 ms). These are connectivity observations, not percentile/scale promises.
- Browser: connected public detail renders imported text/comments and five related posts; messages require real login instead of silently using the demo identity.
- TypeScript and application build pass. The local sandbox prevented writing Wrangler’s optional log outside the workspace; build output still completed successfully. The compatibility layer reports its existing experimental/static route-classification notes.

Live tests use reserved `example.test` fixture users and never send signup emails. Run only after provisioning known disposable accounts into ignored `.local/realtime-fixtures.json` and loading `.env.local`: `node --env-file=.env.local scripts/test-live-realtime.mjs`. An administrator must remove the exact fixture rows/accounts afterward; the test deliberately cannot delete arbitrary application data. The database fixture insertion does not validate email signup delivery or confirmation links.

## Remaining gates — not skipped silently

1. **Legacy database security:** Supabase still reports 15 old public tables without RLS, including legacy `group_messages`, `message_read_receipts`, `posts`, and `comments`; legacy functions and leaked-password protection also have advisor findings. An automatic approval review rejected broad legacy access changes because they could break other workflows. Owner approval and compatibility review are needed. [RLS finding remediation](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public).
2. **Production identity:** verify real email signup/confirmation/recovery, SMTP delivery and allowed origins. No external emails were sent during tests. Rotate credentials previously exposed in this project/conversation/history before a public launch.
3. **Public deployment:** rebuild/publish the connected development Worker with correct environment/secret configuration and verify hosted authentication. Only the local connected version was verified in this change.
4. **Capacity:** this is not million-user certified. Load-test realistic concurrent sockets, hot topics, search p95/p99, reconnect storms, database CPU and cost before raising provider quotas. The current subscription scope covers up to five active discovery topics, not a global every-post firehose.
5. **Large datasets/threads:** the imported archive is client-indexed only at development size; migrate historical ingestion into a durable indexed store before it grows. Native answers are currently capped at 100 and inbox conversations at 50; add older-answer/inbox pagination before supporting very large histories. Candidate selection is bounded, so relevance/recall needs a corpus benchmark.
6. **Trust and operations:** reporting/moderation/admin tools, question/reply abuse controls, attachments, notifications, backup/restore drills, retention and account deletion remain follow-up work. Chat is access-controlled, not end-to-end encrypted.

Recommended next architecture stays on the current website host + Supabase Auth/Postgres/private Broadcast, with indexed deterministic retrieval. Add hybrid/vector retrieval or a separate managed chat transport only after measured quality/capacity gaps justify their cost and synchronization complexity.

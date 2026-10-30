# VisaFlow scheduled synthetic community tests

This implements the small Cloudflare Cron + Worker + D1 + optional Workers AI design in the [Perplexity proposal](https://www.perplexity.ai/search/e56cb87d-74e5-4390-bf58-a64ffd760bd5). The proposal is reference material; its untested skeleton was not executed. This adapter uses the repository's actual Supabase tables, permissions and policy receipts.

## Status and verification

Implemented on `dev/free-tier-scale-tests`. **Not deployed or scheduled on a hosted account.** The checked-in Worker is disabled. On October 29, 2026 (Central time), the Supabase dev dashboard was reconnected; Cloudflare deployment authorization was pending. The Supabase connector still points to another account, so dev checks use the authorized dashboard. Production is not an alternative target.

The refreshed dev organization dashboard showed Free status, 265/50,000 MAU, 4,894/2,000,000 Realtime messages, 0.009/5 GB egress and approximately 30 MB database size. Its historical peak was 103/200 Realtime connections; this is not the current connection count. A read-only dev database audit found zero test accounts remaining, zero enabled Supabase webhook triggers and zero public/private function bodies matching outbound HTTP/email call patterns. Those checks do not replace the remaining Auth configuration, Cloudflare plan and deployment checks.

Verified locally:

- 16 controller/security tests pass, including a simulated month of 300 actions, overlapping cron events, failure without retries, interrupted-write reconciliation, reply ownership, cleanup ownership and invalid AI output.
- A real local Supabase Auth/PostgREST/database run passed with 10 distinct accounts, 10 questions and 20 cross-user replies. Every persisted action was read back and matched. All ten accounts and their posts/replies were removed and their absence verified. Report: `.local/community-runner/local-protocol.json`.
- Worker binding types, TypeScript entry point, deployment bundle dry run and repository secret scan pass. The existing 14 multi-user safety tests also pass.

The controller tests accelerate the schedule; the local protocol check uses actual Auth and database permissions. Neither proves hosted CPU usage, AI quality, browser behavior, or a month of uninterrupted operation. The earlier hosted 100-user concurrency result remains documented in `tests/scale/MULTIUSER.md`; this scheduled runner serves a different purpose.

## What runs

- Exactly ten dedicated test identities. No Gmail passwords or browser-login automation. The operator creates `@example.invalid` accounts in the dev project only.
- Input is a JSON array of 1–500 **synthetic** questions. Each question becomes one post and two replies from other accounts. Extra queued questions wait; the budget does not increase with the input size.
- At most one reserved action per two-hour UTC slot, ten per UTC day and **300 total actions per UTC month**, including failures and replies. A full 300-action month is 100 questions plus 200 replies. This is deliberately more conservative than 300 questions plus replies.
- The campaign ends within 31 days. Free-plan and outbound-hook evidence must be checked initially; the runner pauses once its quota evidence is over seven days old. Refresh the evidence after actually reviewing usage. It is not an unattended, permanently enabled public-content generator.
- `fixtures` mode is the default and makes zero AI calls. `ai` mode makes at most one bounded call per action, with a fixed model and a 400-output-token limit. The model only supplies text. It cannot choose identities, tables, targets, URLs or tools.
- A/B balances a concise-clarification style and a checklist/follow-up style across threads and identities. Every ten-question block flips the assignment so the same account can experience both variants. The ledger records variant, completion, failures and duration. This compares synthetic workflow behavior; it is not evidence of real-user preference or conversion.
- Every title and body is visibly labeled synthetic. Replies are restricted to this campaign's persisted questions. There are no votes, private messages, email/SMS, external links or promotion tasks.

## Isolation and credentials

The executable target is fixed to `https://ppdwysmeistjxzjpmxyk.supabase.co`. Production and arbitrary origins are rejected, including redirects. The Worker receives only a publishable key and ten ordinary test-account credentials in Cloudflare secrets. Its Auth lookup verifies the user ID, reserved email, ordinary role and trusted `app_metadata` before each action. It never uses editable user metadata for authorization.

Each invocation signs in only its selected actor, then signs out that session. Access/refresh tokens are not persisted. Ten generated test passwords live in one Cloudflare secret, below the binding size limit; there is no session vault or Gmail account management. The local operator uses the dev admin key only for provisioning/cleanup and never passes it to the Worker or writes it to disk.

No Supabase schema migration or widened column grant is needed. The app assigns post/reply IDs itself. The runner stores the resulting ID in D1. A unique campaign/job marker in each body permits exact read-back after a lost response. A failure pauses the campaign without retrying writes. An invocation killed without handling an error leaves a durable running record; a later invocation only reconciles an exact existing row, and pauses if the result is uncertain. Keep the ledger: replacing it resets its usage counters.

This version relies on the separate dev database for isolation. Dev search and analytics can include these labeled fixtures. It does **not** add a production-wide synthetic flag or exclusions across reputation, notifications, analytics and RAG. Public automated posting on `visathreads.com`, or using real member accounts, is outside this implementation. Outbound hooks must be verified disabled on dev before activation.

## Free-tier assessment

Checked against official documentation October 29, 2026:

- [Workers Free](https://developers.cloudflare.com/workers/platform/limits/) allows 100,000 requests/day but only 10 ms CPU per cron invocation. Waiting for network responses does not count as CPU. The small bundle and low frequency make this plausible, but **deployed CPU measurements are still required**.
- [D1 Free](https://developers.cloudflare.com/d1/platform/pricing/) includes 5 million rows read/day, 100,000 rows written/day and 5 GB total storage. This ledger uses bounded indexed queries and at most 1,500 queued actions.
- [Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/) includes 10,000 neurons/day. The fixed Llama 3.1 8B model does not require a paid model tier; allowance is shared with other account usage. `fixtures` mode avoids inference entirely. AI has not been called in this implementation check.
- This runner uses no Realtime sockets. The [Supabase connection ceiling](https://supabase.com/docs/guides/realtime/limits) is therefore not its limiting factor. Auth, database and egress usage still count.

No plan upgrade, payment, new billing agreement or paid fallback is part of this setup. A true Free-plan resource limit should stop the run. If the account is already Paid, these local limits do not enforce account-wide zero spending; do not enable the runner under a zero-cost requirement until the actual plan and remaining usage are checked.

## Local commands

Run from the repository root:

```sh
npm run test:community-runner
npm run test:community-runner:protocol
npm run runner:plan -- workers/community-runner/questions.example.json
```

The protocol test requires local Docker and Supabase CLI. It uses the existing disposable local test stack and selected application migrations; it is not a full migration-history replay. Never run it alongside the other local protocol tests. Planning writes a non-secret manifest and D1 import SQL under ignored `.local/community-runner/`, with a new campaign UUID. It does not contact a hosted service.

## Activation sequence after connections are restored

The agent can perform this sequence; it is not a request to repeatedly paste commands or keys.

1. Reconnect the intended Cloudflare account and exact Supabase dev project. Verify Workers/D1/Supabase Free status, remaining usage, cron capacity and disabled outbound hooks. Retain the actual evidence. Use the existing `tests/scale/limits.example.json` format for `RUNNER_QUOTA_EVIDENCE`; provisioning checks the evidence is less than one hour old.
2. Create one D1 database named `visaflow-community-runner-dev`, put its ID into this directory's `wrangler.jsonc`, apply `schema.sql`, and import the generated plan SQL. Start with the included ten-question canary rather than a large queue. Do not import plans into an existing non-empty campaign ledger.
3. Fill the non-secret campaign ID/start/end and evidence date. Leave `RUNNER_ENABLED=false` and `CONTENT_MODE=fixtures`. Deploy this disabled Worker, with no public route.
4. Run `node workers/community-runner/operator.mjs provision PLAN.json` in a private process with the dev admin/public keys and `RUNNER_QUOTA_EVIDENCE` provided through environment variables. It checks Cloudflare authentication before creating accounts, records each reserved email before creation, creates ten test accounts, accepts the app's test policy through ordinary-user sessions, signs out and sends only the two Worker secrets through Wrangler stdin. No password file is retained. A partial setup must be cleaned, not blindly repeated.
5. Enable the Worker for the canary only after checking the exact dev site's configuration and Free-tier headroom. Observe one question and its two replies in the dev UI, account labels, author separation, persistence, duplicate-event behavior and Worker CPU. Inspect errors and D1 state. A Cron/Supabase API pass is not a browser UI pass.
6. Add reviewed questions with `node workers/community-runner/operator.mjs append PLAN.json MORE_QUESTIONS.json`, then import only the emitted append SQL into the same ledger. This preserves IDs, assignments, history and counters; repeating the SQL fails on primary keys rather than duplicating jobs. Enable AI only after a bounded labeled output canary and an allowance check. Observe a week before extending use. Refresh quota evidence weekly; never just change its timestamp without checking.

The Worker has no public run/enrollment endpoint. Configure it using the CLI and secrets. Stopping is `RUNNER_ENABLED=false` plus redeploy, and `UPDATE runner_control SET paused=1,reason='operator_stop' WHERE id=1` in its D1 database. Wait for in-flight work to finish before cleanup. Each network call is capped at ten seconds; text generation is capped at thirty seconds, and a paused ledger is rechecked immediately before a write.

For a paused or interrupted job, inspect the saved ID/marker and exact remote content. Never set a running job back to ready merely to retry. Exact existing content can be reconciled; an absent/ambiguous write needs investigation. Account, quota, network or schema failures are not reasons to reset the test project.

## Cleanup and reporting

After stopping the campaign, `node workers/community-runner/operator.mjs cleanup PLAN.json` requires the dev admin key and `RUNNER_STOPPED_CONFIRMED=true`. It reconciles reserved Auth emails, verifies trusted ownership, checks all planned question/reply markers and parents, and refuses foreign replies/votes, conversations, imported replies, unrelated votes or moderation reports. It bans the test accounts, removes their content and deletes the accounts, then checks their absence. Preserve the manifest on any refusal or partial failure. This operator path has ownership unit tests; hosted provisioning/cleanup for the new runner has not yet been exercised. The disposable local protocol cleanup has passed.

After cleanup, remove `RUNNER_ACTORS` from the disabled Worker; retain only non-secret ledger/report evidence as needed. Deleting an Auth user is not instant revocation of an already issued JWT, so stop all actors and complete cleanup together.

Example read-only ledger report:

```sql
SELECT variant, kind, status, COUNT(*) AS actions,
       AVG(duration_ms) AS average_workflow_ms
FROM runner_jobs GROUP BY variant, kind, status;
```

`duration_ms` is controller workflow time, not pure database latency. Fixture-mode A/B text and AI-mode A/B text are separate experiments; record the chosen mode with the report. Failures and missing observations must remain visible.

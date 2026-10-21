# Multi-user tests on Supabase Free

## Maximum versus tested capacity

Checked October 21, 2026: Supabase Free permits **200 concurrent Realtime connections**, **100 Realtime events/second**, **100 channel joins/second**, and includes **50,000 monthly active users** and **2 million monthly Realtime messages**. The database allowance is 500 MB, and uncached egress is 5 GB. Sources: [Realtime limits](https://supabase.com/docs/guides/realtime/limits), [pricing](https://supabase.com/pricing), [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).

200 connections is at most 200 users if each has one connected client and no other sockets use the project. Extra tabs, background clients and reconnect overlap reduce the number. Monthly active users are not simultaneous users. There is no single guaranteed maximum for non-Realtime traffic; workload, query costs, database resources, request rates and remaining allowances determine it.

This harness supports **10 → 50 → 100 users**. It intentionally refuses 200: the enforced test maximum is 100, existing connections plus the cohort cannot exceed 150, and at least 50 connections remain reserved. This is a conservative operator policy, not a provider guarantee. It does not change the provider limit or prove 100-user hosted capacity.

## Implemented and verified

`npm run test:multiuser` runs the same paired-message journey at 10, 50 and 100 distinct local PostgreSQL identities using the real application migrations and RLS. Each user sends and reads a partner message; every pair checks idempotency, conflicting-ID rejection, outsider read/write denial, read receipts, blocking and persistent history. The local tests also exercise posting, replies, votes and accepted answers. The 100-user case has 50 conversations and 100 messages, plus 50 posts, 50 replies and 100 votes.

The local tests use an in-process disposable database. Local Auth and Realtime are platform stubs, not real logins/WebSockets. Thirteen tests passed across the three local cohorts and safety/failure checks. This is functional coverage, not a hosted concurrency benchmark.

Hosted commands are implemented for provisioning, ordinary-user execution and cleanup. They **have not been run against hosted Supabase** because the connector still denied access to `ppdwysmeistjxzjpmxyk`; no dev administrative key or verified account quotas were available. Reconnection must grant access to this exact dev project. No production or unrelated Supabase project is a substitute.

## Run the local tests now

```sh
npm run test:multiuser
```

Requires the repository's pinned dependencies (`npm ci` on a fresh checkout). No new packages, migrations, website deployment or paid resources are required. These tests are also included in `npm test`.

## Prepare a hosted run

Use one operator process/check-out and an exclusive dev testing window. The target is fixed to the existing dev project and `visa-central.com`. The old Wrangler environment named `development` serves the live site and is not used here. Both provisioning and execution first run the existing six-GET canary against the independently recorded clean dev deployment.

1. Inspect the dev account's **actual Free subscription and remaining allowances**, current Realtime usage, database size, deployed migrations and Auth configuration. Verify no outbound Auth/database hooks can send notifications or invoke paid services. The admin-created test accounts use reserved `example.invalid` addresses with `email_confirm: true`; no confirmation email is requested. Do not disable CAPTCHA or production protections to make password login work. If the configured dev Auth flow requires an unsupported challenge, leave this protocol test blocked.
2. Copy `tests/scale/limits.example.json` to ignored `.local/multiuser/limits.json`. Replace its null/false entries with recently observed values. `checkedAt` is an ISO timestamp valid for at most one hour; `applicationCommit` is the 40-character SHA returned by the verified dev deployment. The file is operator-recorded evidence, not an automatic provider quota lookup. Never invent values merely to pass the check.
3. Ensure background events ≤20/sec, database size ≤400 MB, remaining uncached egress ≥50 MB, remaining Realtime messages ≥20,000, and remaining MAU ≥cohort size. These deliberately conservative reservations cover this short functional test, not future soak tests. The limits may be lowered after measuring real service behavior; do not raise them to fit an unverified run.
4. Supply `VISAFLOW_MULTIUSER_PUBLIC_KEY` with the **dev publishable key**. Administrative commands additionally require `VISAFLOW_MULTIUSER_ADMIN_KEY`, the **dev secret API key**, in the process environment. No application `.env.local` is loaded or reused. Keep all keys out of source control, command-line arguments, screenshots and chat.
5. Supply `VISAFLOW_MULTIUSER_ENCRYPTION_KEY`, a separately generated 32-byte hexadecimal key kept in a local secret manager. Credentials are AES-256-GCM encrypted and bound to the run UUID. Files are owner-readable/writable only under ignored `.local/multiuser/<run-id>/`. Preserve the encryption key until the test finishes; cleanup itself needs only the manifest and admin key.

For 50/100 users, `previousStage` must identify the immediately smaller stage with `passed: true` and `cleanupVerified: true`. `previousRunId` must reference its actual local manifest, passing hosted result and passing cleanup report. The CLI checks those artifacts and requires the same application commit. Local database tests cannot unlock a hosted ramp.

## Hosted lifecycle

```sh
# Administrative provisioning process, with dedicated dev admin key available:
npm run scale:multiuser -- provision 10

# Separate ordinary-user process: unset VISAFLOW_MULTIUSER_ADMIN_KEY first.
# Use the run UUID printed by provisioning; public key and encryption key required.
npm run scale:multiuser -- run RUN_UUID

# After the runner exits, administrative cleanup process:
npm run scale:multiuser -- cleanup RUN_UUID
```

Do not paste `RUN_UUID` literally: use the generated identifier. Create a fresh cohort for the next stage; accounts are single-use. A failed or interrupted run must be cleaned rather than reused. The manifest records every planned account UUID before creation, so cleanup can inspect even an account whose creation response was lost. The manifest also retains provisioning failures.

Provisioning sets a trusted `app_metadata` run identifier and purpose. Actor execution verifies the server-authenticated user UUID, email, ordinary role and trusted metadata; creates a separate session/client for each actor; checks profiles and empty conversations; accepts the current policy through the real user permission path; and acknowledges each private inbox subscription. All actors remain subscribed through a 30-second initial hold and the paired journeys. Active-conversation subscriptions are added as each pair exchanges messages.

For each delivery, the receiving actor must observe an actual private Broadcast invalidation and then read the exact message UUID from persisted history. The reply references the observed message. A transport event alone cannot pass delivery. Latency is measured in one runner from send start through recipient event and history read; it is not pure one-way network latency. No AI calls, SMS, scraping or browser sessions are made. Native posts/replies/votes/accepted answers use ordinary Supabase sessions and current application interfaces.

## Safety and evidence

- At most 100 accounts/clients; sequential setup; one HTTP request start every 300 ms globally; password sign-ins at least 2.1 seconds apart. Admin provisioning uses the same request budget.
- Each command has a 20-minute deadline, 3,000 HTTP-request budget and 20 MiB decoded HTTP-response budget; each response is limited to 2 MiB. Actor execution also stops above 20,000 observed Broadcast events. These are local bounds, not a billing guarantee or complete metering of WebSocket protocol overhead.
- Redirects and requests to any other backend origin are rejected before credentials are sent. HTTP 429/5xx responses and subscription failure stop the run without automatic retries. A deliberate duplicate-message assertion is the only repeated logical write.
- Refresh is disabled for this short test; sessions must have enough validity remaining. A disconnect fails the test instead of starting a reconnect storm. Reconnect/recovery and session-refresh tests are not covered.
- Ctrl-C aborts work and closes sockets. `.local/multiuser/STOP` prevents new test requests. Cleanup remains available with STOP present. One `.local/multiuser/active.lock` excludes overlap in this checkout; after a crash, verify no actor process remains before removing a stale lock. It is not a cross-machine distributed lock.
- Cleanup is a separate explicit command, including after failed provisioning. It verifies trusted Auth ownership and the entire affected data graph before mutations, rejects foreign replies/votes/conversation participants, bans test accounts, deletes test-owned records in dependency order, deletes Auth users and verifies absence. It preserves reports on failure. Do not run other test writers during cleanup. It is not a transactional cleanup endpoint; unexpected concurrent external writes require investigation.
- Best-effort sign-out is recorded separately and can fail after cancellation/budget exhaustion. Account deletion is not instant revocation of every already-issued access JWT; keep tokens private, close all clients and complete cleanup. No session token is persisted by the runner. Successful cleanup removes the encrypted password artifact.

`result.json` records authenticated users, one-second inbox subscription samples, the peak and all-ready interval, distinct senders/recipients, persisted pair IDs, correlated delivery observations, content counts, request usage, deployed application commit and the quota evidence. `cleanup.json` is separate and must pass before progressing. Do not treat the prefilled `cleanupVerified: false` in a run result as a failure of cleanup that has not yet run; the cleanup report is authoritative.

Remaining coverage limitations: actual browser interactions, unsolicited external traffic, live database CPU/health streaming, unauthorized private-channel join probes, detailed latency percentiles, large histories, attachments, notification delivery outside private Broadcast, and distributed/fault/soak load. No claim of issue-free production operation is made.

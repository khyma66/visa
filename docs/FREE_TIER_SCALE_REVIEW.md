# VisaFlow: 10,000-user free-tier feasibility review

Review date: October 21, 2026. Input: the user's `Visaflow_Miro.md` blueprint. Its proposed configurations were treated as design input, not as evidence of capacity or authorization to incur costs.

**Follow-up implementation:** The subsequent user request added the [10/50/100-user testing lifecycle](../tests/scale/MULTIUSER.md): guarded provisioning, encrypted credentials, ordinary-user sessions, private subscription acknowledgments, paired-message verification, posting/replies/votes and scoped cleanup. Local functional cohorts at all three sizes passed. Hosted execution is still pending dev project access and verified quotas. The initial review below describes what had been implemented at the time of that first review; its "unimplemented" Phase 2 notes are superseded by the linked follow-up where specified. The 10,000-user Free-tier decision is unchanged.

## Decision

**Do not run the proposed 10,000-concurrent-user test on hosted Free resources.** The application connects directly to Supabase Realtime, whose published Free ceiling is 200 concurrent connections. Ten thousand is 50 times that ceiling. Moving the load generator to Cloudflare or creating more accounts does not remove it. No paid resources, billing changes, database branches, migrations, bulk accounts or hosted write workloads were created for this review.

Implemented a fail-closed planning command, six-request read-only dev canary, tests for its boundaries, and this discovery report. These are Phase 1 tools; provisioning, leases, authenticated protocol load, browser cohorts, distributed metrics, recovery and cleanup remain unimplemented. The document's Phase 2–5 acceptance criteria have not been met. No claim of issue-free operation or zero cost is made.

## Verified source and environment

The initial local `visa` checkout had extensive unrelated uncommitted changes on `release/visaflow-consolidated-20261002`; those files were preserved. The remote dev-sync branch `fix/dev-sync-legacy-baseline-20261020` was inspected. Dev health identified a newer clean deployed commit, `6f494db74c00feb652adcb49a5b12960de23793f`. A separate worktree and local `dev/free-tier-scale-tests` branch were based on that exact deployed commit.

| Purpose | Site | Worker/environment | Supabase reference |
|---|---|---|---|
| Development | `https://visa-central.com` | `visathreads-sandbox` / `sandbox` | `ppdwysmeistjxzjpmxyk` |
| Existing live site, excluded | `https://visathreads.com` | `visaflow-dev` / historically `development` | `cycnichledvqbxevrwnt` |

The word `development` is not a reliable deployment selector: the historical `build:dev` command on the deployed source still builds the live Worker. The dedicated `scripts/development-site.mjs` validates the isolated dev target. Do not use the old local checkout's deploy commands to infer the current release workflow. No deployment is required for operator-side testing tools.

Read-only checks confirmed dev health HTTP 200, clean expected commit, `siteOrigin=https://visa-central.com`, development environment, configured status and noindex headers. The live login page contains sign-in UI; the older local browse-only note is stale. This is not proof that signup/email/password/CAPTCHA flows work. `/api/assistant` returns all three capabilities false. Health explicitly reports `dependencyCheck: not-performed`; it does not prove database readiness or isolation of every runtime request.

The connected Supabase project-details request for the exact dev reference returned a permission error. Consequently its actual subscription, remaining quota, Auth settings, current schema, compute and connection limits were **not verified**. No unrelated project connector was used as a substitute. Cloudflare billing and current request usage also remain unverified.

## Published limits and workload arithmetic

| Resource | Published Free allowance/limit | Consequence |
|---|---|---|
| Supabase Realtime concurrent connections | 200 | Hard blocker for 10,000 concurrent identities |
| Realtime events / joins | 100 events/sec; 100 joins/sec | Ramp and fanout must be measured and paced |
| Realtime monthly messages | 2 million | Includes deliveries; logical writes alone are insufficient |
| Supabase Auth | 50,000 monthly active users | 10,000 accounts can fit the MAU allowance in principle, but this says nothing about concurrent capacity or remaining quota |
| Supabase database / egress | 500 MB database; 5 GB uncached egress | Rows, indexes, Auth data and repeated reads need measured budgets |
| Cloudflare Workers | 100,000 dynamic requests/day, 10 ms CPU/request | Shared account usage and actual SSR CPU matter |

Sources checked: [Supabase Realtime limits](https://supabase.com/docs/guides/realtime/limits), [Supabase pricing](https://supabase.com/pricing), [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/). Published values are not guarantees that this account has that much unused capacity. Supabase's paid database branching is not a free substitute for the existing isolated project. Static asset delivery and direct Supabase requests must be accounted separately from dynamic Worker requests.

The blueprint's 10,000 users sending once per minute offers 166.67 writes/sec and 300,000 writes during its 30-minute plateau. The actual schema broadcasts a conversation invalidation and both inbox invalidations. With each pair listening to both its inboxes and its open conversation, that implies at least four recipient deliveries per write: about 666.67 deliveries/sec and 1.2 million plateau deliveries before read receipts and other work. That already exceeds the Free event rate. Clients then re-read durable data, adding database requests. Actual billing/event accounting must be measured; these are offered-load estimates.

Including the suggested 1,000/5-minute, 2,500/5-minute and 5,000/10-minute holds adds up to **367,500 writes and 1,470,000 modeled recipient deliveries** over all holds. Transitions, setup, retries, read receipts, cleanup and other workloads are additional. If every write traversed a Worker, even the 300,000-write plateau would exceed the daily Free request allowance; this app's messaging goes directly to Supabase, so that is a conditional illustration, not a claim about current Worker usage.

At 100 users, the same average is 1.67 writes/sec and at least 6.67 deliveries/sec. This is a reasonable *candidate* baseline, not verified capacity. Use 10 first, retain substantial connection headroom, and stop on any unexpected errors or quota uncertainty. Do not shard across free projects to evade limits.

## Repository discovery and real action map

The active app is Next.js/React built through Vinext/Vite for Cloudflare Workers. Legacy Python backend, pipeline Workers and old configuration files are present but are not evidence of active runtime paths. Primary references are `package.json`, `wrangler.jsonc`, `src/lib/community.ts`, `src/lib/realtime.ts`, `src/components/AuthProvider.tsx` and actual SQL migrations.

| Area/action | Real interface | Testing implications |
|---|---|---|
| Public source feed | `GET /api/community`, bundled archive in dev | Public cached content is not private-message load; do not activate Apify fetching |
| Native feed/page | Supabase `community_post_page`, `question_feed` | Use real pagination/visibility; keep archive and native metrics distinct |
| Search/related posts | `search_questions`, `discover_community`, client discovery index | No invented `/api/search` route; search modes differ by source |
| Native posting | `questions` insert with author, validated inputs | Real Auth, policy acceptance, rate limits and RLS required |
| Replies | `answers` or `imported_answers`; `answer_page` / `imported_answer_page` | Branch on actual parent source; validate permissions and pagination |
| Voting | `vote_question`, `vote_answer` | Ordinary JWT context; uniqueness/upsert behavior already tested |
| Accepted answers | `accept_answer` | Enforce author-only decision and visible parent |
| Start/accept/block chat | `start_direct_conversation`, `respond_to_conversation` | First pending message only until recipient accepts; blocked sends denied |
| Inbox/history | `conversation_page`, `conversation_inbox`, `message_page` | RLS and participant filters; stable timestamp/ID pagination |
| Send/read receipts | `send_direct_message`, `mark_direct_messages_read` | Client message UUID already gives retry deduplication; conflicting reuse rejected |
| Realtime | Direct Supabase private Broadcast, event `changed` | One client socket per actor, shared topic subscriptions; wait for `SUBSCRIBED` |
| Inbox/conversation topics | `inbox:<user-id>`, `conversation:<conversation-id>` | Events invalidate state; fetch durable records under actor RLS before counting delivery |
| Discussion topics | `question:<id>`, `discovery:<tag>` | Topic fanout differs from direct-message pairs |
| Auth | Supabase email code, password and social flows via `auth-flow.ts` | Public provider settings are not proof of successful login; CAPTCHA/provider config must be checked |
| Feedback | `feedback_submit`, `feedback_is_owner`, owner-only inbox/review RPCs | Not a general push notification system; never give test actors owner rights |
| AI | Production assistant code exists; dev capability flags disabled | Keep AI/MiroFish/OASIS off; no LLM spend needed for deterministic tests |
| Health | `GET /api/health` | Build/config check only; no dependency probe |

No supported group direct-message topology or message reply-to field was established in the inspected adapter. Use paired conversations; do not invent group chat to satisfy the blueprint. A reply correlation can be tracked in harness evidence, but must not be claimed as a persisted reply-to relation. No active private-attachment/R2 or queue binding was found in the dev Worker configuration; attachment and queue-fault scenarios remain unsupported/unverified rather than silently added.

### Security and deployment observations

Normal browser operations use the publishable key plus the user's Supabase session. Admin keys must never enter actors/browser bundles. Authorization is enforced by database policies and permission-checked functions; a test header is not a permission bypass. Existing messaging RPCs restrict participants, lock conversation operations, deduplicate UUIDs and apply per-user rate limits. Database write guards require policy acknowledgment. Do not weaken these controls to reach a load target.

The frontend debounces invalidations and re-reads persistent data. Counting `changed` events cannot establish individual message delivery; correlate persisted message UUIDs and successful actor reads. Test refresh and reconnect under real transport, since local Realtime stubs do not exercise WebSockets.

Current migrations create authorization policies on `realtime.messages`; local tests emulate the platform schema. Do not deploy those local platform stubs to hosted Supabase. [The July Realtime schema restriction](https://supabase.com/changelog/realtime-schema-locked-down-against-modification) explicitly retains RLS policy support. [November's TLS change](https://supabase.com/changelog/cbc-tls-ciphers-deprecated) requires supported modern clients. The [Postgres minor-release notice](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes) also warrants project-specific extension checks once access is available; this review did not verify hosted extensions.

WAF/Cloudflare Access/account rate policies were not accessible. Direct Supabase traffic does not pass through the site's Worker WAF. Keep private-data authorization at the database boundary. No new routes, security bypasses or application-side changes were introduced by this work.

## Verification performed

- **9 new safety/tool tests passed:** production/lookalike/project denial before network, blocked plans, six-request bound, redirect/WAF/429/malformed failure, secret-safe diagnostics, expected clean commit, cancellation and oversized responses.
- **155 existing local tests passed** across isolation, 10-user messaging, 10,000-community/100,000-question query plans, native-content permissions, voting and access control. Disposable PostgreSQL/WASM only; no hosted accounts or writes.
- The local 10-user exercise created 10 conversations and 30 messages and checked 80 outsider/conversation combinations. This existing ring topology is not the blueprint's hosted five-pair/WebSocket proof.
- **Six live dev GET checks passed**, including matching clean deployment at start/end and disabled AI capability flags. Raw results are in ignored `.local/scale/`; no response content or credentials are stored.
- No full application build, full repository suite, browser journey, hosted Auth test, hosted migration or 10,000-user run was performed. The new tooling changes no runtime application code and requires no redeployment.
- Existing installed PGlite/TypeScript dependencies were reused for local regressions; no dependency upgrade or package installation was needed. The added tooling itself requires no external dependency.

## Remaining gates and feasible path

1. Verify dev-project/account access, actual free plans, unused quotas, realtime/auth settings, schema version, database/storage size, outbound notification sinks and Cloudflare request/CPU usage. Record evidence with time and expiry. Account permission denial currently blocks this.
2. Implement bounded provisioning for **10** test-owned identities, trusted run metadata, encrypted credentials, policy acceptance, five pairs, real sessions, subscription acknowledgments, persisted send/read/reply checks, outsider denial, and run-scoped cleanup. Honor enabled CAPTCHA/auth controls; do not bypass them or send bulk email.
3. If that proof and cleanup pass, add a global request/event/byte/time budget and a 100-user candidate stage with reconnect limits and health telemetry. Use the actual app interfaces above. Add browser journeys only for a few leased actors.
4. Keep the 10,000-concurrent hosted profile refused under the Free-only constraint. Ten thousand sequential identities in bounded batches could test breadth subject to MAU/storage/egress budgets, but must be labeled sequential and is not implemented. A separate local full Supabase stack could support a hardware-dependent synthetic load investigation; it would not establish hosted capacity.

No upgrade is recommended or authorized by this implementation. The user's free-tier requirement takes precedence over the blueprint's larger target.

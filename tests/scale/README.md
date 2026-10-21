# VisaFlow free-tier testing

This implements **Phase 1 feasibility and a public availability canary**, not the complete 10,000-user harness in `Visaflow_Miro.md`. Hosted authenticated load is deliberately unavailable. See [the discovery report](../../docs/FREE_TIER_SCALE_REVIEW.md) for constraints and the real action map.

## Commands

Use Node 22 or newer from the repository root. These tools use built-in Node modules and add no dependencies or paid services.

```sh
npm run test:scale:free
npm run scale:plan -- smoke-10
npm run scale:plan -- baseline-100
npm run scale:plan -- concurrent-10k
```

Every plan exits **2** because execution is blocked. Its JSON separates modeled work from measured users (all zero). Published ceilings are a dated planning snapshot, not a substitute for inspecting account usage. Recheck the linked provider documentation before revising the snapshot. There is no force flag, paid upgrade, account creation or load runner.

For a small operational check, supply the independently verified current dev deployment SHA:

```sh
npm run scale:canary -- 6f494db74c00feb652adcb49a5b12960de23793f
```

This makes **six sequential GET requests** to the exact dev origin: health, home, login, messages, AI capability flags, health again. It verifies the expected clean deployment at both ends, development environment, noindex headers, app responses and disabled AI flags. It does not sign in or execute browser JavaScript. A redirect, challenge, non-200 response, changed build or malformed API response fails immediately without retries. It does not inspect private data or measure database health.

Requests start at least one second apart, with a 12-second request timeout, 90-second run deadline and 2 MiB decoded-body limit per response. In-flight data can exceed the body bound by a network chunk before cancellation. Reports store route names, status, elapsed time, bytes, commit and configuration hash, never page content or credentials. Raw reports live under ignored `.local/scale/` with owner-only permissions. Normal website traffic still consumes provider resources; this canary does not guarantee remaining allowance or a dollar cost.

Ctrl-C stops the active request. Creating `.local/scale/STOP` stops new requests; remove it when intentionally resuming. An exclusive `.local/scale/canary.lock` prevents overlaps in this checkout. After a crash, verify the previous process ended before removing a stale lock. This is a local process guard, not distributed actor leasing. Multiple checkouts/machines must not be used to amplify traffic.

The canary runs on the operator's machine against the dev site. **Do not deploy the generator inside the application Worker.** No website deployment, database migration, AI binding, or test-control endpoint is needed for these additions.

## Existing free local checks

```sh
node --test --test-concurrency=1 --test-timeout=120000 \
  scripts/test-isolation.mjs scripts/test-messaging-ten-users.mjs \
  scripts/test-community-scale.mjs tests/database/native-content.test.mjs \
  tests/database/voting.test.mjs tests/database/access.test.mjs
```

These run against disposable in-process PostgreSQL/WASM and actual application migrations. The 10-user messaging test checks ordinary-user permissions, durable messages, policy acceptance and outsider isolation. The large-dataset test uses 10,000 communities and 100,000 questions. Neither is 10,000 authenticated users or a hosted WebSocket capacity benchmark.

## Before implementing the next phase

Obtain read-only access to the exact dev Supabase project and Cloudflare account usage. Record plan, current utilization, Auth limits/CAPTCHA, deployed migrations, Realtime limits and error rates, database size/connections, and remaining monthly/daily quotas. No paid Supabase database branch is required: the separate dev project already exists.

Implement only a 10-user hosted proof first, then at most a measured 100-user baseline if quota permits, leaving headroom below 200 connections. Keep actor credentials encrypted, admin provisioning separate from ordinary sessions, fixture ownership trusted, and cleanup verified. Use the application policy-acceptance flow before writes. Match `inbox:<user-id>` and active `conversation:<id>` private subscriptions; wait for acknowledgments and re-read message history under RLS after invalidations. Keep AI, SMS, email blasts and scraping disabled. Expand only after collecting real evidence.

For 10,000 concurrent hosted Realtime users, the existing Supabase Free architecture cannot satisfy the requirement. A fully local/self-hosted stack could test synthetic 10,000-user behavior subject to hardware, but would not prove the hosted dev site's capacity and is not implemented here. Sequential batches of accounts likewise do not satisfy concurrency.

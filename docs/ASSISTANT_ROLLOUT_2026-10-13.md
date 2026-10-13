# VisaThreads discussion assistant — development rollout

Status: implemented in the repository; not deployed or validated with a live model. This replaces the earlier assistant prototype for new work. The old `/api/communities/:id/summary` route remains disabled; the active implementation uses `/api/assistant`.

## Implemented

- Collapsible **Ask about this discussion** and **Summarize discussion** on question/experience pages, with links to cited posts and replies.
- **Ask VisaThreads** at `/assistant`, accessible from the header and community tools. Global post search is included in the first rollout.
- Separately gated community Q&A and **Catch me up**. Intervals: 1 hour, 6 hours, 24 hours, 7 days, or since the last successful complete catch-up. The default is 24 hours; API intervals cannot exceed 31 days.
- Up to three previous user questions support follow-ups. Conversation contents are not persisted by this implementation. Only a timestamp is saved in browser storage, scoped to the account and selected community/feed. Partial or insufficient answers do not advance that checkpoint.
- Native content is retrieved through the signed-in user's Supabase client, current RLS/invoker views, and indexed keyword/tag search. Approved snapshot content supports individual discussions, public Q&A, and public catch-up events within the selected interval. Public catch-up also retrieves current member replies to visible snapshot posts. Imported content is not guessed into native communities. Replies to older posts can appear in catch-up; the older parent is context, not a new event.

Retrieval is bounded to 48 candidates; model input is further bounded to 24 sources and 24,000 characters. Truncation is disclosed prominently. This is not an exhaustive search guarantee, and busy communities may need the shorter intervals.

Global Q&A currently searches native discussions and the approved snapshot. It explicitly reports partial coverage while indexed search of new member replies on snapshot posts is deferred. Those replies are included in individual-post Q&A and public catch-up. Older cited replies can require the discussion's existing **Load more** control.

## Authentication, evidence, and privacy

The API verifies a registered Supabase user, rejects cross-origin browser requests, enforces the feature gates, and constructs its own sources. It never uses a service-role key or accepts client-supplied evidence. Direct messages and chat tables are not searched.

Every returned claim needs a valid source ID and a matching quote from the retrieved text. Disagreements require multiple cited sources. Model text is displayed as escaped plain text; only server-owned internal source links become clickable. Dates, limited coverage, and insufficient evidence remain visible. The assistant must attribute anecdotes to members and cannot verify current visa rules or eligibility.

**A matching quote does not establish that the claim logically follows from it.** Semantic support, missing context, prompt-injection resistance, and immigration-related accuracy still require representative live-model evaluation. There is no verified official-government-source retrieval in this release.

Text is redacted for several common identifiers before inference, but pattern matching cannot remove every personal detail. Selected text is sent to the configured AI provider. The optional OpenAI adapter requests `store: false`; provider-level data handling still needs review before broad launch. No prompt logging or durable conversation archive was added.

Responses use private/no-store browser headers. The internal Cloudflare cache lasts up to five minutes and is keyed by user, request, model/version, and source contents. Retrieval and permission checks precede cache reads; content is rechecked before returning results. Cached responses are not shared across accounts. This favors isolation over maximum reuse.

## Resource controls

Database-enforced starting limits are **30 request/retrieval checks/minute/user**, and for new generation **4/minute/user, 20/day/user, and 500/day/project**. Route checks and database retrieval/revalidation share the first counter, so one HTTP request can consume multiple checks. Daily counters use UTC. Cached/no-evidence responses still pass the request limit, but do not reserve generation allowance. Failed inference can consume a reservation. These are request ceilings, not a monetary spending cap.

The provider makes one bounded call with a 25-second timeout and 1,600 output-token limit, without automatic retries or escalation. A Workers AI timeout stops waiting; the binding may continue execution and incur usage. Reserved generation quota is intentionally not refunded. Identical in-flight requests coalesce within one Worker isolate; cross-isolate deduplication is not guaranteed. Usage counters retain approximately 30 days; no conversation text is stored in those tables.

## Isolated staging setup

Use only the new dev project: [ppdwysmeistjxzjpmxyk](https://supabase.com/dashboard/project/ppdwysmeistjxzjpmxyk).

1. Authorize Supabase access to the second account's organization. Current connected access to that project is blocked by a project-permission error. Inspect its current migration history, then apply the reviewed application schema migrations in timestamp order, including `supabase/migrations/20261013190102_grounded_assistant_retrieval_and_quotas.sql`. That migration depends on the existing profiles, questions, answers, communities, and security views; applying it alone to an empty project is insufficient. Use test accounts and sanitized fixtures, not a production user/message clone.
2. Sign into Cloudflare with the intended account using `npx wrangler login`; verify the account with `npx wrangler whoami`. Wrangler is currently unauthenticated. Find that account's Workers subdomain in its dashboard.
3. Create the ignored root file `.env.assistant.local` with exactly these browser-safe project settings, replacing the placeholders:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://ppdwysmeistjxzjpmxyk.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_WITH_THE_DEV_PROJECT_KEY
   NEXT_PUBLIC_SITE_URL=https://visathreads-ai-dev.YOUR_WORKERS_SUBDOMAIN.workers.dev
   ```

   Use the dev project's publishable key. Never insert a database password, secret key, or service-role key. The helper refuses a different project and requires the isolated Worker URL. Shell environment values override file values, so remove stale exported settings if validation fails.
4. Configure the dev project's Auth site URL and allowed callbacks for that exact staging origin. Test email and Google sign-in separately; the Google OAuth client needs the dev Supabase callback `https://ppdwysmeistjxzjpmxyk.supabase.co/auth/v1/callback`. Do not change production Auth to point at staging.
5. Run the verification gates, then build and deploy through the isolated helper:

   ```bash
   npm run test:assistant
   npm run test:database
   npm run typecheck
   npm run build:assistant
   npm run deploy:assistant
   ```

   `deploy:assistant` rebuilds and verifies the generated Worker configuration before deploying `visathreads-ai-dev`, with `routes: []`. The default is Cloudflare Workers AI through the `ASSISTANT_AI` binding; **no model API key is needed**. Live Apify fetching is disabled. Merely building does not test model inference.

**Do not use `npm run deploy:dev`, `build:dev`, or `wrangler --env development` for this rollout.** Despite its name, the existing `env.development` has `visathreads.com` and `www.visathreads.com` custom-domain routes. The new isolated environment is named `assistant`.

## Enable in stages

Set flags in `wrangler.jsonc` → `env.assistant.vars`, then rebuild/redeploy. `ASSISTANT_PROJECT_REF` must match the Supabase URL or availability fails closed.

| Gate | Post/global Q&A + post summaries | Community Q&A | Catch-up |
|---|---|---|---|
| `ASSISTANT_ENABLED` | `true` | `true` | `true` |
| `ASSISTANT_COMMUNITIES_ENABLED` | `false` | `true` | `true` |
| `ASSISTANT_CATCHUP_ENABLED` | `false` | `false` | `true` |

Start with the first column. Verify real sign-in, native/imported discussions, relevant citations, unsupported questions, conflicting/outdated reports, deletion/moderation invalidation, account changes, and quotas. For community activation, add scope-isolation checks. For catch-up activation, add boundary timestamps, replies to older posts, empty/busy periods, partial coverage, and checkpoint behavior. Keep a reviewed question set and measure supported answers, abstention, retrieval misses, latency, and usage before widening access. Turn `ASSISTANT_ENABLED=false` and redeploy to disable generation.

## Validation and remaining work

Confirmed by the coordinator: `npm run build:assistant` succeeded using a synthetic publishable key for build validation; typecheck and repository secret scan passed. That key cannot authenticate to the dev project. A local Wrangler runtime smoke test could not start because of `uv_interface_addresses: Unknown system error 1`; runtime behavior and model inference remain unverified.

- `npm run test:assistant`: 43/43 passed; the new migration also passed 17 PostgreSQL/PGlite tests (60 assistant-specific checks total).
- The initial full `npm test` run recorded 455 passing checks before stopping at an existing news/experience test requiring the ignored private `src/data/api-archive.json` snapshot. Public CI now uses synthetic selection fixtures. The real-data invariants remain mandatory through `check:private-experiences` in `check:release`; the private snapshot remains absent here.
- Remaining suites were then executed separately: groups, community UI, scale, feed UI, and assistant all passed. Scale fixtures are not a million-user capacity certification.
- TypeScript, isolated Worker build, archive-bundle check, bundle credential scan, and repository credential scan passed. Build validation used synthetic data and a synthetic public key; no deployment was executed.

Local deterministic tests and a successful build do not constitute a hosted end-to-end or model-quality pass. Restore the authorized private snapshot for the production release check, then complete the staged hosted checks above before promotion.

Not established or implemented: live model accuracy, production deployment, vector/embedding retrieval, background indexing, durable incremental summaries, scheduled digests/notifications, direct-message or group-chat summaries, and million-user capacity. The bounded archive scan is transitional, not a large-corpus indexing solution. No paid plan, account, or billing changes were made.

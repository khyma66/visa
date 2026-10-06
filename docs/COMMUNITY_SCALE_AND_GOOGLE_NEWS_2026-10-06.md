# Community scale and Google News update — October 6, 2026

## Current conclusion

Thousands of communities fit this shared-table design; a separate database, table,
Worker, or deployment per community is unnecessary. Millions of registered users
are a plausible product target, not a tested capacity claim. Concurrent users,
requests per second, popular-community write bursts, query complexity, and database
resources determine actual capacity. No hosted load test was run.

This update is based on the newest accessible source, PR #5 commit
5838f7eedd34cc71584423de9502c26ee5ab483b. All six remote branches were checked again
on October 6. None contains the newer deployed VisaThreads source. The live preview
has Experience, consent/privacy, avatar, and other changes absent from this branch.
The hosted migration ledger ends at 20261006045212_visa_experiences; neither the
community lifecycle migration nor this follow-up migration was applied remotely.
GitHub synchronization of this patch is distinct from synchronization of that
missing application source. Do not overwrite the preview with this older base.

## Changes in this version

- Explore and My communities use bounded pages with server-side filtering.
- Membership checks request only the communities currently displayed; the detail
  page checks one membership. Opening a page no longer downloads every membership.
- The Ask community selector searches and pages through joined communities while
  independently validating a selected community. Tagged Q&A remains unchanged.
- Community question reads select a bounded set of question IDs before expanding
  the feed view. Authentication and row policies still apply.
- Database read functions derive the actor from the session, enforce page limits,
  and use fixed search paths. They do not grant privileged directory access.
- Unchanged membership updates avoid unnecessary exact-counter writes. Real joins
  and leaves still serialize on a community row to preserve consistent counts.

## Google News source and product behavior

The requested source replaces the Federal Register feed. The implementation queries
one fixed Google News RSS search for recent visa/immigration stories, excludes common
Visa card/payment noise, validates XML and destinations, deduplicates stories, and
sorts publication dates newest first. Cards show headline, publisher, publication
time, and a link to the Google News article. Full articles and RSS HTML descriptions
are not copied. Retrieval time is separate from publication time.

The live Google RSS response returned HTTP 200 and 100 items during verification.
Its embedded copyright notice explicitly limits use to personal, non-commercial
feed readers and prohibits other use. Public redistribution is therefore not enabled
by default. GOOGLE_NEWS_RSS_ENABLED is a server-only opt-in, to be set only after the
intended use is permitted. Without it, the News tab provides a direct Google News
link without fetching or presenting syndicated results. This restriction comes
from the actual upstream feed, not a speculative concern or an approval workflow.

Requests have byte, XML complexity and time limits; redirects and arbitrary fetch
URLs are prohibited. Successful responses use a five-minute cache and concurrent
requests coalesce within an isolate. Cloudflare Cache API adds a shared cache per
data center, not a globally replicated store. This is not a scheduled global news
collector and does not establish a Google API availability guarantee. At larger
scale, use a permitted/licensed source and a scheduled fetch into shared storage,
with a timestamp and a bounded stale-data policy.

The parser is pinned to saxes 6.0.0 plus its lockfile. It does not resolve external
entities. The upstream repository is archived, which is a maintenance consideration;
keep the byte/complexity limits and dependency scanning, and reassess a maintained
parser when upgrading. No parser-specific advisory appeared in this verification.

## What still limits scale

| Area | Current behavior | Required evidence or next change |
| --- | --- | --- |
| Community directory | Shared indexed table, keyset pages | Explain plans with production-like distributions and authenticated RLS |
| Popular group joins | Exact counter and group row lock | Measure lock waits and retryable conflicts under a single-group burst; shard or defer counters only if measured necessary |
| Question detail/answers/global feed | Older recovered implementation and newer live code differ | Reconcile source, then test hot discussions, ranked feeds, imported data and all cursor paths |
| Realtime | Existing private Broadcast subscriptions, bounded shared subscriptions per browser | Measure message fan-out, refresh-query amplification, reconnect storms and plan quotas |
| News | Bounded RSS, per-isolate/per-data-center caches | Source permission, approved production cache behavior; shared scheduled ingestion for large traffic |
| Database | Supabase/Postgres, existing RLS and Data API | Size compute/I/O/storage using measured working set, monitor slow queries and connection limits |
| Abuse and moderation | Existing write guards, rate checks and reporting | Load-test unauthenticated traffic controls and moderation queues; owner tools remain separate work |

The browser uses Supabase's Data API; it must not create a raw database connection
per user. Any future server-side direct SQL requires appropriate transaction/session
pooling. Thousands of communities do not imply thousands of WebSocket subscriptions
per browser. Subscribe only to visible conversations and relevant user topics.

## Capacity verification before a million-user claim

Use an isolated staging copy of the reconciled current schema and representative
synthetic data. Do not run these workloads against the live preview without an
explicit operational plan. Synthetic test identities must not be presented as real
community engagement.

1. Verify migration order, existing policies/consent guards, and roll-forward and
   rollback procedures on staging. Test creating, joining, leaving, asking, answering,
   tags, imported-author messaging restrictions and account-switch behavior.
2. Seed at least 10,000 communities, a realistic membership distribution, one million
   synthetic profiles and millions of questions/answers if that is the forecast.
   Include several highly popular groups; uniform data hides the hardest bottlenecks.
3. State the traffic model. For example, 10,000 concurrent visitors each making one
   read every 10 seconds means approximately 1,000 read requests/second, regardless
   of total registered users. This is an example workload, not measured capacity.
4. Ramp separately through read traffic, hot-group join/leave bursts, posts/votes,
   private messaging and reconnects. Start small, then increase to the chosen peak.
   Include cache misses, upstream News errors, auth changes and popular-topic fan-out.
5. Record p50/p95/p99 latency, errors, DB CPU/I/O, query plans, pool saturation,
   lock waits/deadlocks, replication lag, cache hit ratio, realtime volume and costs.
   Suggested initial gates: under 500 ms p95 for interactive API reads, under 1 s p95
   for writes, under 1% unexpected errors, no access-control failures or lost writes.
   These are proposed acceptance targets, not existing results or provider promises.
6. Keep adequate capacity headroom, run a sustained soak, fix measured bottlenecks,
   and repeat before increasing launch traffic. Verify backups/PITR and recovery.

## Release order

1. Recover the newer deployed VisaThreads source into Git and reconcile its migration
   ledger. Port this PR's changes while retaining Experience, policy acceptance,
   native pagination/votes/messaging, privacy pages and avatar behavior.
2. Resolve the unchanged blocking dependency audit (12 high, 2 moderate at this
   check). Do not suppress the gate or blindly accept suggested major downgrades.
3. Apply and test the community lifecycle migration, then the bounded-read migration
   on an isolated current-schema staging database. Update generated database types.
4. Run the repository checks and hosted browser flows with separate test identities.
   Resolve Google feed permission before enabling server-side redistribution.
5. Deploy the reconciled source to a review environment, verify cache and error
   behavior, then run capacity tests at the agreed traffic target.
6. Promote that exact tested commit through the existing release gates and observe
   errors/latency. Preserve the prior version and a forward-compatible DB rollback plan.

## References checked

- https://supabase.com/docs/guides/database/query-optimization
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/realtime/postgres-changes
- https://developers.cloudflare.com/workers/runtime-apis/cache/
- https://github.com/lddubeau/saxes
- Google News RSS search response, channel copyright, retrieved October 6, 2026.

## Verification results

- 220 tests passed: 98 existing safeguards, 47 community lifecycle tests, 41
  rendered component/service tests, 25 Google News tests and 9 scale/query tests.
- The scale fixture contains 10,000 communities, 100,000 questions, a hot group
  with 50,000 questions, and a cursor 40,000 records deep. The old query examined
  40,022 question rows versus 42 in the bounded query. In one root run they took
  26.052 ms and 19.930 ms respectively; these local timings are not production SLOs.
- A newer feed predicate hiding early records is applied before the page limit,
  so pagination still returns a full eligible page. Private/inactive group visibility,
  own-membership scope and parameter bounds are checked under actual test RLS.
- A 10,000-available-community UI fixture keeps only 24 cards and bounded membership
  requests. Ask preserves a selected group outside the visible page and blocks stale
  account redirects. Question pages keep 20 posts; navigation stores at most 50 cursors.
- TypeScript, Worker compilation, the repository secret-pattern scan and whitespace
  checks passed. The scan found no working-file patterns; it does not certify history.
- Supported Next development HTTP smoke returned 200 for News, Explore, Start a
  community, a community route and scoped Ask. With the server flag disabled,
  /api/news returned 200 {status: external}, no-store, and the page had its Google link.
  In a local-only enabled check, the actual API fetched Google and returned 200 with
  24 headlines, newest publication 2026-10-06T02:37:11.000Z, and a 300-second shared
  cache header. The local process was stopped; the public deployment flag was not changed.
- Added only saxes 6.0.0 and xmlchars 2.2.0. Audit remains 12 high and 2 moderate,
  with no finding for either parser package. Release remains blocked by that audit.
- Wrangler whoami reports no authenticated deployment session. No hosted schema,
  real account, membership, message, public news feed, or live deployment was changed.

Local PGlite is a single-process WebAssembly PostgreSQL runtime; its functional and
query-plan checks are not a hosted concurrency, network, or production capacity
benchmark. Local HTTP used Next, not a running Cloudflare Worker. Worker compilation
passed; hosted edge caching and browser database-write flows require staging.

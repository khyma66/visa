# Platform capacity and scale gates

The target is millions of stored posts and 100,000 concurrent platform users. The
current Free deployment is not certified for that load. A provider quota is not a
performance benchmark. No paid upgrade has been purchased by this change.

## Implemented foundation

- The backend enforces a rolling two-calendar-month feed window before ranking
  and pagination. There is no public date-window label and no deletion of history.
- Member and imported posts are merged by one RLS-aware indexed feed RPC. Each
  response contains at most 51 rows (50 plus a lookahead), with stable keyset
  cursors. Reply counts are included in the same read. Private communities still
  use the caller's RLS; no private/user feed is placed in a shared cache.
- Imported post details and source replies are fetched per discussion. Related
  suggestions use bounded indexed candidates rather than a full archive in the
  browser. New imported content can enter durable indexed storage without
  increasing the browser or Worker bundle.
- The legacy reviewed snapshot and full-export endpoint remain for historical
  release compatibility. They are not the ingestion or browsing path for a
  million-post dataset. Do not append millions of items to that bundle. Use the
  scoped, batched database importer or the memory-bounded NDJSON importer.
- Imports use a separate encrypted credential. Each request is at most 50 posts
  and 1 MB; unchanged rows are skipped. It has no access to private account or
  message data. Retries are idempotent. Only already-approved public source data
  belongs in this pipeline.
- Notifications share subscriptions, reconcile only visible tabs, add jitter,
  and back off during outages. Public archive detail caching is bounded. News
  fallback handles malformed cached editions.

## Capacity monitoring

`private.capacity_capture()` samples database size, connections, active queries,
 and lock waits every five minutes with 30-day retention. Warnings start at 70%,
critical at 85%, and recover below 60%. Connection counts include system sessions;
they are not concurrent-user counts.

The protected `platform-capacity-metrics` function reads Supabase's Metrics API
using credentials that remain inside the function runtime. It stores aggregate
CPU and available-memory measurements only. CPU needs two samples; unknown values
stay unknown. CPU/memory warnings start at 80%, critical at 90%, and recover below
70%. Counter resets invalidate that CPU interval.

A GitHub workflow checks every 15 minutes: provider collection, sampler freshness,
thresholds, website availability, and database readiness. Scheduled GitHub jobs can
be delayed; this is an initial monitor, not a paging SLA. Workflow failures use the
owner's existing GitHub Actions notification preferences. The owner dashboard is
`/admin?section=capacity`. A dedicated email channel has not been configured.

The current provider Metrics API does not expose total Realtime connections for
this project (Postgres Changes subscriptions are a different metric). Total
Realtime connections, message throughput, auth/egress billing, and monthly quotas
must also be monitored through Supabase Reports or a connected Management API
collector. Missing coverage is visible in the private dashboard. Do not claim a
Realtime warning is active until that data source has been tested.

After upgrading Supabase, set the actual storage and Realtime limits in the owner
capacity panel. That changes alert thresholds only. It does not purchase compute,
change billing/spend caps, or raise provider limits.

## Upgrade and validation gates

1. At the first sustained warning, inspect query latency, connections, growth,
   cache effectiveness, and slow queries. Remove unnecessary work before buying
   compute. Current backend data is much smaller than the target dataset.
2. Before exceeding Free quotas, choose a paid plan, a supported database minor
   version, automated backups, and an isolated restore target. Verify a restore
   and the operational on-call/alert destination. Keep dev and production separate.
3. Seed staging with 1M representative posts plus realistic replies, memberships,
   votes, and messages. The local 100,000-row test is a query regression only.
   It is not a hosted capacity result. Check plans and p95/p99 latency for all
   sorts, text/tag searches, private communities, and hot posts.
4. Run `load-tests/platform-scale.js` against isolated staging at 100, 500, 2,000,
   10,000, then 100,000 users. Use distinct synthetic tokens for authenticated
   sockets. Provision distributed load generators for the larger stages. The
   script refuses the production Supabase project. It defaults to 100 VUs.
5. Initial acceptance goals: request error rate <0.1%; feed p95 <500ms and p99
   <1.5s; Realtime joins >99.9% and p95 <2s. Measure sustained throughput, message
   fan-out, reconnection storms, hot-row contention, and billing over a long soak.
6. Obtain an explicitly approved Realtime quota for the intended connected-user
   load. The published default limits do not provide 100,000 sockets on the
   current plan. Load generators also need a join-rate ramp; opening 100,000
   sockets simultaneously would be a separate overload test.
7. Use measured results to choose database compute, pooling, storage, read replicas
   for genuinely public reads, caching, and an optional dedicated realtime tier.
   Do not route private reads to replicas or shared caches without checking
   authorization freshness and replication lag. Keep media in object storage
   such as R2 with authenticated uploads when media uploads are introduced.

## Operator commands

Use `ARCHIVE_INGEST_TOKEN` only in the protected production environment:

```
node scripts/sync-archive-database.mjs reviewed-public-archive.json
node scripts/ingest-archive-stream.mjs reviewed-discussions.ndjson source-metadata.json
node scripts/check-platform-capacity.mjs
```

The monitor needs `CAPACITY_MONITOR_TOKEN`. Never put either secret in frontend
configuration, logs, Pages, or tickets. Rotate by setting the new encrypted GitHub
secret and replacing its SHA-256 hash in the private key table. Source data and
credentials must not be copied from production into development fixtures.

## Remaining external work

- Connect total Realtime and monthly usage data and verify the selected alert
  destination. CPU/memory and DB sampling are operational independently.
- Provision isolated staging and the paid resources needed for the staged load
  and restore tests. Those tests were not run against production.
- Raise the Realtime quota with Supabase for the 100,000-user scenario and record
  the actual billing/compute limits. No 100,000-concurrent-user guarantee exists
  until the hosted workload and failure/recovery tests pass.

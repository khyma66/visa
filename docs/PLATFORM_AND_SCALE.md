# VisaFlow deployment and scale assessment

Original hosting/cost assessment: September 8, 2026. Recommendations below are engineering judgments, not measured capacity guarantees. **September 10 update:** the resumed Supabase project is connected locally and private Broadcast, request-based chat, cursor feed/message paging and indexed comment-aware discovery are now implemented and live-tested. See [current implementation and remaining gates](REALTIME_IMPLEMENTATION.md). Hosting/pricing figures below are the earlier research snapshot, not a new vendor quote.

## Development website

https://visaflow-dev.varunchinna5966.workers.dev

Worker: `visaflow-dev`, environment: `development`. Initial version: `3d8bc554-9c85-4f12-83b5-44a9e15ae0a3`. Published from the current local working tree, including the existing vinext migration. No Git push or repository transfer was performed.

The preview uses demo profiles and local browser storage because no development Supabase URL/key is configured. Messages do not pass between real users in this mode. The optional imported-community endpoint returns 503 when its source credentials are absent; the feed falls back to demo questions. No ingestion credentials were uploaded.

Deployment checks: TypeScript passed; vinext reported no incompatible imports, with two partial configuration notes (image optimization and App Router StrictMode); development build and Wrangler upload dry run passed. Published pages and CSS/JavaScript were checked over HTTPS, and the question feed was visually inspected. These checks do not constitute a load test or verification of live Supabase authentication/messaging.

Update the preview with `npm run deploy:dev`. For CI, install Node 22+, run `npm ci`, `npm run typecheck`, then `npm run deploy:dev` with a deployment token supplied by the CI secret store. A separate Supabase development project should supply the two `NEXT_PUBLIC_SUPABASE_*` build variables. Add the development origin to Supabase Auth redirect settings.

## Recommended stack

| Concern | Choice for VisaFlow | Reason and tradeoff |
| --- | --- | --- |
| Website and API hosting | Cloudflare Workers | Reuses the current application, global delivery and usage-based compute. The existing vinext adapter is beta; retain native Next.js as a comparison path and run compatibility checks on upgrades. |
| Accounts, questions, answers, votes, persistent messages | Supabase Auth + PostgreSQL | Matches the implemented schema and RLS. Size database compute and indexes using realistic workloads; an edge host does not distribute a single database's writes globally. |
| Initial direct messaging | Supabase private Broadcast channels backed by stored messages | Smallest operational change from the current code. Replace per-client Postgres Changes subscriptions after benchmarking, authorize each conversation channel, and retain the database as the durable history. |
| Managed chat with a small team | Stream Chat | Strong option when blocking, moderation, unread state, receipts, attachments and ready UI components matter more than custom infrastructure control. Obtain a quote for actual chat-active users and concurrency. |
| Managed realtime with custom product logic | Ably Chat | Good alternative for custom room/message workflows. Compare message delivery, connection minutes, channel minutes, retention and moderation needs, not only cost per message. |
| Custom Cloudflare messaging at scale | Durable Objects with WebSocket hibernation | Good when usage justifies owning the delivery service. Partition by conversation/user routing; never put all users in one object. Engineering must cover replay, deduplication, authorization, membership changes and offline notifications. |
| Attachments | Private Cloudflare R2 objects | Suitable object storage with no internet egress fee; storage and operations are still billed. Use authorized download paths for private attachments. |
| Similar-question search | PostgreSQL keyword/trigram now; add pgvector hybrid retrieval | Keeps visa type, destination, tags and meaning in the same query system initially. Evaluate a separate Vectorize index once measured query volume justifies extra infrastructure and index synchronization. |

Cloudflare currently recommends vinext for Next.js on Workers, while explicitly labeling it beta. [Next.js deployment documentation](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)

Vercel is the main hosting alternative if native Next.js integration becomes more valuable than the Cloudflare stack. It still requires a separate realtime service for this architecture; Vercel Functions are not a persistent WebSocket chat server. [Vercel guidance](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)

Sources for messaging comparison: [Supabase Broadcast](https://supabase.com/docs/guides/realtime/broadcast), [Supabase benchmarks](https://supabase.com/docs/guides/realtime/benchmarks), [Stream features](https://getstream.io/chat/), [Ably Chat](https://ably.com/docs/chat), [Durable Objects hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/). An individual Durable Object has a soft throughput limit of 1,000 requests/second; capacity scales across objects, not by making one global chat object. [Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/)

Sources for storage/search: [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Supabase hybrid search](https://supabase.com/docs/guides/ai/hybrid-search), [Vectorize filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/).

## What “millions of users” must specify

Registered accounts, monthly visitors, authenticated monthly active users, simultaneous sockets, messages sent and messages delivered are different measurements. A private message sent to two devices costs differently from a group message delivered to 10,000 subscribers.

Use an initial planning scenario of 1 million monthly visitors, 100,000 authenticated monthly users, and 10,000 peak connected clients. This is an assumption for sizing, not a forecast. If all 1 million visitors authenticate, the authentication bill changes substantially. If all 1 million are connected simultaneously, obtain enterprise capacity commitments before launch.

Supabase's documented default concurrent-connection limits are 500 for Pro with its spend cap and 10,000 for Pro without the cap/Team, with higher configured limits requiring coordination. Ably Standard advertises 10,000 concurrent connections, Pro 50,000, and Enterprise custom capacity. A vendor's aggregate infrastructure capacity does not mean every project receives that capacity automatically. [Supabase limits](https://supabase.com/docs/guides/realtime/limits), [Ably plans](https://ably.com/pricing)

## Cost reference points, not a complete budget

- Workers Paid starts at $5/month. At 100 million dynamic requests/month and an assumed average 7 ms of CPU per request, Cloudflare's published example totals $45.40 for Workers requests and compute. Database, chat, logs, builds, storage and other services are additional. With Workers Cache enabled, cache hits still count as billable requests; they avoid Worker CPU. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- Supabase Pro starts at $25/month, including 100,000 authenticated MAU. Another 900,000 authenticated MAU at $0.00325 each adds $2,925/month, before compute or other overages. Anonymous public browsing does not require an authenticated MAU. [Supabase pricing](https://supabase.com/pricing)
- Supabase Realtime bills excess messages at $2.50/million and excess peak connections at $10/1,000; Pro includes 5 million messages and 500 peak connections. Fan-out, presence and subscriptions must be modeled accurately. [Realtime pricing](https://supabase.com/docs/guides/realtime/pricing)
- Ably's usage model lists $2.50/million messages, $1/million connection minutes and $1/million channel minutes, plus the selected package and applicable transfer charges; volume agreements differ. [Ably pricing](https://ably.com/pricing)
- R2 Standard storage lists $0.015/GB-month, plus read/write operations, with no internet egress fee. [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

## Work required before a large public launch

1. Local Supabase connection, three-account messaging and RLS verification are complete. Real email signup/confirmation and hosted-origin verification remain.
2. Feed and message cursor pagination and retry deduplication are implemented; older inbox/answer pagination and reconnect-storm load tests remain.
3. Private Broadcast is implemented. Benchmark its fan-out, reconnect and database read costs at the target workload. [Supabase scaling guidance](https://supabase.com/docs/guides/realtime/benchmarks)
4. Make public question detail content server-rendered for search indexing; cache public reads while keeping authenticated responses and private messages out of shared caches.
5. Benchmark related-question retrieval against a representative corpus. Indexed tag/text/comment candidate selection is implemented with bounded candidates; measure relevance and query plans before claiming million-post capacity.
6. Blocking and message/request rate limits are implemented. Add reporting, post/reply abuse limits, moderation, attachment controls and retention. A random handle provides public pseudonymity; the service still holds account and message data. Existing messages are not end-to-end encrypted.
7. Load-test an agreed workload, including reconnect storms, hot questions, many small chats and offline replay. Record p95/p99 latency, error rate, database CPU, replication lag and cost per 1,000 users. Request provider limits based on the results.

My recommendation is to keep Workers + Supabase and the implemented Broadcast-based chat for the next release. Evaluate Stream or Ably against measured chat requirements; build a custom Durable Objects delivery layer only when those requirements and engineering capacity justify it.

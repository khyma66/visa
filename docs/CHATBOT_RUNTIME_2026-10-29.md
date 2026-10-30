# VisaThreads chatbot runtime and rollout

Keep Cloudflare Workers, the existing React interface, Supabase authorization and Groq. The immediate problem is conversation interpretation and request orchestration, not the absence of another model vendor. This change implements a bounded conversational layer and live request progress without removing evidence checks.

## Request workflow

1. The browser sends the latest question, at most three recent question and answer pairs, and bounded source ID references. Previous text is untrusted context, never evidence.
2. The server validates the request, authenticates the user, checks request limits and reserves model quota before any planning call.
3. For public chat questions, one constrained model call selects fresh retrieval, re-reading earlier source references, or a fixed clarification prompt. The client cannot supply a trusted plan or change the access scope.
4. Independent native-content and imported-reply searches start concurrently. Selected threads are expanded under the caller's existing permissions. Reuse bypasses global search but still rereads the selected content.
5. Generation selects server-defined evidence spans. A separate reviewer checks the claims, followed by a fresh source/access fingerprint check. Existing bounded repair, request deadline and cancellation remain in force.
6. Live progress events reflect actual stages. Only the finalized result is released. Interrupted, oversized, malformed and duplicate-completion streams fail closed. Older JSON clients continue to work.
7. A resolved topic hint is returned for subsequent turns. Model usage and stage durations use fixed labels and numbers, without logging questions, answers or credentials.

## Streaming policy

The new transport streams progress, not raw model tokens. Immigration experience summaries can contain consequential unsupported claims; displaying a draft and retracting it later would not preserve the existing review-before-publication policy. There is no artificial typing delay after acceptance. First progress, first answer text, and completion latency must be measured separately.

The planner adds one inference for free-text chat turns, including the first question from the modern UI. Legacy API callers that omit conversation context retain their compatible path. Explicit Summarize and Make it shorter UI actions skip planning, while still rereading sources and reviewing the answer. There is no autonomous search loop, new model fallback, or extra retry budget for the planner. One request reservation covers planning and answering; the existing total deadline still applies.

For a rejected summary, the bounded repair may remove whole unsupported claims and independently review the remaining candidate against the full original evidence and task. It never publishes a partially checked draft. Missing qualifications or conflicting positions still require abstention. This uses one fewer inference than regenerating a full answer; it does not increase the retry budget. Specific questions retain the existing full-answer repair path.

## Verification and release

Local tests cover request validation, bounded history, context routing, source revalidation, changed topics, protected clarification, cancellation, framing, UTF-8, truncated responses and actual Workers streaming. Existing auth, database, messaging and site regression tests remain required.

Hosted acceptance retains the existing 34 answer scenarios and adds 12 contextual-planning scenarios, each with three retained samples. Cases include paraphrases, a changed constraint, negation, translation, a new topic, period comparison, missing references, exhaustive aggregates, ordinal selection, location correction and answering a clarification. Expected semantics are not sent to the model. These are regression cases, not an estimate of all-user accuracy.

The guarded workflow must pass before production deployment and then sync the same source to development. Development AI remains disabled under the existing environment-isolation policy. No database schema, source content, domain configuration or secrets are changed by this release.

## Remaining architecture work

- **Owned persistent conversations:** history is currently bounded browser context, not a server-owned conversation database. Cross-device history, refresh restoration, durable idempotent turns and per-conversation concurrency are not implemented here. Add owner-scoped tables, a server-only assistant-write path, retention/deletion controls and two-user isolation tests before enabling these features.
- **Hybrid retrieval:** existing full-text search remains. Add versioned embeddings with permission-aware Postgres retrieval, edit/delete invalidation and a benchmark against current keyword results. Do not add another vector database without a measured need.
- **Calendar and comparative analytics:** current retrieval date conventions remain. A planner can request new evidence but cannot create a missing multi-window or whole-database analytics tool. Exhaustive counts/averages receive a fixed clarification; sampled reports must not become totals.
- **Token streaming:** retain the current publication policy until a separately evaluated low-risk streaming mode or claim-by-claim review provides an acceptable tradeoff. Progress events alone do not establish ChatGPT-equivalent streaming.
- **Performance qualification:** record p50/p95 for planning, retrieval, generation, review, first actual answer and completion at documented concurrency. Synthetic hosted inference excludes real user authentication and production database latency. No zero-lag or million-user capacity guarantee follows from these tests.
- **Live human testing:** real two-account signup, posting and messaging remain separate from automated chatbot checks.

## Access and tools

The current runtime change needs no new provider key or paid service. Deployment uses the established GitHub release secrets; Groq remains server-side. Production-like load tests require an approved test account and workload/budget limits. Persistent history and embeddings require reviewed Supabase migrations and backend-only write access; embedding-provider selection requires retention and cost review. Optional AI Gateway or tracing should minimize stored payloads and must not add blocking calls to normal chat.

Cloudflare Agents SDK is an option for durable conversation coordination and reconnectable streams, not a requirement for the current stateless text endpoint. Deep Research, external browsing and autonomous tools stay outside normal chat.

## Documentation basis

- [OpenAI latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization): fewer serial calls, bounded output, streaming and chunking. This informs implementation patterns, not claims about ChatGPT's private infrastructure.
- [OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state): carry relevant user and assistant turns within a bounded context.
- [Groq text generation](https://console.groq.com/docs/text-chat) and [structured outputs](https://console.groq.com/docs/structured-outputs): multi-turn input and schema-constrained responses; application validation remains necessary.
- [Cloudflare Streams](https://developers.cloudflare.com/workers/runtime-apis/streams/) and [chat agents](https://developers.cloudflare.com/agents/api-reference/chat-agents/): streaming transport and the optional durable-agent architecture.
- [AI SDK message persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence): persistent message lifecycle and validation patterns for a later storage rollout.
- [Supabase hybrid search](https://supabase.com/docs/guides/ai/hybrid-search): combine keyword and semantic ranking without changing the authoritative database.

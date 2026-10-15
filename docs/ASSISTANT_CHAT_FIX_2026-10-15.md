# Production assistant correction — October 15, 2026

The owner reported failed answers and requested a compact conversational interface. Catch-up is exclusively for communities/groups; public and post scopes reject catch-up before authentication or database access.

## Incident evidence

The production request at 01:07:01.889 UTC returned HTTP 502 after 10,016 ms (132 ms CPU), with Worker outcome `ok`. Supabase retrieval and quota reservation succeeded, with no subsequent source revalidation. In deployed commit `15fc12aa818b6971303606b4e0cf3fa687c839a6`, only model JSON/structure/citation validation returns 502. This isolates the failure to output validation after inference. The exact rejected output was not logged and cannot be reconstructed from these diagnostics.

Read-only Cloudflare diagnostic run: https://github.com/khyma66/visa/actions/runs/38664743592 . It emitted bounded status/timing metadata, without prompts, source content, credentials or account identifiers. No database/configuration mutation was required.

## Changes

- Ordered chat messages, short copy, Enter-to-send, pending/stop controls, preserved drafts and retry, expandable sources. Chat memory stays in the component and clears on account/scope changes.
- New questions do not inherit unrelated topics; referential follow-ups, including short “Why?” and “What happened next?” messages, use the latest relevant user question. Whole-word search avoids substring collisions, replies retain discussion context, and long posts retain the passage matching the question.
- The model receives a source-ID enum and schema limits matching validation. Quotes must come from the cited source title/body; parent context is not citable as a reply. Backend exact-quote validation remains mandatory, and whitespace-only quotes are rejected.
- Safe error telemetry records only fixed stages/reason codes and HTTP status. No questions, sources, tokens, identities or provider error bodies are logged. Concurrent requests retain the correct shared failure stage.
- Catch-up is community-only in both UI and backend. Empty intervals have a specific response.

## Verification and release

The hosted gate now runs the actual application handler, including parsing, authentication dependency, quota, corpus preparation, real Workers AI inference, validation, revalidation, private headers and the runtime binding import. Authentication and corpus in this expiring evaluator are fixed synthetic dependencies, not production accounts or records.

Fifteen fixtures require three independent passing samples each (45 total), retaining every failure. Coverage includes ten noisy public sources, topic changes, short follow-ups, answers beyond character 4,000, concise relevance, communities/catch-up, conflicts, unsupported claims, injection and multilingual content.

Local verification passed 1,546 tests, TypeScript and the repository secret scan. Dependency audit passed its high-severity gate (three moderate advisories remain).

The existing release workflow preserves the production archive and launch settings, deploys only after all gates pass, and checks immutable source/configuration receipts with guarded rollback. Production release and a real signed-in browser answer remain pending at the time this implementation commit is prepared. Do not equate synthetic acceptance with verified member sign-in.

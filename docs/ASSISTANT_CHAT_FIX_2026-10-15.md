# Production assistant correction — October 15, 2026

Latest follow-up: [direct post search and final production verification](ASSISTANT_POST_SEARCH_FIX_2026-10-15.md) fixes explicit post-list requests. The exact stamping-delay query returned 40 matching discussions in 2,052 ms after the refined production deployment, with 48/48 hosted checks passing. The evidence below describes the earlier conversational-answer correction.

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

The final production CI passed 1,548 tests (including 92 assistant-specific tests), TypeScript and the repository secret scan. The release helper’s 13 tests also ran again as a dedicated gate. Dependency audit passed its high-severity gate (three moderate advisories remain).

The existing release workflow preserves the production archive and launch settings, deploys only after all gates pass, and checks immutable source/configuration receipts with guarded rollback. Final release [38665753026](https://github.com/khyma66/visa/actions/runs/38665753026) completed successfully on October 15, 2026 at 01:44 UTC. It deployed commit `899f7fe493b56c8794642c0b0ede87c12a2f0b36` (tree `de541898fc4ba24c068cc8be1077178400eaab37`) as Worker version `317351cd-fec1-44f4-9f0b-241d74ed02c7`. Artifact `11942970534` retains all 45 passing hosted samples and the immutable build receipt. Every runtime-binding check and all three short-follow-up samples passed; the temporary evaluation Worker was deleted. Smoke checks verified exact source, all production AI flags and unchanged 563 posts / 628 replies. The preceding conversational release `babc5c3ebdedc0491a5382520ce86801e9e45833` also passed 42 samples and deployed successfully in run `38665376392`.

## Signed-in production browser verification

A real existing member signed in through the secure email-code flow. No credentials or account identifiers are retained here. On the final live version, three actual model requests returned correct short answers with citations:

| Surface | Question | Verified answer |
| --- | --- | --- |
| [Published Cognizant discussion](https://visathreads.com/questions/apify-2286326712182444) | On what date did the original poster upgrade to premium processing? | August 20. |
| Same conversation | How long had it been pending? | Over 10 months; correctly retained the original poster’s context. |
| [Standalone Ask page](https://visathreads.com/assistant) | In the Cognizant discussion where an extension had been pending for over 10 months, when was it upgraded to premium processing? | August 20, citing the correct discussion retrieved from the public corpus. |

Enter-to-send, the Thinking state, retained conversation messages and expanded source quotes were observed directly. The citation quote matched the published post. Catch-up controls were absent on both public and post chat. Community scope has unit and hosted acceptance coverage; no new live community or synthetic production content was created for testing. The final browser remained on the successful standalone conversation.

These results demonstrate the checked questions and paths; they do not establish universal answer accuracy. Partial corpus coverage remains visible to members.

# Direct post search in production chat

The signed-in production query `give all posts related to stamping delay` reproduced the source-verification error after the earlier chat release. The previous 45 hosted samples covered generated answers but did not cover requests to list posts. Passing those samples did not establish reliability for this search intent.

## Change

- Explicit requests to find, show or list posts return server-selected discussion links and redacted excerpts directly. They do not call the model, reserve model quota, or depend on generated citation syntax.
- Stamping-delay matching associates delay language with stamping, passport or consular events. It handles dropbox and administrative-processing terminology, normalizes common visa-type spellings, and excludes unrelated extension, transfer and I-140 delays even when a post also mentions a future stamping plan.
- Results are deduplicated by discussion before the 48-post cap. The chat initially shows eight posts with an expandable remainder. Partial coverage is disclosed; the result does not claim every post in the database has been searched.
- Authentication, request rate limits, caller-JWT database reads, production-only availability, redaction, private response headers and a fresh source-permission recheck remain enforced.
- Questions asking for an explanation continue through the existing grounded-answer path. Community-only catch-up is unchanged.

## Verification

Regression tests cover the exact reported phrase, intent routing, unrelated decoys, spelling variants, native and archive retrieval, deduplication, redaction, safe links, empty results, source deletion and compact UI rendering.

The production release requires 16 hosted cases with three samples each (48 total). The new direct-search case explicitly asserts zero model calls, zero model-quota reservations and successful operation without an AI binding. The other 45 samples continue checking generated answers.

The first signed-in production check returned 48 results in 2,149 ms (browser submit-to-visible timing), without the source-verification error. Inspection exposed mixed-topic false positives: a stamping mention plus a separate petition or employment delay. Those examples were added to the regression fixture and the matcher was refined before final acceptance.

The change removes model-generation latency for explicit post searches. Authentication, source retrieval and revalidation still require network time; zero latency is not promised.

## Final production verification

The refined matcher is live at commit `07e7a0233f13d2ab55e9a74ebf343032aa76e464`, tree `5fe3fd4fe431df13dd9bfed7cb281474255d558d`, Worker version `9dfa59e1-f7f3-4514-89cd-41140880b2e0`.

- [Production release 38671023881](https://github.com/khyma66/visa/actions/runs/38671023881) passed; evidence artifact `11943494427` matches the exact commit and tree. Deployment completed at 02:36:09 UTC on October 15, 2026; exact-source and archive smoke checks passed at 02:36:19 UTC.
- All 1,566 automated tests passed, including the 106 assistant tests, alongside TypeScript, audit, secret scan and release guards. The 13 release-helper tests were also rerun separately and are not added again to the total.
- All 48 hosted samples passed: 45 generated-answer samples and three direct-search samples including mixed-topic decoys. Direct search used no model call, model quota or AI binding. Synthetic Worker-local durations are not end-user response timings.
- The committed matcher was checked against the actual public feed: 563 posts and 628 replies, represented as 1,191 sources. The exact query returned 40 unique discussions. Known unrelated mixed-topic posts `apify-2277458193069296`, `apify-2276330596515389` and `apify-2271546490327133` were excluded.
- After deployment, a fresh signed-in browser submission of `give all posts related to stamping delay` visibly returned **40 matching posts in 2,052 ms**, measured from Send through rendered results. The first eight linked excerpts were inspected; the remaining 32 are expandable. No source-verification error appeared. This is one observed production timing, not a latency guarantee or an exhaustive database count.
- The full 563-post / 628-reply archive, existing branding and production AI flags were preserved. `APP_ENV=development`, `PUBLIC_LAUNCH_APPROVED=false` and `IMPORTED_CONTENT_APPROVED=false` remain intentional production-preview settings. AI remains production-only; catch-up remains exclusive to communities/groups.
- The temporary evaluation Worker was deleted, and rollback was not required.

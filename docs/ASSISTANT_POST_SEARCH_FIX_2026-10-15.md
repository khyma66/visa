# Direct post search in production chat

The signed-in production query `give all posts related to stamping delay` reproduced the source-verification error after the earlier chat release. The previous 45 hosted samples covered generated answers but did not cover requests to list posts. Passing those samples did not establish reliability for this search intent.

## Change

- Explicit requests to find, show or list posts return server-selected discussion links and redacted excerpts directly. They do not call the model, reserve model quota, or depend on generated citation syntax.
- Stamping-delay matching requires both stamping context and delay language. It handles dropbox, consular/passport and administrative-processing terminology, normalizes common visa-type spellings, and excludes extension-only pending reports.
- Results are deduplicated by discussion before the 48-post cap. The chat initially shows eight posts with an expandable remainder. Partial coverage is disclosed; the result does not claim every post in the database has been searched.
- Authentication, request rate limits, caller-JWT database reads, production-only availability, redaction, private response headers and a fresh source-permission recheck remain enforced.
- Questions asking for an explanation continue through the existing grounded-answer path. Community-only catch-up is unchanged.

## Verification

Regression tests cover the exact reported phrase, intent routing, unrelated decoys, spelling variants, native and archive retrieval, deduplication, redaction, safe links, empty results, source deletion and compact UI rendering.

The production release requires 16 hosted cases with three samples each (48 total). The new direct-search case explicitly asserts zero model calls, zero model-quota reservations and successful operation without an AI binding. The other 45 samples continue checking generated answers.

The change removes model-generation latency for explicit post searches. Authentication, source retrieval and revalidation still require network time; zero latency is not promised. Signed-in production timing will be recorded after deployment.

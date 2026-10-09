# Community interval summaries — prototype, disabled

The earlier implementation is not production ready. GET and POST at
`/api/communities/:id/summary` return 503 with no database reads or AI calls.
The model helper and unapplied artifact migration are retained for review, not
as an instruction to activate the feature or provision privileged credentials.

Required before activation:

- Use the actual native question/answer schema and verified community membership rules.
- Include replies to older questions inside the requested interval; detect and disclose
  incomplete coverage instead of silently truncating posts or model input.
- Validate evidence for every published claim, including the overview; valid citation
  IDs alone do not establish factual support.
- Add authenticated generation, durable deduplication/locking, per-user/community
  rate limits, a global spending cap and model timeouts.
- Use server-side Workers AI bindings and least-privilege data access, not a public
  endpoint with broad service credentials.
- Verify private-community isolation, cache invalidation after deletion/moderation,
  prompt-injection resistance and representative accuracy evaluations.
- Provide the interval selector and evidence links in the UI only after those tests.

No AI inference, paid account changes or hosted summary migration was executed
during PR #7 consolidation. Automatic suggestion-to-code changes remain subject
to owner review and are not implemented by this prototype.

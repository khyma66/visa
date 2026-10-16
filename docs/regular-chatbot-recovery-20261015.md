# Regular chatbot recovery

Scope: restore the site-wide assistant on `https://visathreads.com/assistant`.
Community assistant and catch-up execution remain disabled. This is not public
launch approval and does not change account, RLS, or content permissions.

## Observed deployment

The live production Worker `visaflow-dev` was version
`9be26341-637e-4384-9e53-712d5fa27e5a`, deployment
`f22d382e-0904-4e41-a30f-c687634163cd`. Its health response identified
`8e1e8ea187a91a2aed732426683adc6c7febfcec` with dirty source and no site origin.
All assistant flags were false and `/assistant` returned 404. The local checkout
for that deployment contained only three additional branding files/changes.
Those changes have been retained and committed; the integrated logo's bytes
also match the live asset. The recorded source fingerprint describes the base
commit, not the dirty modifications; we do not claim exact source equivalence.

The guarded release permits recovery only from this exact observed build,
configuration, version and deployment. It still requires clean committed new
source, retained branding, the base commit in ancestry, a freshly captured
original archive, an unchanged active deployment, model acceptance, and a
post-deployment smoke check. Automatic rollback may replace only this release's
own exact uploaded version, never another actor's later deployment.

Guarded run `38833072583` passed all 72 hosted samples and uploaded version
`4d68157c-de5c-4903-8b46-a9054e93b021`. Its fresh health probe, feature checks,
content hash and authentication denials passed, but the later default-cache
bare health request returned the old source. The workflow restored the captured
version at deployment `c89cfee1-1f7c-46c3-b5d1-7d33ff43d970`. Wrangler and public
hash checks independently confirmed that exact rollback, unchanged archive and
unchanged branding. The recovery pin now identifies only that observed rollback
event; it does not allow arbitrary redeployments. Release probes must use fresh
requests and require both bare and cache-busted health URLs to agree repeatedly.

## Answer behavior

- Bounded conversation context preserves the topic across brief follow-ups.
- Post references carry identifiers, not old source text or generated claims.
  The server reads the referenced post and replies again under caller access.
- Additional post searches exclude seen results and disclose their bounded
  window instead of cycling through the same results.
- Regular public answers publish attributed source excerpts selected by the
  model and checked by the server. Matching a quote does not prove a paraphrase
  true, so unchecked model-written factual prose is not displayed.
- Negation, short-report caveats and corrections are retained. Titles alone
  and detected instruction payloads are not promoted to factual answers.
- Community anecdotes do not establish current rules, eligibility or outcomes.
  The assistant can decline unsupported questions. This does not guarantee the
  original member reports themselves are accurate or complete.
- Cache entries remain identity/scoped, versioned and source-revalidated;
  authentication, request limits and inference limits are unchanged.

## Release checks

Run the full repository suite, typecheck, repository secret scan, dependency
audit and 24 hosted acceptance cases with three independent samples per case.
The hosted harness uses fixed synthetic evidence and the real provider binding
through the shared request handler. It is not an actual member session against
the production database. A signed-in browser check is separate and must be
reported separately rather than inferred from these fixtures.

## Development synchronization restriction

The current development site has 563 posts and 628 replies, matching the public
production archive, and a separate browse-only boundary. The old development
workflow instead selects 42 CI fixtures and lacks that boundary. Do not run it
unchanged. Reconcile the existing development restrictions and add a fresh
development content receipt/hash guard before deploying the feature there.
Development must retain `ppdwysmeistjxzjpmxyk`; production retains
`cycnichledvqbxevrwnt`.

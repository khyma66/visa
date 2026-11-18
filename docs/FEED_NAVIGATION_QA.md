# Feed navigation verification — November 17, 2026

## Behavior

- F1 / OPT is the first visible visa and the first-request default on Home and Experience. Other supported visas remain available; All visas is last.
- Explicit visa links remain authoritative. Existing global search/topic links can still search all visas.
- Experience has no arrow, a green/white hover state, a solid green current-page state, keyboard focus feedback, and no hover-triggered prefetch.
- On Experience, the chosen sort retains `aria-pressed` and a subordinate gray indicator. Only Experience has the strong green current-view treatment; New no longer looks like the active page.
- Entering Experience carries the selected visa, not question-only search, source, tag, SOS or unanswered filters. This matches the navigation contract in PR #163.
- Clear filters removes search, category, source, tag, type and sort overrides, returns to F1 / OPT + newest, stays on the current feed, and disappears at that baseline.
- Phone controls use equal-width cells: three columns at 380–639px, two below 380px. Desktop retains the compact row. Every control is 44px tall.

## Checks

- `npm run test:feed-ui`: 38 passing checks, including all visas × all five sorts on both feeds, default/order, current/hover classes, empty results, combined filters, URL state, reset, stale responses and pagination.
- `npm run test:presentation`: 110 passing checks. The supported-visa test evaluates the actual feed constant and proves exact membership, uniqueness and order instead of requiring the former array spelling.
- Typecheck and production build pass.
- Actual browser testing used the isolated `npm run dev:demo -- --port 3125` app, with no hosted database credentials. A synthetic F1 experience was published only in browser-local demo storage.
- The default feed displayed that story. A matching refusal category + member source + Top sort retained it. A nonmatching category/source/search combination and H4 selection produced an honest empty state. Clear filters restored the F1 story, empty search, all categories and all sources.
- Tested 390×844 and 320×740 viewports: no horizontal page overflow, unclipped labels, equal button dimensions, reachable category/source/reset controls. Actual pointer hover on Experience changed its computed background to `rgb(17, 94, 89)` while retaining white text. Current-page background is `rgb(15, 118, 110)`; New is gray. Temporary viewport override was reset.

## Release status

Prepared on current production source `51222b7`; this is not a claim of deployment. PR #163's composer work and PR #164's imported-post controls remain separate and are not discarded.

The fresh registry audit still fails the existing high-severity gate for transitive picomatch, advisory GHSA-fc5q-39xc-vjpf (affected range `<=4.0.7`). No audit suppression, dependency downgrade, unreviewed custom patch or deployment bypass was made. Production must remain unchanged until the security gate passes through an approved remediation; then use the normal production-first verification and development-sync process.

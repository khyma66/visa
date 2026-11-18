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
- Final `npm run check` passes all 2,201 regression checks, typecheck, production build and archive-bundle verification. The dependency audit is a separate failing release gate, not included in that success claim.
- Actual browser testing used the isolated `npm run dev:demo -- --port 3125` app, with no hosted database credentials. A synthetic F1 experience was published only in browser-local demo storage.
- The default feed displayed that story. A matching refusal category + member source + Top sort retained it. A nonmatching category/source/search combination and H4 selection produced an honest empty state. Clear filters restored the F1 story, empty search, all categories and all sources.
- Home → SOS → Experience opened the F1 story without the SOS filter. Actual browser Back restored Home/SOS; Forward restored Experience/F1.
- Tested 390×844 and 320×740 viewports: no horizontal page overflow, unclipped labels, equal button dimensions, reachable category/source/reset controls. Actual pointer hover on Experience changed its computed background to `rgb(17, 94, 89)` while retaining white text. Current-page background is `rgb(15, 118, 110)`; New is gray. Temporary viewport override was reset.

## Release status

Prepared on current production source `51222b7`; this is not a claim of deployment. PR #163's composer work and PR #164's imported-post controls remain separate and are not discarded.

At the time of this initial check, the registry audit failed the high-severity gate for transitive picomatch, advisory GHSA-fc5q-39xc-vjpf (affected range `<=4.0.7`). Production remained unchanged pending remediation.

## Combined candidate — November 18, 2026

The local `release/experience-visa-nov18` branch combines #163, #164 and #165 without replacing the existing production baseline. It preserves scoped Create Experience links, visa-specific fill-in templates, F1-first controls, Experience styling, independent drafts, and indexed archive target validation. The primary Create action spans the full phone grid row to keep its label readable. The combined post-control, import and feed checks pass (43 tests); the complete combined regression/build is checked separately before release.

The official upstream package remained unpatched when this candidate was prepared. The candidate was subsequently updated with temporary, tested backports for both major versions and separate upstream-advisory monitoring; see [PICOMATCH_SECURITY_FORK.md](PICOMATCH_SECURITY_FORK.md). The high-severity audit gate remains enabled. Use the normal guarded production release and verify it before syncing development.

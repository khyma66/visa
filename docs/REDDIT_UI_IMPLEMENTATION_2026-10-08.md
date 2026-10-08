# Reddit-style UI and completion runbook

Checked October 8 UTC / October 7 America/Chicago. This is implementation evidence for the review branch, not a claim that production changed.

## Implemented in this change

The uploaded Reddit design summary and HTML snapshot were used as layout references, not copied executable code or content. The app retains its own identity, question/answer model, accepted-answer signals, tags and account boundaries.

| Surface | Implementation |
| --- | --- |
| Shared shell | Compact sticky header, native GET search, persistent desktop navigation, native mobile menu, mobile community shortcuts. |
| Navigation | Home, Popular, Explore communities, News, Tags, My communities, Messages, Start a community, safety and support. All link to implemented routes. |
| Question feed | Compact author/time/title/body/tag rows, score and replies, accepted-answer indication, URL-backed search/filter/sort, pagination, loading/error/retry states. |
| Explore | Category chips, server-backed search/category/country filters, bounded directory pages, real Join/Leave and owner-disabled state; no invented member totals or global popularity order. |
| Related questions | Compact list, stale-result protection, contextual empty states and retry. |
| Login | Retains PR #6's document link to `/login#sign-in`, visible Google/email form, safe return paths and retry handling. No Apple button. |
| Imported posts | Preserves PR #4's presentation and native-author-only messaging rules. Provenance remains internal. No synthetic users or messages were added to the hosted service. |
| News | Existing validated Google RSS integration now backs off on upstream failures and shares a bounded failure marker across edge isolates. Public reuse remains opt-in. |
| Dependencies | Compatible `sharp` and `source-map-js` patch overrides. Audit reduced from 16 high/2 moderate to 11 high/2 moderate; gate remains enabled. |
| Deployment evidence | Both builders embed Git SHA/tree, source/config fingerprints and dirty status. Production requires matching source-parity evidence and a clean checkout. Smoke checks verify exact deployed build identity. |

## What is not complete

1. **Live source recovery:** the hosted site has Experience, avatar and policy/privacy work absent from accessible Git. Read `SOURCE_RECOVERY_2026-10-08.md`. The 22-entry hosted migration ledger confirms recent work; it does not reconstruct the frontend source. Do not deploy this branch wholesale over the live Worker.
2. **Hosted database integration:** the community migrations are local only. Reconcile with the current deployed functions, policies and views, including October 3-6 changes. Use the hosted compatibility report before staging. Do not run all old migrations against production.
3. **Security:** the remaining `braces` high-severity chain has no patched release in the checked dependency graph. A reviewed toolchain migration is still needed. Do not bypass the audit gate or silently force major dependency changes.
4. **Account-owned setup:** Google published branding, owned domain/custom auth domain, callback allowlists, SMTP sender/templates, CAPTCHA settings and real email/OAuth acceptance require the actual accounts and operator choices.
5. **Public data/legal operations:** imported redistribution rights, source removals, operator identity, monitored support, moderation ownership, backup restore and retention/request handling are not established by a UI PR.
6. **Visual and hosted acceptance:** local browser preview access was blocked in this session. Component/database tests and a Worker build are not a substitute for desktop/mobile browser inspection or hosted account tests.
7. **Capacity:** 10,000-community/100,000-question fixtures prove bounded query behavior only. They do not prove the design target of 10 million registered users, 1 million monthly active users, or 50,000 concurrent users. Hot-group membership counters, imported-feed delivery and Realtime quotas still need traffic-model testing.

The current hosted advisor check supersedes the old September legacy-RLS warning: it returned no ERROR-level findings and now reports RLS-enabled/no-policy legacy tables. It still warns that leaked-password protection is disabled and identifies public-schema extension/GraphQL discoverability concerns. Exact deployed function/view compatibility was not verified because that metadata query was cancelled. See `HOSTED_COMPATIBILITY_2026-10-08.md`; do not treat absence of advisor errors as complete security acceptance.

## Ordered PR and release process

1. In the original VisaFlow implementation chat/workspace, commit the actual deployed source and push a recovery branch to `khyma66/visa`. Keep credentials and real imported archives out of Git. Record the current Worker version and rollback version. Compare Experience, cookies/privacy choices, country communities, policy receipts, avatars and current RPC calls.
2. Make that verified source the integration base. Port the focused diffs from PR #4 (post presentation), PR #5 (communities/News), PR #6 (login), then this branch (Reddit UI and hardening). PR #3 is a baseline reference, not permission to overwrite newer source. Do not merge PR #2's obsolete app tree.
3. Preserve the recovered app's Experience and other navigation when integrating `CommunityNavigation` and the header. Do not substitute the feed's discussion filter for the separate Experience feature. Keep newer avatar and policy acceptance implementations intact.
4. Rehearse the adapted community migrations against a staging clone of the current schema. Run lifecycle/access tests and verify anonymous read, private-community denial, create, join, leave, owner protection, tags, question pages and account switching through the hosted API.
5. Resolve dependency audit failures without weakening the gate. Record rotation of historically exposed credentials in provider settings. Recheck current hosted advisors; old September findings may have been addressed by newer migrations.
6. Run the complete automated checks on the integrated tree:

   ```sh
   npm ci
   npm run check
   npm audit --audit-level=high
   ```

7. In a reviewed non-production environment, run `npm run dev` and inspect the actual UI at `http://localhost:3000/`. Verify 320/390px mobile and desktop widths, keyboard navigation, mobile menu Escape/close, search, sort, filters, tags, related posts, Join/Leave and the direct login section. Test all new routes and the recovered live-only routes. Do not publish test stories as real community activity.
8. Complete the Google/custom-domain/SMTP steps in `LOGIN_BRANDING_AND_DEPLOYMENT_2026-10-07.md`. Branding alone cannot remove the provider hostname; a verified custom auth domain is required. Backend technology must still be accurately disclosed where appropriate.
9. Record independent, attributable production evidence in `docs/release-review.json`. For source parity, first commit the reviewed source, run `node scripts/build-provenance.mjs`, record its `sourceSha256` under `checks.source_parity`, then commit the evidence-only change. Do not mark unperformed checks verified. Configure required reviewers on the GitHub `production` environment.
10. Only when all gates pass, build/deploy through the manual Reviewed public release workflow on `main`. Merging a PR does not deploy the site. The workflow preserves `.cache/visaflow/build-provenance.json` and tests the deployed SHA/config against it.
11. Verify the final deployment and retain rollback evidence:

    ```sh
    node scripts/smoke-site.mjs <actual-site-origin> .cache/visaflow/build-provenance.json <exact-commit-sha>
    ```

    Complete real Google/email/recovery and two-account messaging acceptance separately. A Worker rollback does not revert database migrations or auth-domain settings.

## News enablement

`GOOGLE_NEWS_RSS_ENABLED=false` remains the public default because the checked RSS channel limits reuse to personal, non-commercial feed readers. The page links directly to Google News in this mode. Enable server-side fetching only once the intended reuse is permitted; then verify publisher/date/URL validation, freshness, outage backoff and cache behavior. No claim of automatic live News display is made while disabled.

## Test interpretation

Final local `npm run check` passed: **254 tests**, TypeScript, Vinext Worker build, a 302-file working-tree secret-pattern scan with no findings, and the 42-post synthetic archive-bundle check. The 254 tests include 24 auth/navigation, 43 community UI, 7 new feed interaction, 27 News, 15 release/provenance, 15 ten-user messaging and the database/security/scale suites. This does not make the dependency audit or hosted production gate pass.

Automated test harnesses execute real handlers with controlled service boundaries; isolated database tests use PGlite. They do not create ten real hosted accounts or verify internet WebSocket delivery. The repository scanner is a pattern-based working-tree check, not proof that historical credentials were revoked. Build success is not production approval.

# Collected API archive on the development Worker

Snapshot captured September 12, 2026 at 05:05 UTC (00:05 America/Chicago). Latest completed source run finished September 11 at 07:06 UTC (02:06 America/Chicago).

| Coverage | Count |
| --- | ---: |
| Completed runs matching the original project's source-group URLs | 3 |
| Source records read across those runs | 1,500 |
| Distinct nonempty posts in the archive | 549 |
| Repeated post records merged | 942 |
| Source entries with no text excluded | 9 |
| Available distinct comments retained within their posts | 606 |
| Tags present on archive posts | 21 |

Runs: `9iVj9RajtVcIVkzgZ` (finished September 8), `5mdyT1d9iodnS1MU1` (finished September 10), and `tRpd0gmY3XTa2x2Ak` (finished September 11). The latest run contributes 27 additional unique posts and the merged archive has 23 additional available comments. Comparison against the previous snapshot confirmed zero previous posts or comments were lost. The exporter lists existing successful runs for the configured Actor, verifies their source URLs match the baseline, and paginates every matching dataset. It does not start scraping runs or access unrelated groups. The newest post snapshot wins while distinct available comments from older runs are retained. The comment count describes returned comments, not every comment that might exist on Facebook.

## Website

Cloudflare confirmed the September 12 refresh to [the development website](https://visaflow-dev.varunchinna5966.workers.dev), version `58edd21f-4959-4bdc-9b7a-36267fcac39a`. Both the hosted `/api/community` endpoint and `http://localhost:3000/api/community` were checked: 549 unique posts, 606 comments, all 27 additional posts present, and all 522 previous posts preserved. The latest included run is `tRpd0gmY3XTa2x2Ak`; no new scraper run was started.

- `/`: all archived posts plus loaded member questions, search, visa/post-type filters, sorting and 20-post pages. Promotions remain visible under the appropriate type, not disguised as questions.
- `/tags`: every archive tag, post counts, tag-name search and alphabetical/popularity sorting.
- `/questions/[id]`: full available post text, available comments, member replies and related-question matches.
- The feed also offers a **Related questions** action on each row and a matching sidebar. Related recommendations exclude the current post and promotional candidates.

The layout uses Stack Overflow-style compact question summaries, blue question links, tag chips, vote/reaction and answer/comment counts, left navigation and a right related-topic column. It retains VisaFlow branding and accurately labels imported reactions/comments instead of inventing votes/accepted answers.

## Hosting without moving a secret

The development Worker has `COMMUNITY_SOURCE_MODE=snapshot`. Its `/api/community` endpoint serves the sanitized generated archive from its server bundle. No Apify token is copied to Cloudflare or the browser. Runtime requests therefore do not depend on an installed Apify credential. The explicit production import/launch gates remain unchanged; this task does not approve general public production redistribution.

The snapshot removes source profile objects/photos, replaces public author handles, and applies the existing email/phone/case-identifier masking. This is not a guarantee of full anonymization: quoted text and source links can still identify people. Nine textless records are counted but not rendered as empty questions.

`npm run archive:inventory` inspects existing completed source runs. `npm run archive:refresh` regenerates the snapshot locally using the existing credential only at Apify. Then run tests and build/deploy the development Worker. Refreshing the snapshot and redeploying is required to include future runs; the site does not claim this bundled archive is live.

## Verification

For the September 12 refresh, archive tests passed, reconciling source counts, uniqueness, comments, tags and related-match targets for all 549 posts. All seven release tests, six security tests, two safety-notice tests and three realtime tests passed, including the local PostgreSQL migration/RLS test. TypeScript, the development Worker build, bundle-secret checks and diff whitespace checks passed. Hosted HTTP smoke checks covered the feed, new-post route, tag directory, account/message/policy pages, health, security headers and real 404 responses. These are data/HTTP checks, not browser visual verification, email-delivery testing or a capacity test. Production launch/import gates and Supabase data were not changed.

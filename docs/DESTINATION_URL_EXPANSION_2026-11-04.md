# Destination URL architecture and expansion

Decision: country means **visa destination**, not the visitor's nationality, residence, legal jurisdiction, or data-storage location. Keep the permanent public base `https://visathreads.com`. Use lowercase `/{destination}/{language}/{section}` paths. `https://visa-central.com` remains an isolated development site, not another country or a production alias.

## Implemented URL contract

| Purpose | URL |
| --- | --- |
| Global entry, retaining today's feed and existing saved searches | `/` |
| Available destination directory | `/countries` |
| US English community | `/us/en` |
| Country content | `/us/en/news`, `/us/en/tags`, `/us/en/explore`, `/us/en/experiences`, `/us/en/guides` |
| Existing content IDs, unchanged | `/us/en/questions/{id}`, `/us/en/experiences/{id}`, `/us/en/c/{slug}`, `/us/en/guides/{slug}` |
| Shared identity, personal areas and actions | `/login`, `/signup`, `/account/*`, `/messages`, `/ask`, `/experiences/new`, `/communities/new`, `/my-communities` |
| Shared support, policies, administration and APIs | Existing `/contact`, `/security`, `/privacy*`, `/terms`, `/cookies`, `/feedback`, `/owner/*`, `/admin/*`, `/api/*` |
| Reserved examples, not launched | `/gb/en`, `/ca/en`, `/ca/fr`, `/au/en` |

The country registry records availability and languages. Explicit routes reuse the current US pages and data; changing a registry entry alone cannot publish a country. Unimplemented countries, languages and country-prefixed private/API routes return 404. Existing launch controls remain authoritative.

Old `/us`, `/news`, `/tags`, `/explore`, `/guides`, `/guides/{slug}`, `/questions/{id}`, `/experiences`, `/experiences/{id}` and `/c/{slug}` receive same-origin 308 redirects for GET/HEAD. Query strings are retained, including repeated filters. The redirect does not replace a URL fragment; browsers retain existing reply anchors. POST and other mutations are not redirected. Root bookmarks and global actions remain valid. Keep these redirects indefinitely; never reuse their paths for another meaning.

Navigation, search submissions, cards, related content, saved posts, account activity, creation success links, sharing, canonical metadata, structured data and sitemaps use the new URLs. Sharing validation also accepts previously copied legacy URLs. Feedback section classification recognizes the new prefix without retaining private query strings or post IDs. Existing post IDs, accounts, drafts, votes, messages, imports, news rights and policy receipts are preserved; no database migration or account copy is part of this change.

## Authentication, support and provider dependencies

Country navigation stays on the same origin, so cookies, local storage and current login sessions remain in place. OAuth and email completion continue at `/login` with the existing validated relative `next` destination. Password recovery stays at `/account/update-password`. Do not create a callback per country or add broad country wildcards. Google redirects to the existing Supabase project's `/auth/v1/callback`; the application callback and Google provider callback are different steps. Neither changes for a content-path migration.

Read-only provider audit on November 4, 2026:

- Cloudflare Email Routing shows `support@visathreads.com`, `privacy@visathreads.com` and `security@visathreads.com` active, forwarded to the existing verified VisaThreads Gmail inbox. Catch-all is disabled. No mailbox, MX, DNS, routing rule, or Gmail setting was changed, and no email was sent.
- Development Supabase Site URL is `https://visa-central.com`; its redirect list includes that origin's `/login**` and `/account/update-password` plus localhost development equivalents. These remain compatible. No settings were broadened.
- The available dashboard account could not access the production Supabase project's URL configuration. The source callbacks and prior configuration records remain unchanged. A fresh production Google/email/recovery round trip and SMTP inbox delivery were not performed; this audit must not be represented as end-to-end email delivery proof.
- Public support and legal links stay on their current paths. Future destination-specific queues should route behind the same public addresses, with assigned language coverage, response ownership and case tracking.
- The existing development sync is blocked by missing community schema (`my_reputation` was the first failing check in release 41797374153). The connected database tool cannot administer that development project. Keep the schema guard enabled; apply the already-reviewed prerequisite migrations with authorized development-project access before retrying sync. This is separate from the URL-only change and must not be bypassed by changing database keys or copying production data.
- No package versions or lockfile changed. The dependency audit found 19 moderate findings and no high/critical findings. Existing findings primarily involve lint dependencies and the image-rendering/Vinext dependency tree. Remediate in a separate compatibility-tested dependency release rather than accepting a blind forced update in this URL migration.

## SEO and localization rules

Use a neutral global domain and path-based country sections; new destinations do not require new DNS, certificates or brands. Language is separate from destination. `en` describes English content for people anywhere seeking a US visa; do not infer `en-US` audience targeting from the destination country. Emit alternate-language links only for actually published translations of the same content, with reciprocal links and self-references. A UK visa page is not a translation of a US visa page.

Preserve existing noindex, imported-content exclusion, private-page exclusion and launch/discovery controls. Update sitemap and canonical URLs together. Do not generate empty destination landing pages or publish automatic machine translations as reviewed immigration guidance. When several countries have useful content, evolve the root into a real global destination selector while retaining old filtered root bookmarks. Let visitors choose their destination and language; do not force IP-based redirects.

References: [Google multilingual and multiregional guidance](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites), [Supabase redirect URL guidance](https://supabase.com/docs/guides/auth/redirect-urls).

## Expansion sequence

1. **Select a destination based on demand and operational readiness.** Review search demand, requests and support capacity using aggregated metrics. Assign an editor and moderator; identify trusted official visa sources and permitted imports. Record review dates and source ownership.
2. **Add a destination data boundary before opening it.** Keep one shared account experience by default. Add destination IDs to country-owned content, communities, search/index/cache keys and moderation queues with server-side authorization and scoped database policies. Backfill today's content to `us` through a reversible, staged migration. Test cross-country IDs, subscriptions, realtime, storage, imports and private data. A URL or browser filter is not data isolation. Do not expose US content as a new country's feed.
3. **Model differences in configuration and content.** Give each destination its own visa taxonomy, official sources, editorial content, forms and support coverage. Treat language, currency and residency as separate attributes. Use shared UI components with destination services; avoid country branches or copy-pasted applications. Keep global private messages and accounts under their existing authorization rules.
4. **Review each launch.** Complete the jurisdiction, privacy, transfer/residency, content licensing, accessibility and moderation review appropriate to the actual audience and operations. Destination choice alone does not determine applicable law. If regional data isolation is required, select regional backends behind the same URL contract and design identity linking explicitly before moving data.
5. **Launch behind an explicit per-destination flag.** Publish reviewed language content, exact routes and reciprocal translation metadata; validate login return paths, support routing, mobile navigation, sitemap, caching and rollback. Enable only that destination after checks pass. Do not automatically open countries listed as planned.
6. **Measure and expand gradually.** Track route errors, legacy redirects, login failures, useful-content coverage, support response times and moderation load by destination without logging sensitive visa profiles. Expand language coverage based on demand and sustainable review capacity. Keep one mainline release process, independent feature flags and a previous verified Worker version for rollback.

## Release and rollback

Use the established guarded `production-features.yml` workflow: full tests, type checking, secret/dependency checks, live-source preservation, build and actual Worker route checks, then production deployment and verification, followed by the isolated development sync. The new destination smoke checks run before release and after each site's rollout. They verify same-origin legacy redirects, query retention, successful canonical pages, security nonces and unopened-country/private-route 404s. Existing regression suites continue to cover authentication, permissions, support, messaging, content and launch controls.

If verification fails, the existing guarded rollback restores the captured prior Worker only when the expected version still owns the deployment. No data rollback is necessary for this release. Redirect responses are private/no-store to avoid caching a migration response across rollout or rollback. After a source change, fetch main again and preserve concurrent features before releasing.

## Local validation record

The final rebased source passed all 1,989 tests across 21 suites, type checking, the repository secret scan, and the full Vinext build. The actual built Worker passed country-route checks. Browser checks with synthetic local data confirmed destination navigation, search at `/us/en?q=...`, and legacy post redirect preservation of query strings and fragments. These checks do not claim an authenticated production login or email-delivery test.

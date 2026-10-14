# VisaThreads UI preview release

## Why the site looked unchanged

The consolidated release branch was pushed but not deployed. The previous live
Worker version was `05c08a98-2d11-4fdf-82fd-62f6f86081ec`. GitHub PR availability
does not publish a Cloudflare build.

## Source of truth

- Repository: `khyma66/visa` (the old `mohan6695/visa` URL redirects here).
- Branch: `release/visaflow-consolidated-20261002`; consolidation PR #3.
- Existing preview Worker: `visaflow-dev`, development environment.
- Domain: https://visathreads.com; www redirects to the apex.
- Existing database: `cycnichledvqbxevrwnt`; no replacement database or account migration.

## PR reconciliation

| PR | Included behavior |
| --- | --- |
| #2 | Current email/OAuth/recovery flow and hardened boundaries supersede the obsolete whole-tree auth branch. It is not safe to merge that old tree wholesale. |
| #3 | Consolidated release branch, restored deployed account/privacy/experience functionality. |
| #4 | Source-neutral feed presentation; imported aliases cannot receive member messages. |
| #5 | Explore, create/join/leave communities, member directory, scoped posts, official news, bounded pagination. |
| #6 | Reliable native login link, visible methods during loading, bounded provider-settings wait. |
| #7 | Desktop sidebar, native header search, dense feed, mobile navigation, URL filters, build provenance. |

This release refines the Reddit-inspired system font, neutral surfaces, rounded
feed interactions, discovery panel and horizontally scrollable mobile shortcuts.
The supplied JSON and HTML are design references only; their content is not
executed or treated as instructions. Reddit branding and assets are not copied.

## Database upgrade

Applied `public_community_lifecycle` and `bounded_community_reads` to the existing
project after isolated PostgreSQL tests. Hosted preflight found zero memberships,
zero orphan memberships, and zero duplicate case-insensitive slugs. Current feed
projection and policy guard were compared with the migration compatibility test.
Both migrations are transactional with a five-second lock timeout.

The added regression checks preserve current policy receipts, single-initial
avatars, private names, experience categories, old feed RPCs and hidden-group
isolation. Post-apply anonymous reads succeed; anonymous creation/membership reads
and authenticated direct membership inserts remain denied. No hosted test users,
posts or communities were created. The bundled 563 posts and 628 comments remain
independent of the empty native question/answer tables.

## Scope and remaining gates

This publishes an **early preview update**, not a public-launch approval. Keep
noindex and existing release gates. The full dependency audit still reports 11
high and 2 moderate findings, rooted in build-tool dependencies (`braces` and
`postcss-selector-parser`); do not describe this as a clean security audit. The
registry has no newer braces release; automated remediation suggests incompatible
toolchain changes. Handle that as a separately tested upgrade, not a blind downgrade.

AI summary endpoints remain disabled (503), and payments/ads stay off. No automatic
production feature changes are enabled. Operator identity, final legal review,
content rights, provider branding and end-to-end email/SMS delivery remain distinct
launch tasks. Browser checks of provider handoff do not prove delivery or successful
account login. Never promise complete protection from attacks or all-state compliance.

## Deployment verification — completed October 8, 03:45 UTC

- Live application commit: `fab04160750697a38b3778349a1d78d26834637b`.
- Worker version: `70b72768-ce1c-4c73-80fc-b5dcd64fa4dc`.
- Live health matches clean source digest `e3007d1fa17005ee59c1a5d44ddfcf25c4217ee36a71dd2bcd2ac97afdcf43a1`.
- 522 tests passed in one uninterrupted run; typecheck/build passed.
- Working-tree known-secret scan: 369 files; bundle scan: 220 files; no matches.
- 21 live page requests returned 200 with CSP and preview noindex headers.
- www redirects to the apex with 308. Live smoke confirms 563 posts, 628 comments,
  21 tags; public read RPCs work and all 22 retired legacy tables deny anonymous access.
- Desktop redesign visible on the real domain. Mobile navigation opens/closes and
  reaches News without overflow. Header search for passport returns 46 matches.
- Explore displays a valid empty community directory, not a schema error.
  No hosted fixture communities created. News currently links out to Google News;
  in-site headline republication remains permission-gated.
- Login preserves the active account. Google/email enabled; phone disabled.
  No fresh OAuth completion, email or SMS delivery claimed. A separate guest
  browser attempt could not attach.
- Local migration `20261006045523` maps to hosted `20261008034145`;
  local `20261006051458` maps to hosted `20261008034201`. Do not blindly replay db push.

Post-migration advisor: no ERROR findings. Remaining warnings include
[public vector extension](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public),
[GraphQL schema visibility](https://supabase.com/docs/guides/database/database-linter?lint=0026_pg_graphql_anon_table_exposed)
(not itself proof of row leakage), and
[disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
Intentionally closed legacy tables retain policy-free RLS.

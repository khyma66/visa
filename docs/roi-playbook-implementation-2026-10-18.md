# ROI and discovery implementation — 2026-10-18

## Scope and decisions

Reviewed both owner-supplied playbooks: SEO and AI Discovery (422 lines) and the updated ROI-First Launch and Operations playbook (662 lines). Their examples, prices, projections and editable legal drafts are planning material, not current business facts or publication approval.

This increment uses the existing Next/Cloudflare application and Supabase database. It adds no paid product, analytics service, visitor tracker, advertising SDK or automatic marketing outreach. It preserves the current early-preview launch gates and the isolated development site's disabled assistant.

| Playbook area | Implemented or retained | Remaining prerequisite |
| --- | --- | --- |
| Useful public content | Three server-rendered H-1B, F-1/OPT and B1/B2 orientation guides, official references, editorial check date, corrections and About page | Genuine contributor recruitment and continued editorial maintenance; no invented firsthand accounts |
| Search templates | Canonicals, social descriptions, query-variant noindex, native Q&A/discussion schema for visible real records, imported discussion server rendering | Public launch approval; imported discussions remain noindex and schema-free |
| Sitemap/crawlers | Owned-host validation, private-route exclusions, approved-launch resource/native sitemap; separate model-use controls | Google/Bing ownership and submission after approval; no crawler or WAF bypass |
| Owner task manager | 16 persisted launch/operating tasks, dependency checks, completion evidence, assignee, due date, optimistic versions and revision history | Owner-entered truthful completion evidence; a task status never changes a release flag |
| ROI experiments | Persisted hypothesis, dates, cash cost, founder time, attributable contribution and observe/improve/scale/stop decisions | Real observed costs, results and attribution; unknown contribution is not zero |
| Reporting | Existing owner-only 7/30/90-day community/import/operations metrics retained; acquisition, AI and revenue readiness tabs added | Visits, attribution, provider spend and payments are explicitly unconfigured, not inferred |
| Feedback/AI | Existing private feedback workflow and assistant release/evaluation controls retained | Changes still require owner review; current assistant work is maintained separately |
| Payments/ads/expansion | Readiness task rather than speculative checkout, ad code or a permanent fork | Delivered paid value, provider eligibility, entitlement/refund/tax review, consent and operator decisions |
| Legal/security operations | Frozen existing policy acceptance documents preserved; launch tasks expose operational requirements | Real operator, credential recovery/rotation evidence, staffed support/moderation, privacy/takedown and restore rehearsals, legal/security review |

## Private storage

`20261018063832_owner_launch_workspace.sql` adds private tables only. Tables have RLS and no direct anonymous, member or service-role table grants. Public invoker RPCs call narrowly scoped internal functions requiring the existing owner allowlist and a current non-revoked session. Mutations validate fields, serialize dependency transitions, rate-limit writes and require the expected record version. Audit history is append-only through application roles. No new owner is provisioned.

The production migration was applied and catalog-verified: 16 backlog tasks, zero experiments/history, zero direct table grants, and four invoker wrappers with no anonymous execute permission. Migration changes are additive; no member posts, replies, profiles or messages were modified.

Security-advisor follow-up: the new private deny-all tables intentionally have no RLS policies. Existing warnings remain for [vector's public extension schema](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [GraphQL-visible public/member objects](https://supabase.com/docs/guides/database/database-linter?lint=0026_pg_graphql_anon_table_exposed), and [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Visibility warnings are not evidence of a row-access bypass; existing RLS tests remain necessary. This release is not a comprehensive penetration-test or legal-compliance certification.

## Discovery boundaries

- Early preview remains noindex, deny-all robots and an empty sitemap. No public indexing approval is inferred from the deployment request.
- Private content is never queried with member credentials for shared HTML. Native reads use anonymous security-invoker views.
- Imported pages display the same normalized, already-public snapshot under the existing publication gate. Generic archive labels are not misrepresented as authors.
- The current native sitemap caps enumeration at 1,000 eligible records. Introduce paginated sitemap indexes before this becomes limiting.
- Approved public search rules keep GPTBot, ClaudeBot and Google-Extended disallowed. Google-Extended also controls Gemini grounding, not Google Search. Revisit this explicit model-use choice separately if desired.
- Thin client-only discovery/filter pages remain noindex until their substantive server-rendered content is reviewed.

## Verification and operations

Automated coverage includes private-role/session denial, dependency completion/reopen conflicts, immutable history, financial unknown/zero distinctions, safe metadata/schema, Workers-compatible redirect handling, imported pagination, guide links/404s and owner UI states. Preview layouts were checked at 320px, 390px and desktop. Builds use the existing isolated environment settings.

Release via the existing guarded production workflow: merge latest main, preserve newer concurrent features, capture live content/source baseline, run all regressions and model acceptance, deploy, then verify exact source and new pages. Sync development only after production verification, retaining its independent database and disabled assistant. Live deployment evidence, not this document, determines rollout success.

## Owner next actions

1. Open `/admin/launch` with the designated owner account and supply actual operator, support, recovery and review evidence. Do not paste credentials or member details.
2. Reconcile `/admin/analytics` exclusions and define the first narrow contributor experiment before entering costs/results.
3. Complete outstanding launch checks before enabling indexing and submitting the sitemap to verified Google/Bing properties.
4. Decide measurement hosting, consent/retention and a budget before adding visitor analytics or invoice integrations. Keep the existing stack until a measured need justifies another service.

No recurring automation, payment, external message or ownership claim was created by this increment.

# Membership and advertising preparation

Prepared October 30, 2026. This is a product/engineering plan, not legal approval.

## Current implementation

`feature/premium-pro-ready` starts from production commit `1bfee33f8818301299e0cd6ed2b92cfb1567306c`.
It is a preparation branch, not a deployable paid product. Do not switch production
to this branch months later without integrating current main and repeating checks.

- `/membership-preview`: noindex plan comparison, a functional session-only research
  list (add, review, remove, JSON export), and explicit ad-layout preview.
- Main feed has dormant sidebar and inline insertion points. They emit no markup
  and reserve no blank space until a provider implementation is separately reviewed.
- Inline inventory is limited to after post 7 and 15, never at the end of a short
  list; preview uses fixed-height containers and clear “Advertisements” labels.
- Checkout, tracking and paid entitlements remain hard-disabled. A member-count
  threshold cannot turn them on. No new provider, secret, database table or policy
  acceptance version was introduced.
- No production or UAT data is copied into this branch. Local sample content only.

## Recommended branch and release strategy

1. Keep `main` as the one maintained application. Review and merge safe foundations
   behind disabled server-side capabilities; use short-lived feature branches.
2. Keep this branch for the requested preview, but merge newer main into it regularly.
   Resolve conflicts and rerun CI; never force-replace main with the snapshot.
3. Complete premium capabilities and payment integration independently. Server-side
   entitlements must authorize every paid API; hiding UI is not access control.
4. Release the exact checked commit to production first using the existing guarded
   workflow, then its existing isolated development sync. Never use production
   database credentials, users, messages, or payment keys in UAT.
5. Use independently reviewed billing/advertising flags with owner approval,
   audit records and emergency-off controls. Disabling new sales must not disable
   cancellation, refunds, existing subscriber access or subscription management.
6. Use a release tag for a known-good version, not a separate permanent “paid app.”

## Product scope and sequencing

| Tier | Candidate value | Implementation status |
| --- | --- | --- |
| Community | Public Q&A, guides, reports, ordinary participation | Existing product; keep free |
| Premium | Ad-free experience, private research collections, checklist/export, opt-in topic digests | Plan UI + session research/export prototype; cloud persistence and digests not implemented |
| Pro | Saved searches, change alerts, bounded source-linked summaries, cross-topic workspace | Proposed only; no paid authorization or higher model quotas yet |

Do not sell legal certainty, guaranteed outcomes, priority moderation, unverified
professional badges, or unrestricted AI. Account/privacy export and safety reporting
must not become paid features. AI quality should remain the same for free and paid
members; paid tiers may increase measured limits after unit economics are known.

Next free-product improvements: duplicate-question suggestions, better answered-status
filters, official-source freshness dates, accessibility/keyboard audit, and improved
new-member onboarding. Add notifications only with clear opt-in and unsubscribe.

## Commercial go/no-go

10,000 verified active native members triggers a review only. Define “active” (for
example, a 30-day qualified activity window); exclude imported authors, fixtures,
bots and deleted accounts. Also review retention, returning usage, support capacity,
AI costs, abuse rates and willingness to pay. No price is approved in this branch.

Before paid launch the owner must choose prices, billing cadence, provider/business
account, eligible countries, tax handling, cancellation/refund policy and support
contact. Complete legal review and versioned acknowledgement where applicable.

Recommended next integration: hosted Stripe Checkout and Customer Portal, with
server-owned price IDs, authenticated customer mapping, signed idempotent webhooks,
out-of-order event handling, reconciliation, usage caps and row-level access tests.
Never grant access from a success URL, browser plan selection, or email alone.
Test purchase, failed/late payment, cancellation, renewal, upgrade/downgrade, refund,
duplicate events and provider outage in a separate payment sandbox before live keys.
This integration is **not implemented** by the current preparation branch.

## Advertising controls before activation

- Obtain publisher approval, owned-domain verification and approved inventory IDs.
- Only reviewed public editorial/feed inventory. Do not monetize unreviewed imported
  content; rights clearance and moderation must precede ads.
- No ads in authentication, private messages, account/admin areas, private communities,
  or sensitive case details. Do not target by citizenship, immigration status,
  private searches, case text or personal documents.
- Keep units visually distinct and away from vote, navigation and submit controls.
  No fake sponsored posts, accidental-click layouts or “support us by clicking.”
- Implement reviewed regional consent, opt-outs, GPC handling and updated disclosures
  before loading scripts. A U.S.-focused topic does not mean every visitor is in the U.S.
- Add a provider adapter, consent-aware request logic, CSP allowlist, approved ads.txt,
  ad-free entitlement checks, empty-fill collapse and layout/performance tests.
- Start with one sidebar unit; add sparse inline units only after usability/revenue
  evidence. Disable ads immediately with a separate kill switch if problems occur.

Google requirements and provider references checked October 30, 2026:

- https://support.google.com/adsense/answer/1346295
- https://support.google.com/adsense/answer/48182
- https://support.google.com/adsense/answer/13554116
- https://docs.stripe.com/payments/existing-customers
- https://docs.stripe.com/payments/checkout/limit-subscriptions
- https://docs.stripe.com/automated-testing

## Validation and preview

Run `npm run test:notices`, `npm run test:feed-ui`, `npm run test:presentation`,
`npm run typecheck`, and `npm run build`. The new membership tests are part of CI.
Use the repository's isolated local demo command and open `/membership-preview`.
Do not deploy this branch over UAT solely to preview it: UAT must continue matching
the live production source. Use an isolated local preview or a separately approved
temporary environment instead.

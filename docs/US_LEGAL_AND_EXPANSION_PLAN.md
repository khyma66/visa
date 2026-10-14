# VisaThreads US launch and expansion plan

Prepared October 4, 2026 for the operator. This is an implementation and legal issue-spotting plan, not legal advice or a completed 50-state legal opinion. Public launch remains blocked. The policies describe early access, not an invented incorporated business or a guarantee of compliance.

## Decisions and implementation scope

Use a conservative adults-only membership baseline: at least 18 and legally able to agree where the member lives. A checkbox is not verified age assurance. Do not collect full birth dates or identity documents merely to improve the appearance of compliance. Operator approval and counsel review remain required before public launch.

Signup displays collection information and links to terms, privacy and storage notices before requesting an email code. Email login no longer silently creates a new account. After authentication, members separately confirm terms agreement, privacy-notice acknowledgement and adult eligibility. Receipts store account ID, policy version, market context and a server timestamp; browser roles cannot overwrite dates, alter receipts or access another account's receipts. They contain no IP, user agent or date of birth. User-editable auth metadata is not the authorization source. Existing accounts are not silently grandfathered in.

The database publication guard checks the current receipt for posts, replies, votes, new conversations, messages and profile publication. Existing rate and suspension controls remain. Privacy/help pages stay accessible without agreement. An acknowledgement is not marketing consent, payment authorization or permission for sensitive-data advertising. A direct authentication API call can still create an auth identity; this is a participation gate, not a complete pre-registration age-verification/auth-hook system. Public launch needs direct-API registration and abuse review.

Current routes include /privacy, /terms, /cookies, /privacy-choices, /contact, /countries and /us. No paid integration, AdSense script, new foreign-market database, wildcard DNS record or separate permanent paid branch is activated by this change.

## US legal findings

The review register in us-jurisdiction-review.json includes every state and DC. Each remains pending an actual applicability determination using business identity, turnover, resident counts, data uses and relevant effective dates. A row is not evidence that counsel reviewed that state. The [NCSL legislation database](https://www.ncsl.org/technology-and-communication/consumer-privacy-legislation-database) includes introduced bills, not just enacted law; do not treat proposals as law.

All states have breach-notification laws, with differing triggers, recipients and timing. The response plan must map affected residents to the correct requirements, not use a single national deadline. See [NCSL's statutory index](https://www.ncsl.org/technology-and-communication/security-breach-notification-laws).

California: evaluate all applicability routes, notice-at-collection, service-provider agreements, sensitive data, rights and opt-out signals. The inflation-adjusted revenue threshold is $26,625,000 for the current adjustment period, not the stale $25 million figure often quoted. This is only one applicability route. See [CPPA adjustment](https://cppa.ca.gov/regulations/cpi_adjustment.html) and [California AG guidance](https://oag.ca.gov/privacy/ccpa). Separately review CalOPPA and other laws even if CCPA thresholds are not met.

Texas: small-business treatment is not a blanket exemption from every obligation; sensitive-data sale has a consent rule. See [Texas AG guidance](https://www.oag.state.tx.us/consumer-protection/file-consumer-complaint/consumer-privacy-rights/texas-data-privacy-and-security-act). Do not use 10,000 registered accounts as a universal legal threshold.

Maryland: MODPA requires separate sensitive-data and minimization analysis; the AG notes that covered controllers cannot sell sensitive data. See [Maryland AG](https://oag.maryland.gov/resources-info/Pages/data-privacy.aspx). Minnesota also needs a current applicability and enforcement review; see [Minnesota AG](https://ag.state.mn.us/Data-Privacy/Consumer/).

Rhode Island: review the exact statute rather than a generic summary. Section 6-48.1-3 addresses controller designation and has specific collection/storage/sale and targeted-advertising disclosure language; its subsection conditions matter. See [official statutory text](https://webserver.rilegislature.gov/Statutes/TITLE6/6-48.1/6-48.1-3.htm).

Washington consumer-health rules, Illinois biometric rules, Nevada privacy rules, state interception/session-replay rules, and children's/teen online protections require separate review if relevant features or data appear. A visa forum can incidentally receive health, citizenship, national-origin and other sensitive information. Do not enable session replay, document upload, biometric verification, sensitive profiling or targeted ads without this analysis. State-specific applicability and exemptions are not resolved by this report.

Federal and cross-state work:

- Truthful disclosures and reasonable security must reflect actual practices. No claim of anonymity, end-to-end encryption or absolute security when untrue.
- Adult-only terms do not erase COPPA duties if the service is child-directed or has actual knowledge of under-13 collection. Review the [FTC COPPA guidance](https://www.ftc.gov/business-guidance/privacy-security/childrens-privacy), amended rule and relevant state teen requirements; assess age assurance and discovery/removal procedures with counsel.
- A UGC forum may be a covered platform under TAKE IT DOWN. Covered platforms need clear no-account removal intake and removal of validly reported intimate imagery plus known identical copies within 48 hours. This duty is not established merely by publishing a mailbox. Confirm coverage, staff escalation and test response tracking. See [FTC business guidance](https://www.ftc.gov/business-guidance/resources/complying-take-it-down-act).
- Assess DMCA agent registration, notices/counter-notices and an implemented repeat-infringer policy before claiming safe-harbor protections. See [Copyright Office](https://www.copyright.gov/512/). Reconfirm import permission for VisaThreads and future countries; prior permission referred to the old domain. Source credits are not a license.
- Keep case-specific legal representation and paid referrals out of scope until immigration counsel reviews licensing, referral fees and unauthorized-practice issues. Disclaimers alone do not cure the underlying activity.
- Test keyboard, screen-reader, zoom and mobile access, including signup and complaint intake. See [DOJ accessibility guidance](https://www.ada.gov/resources/web-guidance/).
- Before marketing, review CAN-SPAM, state consumer-protection and endorsement rules; SMS needs separate TCPA/state analysis. Do not bundle marketing with terms acknowledgement.

## Owner actions required before launch

1. Supply legal operator name and publishable business address; confirm state of formation/operation and a responsible privacy contact. Do not expose a home address without an explicit business decision.
2. Assign support and moderation coverage. Replace temporary Gmail with controlled support@ and privacy@ mailboxes, MFA, access limits and case tracking. Keep sensitive attachments out of normal email.
3. Approve retention periods per record category, deletion/export steps, session revocation, legal holds and backup expiry. Run real request and appeal drills with deadline tracking. Do not invent completed controls in the public policy.
4. Obtain qualified US counsel's applicability review for all launch jurisdictions and record the review in the register. Every state remains pending until evidence exists.
5. Verify vendor contracts, processing locations, historical credential revocation, email delivery/recovery, age/auth abuse controls, dependency remediation and incident-response ownership. Existing release gates stay closed.
6. Freeze a copy of every accepted policy version. When text materially changes, increment the policy identifier and current-version database policy together; keep historical text and receipts under the approved retention policy. Never rewrite a historical receipt to indicate acceptance of new terms.

## Country architecture

Recommendation: one shared application and an explicit country registry. Start with visathreads.com/us and keep current root/login URLs stable. Only the US page is implemented now; it shares the existing feed. Country of interest is distinct from residence, citizenship, billing address and legal jurisdiction.

When a second country is actually approved, provision an explicit host such as gb.visathreads.com or in.visathreads.com, certificate, matching Worker routing and exact authentication callbacks. Cloudflare [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) route a hostname to a Worker; DNS does not partition database records. Avoid wildcard auth redirects and automatic location-based forced redirects. Give people an explicit country selector and preserve accessibility and deep links. Never trust a client-supplied country or forwarded-host header as authorization.

For genuinely separate user bases, prefer a per-market backend project with independent keys, exact auth callbacks, storage, backups and regional vendor review. The same build can run with market-specific configuration. Accounts are separate unless a later explicit linking design is approved. Do not copy existing accounts, posts or private messages into another country by default. If a shared database is chosen instead, first add server-authorized memberships, market IDs on every relevant table, composite constraints, scoped realtime/storage/search, and cross-market RLS tests. A browser filter is not isolation. No foreign market launches before one of these isolation designs is deployed and tested.

Before each country opens, complete local privacy, consumer, age, online-safety, tax, payment, residency and transfer reviews; localize policy versions, notices, currencies and language. DNS geography is not a data-residency guarantee. Test unknown hosts/country codes, cross-market IDs, login callbacks, cache keys and rollback. Keep unopened country codes unavailable.

## Monetization and branch strategy

10,000 is an owner-selected review milestone, not an AdSense qualification or legal exemption. Proposed metric: verified, nonsuspended active members over a defined 30-day window, excluding bots, test users and imported authors. The operator must approve that definition. The implemented readiness helper returns reviewDue at 10,000 but keeps payments, advertising and marketing false at every count. It is not a scheduler or an automatic billing switch.

Do not maintain independent free and paid products. Use short-lived branches such as feature/billing and feature/ads from the same mainline, then merge tested modules behind separate server-controlled country/environment flags. These names are proposals; no branch has been created or switched. Every release must pass shared regression/security tests. Keep a versioned rollback release, backward-compatible database migrations and a kill switch. Turning off new purchases must not stop subscription cancellation, refunds or webhook reconciliation.

Payments proposal: hosted [Stripe Checkout](https://docs.stripe.com/payments/checkout) or another reviewed provider reduces direct card handling. Keep prices and entitlements server-side. Verify webhook signatures against the raw body, deduplicate event IDs, handle retries/out-of-order events and derive entitlement from verified provider state, never the success URL. See [Stripe webhook guidance](https://docs.stripe.com/webhooks). Test mode first, separate secrets, no card data in our database, no charges without explicit purchase consent. Review sales-tax nexus, service taxability, renewal notices, cancellation, refunds and chargebacks per state before activation. Do not assume the FTC's older click-to-cancel rule is current; check the [current rulemaking record](https://www.ftc.gov/legal-library/browse/rules/negative-option-rule), ROSCA and state automatic-renewal rules at launch.

Advertising proposal: apply only after original/authorized content quality, real traffic, moderation and legal operations are ready. Google's [eligibility requirements](https://support.google.com/adsense/answer/9724/eligibility-requirements-for-adsense?hl=en-uk) are not a promise of approval at a certain registered-user count. Publishers are responsible for [UGC on pages containing ads](https://support.google.com/adsense/answer/1355699?hl=en). Never place ads on private messages, authentication, account, moderation or sensitive-case pages; do not transmit message text, emails or immigration profiles as ad targeting data.

Before loading any ad script, implement country-appropriate consent/opt-out controls, honor GPC where required, provide persistent privacy choices, assess restricted-data processing and Google publisher policies, and test network traffic before/after refusal. Review [Google US-state messaging](https://support.google.com/adsense/answer/10961479?hl=en) and [restricted-data processing](https://support.google.com/adsense/answer/14182916). Foreign-market ads need their own consent/platform review. Do not loosen the current restrictive content-security policy until exact reviewed script/frame/connect destinations are known. Contextual/nonpersonalized ads still require privacy and provider review.

Activation requires independent signed-off reviews for billing and ads, not a branch switch or user count alone. Payment-provider onboarding, AdSense application/approval and actual charging remain future work requiring the operator's business and commercial choices.

## Deployment and verification

October 4 implementation deployed to the existing visaflow-dev preview, revision d0daef33-d01c-434e-81f3-89f4eec5f1d4; PUBLIC_LAUNCH_APPROVED was not enabled. The additive receipt migration is applied to the existing project. Hosted catalog checks verify own-account RLS, no anonymous read, no member timestamp insertion/update/deletion and the publication guard. No test accounts, live acknowledgements or posts were created in this pass.

Type checking, build, policy/auth tests, nine isolated receipt database tests and the existing regression suites passed. The initial all-suite run hit a 60-second realtime test timeout; the isolated database case and complete realtime suite passed on rerun, and the remaining suites were run successfully. This is not evidence of production capacity. Seventeen live routes, response security headers, fresh nonces and real 404 behavior passed. Signup was inspected visually and its initially unchecked required checkbox and policy links were checked. Human authenticated email-to-acknowledgement completion and a full mobile/assistive-technology audit remain unverified.

Provider security advisors still report the existing public vector extension, GraphQL-schema visibility and disabled leaked-password protection. The receipt table is discoverable to authenticated clients by design, but only the owner's rows are readable; the [schema-visibility advisory](https://supabase.com/docs/guides/database/database-linter?lint=0027_pg_graphql_authenticated_table_exposed) is not evidence that another member's receipts are readable. [Leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) and the existing dependency/historical-credential issues remain separate launch work. Hosted PostgreSQL reports 17.6; review the current provider upgrade/security guidance before public launch, without assuming a disruptive upgrade is authorized here.

Policy source snapshots and SHA-256 hashes are retained in policy-versions/2026-10-04-preview-v1.json; a regression test rejects silent edits to that version. No Git commit, branch switch, new billing account, AdSense application, foreign DNS record or country data migration was performed.

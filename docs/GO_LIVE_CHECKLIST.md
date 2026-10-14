# VisaFlow: steps to public launch

**Latest status and minimal owner actions:** [September 11 remediation handoff](SECURITY_FIXES_2026-09-11.md). It supersedes the earlier dependency/CSP findings: full audit is now zero and the new community write-guard fixes are installed. Legacy containment is still approval-blocked; no production launch occurred.

**Current decision: NO-GO for public registration.** The dev URL is reachable; it is not a private staging environment merely because it says “dev.” Keep testing limited and arrange actual preview access control. No production launch, paid purchase, credential rotation or compatibility-changing legacy lockdown was performed in this review.

Read alongside [security findings](SECURITY_REVIEW_2026-09-11.md), [U.S. legal/policy review](US_LAUNCH_REVIEW.md), [human test cases](HUMAN_ACCEPTANCE_TESTS.md), and [credentials](LIVE_CREDENTIALS.md). The first two steps are urgent containment, not tasks to postpone until marketing launch.

## Ordered work and acceptance gates

1. **Contain the exposed legacy data.** Inventory consumers, take a restricted backup, approve a permission plan and lock down the 15 exposed tables and any inappropriate public storage. Test necessary legacy consumers after the change. Alternatively create a clean production Supabase project for the new community, but separately contain the old exposure. Do not change or replay migrations blindly: existing hosted/local migration IDs differ; see [the mapping](PRODUCTION_READINESS.md). Preserve records and avoid unauthorized deletion.
2. **Rotate previously exposed credentials.** Determine the exact affected provider keys from a private history scan; issue least-privilege replacements, update authorized environments, revoke the old keys, verify failure of old access, and inspect audit logs. Secure Cloudflare/Supabase/GitHub/registrar/email admin accounts with MFA. Do not send keys in chat or commit them.
3. **Choose the public product and operator.** Supply legal operator/state, domain, age range, supported locations, contacts and spending cap. Recommended small first release: adult text-only native Q&A/chat, no ads/payments, no imported archive in production until rights are settled. This scope still needs privacy/security/moderation controls.
4. **Prepare isolated production data and authentication.** Use only reviewed community migrations for a clean project, verify extensions and grants, test every role/view/RPC/storage path, configure allowed origins, confirmation and recovery, appropriate password controls and Auth-side CAPTCHA. Configure a verified transactional sender and exact HTTPS redirects. Do not introduce another login/chat provider unless requirements justify it; the current app uses Supabase Auth and Realtime.
5. **Finish missing user protection features.** Build secure account export/deletion and session revocation, retention processing, no-account support/privacy/copyright/intimate-content intake, reviewer alerts, appeals and durable import suppression if imports remain. Set the chosen age policy and capture final terms version/acceptance where appropriate. UI checkboxes alone cannot enforce backend eligibility or stop abuse.
6. **Appoint and train people.** Name a moderator, security/on-call owner and backup person. Resolve the moderator’s exact registered profile under administrative access; never make the first signup an admin. Agree report coverage/escalations, incident procedures, law-enforcement request handling and legal counsel contacts. Exercise requests with harmless test fixtures.
7. **Finalize the policies.** Replace preview policy text with reviewed operator-specific Privacy Policy/Terms, retention and support details, age policy and applicable complaint/DMCA details. Verify actual providers/logs/storage against claims. Record federal/state applicability decisions from the U.S. review. A disclaimer does not remove duties or authorize copied content.
8. **Test the patched release candidate.** Compatible dependency updates resolved the previously reported full-tree findings; the full audit is now zero. Run source-secret/security/notice/archive/release/database tests again after updates, plus TypeScript, full dependency audit and Worker build/bundle checks. Pin and review CI actions; configure branch protections and required production reviewers. Commit/push the reviewed changes before using GitHub release automation; no commit/push was performed by this review. Historical credentials still require rotation.
9. **Run all human tests.** Use isolated Alice/Bob/Eve and moderator accounts from the [test plan](HUMAN_ACCEPTANCE_TESTS.md). Real email delivery, logout/account-switch privacy, outsider chat denial, abuse reports, deletion/export and mobile/accessibility must pass. A browser-policy block is an unverified check, not a pass. Have an independent security specialist perform an authorized prelaunch assessment of auth/RLS/realtime and re-test findings.
10. **Prove recovery, capacity and cost.** Back up data and storage separately, restore to an isolated target, test alert delivery and rollback, and run a bounded staged load test. Define a small initial user/concurrency target and budget. Millions of registered users and millions of simultaneous chats are different engineering targets; neither has been demonstrated here.
11. **Configure the final domain and release approvals.** Connect the chosen domain in Cloudflare, verify DNS/HTTPS, exact Auth redirect URLs and all worker aliases. Review WAF/rate limits and direct Supabase protections separately. Store deployment secrets in the protected GitHub environment or local credential manager, not in source. Fill `docs/release-review.json` with real evidence and named reviewers tied to the exact site/database.
12. **Release a limited pilot, then expand.** Only after approval deliberately enable the production launch flag and follow the guarded workflow below. Verify hosted routes/headers and human flows, watch errors, reports, delivery and costs, and retain rollback ability. Do not announce general availability while essential tests or policy channels remain unfinished.

## Release commands for an engineer — not ready to execute today

Use a clean reviewed checkout with the supported Node version and lockfile. Configure ignored `.env.production.local` or protected CI variables with the four public configuration values listed in [credentials](LIVE_CREDENTIALS.md). Secret values never go in command arguments.

```sh
npm ci
npm run test:notices
npm run test:archive
npm run test:release
npm run test:realtime
npm run typecheck
npm audit --audit-level=high
npm run check:release
npm run build:prod
```

`check:release` must **fail today**. Do not change pending/blocked statuses to “verified” without proof. When approved, set the production `APP_ENV=production` and `PUBLIC_LAUNCH_APPROVED=true` in the reviewed configuration. Leave `IMPORTED_CONTENT_APPROVED=false` unless separately approved with evidence and a reviewer. Configure the production origin/route before deployment; never deploy a generated development config as production.

The manual GitHub `Reviewed public release` workflow uses the protected `production` environment on `main`. It checks tests/audit, builds and deploys. For a reviewed local release, after running the full audit/test sequence above:

```sh
npm run deploy:prod
node scripts/smoke-site.mjs https://YOUR-CHOSEN-PUBLIC-DOMAIN
```

Replace the example domain with the approved real domain. The smoke script checks routes/headers/configuration and a 404; it does not prove database health, SMTP delivery or capacity. Repeat human signup/chat/report tests against the deployed version. Keep the prior Worker version ID and a compatible database recovery plan. To close during an incident, apply the appropriate access control: the app maintenance flag alone cannot stop direct Auth/Data API/storage requests.

## What the owner must provide next

- Decision/approval for legacy containment vs separate production data, with known old consumers.
- Legal operator and state, chosen domain, age/market scope and imported-content decision.
- Monitored support/privacy/abuse addresses, moderator username and on-call owner.
- Authorized provider access through secure dashboards/connectors, production plan/budget, and controlled test mailboxes.
- Counsel’s policy/applicability review, then documented human signoff.

Credentials alone do not make this ready. The remaining deletion/intake/bot-control work and validation are substantive engineering/operational tasks. No reliable “maximum work” or launch date can be promised until these decisions and findings are resolved.

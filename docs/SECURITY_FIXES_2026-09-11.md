# Security fixes and minimal owner handoff

Updated September 11, 2026 UTC. Public launch remains **NO-GO**. This is a tested remediation pass, not a guarantee against hacking, a comprehensive penetration test, or a legal compliance certification.

## Done

- Updated compatible dependencies, including Cloudflare Vite plugin 1.54.7 and Wrangler 4.131.0. The full npm audit now reports **zero known vulnerabilities**, not just zero runtime findings. No forced major upgrade was used.
- Fixed auth-state races: sign-out and account changes immediately clear the old profile, reject delayed results, and remount account-specific message/draft state. Tests cover slow reads, failed reads, mismatched profiles, cleanup and stale initial sessions. Real two-browser testing is still required.
- Installed nonce-based script restrictions, disabled inline event handlers, and limited browser connections to the configured Supabase HTTPS/WebSocket origin. Client-supplied security headers are replaced. Streamed script nonces match the response policy. HTML is dynamic and not shared-cacheable; fingerprinted assets and public JSON retain their caching. This trades additional rendering cost for per-request nonces and needs load measurement. Inline **styles** remain permitted; this is not a complete XSS prevention guarantee. [Framework CSP guidance](https://nextjs.org/docs/app/guides/content-security-policy).
- Disabled request-time live upstream imports in production. Optional local/dev live reads require explicit opt-in, the exact official API base, no redirects, bounded page/total bytes, record limits, timeouts and generic error logging. The existing snapshot still contains 522 unique posts, 583 available comments and 21 tags. Native Q&A/chat does not require an Apify credential.
- Replaced the unauthenticated legacy MCP handler with an inert 410 response and removed its resource bindings in source. **No old deployed MCP service was changed or proven absent.** Its existing deployment must be inventoried and retired or separately secured before reuse. Do not follow older MCP deployment guides.
- Applied the narrowly scoped current-community migration: suspended users cannot change accepted answers or publish profile bio/avatar updates; answers can only be accepted on open questions, with a rate limit. Hosted metadata confirms both guards and anonymous RPC denial. This migration does not touch legacy tables.
- Added repeatable security tests, a value-redacting source/history secret scanner, and full audit/source checks to CI and local production release commands. Production launch and imported-content gates remain closed.

## Verified evidence

- 20 automated tests pass: security 6, release 7, notices 2, archive 2, realtime/database 3.
- PostgreSQL tests use three isolated identities and actual community migration SQL, including the new guard migration. The legacy containment plan is also tested on a disposable database fixture: records survive, old browser grants disappear, current-community grants remain. That fixture does not validate pgvector relocation or real old-client compatibility.
- TypeScript, development build and the known-secret bundle scan pass (149 files).
- Local HTTP smoke checks pass for 12 routes plus genuine 404, script/header nonce matching, fresh nonces and hostile-header replacement. These are not browser, email, live messaging or accessibility acceptance tests.
- Read-only pattern scan of 246 working files found no matching privileged-key patterns. Reachable Git patch history contains service-role JWTs in seven historical file paths. The scanner prints no values; it is not exhaustive and does not establish whether old keys are still active.
- Supabase applied migration: local `20260911050812_community_write_guard_gaps.sql` → hosted `20260911051823` on `cycnichledvqbxevrwnt`.
- Development-only deployment: `5650b1cb-ba37-4b26-b717-4d67f5157e5c`, [dev website](https://visaflow-dev.varunchinna5966.workers.dev). No Apify credential was uploaded. This reachable URL is not a private staging environment; noindex is not access control.
- The same 12-route/404/nonce/header smoke checks passed against that deployed dev URL. Browser interaction and rendered visual inspection remain unverified.
- No production deployment, Git commit/push, Git history rewrite, credential rotation, data deletion or paid service purchase was performed.

## Minimal actions for the owner

### 1. Approve the exact legacy containment change

The automated approval system blocked the proposed live lockdown because it can disrupt old clients. It is **not applied**. The latest hosted advisor still reports 15 legacy tables with RLS disabled. [Supabase remediation guidance](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public).

Proposed scope: enable RLS and revoke PUBLIC/anon/member table and column access on 24 legacy tables; revoke browser access to 6 old sequences; make the existing `posts` bucket private (1 object, preserved); fix/restrict 4 old functions and relocate the relocatable `vector` extension out of public; revoke public-schema CREATE. Current community tables are excluded. Privilege/definition metadata is saved privately; it is not a data backup or tested restore plan. Records are not deleted. Old browser consumers and the existing public asset URL may stop working; privileged legacy integrations still need compatibility testing.

Approve this scope only after confirming those old consumers can be stopped. SQL: [legacy_access_containment](../supabase/migrations/20260911025026_legacy_access_containment.sql). Do not route the denied change through a different tool or apply an unreviewed whole-project migration push.

### 2. Provide secure provider access, not secrets in chat

- **Turnstile:** you approved starting setup. The Turnstile Spin procedure paused at its access probe because `CLOUDFLARE_API_TOKEN` is absent. At [Cloudflare API tokens](https://dash.cloudflare.com/profile/api-tokens), create a custom token with **Account → Turnstile → Edit**, restricted to the intended account. Supply the account ID (not secret) and authorize the token securely. Existing Worker-deployment login is not proof of Turnstile editing scope.
- Cleanest token handoff: in Bash, read the token without echoing it, export it, and restart the agent from that shell. The literal command contains no secret:

  ```bash
  read -rsp 'Cloudflare API token: ' token; echo
  export CLOUDFLARE_API_TOKEN="$token"; unset token
  ```

- Alternative: save it yourself to a user-only file, then tell the agent only that file's path. In Bash, this refuses to overwrite an existing file:

  ```bash
  (umask 077; set -C; read -rsp 'Cloudflare API token: ' token; echo; printf '%s' "$token" > "$HOME/.cf-turnstile-token"; unset token)
  ```

  The remaining wizard must confirm domains and insertion points before creating/wiring a widget. No widget was created, no CAPTCHA secret was retrieved or stored, and no fresh-token/replay validation was performed in this pass. Existing Auth calls go directly to Supabase: bot verification must be enforced there, not only on the website. [Supabase CAPTCHA integration](https://supabase.com/docs/guides/auth/auth-captcha).
- **Rotate exposed credentials through provider dashboards.** This scan confirmed historical Supabase service-role JWTs; review earlier credential inventories for other affected providers as well. Update authorized consumers, revoke old access, verify rejection, and inspect logs. Never reuse history values just because a test needs credentials. Removing history alone is not revocation.
- Enable MFA on provider/admin accounts and authorize verified transactional email configuration. No additional chat vendor is needed.

### 3. Send one small operator brief, then perform human acceptance

Provide: legal operator name and U.S. state; chosen public domain; one monitored support/privacy/abuse contact; exact registered moderator username; intended age policy and monthly budget. Recommended initial scope to confirm: adult, text-only native Q&A/chat, no ads/payments and no imported archive in production. This is a proposal, not an implemented age-verification policy.

Use [human tests](HUMAN_ACCEPTANCE_TESTS.md): real signup/confirmation/recovery emails, sign-out/account switching and back-button behavior, two-user messaging plus outsider denial/blocking, reporting/moderator handling, keyboard/mobile/screen-reader use. Before release also exercise backup restore, incident alerts and staged load/cost tests; obtain independent security and operator-specific legal review.

## Engineering that still remains — not passed off as an owner checkbox

Complete verified export/deletion and retention with session handling, monitored no-account privacy/copyright/abuse intake and escalation, durable imported-content suppression if imports continue, selected age policy enforcement and final operator-specific policies. Configure and verify Auth-side CAPTCHA/email, staff moderation (currently zero appointed moderators), protect preview access and assess old deployed services. Browser automation is blocked by administrator policy, so real browser/CAPTCHA/email verification is pending. These require the operator/access choices above and further implementation; no claim is made that credentials alone finish them.

The machine-readable [release review](release-review.json) remains pending/blocked. Follow [the complete launch sequence](GO_LIVE_CHECKLIST.md) only after its evidence exists. Do not replace pending checks with “verified” merely to get a deployment through.

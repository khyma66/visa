# VisaFlow staged authentication

Implemented against `@supabase/supabase-js` 2.90.1 in the accessible repository. This is a staged auth foundation. It does not establish that the missing September frontend has been recovered or that hosted credentials/configuration are correct.

## User flow

- `/login`: Google (only when explicitly enabled) or email and password. Password recovery and signup links are available. No Apple option is rendered or called.
- `/signup`: email → six-digit verification code → password. The confirmed production `private.handle_new_user` trigger assigns a random public username. Chosen usernames are intentionally unavailable because the current database has no authorized username-write API; `user_metadata` is not a substitute.
- `/auth/callback`: explicitly exchanges a PKCE code once, clears it from browser history, and redirects only to a safe local route. Expired/missing codes fail; an existing cached session cannot turn a failed callback into success.
- `/reset-password`: requests an email with a generic success message, then validates the user against Supabase before permitting a password change.
- Public browsing remains available. Authenticated participation must remain protected by server validation and database RLS, regardless of UI state.
- `AuthNav` validates the browser user with Supabase before showing signed-in state, listens for session changes, and exposes explicit logout for the current browser. It does not expose email addresses in the header.

This follows Reddit's lightweight provider/email entry, verification, and password pattern while preserving VisaFlow branding. It is not an exact Reddit clone: email-only password login avoids building an unsafe public username-to-email lookup, and username selection is deferred until a protected canonical profile operation exists.

## Required hosted configuration before release

1. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the intended project. A legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted for compatibility. Never set a secret/service-role key in a `NEXT_PUBLIC_` variable. Missing or invalid configuration disables auth controls. The runtime guard does not make an accidentally bundled secret safe: rotate any previously exposed credential.
2. Configure the exact HTTPS Site URL and `/auth/callback` redirect allowlist in Supabase. For password recovery the callback includes `recovery=1&next=%2F`; configure exact required callback URLs, or a narrow callback query wildcard per current Supabase redirect rules. Do not allow arbitrary preview hosts on production. PKCE email links must be opened in the same browser/device that requested them.
3. Enable email authentication. Set both **Magic Link** and **Confirm Signup** email templates to display `{{ .Token }}` so new and existing accounts receive the six-digit code. Configure a six-digit OTP and a short expiry suitable for the application. The UI enforces a 60-second resend delay; Supabase must enforce actual server limits.
4. Configure a verified custom SMTP sender and delivery monitoring. Supabase's default mail service is not a production mail solution. Test with an actual controlled inbox, including spam delivery, an expired code, a reused code, and resend throttling. Do not disable email verification to make tests pass.
5. Keep the recovery template's `{{ .ConfirmationURL }}` link so Supabase verifies the recovery request before the PKCE redirect. Test email recovery through a real inbox in the requesting browser; no hosted reset message was sent during local tests.
6. Set the server-side minimum password length to at least 12 and enable leaked-password protection when the project plan supports it. The UI's 12–128 character rule is not a server security control.
7. For Google, configure OAuth credentials in Supabase/Google with the Supabase provider callback, consent screen, and approved domains. Set `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true` only after a real consent/callback test succeeds. Leave it unset/false otherwise. Do not place the Google client secret in the frontend.
8. Enable Cloudflare Turnstile under Supabase Auth CAPTCHA protection, configure matching domain/site credentials, and set `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. The widget token is passed on password login, OTP send/resend, and password-reset requests. Supabase performs server verification. Without the hosted CAPTCHA setting, displaying the widget alone does not block direct API abuse. If the widget cannot load, configured forms fail closed.
9. Removing the UI option does not disable Apple's hosted provider. Inventory existing Apple identities before disabling the provider, and establish tested recovery/linked sign-in for those users so they are not locked out. This code does not delete or unlink existing identities.
10. Apply and verify RLS/column privileges for profiles, communities, posts, Q&A, messages, and all exposed tables. Require authorization on every write. Never use user-editable metadata for roles. Incomplete signup still has a verified-email session after OTP; do not use client onboarding steps as an authorization boundary.
11. Remove third-party ad/analytics scripts from authentication pages, deliver security headers from the actual hosting layer, and redact callback query strings in access/error analytics. Restrict callback `Referrer-Policy` to `no-referrer`. Configure CSP with only necessary script/connect origins, including Turnstile if enabled.
12. Confirm the intended production deployment/source and run full app tests before publishing. This auth work is not a fix for the legacy app's unrelated missing libraries or deployment adapter.

## Session boundaries

The foundation is deliberately browser-only. Supabase stores the session in browser storage under `visaflow-auth`, uses PKCE, and refreshes it automatically. No server route should trust this local state. Existing backend endpoints do not automatically inherit the new browser session. Add authenticated bearer requests or a reviewed `@supabase/ssr` cookie integration when the actual current frontend/backend is identified. Never reuse a singleton user client across server requests. Protect server operations using verified claims/current user and RLS.

Before public launch, verify sign-out and account/session UI in the application shell, two independent users cannot read or write each other's private data, failed/expired refresh denies sensitive actions, and password changes/signout have the intended session revocation behavior. This foundation supplies sign-in routes; it does not claim that every application feature is now authenticated.

## Local verification

`npm --prefix tests/auth test` runs dependency-free mocked flow/security tests on Node 24. `npm --prefix tests/auth run typecheck` checks only the new auth surface so unrelated legacy missing imports cannot hide new errors. These tests cover redirect attacks, missing configuration, privileged-key rejection, session/error handling, verification-first flow, CAPTCHA forwarding, and recovery. They do not replace real provider, email-delivery, hosted CAPTCHA, browser, or RLS tests.

## References checked 2026-10-01 UTC

- [Reddit signup](https://support.reddithelp.com/hc/en-us/articles/360060420092-How-do-I-sign-up-for-a-Reddit-account)
- [Reddit login](https://support.reddithelp.com/hc/en-us/articles/28620245447572-How-do-I-log-in-and-out-of-my-Reddit-account)
- [Supabase changelog](https://supabase.com/changelog.md) — current index checked; the September database minor-version notices are separate from this client flow.
- [Supabase email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Supabase PKCE exchange](https://supabase.com/docs/reference/javascript/auth-exchangecodeforsession)
- [Supabase password recovery](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
- [Supabase SSR/session boundaries](https://supabase.com/docs/guides/auth/server-side/advanced-guide)

# VisaFlow sign-in setup

## Implemented in the app

The October 2 consolidation adds separate login and signup screens. Signup verifies email with a one-time code, then offers password setup. Login supports password or an email code. Password setup verifies the user against the auth server and requires a confirmed email and 12–128 characters. Codes and passwords are held only in component state; Supabase validates them. Resend has a 60-second UI cooldown in addition to backend limits. Errors do not expose raw provider responses. Existing identity-scoped UI resets and database policies are preserved.

Google checks the project's public auth settings and stays disabled when the provider is disabled. Apple is removed, following the latest decision in “Check Latest Status Changes”. Enabling Google makes its button usable after page reload; no rebuild is required. OAuth uses PKCE. The browser SDK automatically exchanges the callback code before its initial session result. Do not add a second exchange handler. The callback is `/login?auth=callback&next=...`; destinations are restricted to local paths.

## Required dashboard setup — not completed by this code change

October 3 domain update: the owned site origin is `https://visa-central.com`. The browser dashboard still requires owner sign-in. Set Site URL to that origin and add `https://visa-central.com/login**` and `https://visa-central.com/account/update-password` to the redirect allowlist, preserving supported development/local callbacks. Add `https://visa-central.com` as a Google authorized JavaScript origin; the provider's redirect URI remains the Supabase `/auth/v1/callback` below. Do not redirect an in-progress OAuth callback from workers.dev to the new origin: the PKCE verifier is browser-origin-local. Members must sign in again on the new host; no sessions are copied.

Checked September 17, 2026 (Chicago): email enabled; Google and Apple disabled. Dashboard browser session was signed out, so email template, SMTP and redirect settings could not be verified or changed. End-to-end delivery and social login have not been validated.

1. In Authentication → Emails → Templates, change **Magic Link** to the contents of `supabase/templates/sign-in-code.html`. Use subject **Your VisaFlow sign-in code**. Also apply the branded code template to **Confirm signup**, so new-account confirmation emails carry a code. Preserve other security email templates. Test both a new and an existing account: `signInWithOtp` otherwise defaults to an email link, not the requested visible code.
2. Configure custom SMTP with a verified sender on an owned domain; sender display name **VisaFlow**. Enter credentials directly in the provider dashboard, never in browser/public environment variables or this repository. Default hosted email service has recipient/rate restrictions and is not a production mail solution.
3. In URL Configuration, allow the dev/local login callbacks including query parameters: `https://visaflow-dev.varunchinna5966.workers.dev/login**` and `http://localhost:3000/login**`. Keep existing recovery URLs if still used. Set the appropriate site URL; avoid broad wildcard domains. In production, use its exact owned origin instead of development origins.
4. In Google Cloud, configure a Web OAuth client and Google Auth Platform branding as **VisaFlow**, with verified owned domains/policy URLs and minimum identity scopes only. Add the authorized redirect URI `https://cycnichledvqbxevrwnt.supabase.co/auth/v1/callback`. Add the client ID and secret directly to Authentication → Sign In / Providers → Google, then enable it. A custom Supabase auth domain is needed to replace the `supabase.co` host shown in consent/redirect URLs; app copy alone cannot change that. Domain ownership and any paid changes require owner approval.
5. Keep Apple disabled. Configure backend password policy, leaked-password protection where available, authentication rate limits, and a verified CAPTCHA integration before public signup. UI validation and cooldowns are not abuse prevention.

## Acceptance checks

- Existing account: request code, enter correct code, return to the originating page; reload retains session.
- New account: request code, verify, generated public username exists and real name/email is not published.
- Wrong/expired/reused code: helpful error, no session, resend works after cooldown.
- Google: approved test account completes sign-in on the same browser; cancel stays branded and retryable. Check existing-email account linking.
- Signup: verify code, set password, sign out, and log in with that password. Recovery must work without exposing whether an email exists.
- Sign-out and account switch clear prior private conversations. Email-code login remains available.
- No real email has been sent by automated tests. A user-approved inbox is needed for delivery verification.

## Security review status

This change does not constitute public-launch approval. Live security advisor reports 15 legacy public tables without row-level security (including legacy `posts`, `comments`, and `group_messages`), four mutable function search paths, GraphQL discovery warnings, and disabled leaked-password protection. The repository has a legacy-containment migration, but its presence is not evidence it is applied to this project. Review and reconcile live permissions separately before general signup. See [RLS remediation](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Sources: [email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Google](https://supabase.com/docs/guides/auth/social-login/auth-google), [Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

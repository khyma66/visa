# VisaThreads login and branding — execution steps

Checked October 7, 2026 UTC (October 6 in America/Chicago). This is an implementation handoff, not a claim that the changes are deployed.

## What was reproduced

The live preview is https://visaflow-dev.varunchinna5966.workers.dev/. In a fresh browser, its header Log in link opened `/login`, Google became available, and Continue with Google opened Google's sign-in page. Google's visible application label was `cycnichledvqbxevrwnt.supabase.co`. No account identifier, password or verification code was entered, and no real sign-in was completed. The user's intermittent navigation failure was **not** reproduced in this fresh session.

The repository version places the introduction above the form on narrow screens and hides the entire form while reading the session. Its Google-settings request had no timeout. These are concrete reasons for an apparently missing or indefinitely loading login section; they do not establish the exact cause in the user's existing browser.

## Changes prepared

- The header uses a normal document link to `/login#sign-in`, independent of client-router state. Login/signup links inside the form also point to the form section.
- The sign-in card appears first on small screens and remains present while the session is checked. Controls wait for the session; after eight seconds the card offers Reload sign-in.
- Google-provider discovery times out after eight seconds. A failure offers Retry and leaves email usable once the session is ready.
- Google and email code are the first options, with password login available. This preserves the email-code default observed on the live page.
- A known signed-in account returns through a sanitized document navigation without waiting for its public-profile query. PKCE, return-path validation, and friendly error mapping remain in place.
- Sign-in copy and the prepared code email use VisaThreads. The code does not echo raw provider errors.

These edits do not configure Google Cloud, DNS, the hosted email templates or a hosted auth domain. A custom domain is already supported by `NEXT_PUBLIC_SUPABASE_URL`; no additional proxy or third-party authentication script is necessary.

## 1. Recover the source of the current website

1. In Cloudflare, open Workers & Pages → `visaflow-dev` → Deployments. Record the current deployment/version and the known-good rollback version.
2. Identify the source checkout/build that produced that version. If it was deployed from a local machine, commit and push that actual source as a recovery branch in `khyma66/visa`. Keep `.env` files, tokens, private archives and build outputs out of Git. A downloaded compiled Worker is not an equivalent editable source checkout.
3. Verify that the recovery source contains the live **VisaThreads branding, Experience navigation, avatar and privacy-choice work** before using it as the integration base. GitHub's six branches checked today still do not contain the complete current live source. January `main` is not that base.

This is the first concrete blocker to a safe update of the existing website. Do not replace the current Worker with the entire older repository branch.

## 2. Integrate the requested changes in reviewable PRs

| Change | Existing review | Action on the recovered current source |
| --- | --- | --- |
| Modern app/security/auth baseline | PR #3 | Compare against the recovered source; preserve newer deployed work. PR #1's reviewed ACL work and selected PR #2 auth changes were already incorporated here. |
| Post presentation and messaging | PR #4 | Port the native-user messaging checks and presentation changes; verify imported authors have no message action. |
| Add-on navigation, communities and News | PR #5 | Add Explore communities, My communities, News and Start a community alongside the existing header. Keep Experience and existing navigation. |
| Login reliability and branding | `fix/visathreads-login-20261007` | Apply the focused auth diff from this branch onto the current source; retain other recent auth changes. |

For each PR: branch from the recovered integration base, apply only its intended diff, resolve conflicts by retaining newer live behavior, run its checks, deploy a preview, review the visible result, then merge. Do not merge PR #2's obsolete app tree or replay old SQL just because it exists in a branch. The auth patch itself requires **no database migration**.

For community features, reconcile the hosted migration ledger against the source first. Rehearse `20261006045523_public_community_lifecycle.sql` and `20261006051458_bounded_community_reads.sql` on a staging database with the current schema. Verify anonymous/private access, create/join/leave, ownership, tags and pagination before applying those two reviewed migrations. Do not blindly run all pending migrations from this recovered repository against the live project.

The News tab can be deployed with `GOOGLE_NEWS_RSS_ENABLED=false`, showing the Google News link. Public RSS redistribution is a separate unresolved permission requirement documented in `COMMUNITY_SCALE_AND_GOOGLE_NEWS_2026-10-06.md`.

## 3. Publish Google branding as VisaThreads

Use the Google Cloud project that owns the OAuth client already configured for this app; creating an unrelated client does not change the existing sign-in screen.

1. Open Google Auth Platform → **Branding**.
2. Set App name to **VisaThreads**, add the approved logo, and set a monitored support email. Use the final site's homepage, privacy and terms URLs.
3. Verify ownership of the chosen site domain in Google Search Console and add it under Authorized domains. No final domain is assumed to be purchased or verified here.
4. Run **Verify Branding** and resolve any issues. After approval, click **Publish branding**. Saving a draft alone does not make the name/logo visible.
5. Keep identity access limited to the sign-in scopes required by the configured Google provider. Do not add Gmail, Drive or other data access for basic login. Keep the pilot audience/testing restrictions until public launch is separately ready.

Google's current guidance says unverified branding shows the application domain instead of the name/logo. A verified published brand addresses that label; the next step replaces the provider hostname in the authentication URLs too.

## 4. Configure a branded authentication domain

Use `auth.<owned-domain>` as a placeholder for a subdomain of a domain the operator actually owns. Supabase custom domains are a paid add-on on a paid plan; no purchase or plan change was made.

1. In project `cycnichledvqbxevrwnt`, open Project Settings → General → Custom Domains and start the custom-domain setup.
2. In Cloudflare DNS, add the CNAME and validation TXT records supplied by the setup. The CNAME target is this project's existing hostname. Use the provider's exact values and complete DNS/certificate verification.
3. **Before activating the domain**, open Google Auth Platform → Clients → the existing Web OAuth client. Add `https://auth.<owned-domain>/auth/v1/callback` to Authorized redirect URIs. Retain the existing callback during the cutover. If other OAuth providers or SAML consumers exist, prepare them too.
4. Activate the verified custom domain. Activation changes the callback advertised by the hosted auth service; updating the frontend variable alone is insufficient.
5. In the app's build environment, set `NEXT_PUBLIC_SUPABASE_URL=https://auth.<owned-domain>`, retain the same publishable key, and rebuild. The middleware derives its HTTP/WebSocket CSP allowances from this origin. Never put a service-role key in the browser.
6. In Auth → URL Configuration, set Site URL to the actual app origin and allow the app's `/login` callback and `/account/update-password` recovery route. These are app URLs, distinct from Google's `/auth/v1/callback` URL on the auth domain. Preserve the validated preview return URLs during the pilot. The existing login callback includes `auth` and a URL-encoded `next` query; validate the actual generated URLs for `/`, `/messages`, `/ask` and `/my-communities` against the allowlist. Use the narrowest working allowlist, not a wildcard over arbitrary hosts.
7. Test a new login after the cutover. The SDK's default session-storage name depends on the backend hostname, so switching domains can require existing users to sign in again. Do not claim session preservation without explicitly testing a migration strategy.

A vanity name ending in `.supabase.co` does not satisfy the request to remove that hostname. Nor does renaming the dashboard project. Custom branding does not make the underlying hosting provider undiscoverable to technical inspection; retain accurate provider/privacy disclosures where appropriate.

## 5. Brand email delivery

1. Configure custom SMTP with a verified sender on the owned domain. Set sender name to **VisaThreads** and use a monitored support/reply address. Enter SMTP credentials only in the provider settings.
2. In Auth → Emails → Templates, apply `supabase/templates/sign-in-code.html` to the code-based Magic Link/Confirm signup flows and use subject **Your VisaThreads sign-in code**. This template uses `{{ .Token }}` and does not display a backend URL.
3. Review recovery, invitation, email-change and security-notification templates separately so their purpose and required verification links are preserved while their visible brand matches VisaThreads. Link-based flows should use the activated auth domain. Do not replace a verification link with a decorative homepage link.
4. Test delivery to an approved new test inbox and an existing test account, including expiry/resend and password recovery. Saving the repository template does not update the hosted template.

## 6. Deploy and accept the result

On the recovered and integrated source, run:

```sh
npm ci
npm run check
npm audit --audit-level=high
```

The October 7 local validation record is below. The existing high-severity dependency audit remains a release blocker; do not bypass it to label the site production-ready.

For the development Worker, the repository's supported deploy command is `npm run deploy:dev` from an authenticated Cloudflare environment with the reviewed build-time public settings. Confirm the target is `visaflow-dev`. The current GitHub Web checks workflow **does not deploy** after merging. Public production uses the separate gated release process and `npm run deploy:prod` only when its recorded requirements pass.

Before accepting the preview, verify on desktop and a narrow mobile screen:

1. Click Log in from Questions, a question detail, Tags and Experience. The form and Google button should appear directly; clicking Log in while already on `/login` should reach the form section.
2. Check a fresh session, a previously signed-in session, Back/Forward, and a slow network. Google-provider failure should offer Retry; email should remain usable once the session is checked.
3. Complete Google sign-in with an approved test account. Confirm the published **VisaThreads** label and branded auth domain, correct return destination, and a visible signed-in account on the app.
4. Complete email-code login, password login and password recovery. Confirm sender/content branding, reject an expired code, and verify errors do not reveal raw provider details.
5. Verify existing Experience/privacy/avatar flows and all four additive community links still work. Confirm imported posts cannot be messaged, and two real test members can exchange a message request.
6. Record the exact source commit and deployed Worker version. Roll back the Worker version if navigation/auth regress; a Worker rollback does not revert hosted auth-domain settings or database migrations.

### Validation record

- Full local suite: **235 tests passed**, including 21 auth tests (13 added for this change). The auth checks run the real form handlers with mocked service boundaries and test the real provider-discovery timeout; they do not create hosted accounts.
- Type checking, Vinext Worker build, repository secret scan (295 files, no findings), and the 42-post synthetic archive-bundle check passed.
- Local HTTP checks returned **200** for `/login` and `/signup`, with the sign-in section first, Google/email controls in initial HTML, the document login link, and the configured branded origin in CSP. These used fixture public settings and Next's supported Webpack dev mode; the existing Turbopack cache failed to restore. Dev responses use Next's `no-cache, must-revalidate`; this is not a production cache or browser acceptance test.
- Latest dependency audit: **16 high, 2 moderate, 0 critical**. The lockfile was not changed by this patch. The high-severity release gate remains unresolved; automatic force-fix suggestions include incompatible framework downgrades and were not applied.
- Live browser testing confirmed the existing link and Google handoff in a fresh session, and reproduced Google's provider-hostname label. No hosted deployment, custom domain activation, Google branding publication, SMTP change or real-account sign-in is claimed.

## Primary references checked

- [Google branding and publication](https://support.google.com/cloud/answer/15549049)
- [Google brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- [Google sign-in setup and branding](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Custom-domain activation and OAuth cutover order](https://supabase.com/docs/guides/platform/custom-domains)
- [Auth return URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Email templates](https://supabase.com/docs/guides/auth/auth-email-templates)

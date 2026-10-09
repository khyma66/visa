# Current launch tools, access and credentials

This is the current Q&A/chat stack, not the retired ingestion architecture. Prefer secure dashboard/connector authorization. **Do not paste passwords or secrets into chat, source files, screenshots, public issues or command arguments.** Keep production and development separate and rotate previously exposed secrets.

| Service / tool | Required access or configuration | Where it belongs |
| --- | --- | --- |
| Cloudflare Workers | Authorized account, account ID, deployment access; a narrowly scoped `CLOUDFLARE_API_TOKEN` for CI and `CLOUDFLARE_ACCOUNT_ID` | Protected GitHub `production` environment secrets (or authorized local Wrangler login). The deployment token is not a browser variable or application runtime secret. Scope permissions to the account and needed Workers/route operations; add DNS access only if necessary. |
| Domain / DNS | Ownership of chosen domain, registrar/DNS access, reviewed Cloudflare route or Custom Domain | Provider dashboard/configuration. Domain purchase/paid changes need owner approval. Enable MFA and renewal protection. |
| Supabase | Selected production project URL and browser-safe publishable key, Auth/Data/Realtime setup; authorized admin access for migrations, security and backups | `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are public build configuration. They are not authorization by themselves; RLS/grants protect data. Keep database passwords, management tokens and secret/service-role keys out of frontend code. |
| Public app configuration | `NEXT_PUBLIC_APP_ENV=production` and `NEXT_PUBLIC_SITE_URL=https://chosen-domain` | Protected CI variables or ignored `.env.production.local`. The release checker permits only the reviewed public-variable names. Rebuild after changing public configuration. |
| Transactional email | Verified sending domain/address; SMTP host/port/user/password or provider-supported credentials; DNS authentication records and tested delivery | Supabase Auth SMTP configuration and provider dashboard, not public variables. Verify SPF/DKIM and an appropriate DMARC policy, signup confirmation, recovery and bounces before invitations. No specific email provider has been purchased or configured in this pass. |
| Bot protection | Turnstile (or supported alternative) public sitekey plus secret, hostname allowlist, actual frontend token integration | Sitekey is public; secret goes to Supabase Auth bot-protection settings for its built-in verification. New Worker-verified forms need their own secure server verification. Adding a public key requires updating the release allowlist deliberately; do not just switch CAPTCHA on before frontend support works. |
| GitHub | Repository owner/admin permission, protected `main`, required checks/reviewers, protected `production` environment | GitHub settings; scoped CI secrets. Existing workflows must be reviewed and committed/pushed. No broad personal token is needed in the browser. Confirm destination ownership before any repository migration. |
| Support and moderation | Real monitored privacy/support/abuse mailbox or ticket queue; moderator’s exact registered account; on-call and legal contacts | Restricted operator systems and private moderator allowlist. These are required operations, not optional placeholders in a footer. |
| Observability / recovery | Cloudflare/Supabase logs and alerts, verified backup retention/restore access, spend alerts; optional external error monitoring | Restricted provider dashboards. Strip tokens and user message/document text from telemetry. External monitoring credentials are optional until a provider is selected; do not add one just for launch. |
| Apify — optional | Existing local `APIFY_TOKEN` for approved archive refreshes; source reuse permission | Native Q&A/chat needs no Apify credential. Current dev snapshot reads need no token on Cloudflare. A transfer to any remote secret store needs specific authorization; production imports also need rights/takedown approval. |

## Not required for this initial text-only app

No separate Reddit/Stack Overflow API, paid chat vendor, R2/S3 key, Meilisearch key, OpenAI key, Stripe key or custom WebSocket server is required by the current native feature set. Supabase supplies Auth, PostgreSQL and Realtime; Cloudflare serves the web app. Add storage/search/queue/AI/payment services only when a measured requirement justifies them and after a new security/privacy review.

A Supabase secret/service-role key is **not needed in the normal browser application**. Future server-only account-administration jobs may need privileged access, which must be narrowly separated and reviewed. Never reuse a privileged key merely because an anonymous request fails.

## Safe setup order

1. Resolve the database/key-exposure findings before inviting users.
2. Select production projects/domain and authorize access through dashboards; do not copy all development credentials into production.
3. Place public configuration and deployment secrets in the distinct locations above. [Cloudflare secret guidance](https://developers.cloudflare.com/workers/configuration/secrets/) explains why secrets must not be put in `vars`.
4. Integrate and verify [Supabase Auth CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha) and real email flows.
5. Record evidence and follow [the go-live checklist](GO_LIVE_CHECKLIST.md). Never disable the release gate to work around missing credentials or approvals.

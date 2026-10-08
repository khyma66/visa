# VisaThreads migration — October 4, 2026

## Live site migrated; email cutover in progress

The owner requested moving the existing site from `visa-central.com` to `visathreads.com` and confirmed the old domain has no users. New-domain registration, DNS, and HTTPS are verified.

Public branding, page metadata, login screen, email templates and health identity now use VisaThreads. Metadata uses `https://visathreads.com`; the www hostname redirects to the apex with HTTP 308, preserving path/query. The deployed Worker configuration includes only the two new hostnames. The old hostname is disconnected and no longer resolves.

The existing Supabase project `cycnichledvqbxevrwnt`, 563-post archive, accounts and internal data identifiers are retained. No database or archive content changed. Existing sign-in edits were preserved. Public-launch gates remain closed; this is a preview migration.

Repository credential scan, full automated tests, typecheck, development build, archive bundle verification and 157-file bundle credential scan passed. The canonical redirect and messaging navigation checks, Worker runtime type generation, and deployment dry run passed.

Browser access was restored by the owner. The first live VisaThreads deployment to `visaflow-dev` was version `a4bc8b24-70cf-441f-8cc1-fded8ca61064`; final hostname-only configuration is version `78c847f8-9908-4846-ab92-f62905450c01`. Health confirms development mode. Live site smoke checks passed all 13 page/API checks, CSP/nonces, security headers, and true 404 behavior after the second deployment. HTTPS www redirects preserve query parameters. `visa-central.com` returned DNS `ENOTFOUND` after disconnection. Read-only community verification passed: 563 posts, 628 comments, 21 tags, anonymous private-RPC denial, and all 22 retired tables protected.

Supabase Site URL is now `https://visathreads.com`. Approved new redirects are `/login`, `/login?**`, and `/account/update-password` on that host. Both old-domain redirect entries were removed; the dashboard confirms exactly three remaining URLs. Sign-in, signup, and recovery templates and subjects are branded VisaThreads. Google and phone providers are disabled. The open Google Console project belongs to an unrelated app (`menuocr`); it was not modified.

Resend domain `visathreads.com` was added (North Virginia, `us-east-1`). Its provider-specified DKIM TXT and DNS-only `rsend` and `send` CNAME records, plus monitoring-mode DMARC (`v=DMARC1; p=none;`), are published and match on both Cloudflare and Google public DNS resolvers. Resend verification is pending. Supabase SMTP is saved as `VisaThreads <noreply@visathreads.com>`, host `smtp.resend.com`, port 465, username `resend`; existing password retained. The owner authorized one sign-in test email to their nominated Gmail inbox. The attempt at 20:59:58 UTC was rejected before delivery: Supabase Auth logs show SMTP `550`, new domain not verified. No email delivered and no successful sign-in claimed. The Resend domain list shows only the new domain; the old sender-domain entry is already absent.

Old-domain registrar auto-renew is disabled and the saved switch is off. Registration is still active until October 2, 2027; no registrar deletion or refund was performed. Existing old mail DNS records remain until explicit registration retirement or later cleanup. No database records, accounts, archives, or user content were deleted.

## Remaining sequence

1. Wait for Resend verification, then retry the owner-authorized sign-in email and verify delivery, code-based login and logout. Check recovery destination without changing the owner's password or sending extra unauthorized test emails.
2. For complete relinquishment, ask the owner to confirm irreversible registrar deletion of exactly `visa-central.com` at action time after successful email validation. Cloudflare registrations are non-refundable: https://developers.cloudflare.com/registrar/faq/. Deletion requires an emailed deletion token; do not remove the Cloudflare zone as a substitute for registration deletion. Auto-renew is already off.

Dated historical deployment notes remain historical records. Use this document for the current migration target.

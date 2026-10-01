# VISAFLOW credentials

This file contains placeholders only. Never commit real credentials to documentation,
source files, `.env.example`, or Wrangler `[vars]`.

## Required configuration

| Purpose | Variable | Exposure |
| --- | --- | --- |
| Supabase project URL | `NEXT_PUBLIC_SUPABASE_URL` | Public |
| Supabase publishable key | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public; access still requires grants and RLS |
| Supabase legacy anon key, if used instead | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public; never substitute a service-role key |
| Privileged database operations | `SUPABASE_SERVICE_ROLE_KEY` | Server secret only |
| R2 account | `CF_ACCOUNT_ID` | Server configuration |
| R2 S3 access key | `CF_R2_ACCESS_KEY_ID` | Server secret only |
| R2 S3 secret | `CF_R2_ACCESS_KEY_SECRET` | Server secret only |
| R2 bucket | `CF_R2_BUCKET_NAME` | Server configuration |
| Internal Worker endpoint | `WORKER_URL` | Server configuration |
| Internal Worker authentication | `WORKER_SECRET` | Server secret only; a URL is not a secret |
| Cloudflare deployment token | `CF_API_TOKEN` | CI/deployment secret only |

Obtain Supabase keys from the project's API settings and limit Cloudflare tokens to
the intended account, Worker, and bucket. Keep local values in ignored environment
files. Configure deployed secrets through the provider's secret store. Do not place
privileged credentials in any `NEXT_PUBLIC_` variable.

The legacy R2, queue, and arbitrary cache proxy routes are disabled. Configuring
credentials does not re-enable them; authenticated, authorized replacements and
tests are required first.

## Previously committed credentials

The prior version of this document and `.env.example` contained a Supabase
service-role JWT and R2 credentials. Removing them from the current files does not
invalidate copies in Git history. Treat those credentials as exposed and replace
or revoke them in their issuing services before release. Coordinate replacement
with every backend or importer that uses them. Do not print replacements in logs.

## Database setup

Do not run the old schema snippets or `supabase_migrations/CLEANUP.sql` against an
existing project. The live September schema and this repository's old application
schema differ. Recover the active application source, reconcile migration history,
and verify a backup/restore and migration rehearsal on an isolated database first.

Run the repository secret check before committing:

```sh
node scripts/check-secrets.mjs
```

This targeted check detects known credential formats; it does not prove that all
possible secrets are absent or that previously exposed credentials were revoked.

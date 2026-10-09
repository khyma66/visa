# Environment isolation and production promotion

## Current boundary

The existing Supabase project `cycnichledvqbxevrwnt` is the elected production database. It must no longer be treated as a disposable development database. Existing records remain in place; promotion does not require copying real users or creating substitute accounts.

The current `visa-central.com` / development Worker preview still uses that same database during the authorized transition. This is **shared-data preview mode, not an isolated test environment**. Ordinary signed-in actions there affect the production-candidate data. No runtime or preview deployment was disabled by the test safeguards. The public production release gate remains separate and must not be bypassed.

| Environment | Database | Allowed work |
| --- | --- | --- |
| Current transitional preview | Elected production project | Authorized ordinary application use and read-only operational checks; no fixture seeding, destructive resets or load tests |
| Automated repository checks | In-process disposable PostgreSQL (PGlite) | Schema/RLS, account-boundary, messaging, vote and pagination tests with synthetic data; no hosted credentials |
| Future full local development | Separate VisaFlow local Supabase stack | Local auth, email inbox, realtime and synthetic fixtures |
| Optional hosted staging | A different, explicitly disposable Supabase project | Deliberate live integration tests; never the elected production project |
| Production release | Elected production project | Reviewed migrations and release workflow with backup, acceptance and owner approvals |

## What is already safe to run

`npm test`, `npm run test:database`, and `npm run typecheck` use local fixtures/mocks rather than writing to a hosted project. Database suites instantiate disposable PostgreSQL instances and apply the relevant migrations there. They do not prove email deliverability, hosted realtime service behavior, browser acceptance or production capacity.

`npm run test:isolation` verifies the new guard itself. It uses synthetic configuration and executes the live entrypoint only in a mode that must be rejected before fixture/password reads or network access. It is included in `npm test`.

## Interactive local development

`npm run dev` and `npm run dev:next` now use `scripts/dev-isolated.mjs`. The launcher reads Vite's actual development environment precedence, validates the effective browser connection, and supplies those checked values explicitly to the child. It refuses **every hosted backend**, including the elected production URL in an existing `.env.local`; it never silently changes secret files. Process-level URL/key overrides are checked as well.

Use **`npm run dev:demo`** today for an isolated interactive UI. This explicitly empties the browser Supabase URL/key, disables live ingestion in the child environment, and uses browser-local demo posts/messages. Real login, cross-account persistence, hosted messaging and email are intentionally unavailable in that mode. The app binds loopback only. Use `npm run dev:demo -- --port 3101` if another local task occupies port 3000.

All three supported local dev commands use the existing Next.js server, not the Worker development plugin, because that plugin independently loads `.dev.vars`. Forced process environment values take priority over Next's environment files. This is a UI/local-Supabase development path, not proof of Worker runtime parity; Worker acceptance remains part of the separately authorized preview/release workflow.

Verification on 2026-10-03: the existing production-bound `.env.local` was left unchanged; `npm run dev` refused to start. `npm run dev:demo -- --port 3101` started on loopback and returned HTTP 200 for `/`, `/ask`, `/messages` and `/api/health`. The served client module compiled both Supabase settings to empty strings; the 17 home entry scripts contained no production project reference. This was a startup/HTTP/configuration smoke check, not cross-user or browser-action acceptance. The verification server was stopped afterward. Next may regenerate `next-env.d.ts` for its dev type paths; that generated local churn is not a production configuration change and should not be included in a release.

When a separate VisaFlow local Supabase stack is ready, supply only its loopback URL/public key through an ignored local configuration or process environment, then run `npm run dev`. Do not point it at StayHub. The launcher rejects service-role keys and legacy JWTs identifying a hosted project.

These checks affect supported interactive **dev** commands only. `build:dev`, `deploy:dev`, and the deployed transitional preview are unchanged. `npm run start` / `start:next` serve already-built artifacts and are not isolated development commands; a production-bound artifact remains production-bound even when served on localhost. Calling framework binaries directly also bypasses the launcher and is not a supported safe-development workflow.

The read-only smoke scripts are operational checks, not load tests or account-creation tests. Preserve that distinction; do not add mutations to them without routing through the disposable-target guard.

## Live integration-test guard

`scripts/test-live-realtime.mjs` now uses **dedicated** test settings. It never falls back to `NEXT_PUBLIC_SUPABASE_URL` or application keys. A disposable target requires all five settings:

```dotenv
VISAFLOW_TEST_SUPABASE_URL=http://127.0.0.1:55321
VISAFLOW_TEST_PROJECT_REF=local
VISAFLOW_TEST_ENV=disposable
VISAFLOW_TEST_ALLOW_WRITES=disposable-fixtures-only
VISAFLOW_TEST_PUBLISHABLE_KEY=replace-with-this-local-stack-publishable-or-anon-key
```

Keep actual settings in ignored `.env.test.local`; do not commit keys or fixture passwords. A hosted staging target must use its direct HTTPS `<project-ref>.supabase.co` origin and exact project reference instead of `local`. Custom aliases/proxies are not accepted. The elected production project is refused even when the disposable acknowledgment is supplied. A production application/build environment also refuses live mutation tests.

Only a publishable or appropriate legacy `anon` key is accepted. No service-role or secret key belongs in this test. HTTP redirects and requests leaving the selected origin are rejected before sending credentials.

The ignored `.local/realtime-fixtures.json` must contain:

- `schemaVersion: 1`, `purpose: "visaflow-live-tests"`, and `disposable: true`.
- `databaseOrigin` exactly matching the selected test origin.
- ISO `createdAt` and `expiresAt` timestamps, expiring within 24 hours of creation.
- Exactly three independently provisioned `users`, each with a unique `id`, reserved `example.invalid` email and a fresh disposable password of at least 12 characters.

Old shared-preview fixture files intentionally fail validation. Accounts must be freshly provisioned and email-confirmed **on the separate disposable stack/project**; normal email delivery to `example.invalid` is not expected. The script checks that each identity has no existing authored content or conversations before creating its test records. Test records are left on the disposable target for investigation; the script does not possess administrative deletion credentials. Never copy real users, passwords, sessions or private messages into staging.

Once that separate target is actually provisioned:

```sh
node --env-file=.env.test.local scripts/test-live-realtime.mjs
```

There is intentionally no “allow production tests” override. Approved production acceptance should use named real pilot accounts and a separately reviewed, bounded procedure—not this seeding script.

## Full local stack: current readiness and next step

Read-only inspection on 2026-10-03 found Docker **29.2.0** running, with an existing **StayHub** Supabase stack. No StayHub containers, ports or data were changed. The installed Supabase CLI is **2.72.7**. CLI help confirms that `supabase db reset --linked` and `--db-url` can target remote databases; do not use those options for local development.

A separate VisaFlow local stack is feasible, but it has **not** been started or validated. Before starting one:

1. Give VisaFlow its own project identifier and unused ports (for example, API `55321`, database `55322`, Studio `55323`, local email `55324`, after checking availability). Do not reuse or reset StayHub.
2. Reconcile the fresh-install schema baseline. The retained legacy migration is a no-op, while later community-membership hardening assumes legacy tables already exist. Consequently, blindly running the entire current migration directory against an empty local stack is not a verified bootstrap process. Build a reviewed local baseline, without restoring private production data.
3. Start that distinct stack using the current CLI documentation, then use only its local URL and public key in a separate ignored local configuration. Confirm auth, realtime and local email before running the live test.
4. Use an explicit local target for any reset and verify the selected stack immediately beforehand. Do not copy a production connection string or use the linked project.

Until that bootstrap is completed, the existing PGlite tests provide a working production-independent development/test path, but are not a substitute for a full hosted/browser rehearsal.

Official references: [Supabase local development](https://supabase.com/docs/guides/local-development/cli/getting-started), [managing environments](https://supabase.com/docs/guides/deployment/managing-environments).

## Retired historical write scripts

These entrypoints now exit with guidance before importing database clients, reading credentials or performing network/deployment work. Their old implementation remains below the guard for historical reference:

- `scripts/deploy-all.sh`: obsolete backend/Astro deployment. Use the reviewed current deployment commands instead.
- `scripts/upload-posts.sh`: obsolete R2 upload and pipeline trigger. Stage and review ingestion separately.
- `scripts/test-likes-api.js`: obsolete localhost mutation test. Localhost does not prove the backend database is local; use native database voting tests.
- `backend/src/scripts/seed_data.py`: obsolete legacy-schema seeding. Do not populate production with these fixtures.

The guards do not replace production database permissions, secret rotation, backups or authorization. Operators can still damage data with a direct database console or an unreviewed new script; production access must remain tightly controlled.

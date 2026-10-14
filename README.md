# VisaFlow

**Current handoff (October 2, 2026):** [consolidated release status and owner checklist](docs/RELEASE_HANDOFF_2026-10-02.md). It supersedes historical deployment/audit counts below.

**Public launch is not yet approved.** See [production readiness and release steps](docs/PRODUCTION_READINESS.md) for implemented safeguards, verification evidence, remaining approvals, and the guarded deployment workflow.

Current launch packet: [ordered steps](docs/GO_LIVE_CHECKLIST.md), [security findings](docs/SECURITY_REVIEW_2026-09-11.md), [human testing](docs/HUMAN_ACCEPTANCE_TESTS.md), [U.S. policy review](docs/US_LAUNCH_REVIEW.md), and [tools/credentials](docs/LIVE_CREDENTIALS.md). New preview privacy/rules/request-status pages are informational drafts, not finalized production policies.

VisaFlow is an anonymous community for visa questions. Its primary experience combines:

- Stack Overflow-style questions, tags, answers, votes, and related-question discovery
- Facebook group discussions normalized from Apify post text and top comments
- Related-question discovery while searching and before posting
- Random Reddit-style public handles; account emails are never exposed publicly
- Private one-to-one messaging protected by Supabase Row Level Security (RLS)
- A built-in demo mode so the complete interface works before a backend is connected

Community experiences are not legal advice. The interface repeatedly reminds members to remove passport, receipt, address, and other identifying information.

## Run locally

Requirements: Node.js 22 or later and npm.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. Without environment variables the app uses browser-local demo data and signs in as `quiet-otter-4821`.

The default development command runs through the same Vite-based Next.js compatibility layer used by the Cloudflare Worker. Use `npm run dev:next` only when comparing behavior with the native Next.js development server.

## Connect Apify community data

The real development archive is ignored by Git and must not be committed to this public repository. Clean checkouts, CI, and production builds use `src/data/archive-fixture.json` (42 clearly synthetic posts). Local development uses the private snapshot when present. Production imports remain disabled, regardless of whether a local archive exists.

**Current snapshot mode does not automatically ingest the daily Apify run.** Refresh with `npm run archive:refresh`, verify it, then rebuild/redeploy development. The optional live mode below is a different, explicitly enabled path—not a durable production import pipeline.

The refreshed development archive combines three completed source runs: **549 unique posts, 606 available comments and 21 tags** from 1,500 source records. No Apify secret is installed on the Worker. See [archive coverage and deployment verification](docs/API_ARCHIVE.md). The live-source instructions below apply when explicitly switching `COMMUNITY_SOURCE_MODE` away from `snapshot`.

VisaFlow reads the latest successful run for the configured Facebook Groups Scraper Actor through `/api/community`, using 100-item pages and Apify's total-count header. A daily Apify schedule starts a fresh run with the saved group input; the site discovers the latest successful run automatically and refreshes it after the five-minute cache window. All nonempty posts are retained, classified as questions, discussions, or promotions, and deduplicated by source post ID. The response reports source, imported, empty, and duplicate counts. Failed or incomplete imports return an error instead of silently serving a partial dataset. The safety ceiling is 5,000 items. Only required fields are fetched, and the browser reuses the normalized dataset for search, tags, related questions, and 20-post display pages without extra Apify requests.

1. Copy `.dev.vars.example` to `.dev.vars`.
2. Set `APIFY_TOKEN` to an Apify token with read access to the configured run.
3. Restart `npm run dev`.

The run ID and non-secret API settings live in `wrangler.jsonc`. The token must stay in `.dev.vars` locally and must be installed as a Worker secret before deployment:

```bash
npx wrangler secret put APIFY_TOKEN --env development
```

The Apify schedule `visaflow-daily-community` is enabled for 02:00 America/Chicago each day. It runs Actor `2chN8UQcH1CfxLRNE` with the saved public group input and up to 500 results. The app follows that Actor's latest successful run, so a failed or still-running refresh leaves the last complete dataset available.

Imported records remain source-owned: VisaFlow does not expose scraped account IDs or profile photos, and it never posts local replies back to Facebook. Native VisaFlow questions and messages continue to use the existing Supabase path.

## Connect Supabase

The app is connected to the resumed `cycnichledvqbxevrwnt` project, with six September community migrations applied, including reporting, moderation and posting limits. Earlier cross-account realtime tests passed; current checks and their limits are in [production readiness](docs/PRODUCTION_READINESS.md). The browser-safe settings are in ignored `.env.local`; no service-role key is used by the app.

For another development environment:

1. Create a Supabase project.
2. Apply the six `202609*` community migrations in order. Older migrations belong to legacy experiments; do not blindly replay them into an existing database. Reconcile remote migration history before using `supabase db push`.
3. Copy `.env.example` to `.env.local`.
4. Set the project URL and publishable key:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

5. In Supabase Authentication, configure the site URL and allowed redirect URLs for local and production domains.
6. Restart the development server.

The migration creates an anonymous profile automatically when a user signs up. It also creates full-text and trigram indexes, related-question functions, vote aggregation, accepted answers, private conversations, Realtime messages, explicit Data API grants, and RLS policies.

## Product flows

- `/` — searchable and filterable question feed
- `/ask` — question composer with live duplicate suggestions
- `/questions/[id]` — answers or imported comments, tags, source attribution, related discussions, and message-author actions
- `/messages` — private inbox, anonymous-handle lookup, and realtime conversations
- `/login` — password or email-code login; Google when configured
- `/signup` — email verification followed by password setup
- `/account/recovery` and `/account/update-password` — password recovery flow
- `/moderation` — operator-approved report review, removal and suspension
- `/community-safety` — current privacy limits and community rules

## Verify

```bash
npm run check
```

This runs deterministic discovery checks, real PostgreSQL migration/RLS tests with three identities, TypeScript, and the application build. `scripts/test-live-realtime.mjs` additionally tests the hosted service using explicitly provisioned disposable accounts; it is not run by CI and requires fixture cleanup by an authorized administrator. See the implementation status document.

The build produces the complete Worker application, including dynamic routes. After building, `npm start` serves that output locally at `http://localhost:8787`; `/api/health` provides a runtime health check.

## Deploy to Cloudflare Workers

Development preview: https://visaflow-dev.varunchinna5966.workers.dev

The development environment is a separate Worker named `visaflow-dev`. Publish updates with:

```bash
npm run deploy:dev
```

For a build without publishing, use `npm run build:dev`. The generated `dist/server/wrangler.json` must name `visaflow-dev` before deploying that build. Named environments are selected at build time. The development preview was republished September 10 with the combined API archive, tag directory and related-question browsing. Hosted browser verification was blocked by the computer's admin policy. The bundled snapshot requires no Apify secret transfer; future source runs require a local archive refresh and redeployment. Do not assume named Worker environments inherit root variables.

See [the platform and scale assessment](docs/PLATFORM_AND_SCALE.md) for the hosting, messaging, storage, cost, and launch recommendations.

Production deployment is intentionally blocked until the requirements in [production readiness](docs/PRODUCTION_READINESS.md) are verified. After recording real evidence, configuring the production origin/environment and approving launch:

```bash
npx wrangler login
npm run deploy
```

`wrangler.jsonc` intentionally uses the Workers cache and contains no KV, R2, Queue, AI, or database-secret bindings. Those services should be added only when the official-source ingestion and grounded-answer phases are implemented. Set Supabase's browser-safe URL and publishable key as build environment variables. Never add the service-role key to the client build.

Run `npm run types:worker` after changing Cloudflare bindings so `worker-configuration.d.ts` remains synchronized with `wrangler.jsonc`.

For local database verification, install Docker and the Supabase CLI, then run `supabase start` and `supabase db reset`.

## Security before transferring this repository

This repository previously contained Supabase and Cloudflare credentials in tracked files and Git history. The working tree now contains placeholders, but the old credentials must be rotated and the history must be rewritten before transferring or making a destination repository public. Do not add secret or service-role keys to any `NEXT_PUBLIC_` variable.

The legacy FastAPI, Cloudflare Worker, ingestion, and AI-clustering experiments remain in the repository as future/reference subsystems. The production community UI uses the coherent Next.js + Supabase path described above.

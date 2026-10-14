# VisaThreads assistant and development rollout

## Owner decision — October 14, 2026

AI features belong **only on https://visathreads.com**. The development website https://visa-central.com must have no chatbot or AI controls. This supersedes the earlier isolated-dev AI rollout plan.

| Site | Worker | Supabase project | AI |
|---|---|---|---|
| visathreads.com | visaflow-dev | cycnichledvqbxevrwnt | Production activation pending release checks |
| visa-central.com | visathreads-sandbox | ppdwysmeistjxzjpmxyk | Disabled; no AI binding |

Both Cloudflare routes were verified through the API. The Worker named `visaflow-dev` actually serves production: never infer environment from that name. Both Supabase projects accept read queries. Cloudflare GitHub environment credentials work; another browser login is not needed.

PR #8 contains PR #9's popular-tag quick picks and navigation fixes plus the chatbot. Both target `release/owner-feedback-20261013`; obsolete `main` must not be deployed. The revised combined candidate passes 702 tests, TypeScript, a dev build, and the repository secret scan. These are code checks, not a hosted inference or real sign-in pass.

## Development deployment

Use `npm run build:devsite` / `npm run deploy:devsite` with `.env.sandbox.local` containing the dev publishable key, dev Supabase URL above, and `NEXT_PUBLIC_SITE_URL=https://visa-central.com`.

The `sandbox` Wrangler environment pins the Worker, two visa-central domains, and dev database. The helper rejects production routes, an AI binding, enabled AI flags, and other targets. `workers.dev` is disabled. The old `build:assistant` / `deploy:assistant` commands deliberately fail with replacement instructions.

The `development-site.yml` workflow runs tests/typechecking, builds with synthetic fixtures, verifies generated configuration and actual domain routing, and checks live pages plus AI denial after deployment. It records the old dev Worker version and checks that the production deployment did not change. Existing production-environment Cloudflare secrets are used only in the Cloudflare steps.

Development Auth still requires its own site/callback configuration and provider settings. Do not redirect dev users into the production database. The unused assistant database migration applied before the owner's clarification does not enable AI or create a model binding.

### Latest verification and remaining blockers

- Both Supabase projects accept authenticated tool queries. Production has no assistant quota RPCs yet; dev has the previously applied migration, unused by the website.
- GitHub run `38516140744` successfully uploaded the regular dev build, but its immediate health check returned the older commit. The subsequent Cloudflare inventory showed another deployment of that older build. The new smoke check allows up to 45 seconds for propagation and still requires the exact checked commit; it also verifies denial of legacy summary endpoints.
- The API now checks the actual HTTPS request origin as well as the configured production domain and database. Dev, workers.dev previews, unexpected ports, and lookalike domains cannot enable inference through flags or forged forwarding headers.
- The saved GitHub token can deploy Workers. Its separate Workers AI REST check returned HTTP 401 / code 10000 in run `38516422457`. Validate an AI-authorized token (Workers AI Read and Edit on the VisaThreads account) before relying on REST model evaluation. This result does not establish whether an deployed AI binding works.
- PR checks still fail on the `braces` dependency chain (GHSA-vfj7-8cjw-p6xm, no published patch in the advisory). The full audit remains enforced. Production also needs its reviewed private archive, additive assistant migration, and signed-in model evaluation. Do not deploy the synthetic development fixture over the live archive.

## Production activation

The assistant UI renders only when built for `https://visathreads.com`. The API additionally requires project `cycnichledvqbxevrwnt`; accidental dev flags cannot enable it. The migration is additive: invoker retrieval and private count-only quotas, no posts/messages copied.

Required flags: `ASSISTANT_PROJECT_REF=cycnichledvqbxevrwnt`, `ASSISTANT_PROVIDER=workers-ai`, `ASSISTANT_ENABLED=true`, `ASSISTANT_COMMUNITIES_ENABLED=false`, `ASSISTANT_CATCHUP_ENABLED=false`, and Workers AI binding `ASSISTANT_AI`. These are intended settings, not a deployment record.

Keep the existing dependency audit and public-release review gates. The full audit still finds the unpatched `braces` chain. Do not replace the live 563-post / 628-reply archive with the CI synthetic fixture. The reviewed ignored archive must pass `check:private-experiences` and parity checks before a production deployment. A successful dev deployment does not authorize a public-launch flag change.

Verify registered sign-in, real model inference, source quotes, unsupported/conflicting questions, account isolation, moderation invalidation, and quotas before marking production AI live. Rollback: disable `ASSISTANT_ENABLED` and redeploy the same reviewed production configuration, or restore the previous Worker version. Community/catch-up activation stays a later production-only rollout.

## Implemented

- Collapsible **Ask about this discussion** and **Summarize discussion** on question/experience pages, with links to cited posts and replies.
- **Ask VisaThreads** at `/assistant`, accessible from the header and community tools. Global post search is included in the first rollout.
- Separately gated community Q&A and **Catch me up**. Intervals: 1 hour, 6 hours, 24 hours, 7 days, or since the last successful complete catch-up. The default is 24 hours; API intervals cannot exceed 31 days.
- Up to three previous user questions support follow-ups. Conversation contents are not persisted by this implementation. Only a timestamp is saved in browser storage, scoped to the account and selected community/feed. Partial or insufficient answers do not advance that checkpoint.
- Native content is retrieved through the signed-in user's Supabase client, current RLS/invoker views, and indexed keyword/tag search. Approved snapshot content supports individual discussions, public Q&A, and public catch-up events within the selected interval. Public catch-up also retrieves current member replies to visible snapshot posts. Imported content is not guessed into native communities. Replies to older posts can appear in catch-up; the older parent is context, not a new event.

Retrieval is bounded to 48 candidates; model input is further bounded to 24 sources and 24,000 characters. Truncation is disclosed prominently. This is not an exhaustive search guarantee, and busy communities may need the shorter intervals.

Global Q&A currently searches native discussions and the approved snapshot. It explicitly reports partial coverage while indexed search of new member replies on snapshot posts is deferred. Those replies are included in individual-post Q&A and public catch-up. Older cited replies can require the discussion's existing **Load more** control.

## Authentication, evidence, and privacy

The API verifies a registered Supabase user, rejects cross-origin browser requests, enforces the feature gates, and constructs its own sources. It never uses a service-role key or accepts client-supplied evidence. Direct messages and chat tables are not searched.

Every returned claim needs a valid source ID and a matching quote from the retrieved text. Disagreements require multiple cited sources. Model text is displayed as escaped plain text; only server-owned internal source links become clickable. Dates, limited coverage, and insufficient evidence remain visible. The assistant must attribute anecdotes to members and cannot verify current visa rules or eligibility.

**A matching quote does not establish that the claim logically follows from it.** Semantic support, missing context, prompt-injection resistance, and immigration-related accuracy still require representative live-model evaluation. There is no verified official-government-source retrieval in this release.

Text is redacted for several common identifiers before inference, but pattern matching cannot remove every personal detail. Selected text is sent to the configured AI provider. The optional OpenAI adapter requests `store: false`; provider-level data handling still needs review before broad launch. No prompt logging or durable conversation archive was added.

Responses use private/no-store browser headers. The internal Cloudflare cache lasts up to five minutes and is keyed by user, request, model/version, and source contents. Retrieval and permission checks precede cache reads; content is rechecked before returning results. Cached responses are not shared across accounts. This favors isolation over maximum reuse.


## Limits

Quote matching does not prove semantic support. Answers summarize community evidence; they do not establish current visa rules or eligibility. Direct messages are excluded. No claim of million-user capacity, official-source verification, or completed hosted inference is made by local tests.

# VisaThreads production-only assistant rollout

October 15 correction: [production chat changes and signed-in verification](ASSISTANT_CHAT_FIX_2026-10-15.md) are live at commit `899f7fe493b56c8794642c0b0ede87c12a2f0b36`, with 45/45 hosted samples and three successful real member questions. Catch-up is now community-only. Historical release evidence below records the October 14 deployment.

## Owner decision — October 14, 2026

AI features belong **only on https://visathreads.com**. The development website https://visa-central.com must have no chatbot or AI controls. Production work now includes post Q&A, discussion summaries, public/community Q&A and community-only time-based catch-up. This supersedes the earlier dev-AI plan and the initial post-only activation plan.

| Site | Worker | Supabase project | AI |
|---|---|---|---|
| visathreads.com | visaflow-dev | cycnichledvqbxevrwnt | Live: post Q&A/summaries, public/community Q&A, and catch-up |
| visa-central.com | visathreads-sandbox | ppdwysmeistjxzjpmxyk | Disabled; no AI binding |

The Worker named `visaflow-dev` actually serves the production domain. Deployment checks pin the domain, Worker and database explicitly. Cloudflare access through the GitHub production environment works; another browser login is not required.

## Current checkpoint — October 14, 2026

- The combined release passes **1,513 repository tests**, including the dependency fork regressions and upstream compatibility cases, plus TypeScript and build checks. Web checks run `38583830663` passed for follow-up commit `15fc12aa818b6971303606b4e0cf3fa687c839a6`, including two new provenance regressions. Local tests do not establish hosted model quality or real-user sign-in acceptance.
- The additive assistant retrieval/quota migration is **applied and verified in production** project `cycnichledvqbxevrwnt`. Missing assistant RPCs are no longer a blocker. Do not replay the repository's historical migration chain against this project.
- The previous `braces` audit blocker is addressed by a reviewed, bounded-depth local source fork. Its origin, security changes, limits, tests and maintenance duties are recorded in [vendor/braces/FORK.md](../vendor/braces/FORK.md). The full dependency audit remains enforced. This is not an upstream patched release, and an advisory scan alone does not audit local fork source.
- A real hosted Workers AI binding has been exercised. Early runs exposed inconsistent attribution, summaries and conflict placement. The production prompt now distinguishes reported personal timelines from predictions, preserves summary details and places conflicting reports in disagreements. The first provider, Qwen3-30B-A3B, still omitted a reported delivery day in one of 33 samples (run `38523130090`). Llama 3.3 70B passed summary checks but failed two source-validation cases and declined one usable prompt-injection fixture (run `38579367106`). The release now uses Cloudflare-hosted `@cf/openai/gpt-oss-120b`, low reasoning effort, temperature zero and a fixed seed. The request uses its typed chat-completions schema envelope (`name`, `schema`, `strict`). The 25-second deadline and daily quotas are unchanged; completion is capped at 4,096 tokens including reasoning. **Hosted acceptance run `38580920814` passed all 33 samples** on candidate commit `f16b20cb8e443fcffb6c427d79289a12c9fa858a`: three successful samples of each of eleven cases. Every sample is retained and failures are never replaced with retries.
- **Production AI is deployed and enabled as of October 14, 2026, 14:56 UTC.** PR #8 merged into `main` as `dbded2dac222ca543d93092998ae479f11a1c269`. Production release run `38582002973` passed all 33 hosted samples for that merge commit and uploaded Worker version `1a74afb6-711c-44a0-a3ea-4109ff4634a6`. Its exact-config smoke check then failed because the deploy CLI regenerated the mutable local provenance file with deployment-step environment values. The immutable bundled config hash was `b347d8ceb078615e478eb5fc4f948c24a65374a620051e5ef5fb6cb7e834e91d`; the overwritten expected hash was `e1846f64d6b877a98458b577181571f7bcbd33f7041c12510f38fd2a5a653e83`. Automated rollback restored the captured original Worker version `879503b4-e947-420e-8ad8-e1f2f7082ae5` at 14:44 UTC. Follow-up commit `15fc12aa818b6971303606b4e0cf3fa687c839a6` compares against an immutable post-build receipt and retains that evidence even after failure; no smoke assertion is waived. Corrected release run `38583831283` passed all 33 hosted samples, deployed, passed every live smoke check, and completed successfully. No rollback was needed for the corrected release.
- Production preparation run `38580920806` passed repository tests, TypeScript, audit, original archive capture, the production feature build and unchanged-baseline checks. The original **563 posts and 628 replies** were recovered and their published-feed hash verified. Each release recaptures and rechecks the still-active archive; development fixtures must never replace it.
- Authenticated member end-to-end acceptance has not been completed. Hosted synthetic model tests and anonymous/invalid-auth denial checks do not establish a successful signed-in user flow.

## Successful production release evidence

- Release run: https://github.com/khyma66/visa/actions/runs/38583831283 — success at 14:56 UTC, October 14, 2026.
- Application commit: `15fc12aa818b6971303606b4e0cf3fa687c839a6`.
- Source tree: `372bef6b23e554b0e8aa03e51e17910ad73e3ed1`.
- Source fingerprint: `cc80b79d7e2d51545f971e4196d54bea2ec63c7899188dca4879e8fec5a9e407`.
- Build configuration fingerprint: `b347d8ceb078615e478eb5fc4f948c24a65374a620051e5ef5fb6cb7e834e91d`.
- Active Worker version: `9fa4f008-6624-4f17-b3ec-dfbaf60db168` on `visaflow-dev`, serving `https://visathreads.com`.
- Hosted model: all **33/33 samples** passed for the exact application commit; temporary evaluation Worker deleted.
- Live checks: exact clean source/configuration match; `{posts:true, communities:true, catchup:true}`; assistant route HTTP 200; original **563 posts / 628 replies** and canonical feed hash unchanged; anonymous and invalid sessions rejected with 401, cross-origin requests with 403; private/no-store responses.
- All 24 general smoke routes passed, including security headers, unique script nonces, real 404, and unchanged preview/noindex state.
- Browser: `https://visathreads.com/assistant` displays **Ask VisaThreads**, the assistant navigation link, source/privacy guidance, and the expected sign-in link for a guest. No authenticated member session was available; a real signed-in answer flow is **not verified**.
- Evidence artifact: `11904672129`, containing only the immutable build manifest and hosted model receipt. Documentation-only commits may follow the deployed application commit.
- Rollback version remains `879503b4-e947-420e-8ad8-e1f2f7082ae5`; the additive database migration is retained on Worker rollback.

## PR consolidation

PR #8 is merged into `main` as `dbded2dac222ca543d93092998ae479f11a1c269` and contains the current production source, owner-feedback changes, chatbot and PR #9's tag/navigation improvements. PRs #1, #2, #4, #5, #6, #7 and #9 were closed as incorporated; PR #3 closed automatically with the merge. Deploy the merged combined release, never the obsolete pre-consolidation `main` tree or an old stacked branch in isolation.

| PR | Treatment in the combined release |
|---|---|
| #1 | Community privilege migrations and access tests already incorporated. |
| #2 | Auth/security behavior reconciled into the current application; optional Turnstile support restored without changing hosted auth settings. |
| #3 | Consolidated release branch is an ancestor of the candidate. |
| #4 | Source-neutral post presentation and member-only messaging preserved. |
| #5 | Community discovery, lifecycle and bounded reads incorporated into current UI/schema. |
| #6 | Direct sign-in entry and current Google/email behavior preserved. |
| #7 | Community navigation, compact feed and exact-build provenance safeguards incorporated. |
| #8 | Merged combined release and production-only AI implementation. |
| #9 | Exact popular-tag/navigation commit already included in #8. |

The superseded PRs are closed; their changes were incorporated through #8 rather than merging obsolete whole trees again merely to change their GitHub status.

## Guarded update of the currently live site

Use `.github/workflows/production-features.yml` on the reviewed merged `main` commit. Its helper, `scripts/production-feature-release.mjs`, is specific to the **already-serving early preview at visathreads.com**. The existing live launch mode and noindex status are retained. This feature update does not approve formal public launch or change `PUBLIC_LAUNCH_APPROVED`, `IMPORTED_CONTENT_APPROVED`, auth-provider settings, indexing or the dev deployment.

The workflow:

1. Runs repository checks, TypeScript, release-helper checks and the full high-severity dependency audit.
2. Captures domain routing, exact active deployment and rollback version. Recovers the original archive's JSON literal from the deployed Worker without executing its source, then verifies it against the live feed. Requires the original **563 posts / 628 replies**, unique IDs, metadata and reviewed experience checks; neither recovered content nor Worker source is uploaded as an artifact.
3. Evaluates the actual Workers AI model in a temporary authenticated evaluation Worker using synthetic evidence. Requires three passing samples for each of fifteen representative cases (45 total), including every enabled mode, conflicts, unsupported policy, irrelevant evidence, prompt injection and multilingual content. Cleanup must succeed.
4. Builds from clean, committed source. The identified historical preview is replaced under the exact pinned transition documented in `PRODUCTION_FEATURE_TRANSITION_2026-10-14.md`; its original source commit is unavailable, and source equivalence is not claimed. Pins production domains/database, preserves existing secrets, and adds the `ASSISTANT_AI` binding.
5. Immediately before deployment, verifies the live baseline has not changed and the model acceptance receipt matches the exact commit, enabled features and model, is less than one hour old, and records removal of the temporary Worker.
6. Deploys, then checks exact source provenance, unchanged archive, feature availability and anonymous/invalid-auth denials. Verification failure triggers rollback only if no intervening unrelated deployment exists.

`production-feature-preparation.yml` performs capture/build/preflight without deploying. It does not replace hosted acceptance. `assistant-acceptance.yml` runs the hosted model evaluation independently. No successful result should be inferred from merely uploading an evaluation Worker.

Active feature settings are `ASSISTANT_PROJECT_REF=cycnichledvqbxevrwnt`, `ASSISTANT_PROVIDER=workers-ai`, `ASSISTANT_ENABLED=true`, `ASSISTANT_COMMUNITIES_ENABLED=true`, `ASSISTANT_CATCHUP_ENABLED=true`, with Workers AI binding `ASSISTANT_AI`. These settings were verified in the completed production deployment. The API also checks the actual HTTPS request origin, configured site and database; dev domains, previews, lookalike hosts and forged forwarding headers cannot enable inference.

Keep `.github/workflows/public-release.yml`, `scripts/release-check.mjs` and the evidence requirements in `docs/release-review.json` intact. Their broader launch reviews remain separate and must not be marked verified by this feature rollout.

Deployment and enablement are verified below. Real-account acceptance remains incomplete: verify real answers, source quotes, unsupported/conflicting questions, account isolation, content-change invalidation and quota behavior in a signed-in member session. Do not describe the hosted synthetic model evaluation or anonymous denial checks as a successful signed-in user flow.

Rollback uses the captured previous Worker version, or a checked build with all assistant flags disabled. Worker rollback does not undo the additive database migration.

## Development remains without AI

The sandbox configuration pins `visa-central.com`, Worker `visathreads-sandbox` and project `ppdwysmeistjxzjpmxyk`. Its build helper rejects production targets, AI bindings and enabled AI flags. No AI page/buttons or usable inference endpoint should appear there. The previously applied dev assistant migration is unused and does not activate AI. Routine dev verification is outside the current production rollout work.

## Implemented

- Collapsible **Ask about this discussion** and **Summarize discussion** on question/experience pages, with links to cited posts and replies.
- **Ask VisaThreads** at `/assistant`, accessible from the header and community tools. Global post search is included in the first rollout.
- Separately gated community Q&A and **Catch me up**, both selected for the production-only feature release after hosted acceptance. Intervals: 1 hour, 6 hours, 24 hours, 7 days, or since the last successful complete catch-up. The default is 24 hours; API intervals cannot exceed 31 days.
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

# VisaThreads production-only assistant rollout

## Owner decision — October 14, 2026

AI features belong **only on https://visathreads.com**. The development website https://visa-central.com must have no chatbot or AI controls. Production work now includes post Q&A, discussion summaries, public/community Q&A and time-based catch-up. This supersedes the earlier dev-AI plan and the initial post-only activation plan.

| Site | Worker | Supabase project | AI |
|---|---|---|---|
| visathreads.com | visaflow-dev | cycnichledvqbxevrwnt | Candidate prepared; hosted acceptance and deployment pending |
| visa-central.com | visathreads-sandbox | ppdwysmeistjxzjpmxyk | Disabled; no AI binding |

The Worker named `visaflow-dev` actually serves the production domain. Deployment checks pin the domain, Worker and database explicitly. Cloudflare access through the GitHub production environment works; another browser login is not required.

## Current checkpoint — October 14, 2026

- The combined candidate passes **1,489 local tests**, including the dependency fork regressions and upstream compatibility cases, plus TypeScript and build checks. Local tests do not establish hosted model quality or real-user sign-in acceptance.
- The additive assistant retrieval/quota migration is **applied and verified in production** project `cycnichledvqbxevrwnt`. Missing assistant RPCs are no longer a blocker. Do not replay the repository's historical migration chain against this project.
- The previous `braces` audit blocker is addressed by a reviewed, bounded-depth local source fork. Its origin, security changes, limits, tests and maintenance duties are recorded in [vendor/braces/FORK.md](../vendor/braces/FORK.md). The full dependency audit remains enforced. This is not an upstream patched release, and an advisory scan alone does not audit local fork source.
- A real hosted Workers AI binding has been exercised. The initial representative acceptance run recorded **2 passing cases and 9 failing cases**. Investigation and acceptance remain pending; this is **not** a hosted model pass. The earlier standalone REST-token 401 is not evidence that the deployed binding is unavailable.
- **Production AI has not been deployed or marked live at this checkpoint.** The release workflow requires a successful acceptance receipt for the exact release commit before deployment.
- The original live archive must be recovered and compared against the still-active deployment as part of the guarded release. Development fixtures must never replace it.

## Remaining PR consolidation

PR #8 now targets `main` and contains the current production source, owner-feedback changes, chatbot and PR #9's tag/navigation improvements. Deploy the merged combined release, never the obsolete pre-consolidation `main` tree or an old stacked branch in isolation.

| PR | Treatment in the combined release |
|---|---|
| #1 | Community privilege migrations and access tests already incorporated. |
| #2 | Auth/security behavior reconciled into the current application; optional Turnstile support restored without changing hosted auth settings. |
| #3 | Consolidated release branch is an ancestor of the candidate. |
| #4 | Source-neutral post presentation and member-only messaging preserved. |
| #5 | Community discovery, lifecycle and bounded reads incorporated into current UI/schema. |
| #6 | Direct sign-in entry and current Google/email behavior preserved. |
| #7 | Community navigation, compact feed and exact-build provenance safeguards incorporated. |
| #8 | Combined release candidate and production-only AI implementation. |
| #9 | Exact popular-tag/navigation commit already included in #8. |

After the combined candidate is merged and its checks recorded, close the superseded PRs with a link to that merge. Do not merge their obsolete whole trees again merely to change their GitHub status.

## Guarded update of the currently live site

Use `.github/workflows/production-features.yml` on the reviewed merged `main` commit. Its helper, `scripts/production-feature-release.mjs`, is specific to the **already-serving early preview at visathreads.com**. The existing live launch mode and noindex status are retained. This feature update does not approve formal public launch or change `PUBLIC_LAUNCH_APPROVED`, `IMPORTED_CONTENT_APPROVED`, auth-provider settings, indexing or the dev deployment.

The workflow:

1. Runs repository checks, TypeScript, release-helper checks and the full high-severity dependency audit.
2. Captures domain routing, exact active deployment and rollback version. Recovers the original archive's JSON literal from the deployed Worker without executing its source, then verifies it against the live feed. Requires the original **563 posts / 628 replies**, unique IDs, metadata and reviewed experience checks; neither recovered content nor Worker source is uploaded as an artifact.
3. Evaluates the actual Workers AI model in a temporary authenticated evaluation Worker using synthetic evidence. Requires all eleven representative cases, including every enabled mode, conflicts, unsupported policy, irrelevant evidence, prompt injection and multilingual content. Cleanup must succeed.
4. Builds from clean, committed source. The identified historical preview is replaced under the exact pinned transition documented in `PRODUCTION_FEATURE_TRANSITION_2026-10-14.md`; its original source commit is unavailable, and source equivalence is not claimed. Pins production domains/database, preserves existing secrets, and adds the `ASSISTANT_AI` binding.
5. Immediately before deployment, verifies the live baseline has not changed and the model acceptance receipt matches the exact commit, enabled features and model, is less than one hour old, and records removal of the temporary Worker.
6. Deploys, then checks exact source provenance, unchanged archive, feature availability and anonymous/invalid-auth denials. Verification failure triggers rollback only if no intervening unrelated deployment exists.

`production-feature-preparation.yml` performs capture/build/preflight without deploying. It does not replace hosted acceptance. `assistant-acceptance.yml` runs the hosted model evaluation independently. No successful result should be inferred from merely uploading an evaluation Worker.

Intended feature settings are `ASSISTANT_PROJECT_REF=cycnichledvqbxevrwnt`, `ASSISTANT_PROVIDER=workers-ai`, `ASSISTANT_ENABLED=true`, `ASSISTANT_COMMUNITIES_ENABLED=true`, `ASSISTANT_CATCHUP_ENABLED=true`, with Workers AI binding `ASSISTANT_AI`. These describe the pending candidate, not a completed deployment. The API also checks the actual HTTPS request origin, configured site and database; dev domains, previews, lookalike hosts and forged forwarding headers cannot enable inference.

Keep `.github/workflows/public-release.yml`, `scripts/release-check.mjs` and the evidence requirements in `docs/release-review.json` intact. Their broader launch reviews remain separate and must not be marked verified by this feature rollout.

Before calling AI live, record the successful exact-commit model evaluation, deployment/version, hosted route/feature checks and authenticated end-to-end result. Verify real answers, source quotes, unsupported/conflicting questions, account isolation, content-change invalidation and quota behavior; do not describe an anonymous denial check as a successful signed-in user flow.

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

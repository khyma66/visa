# Community discovery, creation, membership and News

> Historical verification of the initial PR #5 commit. The Google News replacement
> and bounded community pagination update are recorded in
> [COMMUNITY_SCALE_AND_GOOGLE_NEWS_2026-10-06.md](COMMUNITY_SCALE_AND_GOOGLE_NEWS_2026-10-06.md).
> Its current status supersedes the original News source and membership reads below.

## Product scope

Use Reddit's discovery patterns with VisaFlow's existing tagged Q&A model:

- Explore: search public communities, filter by category/country, browse bounded pages.
- My communities: only the signed-in user's memberships; no public member directory.
- Start a community: check existing names first, choose a stable unique address,
  category, country, description and up to five rules. The creator joins as owner.
- Join/Leave: explicit persisted membership, duplicate requests are safe. Owners
  cannot leave and orphan a group; ownership transfer is not offered yet.
- Community page: public description/rules, member count, scoped questions, and a
  link to ask in that community. Membership is required for a new group question.
- News: dated Federal Register immigration-related documents from USCIS and the
  State Department, with agency/type/text filters and links to official sources.
  Fetch time and publication date are distinct; older records are never presented
  as newly published today. Upstream failure shows an error and official links.

Public communities are the supported launch mode. Private communities, invitations,
owner moderation tools, ownership transfer, ranked recommendations, and paid groups
are separate features. Do not expose nonfunctional controls for them. Existing
private records are excluded from this public discovery feature. Platform-wide
reporting and suspension safeguards continue to apply.

Questions, answers, accepted answers and tags remain the discussion format. A tag is
not a community. Imported posts are not automatically assigned to a group or a
member account. The earlier imported-author messaging restriction remains intact.

## Implementation boundaries

The new migration reuses communities and community_members, corrects the legacy
membership identity relationship to profiles, and adds questions.community_id.
General questions retain a null community_id. Existing membership data must pass
an orphan-profile check before its foreign key can be changed.

Creation and membership RPCs derive the actor from auth.uid(), validate inputs,
check suspension/rate limits, and preserve existing write guards (including policy
acceptance requirements added in newer deployed versions). Browsers cannot choose
an owner/admin role or mutate member counts. Creation and owner membership are one
transaction; join/leave and count changes are serialized for a community.

Directory and Q&A reads are bounded and indexed; membership details use batched
reads rather than one request per card. Public group questions stay discoverable
from the global Q&A feed. A group page reads only its own community_id. No evidence
from these functional checks establishes million-user throughput: measure a real
workload before choosing a larger database tier, queues, or an additional search
service. Popular communities may require counter/lock redesign if measured join
contention warrants it.

News fetches one fixed HTTPS API, validates official output URLs and bounded JSON,
uses an eight-second timeout, coalesces concurrent requests within a Worker isolate,
and caches successful results for five minutes. It uses no API keys or arbitrary
user-supplied fetch URLs.

## Deployment prerequisite

This work is based on PR #4 / commit c17d6353d06f23406beeb2526cc96e6f34dd6262.
The deployed VisaThreads preview and Supabase schema have newer work missing from
GitHub, including visa_experiences, policy acceptance, avatar, vote and messaging
changes. Recover/sync that source and reconcile the migration ledger first. Port
this patch into that source; do not replace the preview with the older repository.

No hosted schema change, membership, user, post, merge or deployment was performed.
This turn used isolated tests and read-only hosted checks. The reviewed migration must be tested on an isolated copy of the
current hosted schema before rollout. Preserve newer view columns and policies.

## Verification commands

The package test aggregate includes the new News, community lifecycle and UI tests.
Use npm run typecheck, npm test, npm run build and npm run check:secrets. Run the
unmodified high-severity dependency audit gate before release. Read the PR for the
actual results, scope and remaining limitations; a passing mock/rendered test does
not prove hosted email delivery, WebSockets, or live browser database writes.

## References

- https://www.reddit.com/explore/
- https://support.reddithelp.com/hc/en-us/articles/28621027395220-How-to-join-or-leave-a-community
- https://support.reddithelp.com/hc/en-us/articles/360043043552-What-s-the-difference-between-r-all-r-popular-news-and-my-home-feed
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://www.federalregister.gov/developers/documentation/api/v1

## Results recorded October 6 UTC

- 196 automated tests passed: 98 existing, 47 community database, 35 actual
  component-event/service tests, and 16 News tests. TypeScript, the Worker build
  and repository secret-pattern scan passed.
- HTTP smoke through the repository's supported Next development server returned
  200 for Explore, Start a community, community detail, News and the scoped Ask
  route. The real local News API returned 200 with 18 records; invalid agency
  returned 400. These page responses do not constitute hosted membership writes.
- The Cloudflare local Worker dev server could not start because this environment
  denies its network-interface enumeration (`uv_interface_addresses`). Worker
  compilation passed; its local runtime was not claimed tested.
- No dependencies were added. The unchanged dependency tree's current audit has
  12 high and two moderate findings. The audit gate remains blocking; do not merge
  or release by suppressing it or accepting automatic major downgrades.
- Tested failures uncovered and fixed stale-account membership UI updates,
  creation across an account switch, stale community-route responses, a stuck
  loading state when switching from My communities, and repeat submission before
  navigation. This is not a hosted multi-browser or load test.

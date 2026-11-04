# Community reputation and spam safety

## Member experience

Account → Reputation shows the server-maintained total and paginated, own-account award/reversal history. Existing starting scores are preserved. Qualifying question upvotes earn 2, native-answer upvotes 5, and accepted native answers 10. New questions, answers, messages, views and reports do not mint points. No paid credits, legal-expert badges, automated moderator privileges or minimum posting reputation.

The voter/question author must have a verified email or phone and an account at least 24 hours old. New members can participate immediately. Self-votes are rejected in the interface and database; self-acceptance earns nothing. Archive/source content is never backfilled with rewards. Member replies to archive discussions currently have no voting/acceptance mechanism and therefore do not earn points in this version.

The profile total updates in the database transaction. Open Account → Reputation or use Refresh to fetch current totals and history; there is no background profile polling. Existing discussion realtime behavior is unchanged.

## Integrity

- Private award identities are unique per action/content/actor. Retries cannot mint twice.
- At most 100 new points per recipient per UTC day; at most 20 from one actor to that recipient. Caps count original awards, including subsequently reversed ones. An award denied by a cap does not become earnable by retrying tomorrow.
- Vote withdrawal, vote direction changes, accepted-answer switching, moderation removal, deletion and suspension reverse the corresponding award. Restoration reinstates only previously recorded eligible awards. No backfill of old votes.
- Private append-only event history records adjustments without voter identities or copied post bodies in the member-facing response. Existing profile write restrictions remain.
- Award identity/cap lookups are indexed. Parent and recipient row locks plus actor advisory locks serialize simultaneous events. No remote API/AI call runs inside a transaction.
- Cyclic administrative changes can still produce normal PostgreSQL deadlock aborts. Never treat an aborted transaction as a successful vote; clients show an error and users may retry.
- This reduces farming; it does not claim to detect every coordinated network or make popular accounts trustworthy. Cross-account campaign detection and a staffed review process remain operational work.

## Spam moderation

See spam-protection.md for deterministic checks, bounded account-linked fingerprints, domain blocklists and limitations. The existing privately designated feedback owner is added to the community moderator allowlist. This is a one-time grant; changing feedback ownership later must also review moderator membership. There is no client self-enrollment.

Public suspicious submissions may be queued for human review without automatic removal; confirmed blocked/deceptive links and repeated posting are rejected. Private inbox content is not sent to an AI provider. Existing message-request, blocking and rate-limit protections remain.

## Release and verification

1. Run npm test, typecheck, build, secret checks and the optional local PostgreSQL concurrency harness.
2. Apply community_spam_protection, then community_reputation to production with migration tracking.
3. Verify private grants, self-vote guards, the designated moderator count, and anonymous RPC denial. A rollback-only SQL smoke may test fake records; never publish test posts.
4. Release through production-features.yml. It verifies migration presence before the application deployment.
5. Repeat schema migration in the isolated dev project, then synchronize identical app source. The dev deployment gate intentionally stops if its migrations are missing.

The optional scripts/test-reputation-concurrency.mjs creates a local-only disposable PostgreSQL cluster, checks simultaneous caps/retries/moderation and voter deletion, stops it and retains fixtures for inspection. It cannot connect to production.

## Rollback

Roll back application through the guarded deployment workflow. To pause awards, remove only the reputation change triggers after an operator reviews the exact target list; retain private award/event data, self-vote protection and original community guards. Do not reset profile scores, delete history or revoke existing moderators automatically. A corrective migration is preferable.

## References

- https://support.reddithelp.com/hc/en-us/articles/204511829-What-is-karma
- https://support.reddithelp.com/hc/en-us/articles/27441485903124-Reputation-filter
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/database/postgres/column-level-security

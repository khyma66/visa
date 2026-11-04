# Public contribution spam protection

This change adds database enforcement to new questions, experiences, native answers, archive replies and edits. It preserves the current consent checks, rate limits, account suspensions, grants, parent visibility, and report/removal controls. Private messages retain participant reporting and existing limits; this classifier does not inspect private inboxes.

## Policy and tradeoffs

- Reject URLs with user-info, encoded host characters or backslashes that obscure destinations; reject government-domain impersonation such as `uscis.gov.attacker.example`. Direct official sources remain permitted. Recognize HTTP(S), `www.` and pasted bare domains. Deliberately defanged `hxxps://` examples can be used to discuss scams.
- Reject moderator-blocked domains and their subdomains, using exact label boundaries. The initial list is empty: no unverified external domain feed is trusted automatically. Existing content is not retrospectively removed by blocking its domain.
- Reject the third equivalent body of at least 80 characters within ten minutes across public posting surfaces. Normalize case, whitespace and common zero-width characters. This is exact normalized duplication, not semantic similarity.
- Accounts under seven days old may publish three distinct link-bearing contributions in ten minutes; established accounts may publish ten. No blanket account-age posting prohibition. Text-only contributions remain available subject to existing limits.
- Route shortened links, internationalized domain names, link-heavy posts and visa guarantees combined with contact/payment solicitation to human review. Also review likely credential solicitation. These signals are not proof of abuse: warnings about scams and legitimate references remain visible. Nothing automatically suspends an author. A moderator must review context and may keep, remove, or remove and suspend.
- Reviewed, unchanged content is not requeued; changed suspicious content is requeued. Existing member reports are not overwritten by automatic reports. The queue identifies automatic screening separately from member reports.
- No submitted URLs are fetched. No private content is transmitted to a reputation or AI service. This avoids introducing URL-fetch attacks and third-party content disclosure.

## Operation

The existing private `feedback_owner` record assigns the designated owner moderator access when the migration runs. This contains no hardcoded owner email or user ID. Existing moderator memberships are preserved. `/moderation` exposes the review queue and website block/unblock controls only after the server confirms access. Blocklist changes require a reason and have a private audit trail. Regular users and anonymous visitors cannot read the list, inspect history, forge flags, or manage domains.

Repetition/link history stores at most 32 entries per author (hash, target identifier, link flag and timestamp, no text copy). Only the latest ten minutes affect decisions. Entries are overwritten as the ring fills and removed when the account is deleted. These fingerprints are abuse-prevention records, not anonymized data. Reports retain the existing report retention behavior. Domain audit records contain the domain, action, evidence and operator ID; account deletion clears the operator ID. No abuse records should be repurposed for advertising.

Review the queue regularly. Check the real destination independently, read the surrounding discussion, and confirm promotional context before removing content. Keep legitimate warnings and disclose-affiliation recommendations. Investigate false positives through the existing contact channel. Dismissal is per contribution, not permanent trust for an account.

## Validation and release

`npm run test:database` includes real PostgreSQL execution of the migration and adversarial spam cases. Tests cover direct database-role submissions, question titles, native/archive replies, edits, exact-host boundaries, normal official links, scam warnings, owner/moderator permissions, duplicate normalization, link cooldown, and re-review behavior. The regular typecheck, build and security suites also apply.

Apply this migration to the intended environment before deploying its moderation controls. Do not enable the feature by editing client code alone. Test production owner access and unauthenticated denial, then follow the existing VisaThreads-first release/verification process before syncing visa-central.com.

For rollback, remove only the six `community_spam_*` contribution triggers to disable new screening; retain report/audit data and the original guards. Restore the previous application to remove domain controls. Do not drop reports or bulk-delete contributions. Review any owner membership removal separately rather than revoking an existing operator by assumption.

## Limits and next steps

This is a deterministic first layer, not a guarantee of safety. Novel domains, homographs, URL redirects, language variations and coordinated accounts can evade it. The bounded exact-text history does not identify cross-account campaigns. Internationalized domains and shorteners are reviewed rather than blanket-blocked. Do not treat age or a domain allowlist as proof of trust. Add a licensed URL reputation provider only with a clear provider/privacy design, bounded requests, caching, outage behavior and measured false-positive rates. Never fetch arbitrary user URLs from a privileged server to expand redirects.

Sources reviewed:
- [Reddit reputation filter](https://support.reddithelp.com/hc/en-us/articles/27441485903124-Reputation-filter): behavioral signals and moderator review.
- [Reddit spam policy](https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam): repetitive promotion, harmful destination masking, member reports.
- [Stack Overflow promotion guidance](https://stackoverflow.com/help/promotion): useful standalone contributions, relevant links and affiliation disclosure.

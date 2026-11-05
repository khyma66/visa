# Sharing and future paid features

Current release keeps messaging, posting, replies, sharing, Save and Follow free.
`src/lib/feature-access.ts` controls UI rollout visibility only. It does not grant
access, enforce subscriptions or replace database/API authorization.

Prefer one maintained codebase with feature flags to a long-lived paid branch:
security fixes and UAT stay in sync. Short-lived feature branches remain useful
for development; deploy dormant features and enable them after owner approval.

Possible Premium additions: saved searches, configurable digests and advanced
personal collections. Possible Pro additions: team workspaces, shared collections
and workspace exports. These are proposals, not implemented product promises.
Keep reporting, blocking, privacy requests and account deletion available to all.

Before enabling any paid feature:

1. Implement server-verified billing entitlements, isolated by account and workspace.
   Never trust local storage or editable user metadata for a paid plan or role.
2. Check entitlements in every relevant API/database operation as well as the UI.
3. Test upgrades, cancellations, refunds, failed payments and downgrade behavior.
4. Approve pricing, renewal/refund terms, tax treatment and updated disclosures.
5. Test in UAT with separate test billing/data. Release production through the
   guarded workflow, verify it, then synchronize UAT without copying member data.

External share links disclose only the public post URL when the user selects
them. No third-party sharing scripts load. Native device sharing is optional.
Private messaging is a separate action from public replies and is unavailable
for imported authors or the current user's own posts. Server messaging controls
remain authoritative for blocked users and message requests.

Optional phone numbers are private auth metadata (`contact_phone`). They are not
the verified authentication `phone` field, are never billing entitlements, and
do not subscribe a user to texts. Users can clear them in Profile or Settings.

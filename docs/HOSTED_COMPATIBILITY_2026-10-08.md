# Hosted compatibility review

Read-only review of VisaFlow project `cycnichledvqbxevrwnt`, October 8 UTC / October 7 America/Chicago. No hosted writes, migrations, account changes or private row content were requested.

## Confirmed

- The hosted migration ledger contains 22 entries, ending at `20261006045212_visa_experiences`.
- Newer changes include `production_legacy_access_hardening` (October 3), policy-acceptance receipts, avatar initials/name policy and visa experiences. These are not all represented in the accessible source history.
- Security advisors returned **no ERROR-level findings**. They reported 23 INFO findings for RLS-enabled tables without policies, including quarantined legacy tables.
- Remaining WARN findings: vector extension in public (1), GraphQL schema discoverability for anonymous (9) and authenticated (17), and leaked-password protection disabled (1).

The September claim that 15 legacy tables were still unprotected must not be repeated as a current finding. RLS-enabled/no-policy is different from RLS being disabled. GraphQL schema discovery warnings do not by themselves prove unauthorized row access. None of these results establish complete production security.

## Not verified

The system-schema query intended to compare exact deployed views, functions, triggers and grants was cancelled before results were available. Therefore, compatibility of the two queued local community migrations with the actual deployed definitions is **unverified**, not approved or disproven:

- `20261006045523_public_community_lifecycle.sql`
- `20261006051458_bounded_community_reads.sql`

Local tests verify that these migrations preserve newer question-feed columns/predicates and existing guard behavior in controlled fixtures. This does not prove parity with every October 3-6 hosted change.

## Completion gates

1. Recover the actual deployed application and corresponding migration source; keep the hosted ledger as evidence rather than replaying older local migration timestamps.
2. Compare the current definitions of question/answer views, membership guards, policy-acceptance checks, vote/message routines and avatar/Experience contracts with the integration branch.
3. Rehearse the two adapted community migrations on staging and test through anonymous and separate authenticated clients. Verify create/join/leave, private/inactive visibility, native/imported reply behavior and account-switch isolation.
4. Review extension placement and GraphQL exposure against the intended public schema. Do not remove extensions or change grants blindly.
5. Enable and test leaked-password protection where supported in the actual Auth account; verify CAPTCHA/rate limits and password recovery separately. No protection setting was changed here.
6. Run security advisors again after staging changes, and record attributable evidence before marking `database_access` verified.

No million-user capacity claim is supported by this review. Existing local fixtures cover 10,000 communities and 100,000 questions, not hosted concurrency, recovery or cost.

# VisaThreads security review

## Result and scope

The 16 October 2026 review found and fixed an archive-reply integrity gap: a signed-in author could submit a reply with a forged score, accepted-answer flag or timestamp. The permission change preserves replies, reading, existing row-level security, policy acknowledgements and server maintenance access. It does not change the public-launch boundary.

The production Supabase project is `cycnichledvqbxevrwnt`; development remains separate at `ppdwysmeistjxzjpmxyk`. Production reported `ACTIVE_HEALTHY`. The release coordinator applied the permission migration to production first and then development and verified the allowed columns on each. An independent production catalog recheck confirmed the final grants below.

This is a scoped code, database-metadata and automated-regression review, not a certification that every vulnerability has been eliminated. No private messages, account records or feedback contents were retrieved. Per the user's choice, no real production accounts were created or used for a two-person sign-in, posting and messaging test. Local multi-identity tests do not replace that browser-to-database check.

## Fixed reply metadata permissions

The live `public.imported_answers` table previously gave both `anon` and `authenticated` table-wide `SELECT`, `INSERT`, `UPDATE`, `DELETE` and `MAINTAIN` privileges. The authenticated insert policy correctly required `author_id = auth.uid()`, but that checks ownership, not which columns a member may set. Existing triggers checked policy acceptance and rate limits and derived topic tags; they did not reset scores, accepted flags or timestamps. Anonymous inserts were still denied by RLS.

Migration `20261016021725_imported_answer_write_privileges.sql` now gives:

| Relation | Anonymous access | Signed-in member access | Server access |
| --- | --- | --- | --- |
| `public.imported_answers` | Read active replies under RLS | Read active replies; insert only `question_id`, `author_id`, `body`, subject to existing RLS and triggers | Unchanged |
| `public.imported_answer_feed` | Read under the underlying RLS | Read under the underlying RLS | Unchanged |

Table-level and separately granted column privileges are both cleaned up. The migration changes only these two named relations, does not delete or rewrite rows, and leaves native answers untouched. Revoking write grants on the joined feed also prevents it from becoming an accidental write path if its definition changes later; it was already non-updatable in its current form.

The client still uses exactly the supported insert shape in `src/lib/community.ts`: `question_id`, `author_id`, and `body`. The server remains responsible for identifiers, timestamps, status, scores and acceptance.

### Exact permission evidence

Before the fix, each target relation had this table ACL:

```text
{postgres=arwdDxtm/postgres,anon=arwdm/postgres,authenticated=arwdm/postgres,service_role=arwdDxtm/postgres}
```

After the fix, each has:

```text
{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres}
```

On `imported_answers`, the only remaining column ACLs are:

```text
question_id  {authenticated=a/postgres}
author_id    {authenticated=a/postgres}
body         {authenticated=a/postgres}
```

Here `r` is SELECT, `a` INSERT, `w` UPDATE, `d` DELETE, `D` TRUNCATE, `x` REFERENCES, `t` TRIGGER, and `m` MAINTAIN. No service-role grants were changed.

### Regression results

All 16 new permission tests passed. The focused run passed 46 tests across permission hardening, actual PostgreSQL RLS and chat request behavior, reply counts and cursor pagination. These are isolated PGlite tests with synthetic identities, not production account tests.

The new regression first reproduces the old metadata-spoofing behavior locally. After the actual migration, it checks a successful ordinary archive reply, readable results, rejection of seven server-owned metadata fields, author impersonation, anonymous insertion, policy-acknowledgement enforcement, read-only feed grants, preserved native answer behavior, existing content and service-role access, and repeatable migration application.

Run the focused checks with:

```sh
node --test --test-timeout=60000 tests/database/imported-answer-privileges.test.mjs scripts/test-realtime-database.mjs tests/database/imported-reply-counts.test.mjs tests/database/answer-pagination.test.mjs
```

## Database protections confirmed

Live catalog checks confirmed:

- All 46 tables in `public` and `private` have row-level security enabled; zero unprotected tables were found in those schemas.
- All six client-readable public views use `security_invoker=true`; zero exposed views bypass underlying RLS through the default definer mode.
- There are zero `SECURITY DEFINER` functions in `public` and zero anonymous-callable private definer functions. Reviewed privileged helpers use a fixed empty search path and explicit authenticated-user checks.
- Direct conversations and messages are readable only by their participants. Message creation uses the authenticated RPC, not a client table insert grant. Pending requests allow one initial message; acceptance is recipient-controlled; blocking and sending lock the same conversation. Message IDs provide idempotency.
- Broadcast policies restrict inbox topics to the current account and conversation topics to participants. Clients have no broadcast-send policy. Payloads invalidate data; durable message reads remain subject to RLS.
- Native questions and answers use ownership policies, restricted insert columns and write guards. Restrictive parent-visibility policies prevent archived or inaccessible parent content from reappearing through answer queries.
- Private feedback tables have no anonymous or authenticated table access. Owner inbox/review helpers authorize against the private owner table, not user-editable metadata.
- Legacy tables are not directly accessible to browser roles. The legacy `posts` storage bucket is private, and no storage object policies expose it to clients.
- Public profiles expose only the public account identifier, pseudonym, avatar initial seed, bio, reputation and timestamps—not email addresses or full private names.

These checks distinguish grants from RLS: a GraphQL schema can show that a table exists while RLS still restricts which rows are visible. See [Supabase guidance on row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Remaining platform actions

### Schedule the database security upgrade

Production reports PostgreSQL `17.6` (`server_version_num=170006`), Supabase build `17.6.1.062`. Supabase's 25 September advisory says its 17.11 update includes security fixes from five upstream cycles. The existing version should not be treated as fully patched. [Supabase minor-release advisory](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).

The read-only compatibility preflight found zero `ltree` indexes, zero float GiST indexes, zero custom-estimator operators, zero PGP encryption/decryption functions in the application's schemas, and zero application `bytea` columns. No listed application-specific reindex or PGP migration blocker was identified; this does not rule out encryption done by unrelated external clients.

The owner should confirm a usable backup and rollback plan, select a maintenance window, open the project's infrastructure settings, and choose the offered supported minor upgrade. After it completes, recheck health, Auth, realtime delivery, posting, replies, message requests and RLS advisers. Do not bundle a database engine upgrade into a visual release or assume it is downtime-free. [Supabase upgrade guide](https://supabase.com/docs/guides/platform/upgrading).

### Enable leaked password protection

The security adviser reports leaked password protection disabled. Email-code and Google sign-in remain available, but the application also offers password sign-in and password setup; strong-length validation alone does not detect compromised passwords.

In the project's Auth security settings, enable leaked password protection if the current plan supports it, retain server-side password requirements and verify both a known compromised test password rejection and a compliant password change using an authorized test account. Do not enter or collect a real user's password during testing. [Supabase password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

### Move the vector extension only with a dependency review

The adviser flags `vector` version `0.8.0` in the `public` schema. The legacy vector-search functions are already server-only, so this warning does not establish a current private-content leak. A separate migration should inventory dependent columns, operators and function signatures, move the extension to an appropriate non-public schema, and test every dependent server function before release. Do not blindly drop or recreate the extension. [Extension schema guidance](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public).

### Reduce remaining tag catalog grants

`public.tag_catalog` still has the same old `arwdm` grants for anonymous and authenticated roles. Its only RLS policy is SELECT, so present browser writes are denied. No supported client code writes the catalog; topic patterns are maintained by migrations and read by database tagging functions.

A follow-up permission migration can revoke client privileges on this exact table and regrant SELECT, including cleanup of any column grants. Preserve server-role access and verify automatic tags, native posting, replies and tag discovery. This was deliberately excluded from the archive-reply fix rather than expanding its scope silently.

### Interpret the remaining adviser notices

The security adviser returned no ERROR-level finding, but retained warnings for the vector schema, disabled leaked password protection, and GraphQL discovery of 11 anonymous-readable and 19 authenticated-readable objects. The 30 informational RLS-without-policy notices correspond to intentionally server-only legacy/private tables; adding permissive policies to silence them would weaken protection. GraphQL discovery warnings are not evidence that another user's messages can be read. [Anonymous GraphQL visibility guidance](https://supabase.com/docs/guides/database/database-linter?lint=0026_pg_graphql_anon_table_exposed), [signed-in GraphQL visibility guidance](https://supabase.com/docs/guides/database/database-linter?lint=0027_pg_graphql_authenticated_table_exposed).

Performance notices include a duplicate index pair on `questions` (`questions_assistant_recent_idx`, `questions_new_page_idx`), seven unindexed foreign keys, legacy RLS initialization notices and unused indexes. Address these separately with workload evidence; do not remove an index merely because a low-traffic preview has not used it yet.

## Rollback caution

The permission migration is compatible with the existing client insert shape; reverting an application release does not require reverting this security fix. Prefer fixing a client that submits protected columns.

Only if an owner explicitly accepts reopening the metadata-spoofing gap, the prior table permissions can be restored with:

```sql
grant select,insert,update,delete,maintain
  on public.imported_answers,public.imported_answer_feed
  to anon,authenticated;
```

The original three authenticated column INSERT grants are already present after the fix. No content restoration is needed because no rows were removed. The rollback above intentionally restores the vulnerable baseline and must not be used merely to make a failing security test pass.

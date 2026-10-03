# Human acceptance tests before public launch

All checks below start **NOT VERIFIED**. Use the exact staging/release URL, commit and deployment version. Record tester/date/browser, expected vs actual result, screenshot or sanitized log evidence and a follow-up issue for failures. Never paste session tokens, real passports, visa documents, other users’ messages or actual abuse material into evidence.

## Preparation

- Use three operator-controlled mailboxes: Alice and Bob as ordinary members, Eve as an outsider; use a fourth, explicitly appointed moderator where possible. Separate browser profiles/devices, not merely tabs sharing one login.
- Use synthetic questions/messages prefixed `QA-<date>`. Agree fixture cleanup and permission for email tests. Do not run destructive or high-volume tests against a shared production database.
- Run desktop Chrome/Firefox/Safari, a small-screen phone, keyboard-only and a screen reader. Confirm which environment/database you are using.
- No test is passed merely because the UI hides a button. An authorized engineer must also check the corresponding database/API authorization.

## Feature checklist

| ID | Human action | Expected result |
| --- | --- | --- |
| A1 | Register Alice with the final eligibility/terms flow; confirm email; inspect public profile signed out. | One random public handle; public profile does not show email; only the adopted age/consent process is claimed. Confirmation reaches the mailbox and returns to the allowed origin. |
| A2 | Try wrong password, existing/unknown email, expired/reused confirmation, confirmation on another device. | Clear non-sensitive feedback; no session for invalid credentials; no unsafe redirects or internal secret disclosure. |
| A3 | Recover password from another browser; test expired/reused link; change password; check old password and sessions. | Correct account updated after authorized recovery. Old password fails; session invalidation matches the approved policy, including other devices. |
| A4 | Logout, use Back, reload private pages, and sign in as Bob in the same browser. | No Alice inbox/messages appear, even briefly; cached responses never reveal another account. Repeat in a second tab. |
| A5 | Exercise missing/expired/replayed CAPTCHA and bounded login/signup/reset attempts. | Server rejects missing/invalid proof and limits abuse, including direct Supabase calls. Complete only after bot controls are implemented. |
| Q1 | Browse signed out, search titles/body, filter visa type/post type/tag, sort, clear filters; follow a copied tag URL and browser Back. | Correct matching results and URL state, understandable no-results state, no stale unrelated filter results. |
| Q2 | Walk first/middle/last archive pages; open several posts and comments. | 522 unique nonempty snapshot posts and 21 archive tags at this snapshot; 583 available comments total. Future snapshot changes require updating expected counts. Source totals are not falsely labeled available comments or votes. |
| Q3 | Browse all tags, use A–Z/popularity and tag search; click a tag. | Correct counts for the stated archive scope and only matching posts. |
| Q4 | Draft a new question/reply and inspect related matches; select Related on the feed. | Matching visa topics appear, self is excluded and promotions are not suggested as related questions. No legal-equivalence claim. |
| Q5 | Alice publishes a valid question; Bob answers; Alice accepts it. Refresh both devices. | Durable content and live updates; only Alice can accept an answer to her question. Bob/Eve cannot edit ownership or acceptance through the API. |
| Q6 | Vote twice/change vote; test own-content voting according to intended rules; publish minimum/maximum/empty/overlong text. | Consistent totals and server-enforced validation; no duplicate vote rows or bypass through hand-crafted requests. |
| Q7 | Post harmless literal HTML/XSS-like text in synthetic fixtures. | Text displays inertly, not as executable HTML; no script runs or unexpected navigation. Security tester verifies source links reject executable URL schemes. |
| M1 | Alice requests a chat with Bob and sends one introduction. | Bob receives a request; Alice cannot send a second message before acceptance. Request retry does not create duplicate conversations. |
| M2 | Bob accepts and both exchange messages; retry a send after temporary network loss. | Live delivery and reload persistence, no duplicate message from retry; connection status is accurate. |
| M3 | Bob declines or blocks; Alice tries sending via UI and direct API. | Further sends denied by backend, not only disabled UI. Reopening/requesting again must follow the agreed block policy. |
| M4 | Eve uses a copied conversation ID/message ID and attempts reads, writes and realtime subscriptions. | No private text, participants, read receipts or inbox metadata disclosed. Test REST, RPC and websocket access with valid outsider credentials and signed out. |
| M5 | Exchange more than 50 test messages; load earlier pages; change conversation while a slow request is running. | Stable ordering, no missing/duplicate rows or cross-conversation messages. Read state updates only for authorized recipient. |
| M6 | Disconnect/reconnect, background/foreground tabs, expire session and log out while connected. | Missed messages recover, stale subscriptions close and another account’s messages never reappear. |
| R1 | Bob reports Alice’s post; repeat; Eve tries to read Bob’s report. | A reviewable report, duplicate handling and reporter-only visibility. |
| R2 | Bob reports one received message; moderator opens the queue. | Only reported message is exposed through the moderator workflow, not arbitrary conversation history. Ordinary users cannot self-assign moderator roles. |
| R3 | Moderator removes content and suspends Alice; Alice attempts to restore/post/vote/message. | Removed content stays hidden and protected writes fail. Test related results, SSR, realtime and existing sessions. Appeal/resolution workflow must be operational. |
| R4 | A nonmember submits synthetic copyright, personal-information and urgent intimate-content complaints through final intake. | Receipt reaches a real monitored queue without requiring signup. Appropriate verification, access limits, escalation deadlines and resolution are recorded. No real abuse imagery used. **Current preview intake is not implemented.** |
| R5 | Remove a synthetic imported post/comment; refresh archive, check search/cache and simulate rollback. | Removed material is not reintroduced. **Current durable imported suppression is not implemented.** |
| P1 | Alice requests export/deletion; Eve tries to impersonate Alice; inspect the export. | Secure identity verification, correct scope, no Bob/Eve private data. Revocation, public-content handling, storage/search/cache removal and backup exceptions match the final policy. **Current workflow is not implemented.** |
| P2 | Compare privacy notice to browser network/storage and provider settings. | Actual cookies/storage, logs, analytics, data destinations and retention agree with the notice; applicable opt-out signals work. |
| U1 | Navigate every major flow by keyboard and screen reader, zoom 200–400%, use narrow viewport. | Visible focus, labeled controls, announced errors/statuses, no keyboard trap or inaccessible report/CAPTCHA process; no hidden critical actions. |
| U2 | Open policy/official links, source links and error/404 pages; use very long post/title text. | Correct destinations; warnings visible and readable; source links not described as endorsements; layouts do not conceal actions. |

## Engineer/operator drills (human witnesses required)

1. **Database isolation:** validate each table/view/RPC/storage policy as signed out, Alice, Bob, Eve and moderator. Test owner reassignment, forged metadata, archived content and suspended tokens. Confirm legacy reads/writes are denied where intended. Record that no real records were accessed during adversarial tests.
2. **Recovery:** restore a backup to an isolated target; verify accounts, messages, permissions and separately backed-up objects. Measure actual data-loss and recovery-time objectives. Never restore over the only live copy for a test.
3. **Abuse/incident:** simulate a stolen test token, key rotation, mass signup and report escalation using bounded fixtures. Confirm alerts reach the named operator and the correct access path can be closed. Website maintenance alone does not stop direct database access.
4. **Capacity/cost:** in approved staging, ramp representative reads, posts, concurrent chats and reconnects; measure p95/p99 latency, errors, database CPU/connections, realtime fan-out, egress and spend. Define thresholds before running. Do not claim million-user capacity from a small pilot.
5. **Release/rollback:** verify exact domain, HTTPS, private no-store/noindex headers, health behavior, import gate, and no secrets in bundles. Roll back to a known version and confirm removed content is not revived. Keep a record of schema compatibility; Worker rollback does not roll back database changes.

## Signoff record

For each row: `test ID | version | tester | UTC time | pass/fail/not-run | sanitized evidence | issue link`. A second reviewer signs security/privacy/restore results. Copy genuine summaries into `docs/release-review.json`; never mark a missing or timed-out test verified to get through the release gate.

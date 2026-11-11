# Read-only production site monitor

Isolated test package for `https://visathreads.com/us/en`. No individual post URLs,
login account, auth state or secret is needed. No website, database, publisher or
public-counter code is changed. Test contexts are not distinct real people.

One anonymous Chromium context opens the homepage, checks the site title/heading,
real feed previews and measured view labels on up to five cards, then reloads
once. It does not click individual posts or create views. Legitimate changes to
feed ordering between visits are allowed.

## Limits and protections

- Two document openings, at least ten seconds apart. One worker, no retries.
- Counting POSTs are acknowledged locally, never sent to the website. All other
  writes are blocked. The displayed counts still come from the real read-only GET.
  The two inspected STABLE feed/related RPCs are translated from browser POST to
  PostgREST GET, so their database transactions are read-only. Unknown functions
  or parameter shapes are rejected; no original POST body is forwarded.
- Redirect hops fail closed. The document URL is fixed; other reads are narrowly
  allowlisted. No ad clicks, trackers, WebSockets, service workers or auth flows.
- No proxy rotation, TLS bypass or security-challenge bypass. DNT/GPC are defense
  in depth, not permissions. A public `test=true` flag grants no exceptions.
- A 500-request ceiling also bounds accidental background polling.

Infrastructure request logs may observe monitoring traffic. The runner does not
write application engagement, business-analytics or notification records, and
does not validate the ordinary view-increment path.

## Execution

In this directory: `npm ci --ignore-scripts`, `npm run check`,
`npx --no-install playwright install chromium`, `npm run test:fixtures`, then
`npm run preflight && npm run test:production`.

The GitHub workflow supports manual execution, runs after monitoring changes
merge, and runs once daily at 11:37 UTC. GitHub schedules can be delayed or dropped.
Set repository variable `PRODUCTION_SITE_SMOKE_PAUSED=true` to pause daily runs.
One active run is allowed, with an eight-minute job limit. No secrets are required.

Local browser fixtures prove zero server-side engagement writes, counting-request
suppression, denied writes, a rejected third document and blocked redirect escape.
They contact only a loopback server, not production.

## Evidence and separate environments

Screenshots, traces and sanitized diagnostics are kept only on failure, for one
day. Public feed content may be in a failure trace: review privately and never
send unredacted artifacts to an AI service. Custom diagnostics contain only phase,
counts and numeric error statuses, never member text, query URLs, headers or tokens.
No session/auth state is saved or uploaded. Success logs contain only budgets.

Production performs no create/edit/delete/reply/vote workflows. Existing isolated
PostgreSQL `tests/database` checks cover RLS, ownership and constraints. Full
staging write scenarios require a separate authorized backend/test accounts; this
monitor does not claim those ran. Tactical publishing stays behind its unchanged
consent gates and OFF switch.

References: [navigation](https://playwright.dev/docs/navigations),
[assertions](https://playwright.dev/docs/test-assertions),
[isolation](https://playwright.dev/docs/browser-contexts),
[network interception](https://playwright.dev/docs/network),
[auth-state security](https://playwright.dev/docs/auth),
[GitHub schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

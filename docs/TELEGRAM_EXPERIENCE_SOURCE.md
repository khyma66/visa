# Telegram experience source

## November 18: F1 Experiences channel refresh

The owner supplied completed run `LgBH1Y1beaLVkUlWS` from the same actor.
It finished at `2026-11-18T05:38:08.940Z`; dataset `Z9InhQnuo50dbuidi`
contains six messages from `https://t.me/F1_Experiences`. This is a different
channel from the November 17 discussion-group import; keep both histories.

Use the separately reviewed configuration:

```sh
node scripts/import-telegram-experiences.mjs \
  --source config/telegram-f1-experiences-source.json \
  --run LgBH1Y1beaLVkUlWS --out /absolute/private/new-output-directory
```

One interview account was inserted into production with insert-if-absent behavior:
`apify-telegram-F1_Experiences-130747`, “F-1 Mumbai Interview: Reported 221(g)
and Interview Questions.” Its original posting timestamp is
`2026-10-22T05:54:29.000Z`. The source has incomplete answers and inconsistent
dates in its body; preserve that wording without filling blanks or treating it
as a verified outcome. Text hash:
`a76324f420d623535f48ab800925b90a53c517a259b55985015f6829544a84c0`.

The other five records were excluded: a blank promotional template, two advice
questions (one secondhand), an empty forward, and a reply requesting elaboration.
External engagement and source identities were not imported as member activity.
The default F1 experience query now returns three imported experiences. Live
API text and posting date were checked against the prepared record; no existing
posts, replies or source metadata were replaced. This uses the owner's specified
run and does not claim access to the actor's full run history.

UAT publication was not performed: the connected operator was denied permission
to project `ppdwysmeistjxzjpmxyk`. The pending vote/view integration and dependency
audit blocker described below remain separate from this live content refresh.

## November 17: discussion-group source

The owner selected this actor on November 17, 2026:

- Actor: [webfinity/telegram-channel-content-media-scraper-v2](https://apify.com/webfinity/telegram-channel-content-media-scraper-v2), ID `f9ah2tzQwzhF8OyfK`.
- Reference run: [9G44wVjxkDUHmNG4b](https://console.apify.com/view/runs/9G44wVjxkDUHmNG4b).
- Dataset: `8mZzgaiX3gfjOOqpZ`, 200 messages from `https://t.me/F1_Visa_Discussions`.
- Completed November 17, 2026 at 6:42 p.m. America/Chicago (`2026-11-18T00:42:48.868Z`).
- Input: three-day range, at most 200 posts, text enabled, media downloads disabled.

Configuration and reviewed message IDs are in `config/telegram-experience-source.json`.
This is a discussion group, not a dedicated experience channel. The reference run
contains two selected standalone refusal/profile accounts; neither is a complete
interview transcript. Other messages include questions, replies, announcements,
promotions, or insufficient context. Do not turn them into fabricated experiences.

Preserve source text, paragraph breaks, source posting time and canonical URL.
Use an informative title, `F-1 / OPT` filter value and the existing
`Refusal & reapplication` category. Imported
authors have no member account, vote totals start at zero, and no external views,
reactions or conversation fragments become VisaThreads votes, views or replies.
Source actor/run/dataset and content hash remain attached to each record.
The source body stays outside the public repository.

Prepare a read-only refresh:

```sh
node scripts/import-telegram-experiences.mjs --out /absolute/private/new-output-directory
```

With a current `APIFY_TOKEN`, preparation checks completed runs for this exact
channel before choosing the latest one. Without access to the actor run inventory,
it reads the shared reference run and marks `latestVerified: false`; do not claim
that inventory was checked. An explicit `--run RUN_ID` pins a run.
Preparation never starts an Actor, changes its schedule, or publishes records.
Changed text or new message IDs require review and a configuration update.

Publish the prepared records through the existing operator database connection
or scoped ingestion endpoint. Use insert-if-absent behavior, preserve existing
discussions and metadata, then verify the public experience query and detail page.
Do not infer reply authors or relationships absent from the source. No new
scraping run or ongoing publication schedule was requested in this refresh.

## November 17 publication receipt

Two records were added to the production `archive_posts` table, taking its count
from 944 to 946 and its reviewed experience count from four to six. Existing
records and source metadata were preserved. IDs:

- `apify-telegram-F1_Visa_Discussions-1363357`
- `apify-telegram-F1_Visa_Discussions-1363193`

The default F1 experience filter returns both. Database hashes match the reviewed
source hashes; body text is identical in the detail and experience representations.
The source posting dates remain November 16 UTC. The run capture date was not
substituted for them. The saved credential could not read run history, so this
receipt identifies the owner's shared run rather than claiming a verified latest
actor run. Content is stored in the published index. Vote/view validation now
uses that same index in PR #164 so future reviewed additions do not need a
bundled-ID update. That integration is not deployed yet: application checks and
the build passed, but the dependency audit blocked the release. Its existing
`picomatch` dependency is affected by GHSA-fc5q-39xc-vjpf; as checked November 17,
the advisory lists no patched release. Do not bypass the audit. The two content
records remain live; vote/view controls require the pending integration release.

# Telegram experience source

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
uses that same index so future reviewed additions do not need a bundled-ID update.

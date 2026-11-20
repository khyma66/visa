// Interactive, single-post kickoff. Credentials and tokens remain in memory only.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { ask, passwordPrompt, productionClient, grantConsent, SOURCE } from './editorial-consent.mjs';

const AUTHOR = 'varunchinna5966@gmail.com';
const OWNER = 'visathreads@gmail.com';
const ID = '6057998d86d5a7521241f76e53c48ef79fd6d614efc28daf790cac11b3b61431';
const TITLE = 'Question about an H-1B denial after an RFE response';
const BODY = 'A community member reports selection in this year’s H-1B lottery, followed by a request for evidence (RFE) in September. The RFE response was submitted on November 1, and on November 5 the member saw a denial status referring to the case being denied and available options. The member asks what that status means and what options are available.';
const URL = 'https://www.facebook.com/groups/H1B.Visa.Community/permalink/2341109953370786';

export function nextSlot(now = Date.now()) {
  const format = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hourCycle: 'h23' });
  let time = Math.ceil((now + 20 * 60000) / 900000) * 900000;
  for (let i = 0; i < 192; i++, time += 900000) {
    const hour = Number(format.format(new Date(time)));
    if (hour >= 8 && hour < 21) return new Date(time).toISOString();
  }
  throw new Error('Could not find an available posting time.');
}

export async function preparePilot(client, authorId, confirm, now = Date.now()) {
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authorId ?? ''), 'Account identity unavailable.');
  async function action(operation, payload) {
    const result = await client.rpc('editorial_owner_action', { operation, payload });
    if (result.error) throw new Error(`Could not complete ${operation}: ${result.error.message}`);
    return result.data;
  }
  let after_id = '', draft, settings, scheduled = 0;
  for (let page = 0; page < 100; page++) {
    const result = await action('list', { after_id });
    assert(Array.isArray(result?.items), 'Could not read the queue.');
    settings = result.settings;
    for (const item of result.items) {
      if (item.status === 'scheduled') scheduled++;
      if (item.id === ID) draft = item;
    }
    if (result.items.length < 50) break;
    after_id = result.items.at(-1).id;
    if (page === 99) throw new Error('Queue is too large to verify safely.');
  }
  assert(settings?.enabled === false && settings?.tactical_views_enabled === false && scheduled === 0, 'Queue or view settings changed; stop and check them before proceeding.');
  assert(draft?.status === 'draft' && draft.revision === 2 && draft.title === TITLE && draft.body === BODY && draft.source_url === URL && draft.source_key === SOURCE && Date.parse(draft.source_posted_at) === Date.parse('2026-11-06T16:29:13Z'), 'Pilot draft changed; stop and review it again.');
  console.log(`\nPilot: ${TITLE}\n${BODY}\nSource: ${URL}\nAccount: ${AUTHOR}\n`);
  if (!await confirm()) return { cancelled: true };
  const common = { id: ID, revision: 2 };
  const slot = nextSlot(now);
  await action('review', { ...common, decision: 'approved', facts_verified: true, reuse_basis: 'Owner confirmed permission to reuse and publish attributed community summaries.', review_note: 'Compared this summary to the original post; attribution retained.' });
  await action('source', { source_key: SOURCE, enabled: true });
  await action('schedule', { ...common, author_id: authorId, scheduled_at: slot });
  await action('controls', { enabled: true, confirmation: 'START APPROVED PUBLISHING' });
  return { scheduled_at: slot };
}

async function main() {
  assert(process.stdin.isTTY && process.stdout.isTTY, 'Run this utility in an interactive terminal.');
  console.log(`This starts one reviewed, attributed pilot post, not the full queue.\nThe ${AUTHOR} account grants posting permission for ${SOURCE} for 14 days, at most three posts a day.\nThe owner ${OWNER} then approves and schedules the pilot. Real view counts only.`);
  if (await ask('Type ALLOW to authorize this account, or press Enter to cancel: ') !== 'ALLOW') return;
  console.log(`Sign in as ${AUTHOR}.`);
  let password = await passwordPrompt();
  let author;
  try { author = await grantConsent(productionClient(), AUTHOR, password); } finally { password = ''; }
  console.log('Account permission saved. Next, sign in as the website owner.');
  const client = productionClient();
  password = await passwordPrompt();
  const login = await client.auth.signInWithPassword({ email: OWNER, password });
  password = '';
  if (login.error || !login.data?.session) throw new Error('Owner sign-in failed. The account permission may already be saved; contact the operator before retrying.');
  try {
    const user = await client.auth.getUser();
    assert(!user.error && user.data?.user?.email?.toLowerCase() === OWNER, 'Owner identity could not be verified.');
    const result = await preparePilot(client, author.account_id, async () => (await ask('Type START to approve and schedule this one post, or press Enter to cancel: ')) === 'START');
    if (result.cancelled) console.log('No post scheduled. Account permission remains saved.');
    else console.log(`Pilot scheduled for ${result.scheduled_at}. The publishing timer will process it after that time.`);
  } finally { await client.auth.signOut({ scope: 'local' }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(`${error.message}\nIf any step failed, do not repeat it blindly; ask the operator to check the queue first.`); process.exitCode = 1; });

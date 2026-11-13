// Private operator utility. Run interactively as the account granting consent.
// Never writes credentials or session tokens to a file or accepts them in flags.
import assert from 'node:assert/strict';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ORIGIN = 'https://cycnichledvqbxevrwnt.supabase.co';
const PUBLIC_KEY = 'sb_publishable_7QnSRDvWRYFIqA3zhsNIsw_iWSspCTN';
export const SOURCE = 'https://www.facebook.com/groups/H1B.Visa.Community';
const DAYS = 14, PER_DAY = 3;

/** Grant only for the account that has just signed in and confirmed. */
export async function grantConsent(client, email, password) {
  const login = await client.auth.signInWithPassword({ email, password });
  if (['captcha_failed','captcha_required'].includes(login.error?.code))
    throw new Error('This account requires a security challenge. Use the normal website sign-in; this utility cannot complete that challenge.');
  if (login.error || !login.data?.session) throw new Error('Sign-in failed. Check the account credentials and try again.');
  try {
    const verified = await client.auth.getUser();
    if (verified.error || verified.data?.user?.email?.toLowerCase() !== email.toLowerCase())
      throw new Error('The signed-in account could not be verified.');
    const result = await client.rpc('editorial_consent', { source: SOURCE, allow_posting: true, days_valid: DAYS, per_day: PER_DAY });
    if (result.error || result.data?.enabled !== true)
      throw new Error('Permission could not be saved. Sign in on VisaThreads and accept the current community policies first.');
    return { enabled: true, expires_at: result.data.expires_at, daily_limit: result.data.daily_limit, account_id: verified.data.user.id };
  } finally {
    // Revoke only this temporary session, never other sessions or credentials.
    try {
      const cleanup = await client.auth.signOut({ scope: 'local' });
      if (cleanup.error) process.stderr.write('Could not revoke the temporary session; it will expire normally.\n');
    } catch { process.stderr.write('Could not revoke the temporary session; it will expire normally.\n'); }
  }
}

export function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}
export function passwordPrompt() {
  const input = process.stdin;
  assert(input.isTTY && process.stdout.isTTY, 'Run this utility in an interactive terminal.');
  const wasRaw = input.isRaw;
  process.stdout.write('VisaThreads password (input is hidden): ');
  emitKeypressEvents(input); input.setRawMode(true); input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    function keypress(text, key = {}) {
      if (key.ctrl && key.name === 'c') { cleanup(); reject(new Error('Cancelled.')); return; }
      if (key.name === 'return' || key.name === 'enter') { cleanup(); resolve(value); return; }
      if (key.name === 'backspace') { value = [...value].slice(0, -1).join(''); return; }
      if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) value += text;
    }
    function cleanup() { input.off('keypress', keypress); input.setRawMode(Boolean(wasRaw)); input.pause(); process.stdout.write('\n'); }
    input.on('keypress', keypress);
  });
}
export function productionClient() {
  return createClient(ORIGIN, PUBLIC_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== ORIGIN) throw new Error('Unexpected authentication destination.');
      return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
    } } });
}
async function main() {
  assert(process.stdin.isTTY && process.stdout.isTTY, 'Run this utility in an interactive terminal.');
  console.log('Authorize your VisaThreads account for reviewed, attributed community summaries.');
  console.log(`Source: ${SOURCE}\nPermission: ${DAYS} days, at most ${PER_DAY} posts per day.`);
  console.log('Changing an existing permission stops that account’s previously scheduled assignments.');
  const email = await ask('VisaThreads account email: ');
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter a valid email address.');
  const answer = await ask('Type ALLOW to grant this permission, or press Enter to cancel: ');
  if (answer !== 'ALLOW') { console.log('Cancelled; no permission changed.'); return; }
  let password = await passwordPrompt();
  assert(password, 'Password is required.');
  const client = productionClient();
  try {
    const receipt = await grantConsent(client, email, password);
    console.log(`Permission granted until ${receipt.expires_at}; limit ${receipt.daily_limit} posts/day.`);
    console.log('The owner must still review and schedule posts. No post was published by this utility.');
  } finally { password = ''; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });

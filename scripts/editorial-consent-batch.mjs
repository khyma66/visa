// Interactive account-by-account authorization; credentials are never saved.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { ask, passwordPrompt, productionClient, grantConsent, SOURCE } from './editorial-consent.mjs';

export async function authorizeOne(email, password, client = productionClient()) {
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter a valid account email.');
  assert(password, 'Password is required.');
  return grantConsent(client, email, password);
}

async function main() {
  assert(process.stdin.isTTY && process.stdout.isTTY, 'Run this utility in an interactive terminal.');
  console.log(`Each person must sign in and consent themselves. Source: ${SOURCE}\nPermission: 14 days, up to three posts per day. Posts remain subject to owner review and scheduling.\nSkip accounts already authorized: re-authorizing can cancel their scheduled assignments.\nPress Enter at the email prompt when finished.`);
  while (true) {
    const email = await ask('\nVisaThreads account email (or Enter to finish): ');
    if (!email) break;
    if (await ask(`Type ALLOW to authorize ${email}, or press Enter to skip: `) !== 'ALLOW') continue;
    let password = await passwordPrompt();
    try {
      const result = await authorizeOne(email, password);
      console.log(`Permission saved until ${result.expires_at}; limit ${result.daily_limit} posts per day.`);
    } catch (error) {
      console.error(`Permission not saved: ${error.message} The account may need to sign up, verify its email, and accept the current policies on VisaThreads.`);
    } finally { password = ''; }
  }
  console.log('Finished. This tool does not approve, schedule, or publish posts.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pinnedChatbotRecovery } from './pinned-chatbot-recovery.mjs';

export const LIVE_SITE = 'https://visathreads.com';
export const LIVE_DATABASE = 'https://cycnichledvqbxevrwnt.supabase.co';
export const LIVE_WORKER = 'visaflow-dev';
export const sha256 = value => createHash('sha256').update(value).digest('hex');

/** Only the existing, already-served preview snapshot may enter this feature build. */
export function checkedLiveArchive(root, env) {
  assert.equal(env.VISATHREADS_EXISTING_PREVIEW, 'true', 'Existing-preview mode must be explicit.');
  assert.equal(env.CLOUDFLARE_ENV, 'development', 'This does not open the formal production launch.');
  assert.equal(env.NEXT_PUBLIC_APP_ENV, 'development');
  assert.equal(env.NEXT_PUBLIC_SITE_URL, LIVE_SITE);
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, LIVE_DATABASE);
  const receipt = JSON.parse(readFileSync(resolve(root, '.cache/visaflow/live-preview/receipt.json'), 'utf8'));
  assert.equal(receipt.siteOrigin, LIVE_SITE);
  assert.equal(receipt.worker, LIVE_WORKER);
  assert.equal(receipt.databaseOrigin, LIVE_DATABASE);
  assert.equal(receipt.health?.environment, 'development');
  assert(receipt.health?.build?.dirty === false || pinnedChatbotRecovery(receipt.health?.build, receipt), 'Unreviewed dirty archive baseline.');
  assert.match(receipt.health?.build?.gitSha ?? '', /^[a-f0-9]{40}$/);
  assert.match(receipt.deploymentId ?? '', /^[a-f0-9-]{36}$/);
  assert.equal(receipt.questionCount, 563, 'Existing archive baseline changed; review before deployment.');
  assert.equal(receipt.replyCount, 628, 'Existing reply baseline changed; review before deployment.');
  const age = Date.now() - Date.parse(receipt.capturedAt);
  assert(age >= 0 && age < 2 * 60 * 60 * 1000, 'Live archive receipt is expired.');
  const file = resolve(root, 'src/data/api-archive.json');
  assert.equal(sha256(readFileSync(file)), receipt.archiveSha256, 'Recovered archive changed after capture.');
  return file;
}

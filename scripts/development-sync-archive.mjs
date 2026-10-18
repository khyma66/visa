import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256 } from './live-preview-archive.mjs';

export const DEV_SITE = 'https://visa-central.com';
export const DEV_DATABASE = 'https://ppdwysmeistjxzjpmxyk.supabase.co';
export const DEV_WORKER = 'visathreads-sandbox';
export const DEV_SYNC_DIRECTORY = '.cache/visaflow/development-sync';

/** Explicit CI exception for the exact archive already served by the dev site.
 * Never permits a production snapshot, account export, or arbitrary local file. */
export function checkedDevelopmentArchive(root, env) {
  assert.equal(env.VISATHREADS_DEV_SYNC, 'true');
  assert.equal(env.VISATHREADS_EXISTING_PREVIEW, undefined);
  assert.equal(env.CLOUDFLARE_ENV, 'sandbox');
  assert.equal(env.NEXT_PUBLIC_APP_ENV, 'development');
  assert.equal(env.NEXT_PUBLIC_SITE_URL, DEV_SITE);
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, DEV_DATABASE);
  const receipt = JSON.parse(readFileSync(resolve(root, DEV_SYNC_DIRECTORY, 'receipt.json'), 'utf8'));
  assert.equal(receipt.siteOrigin, DEV_SITE);
  assert.equal(receipt.databaseOrigin, DEV_DATABASE);
  assert.equal(receipt.worker, DEV_WORKER);
  assert.match(receipt.deploymentId ?? '', /^[a-f0-9-]{36}$/);
  assert.match(receipt.previousVersion ?? '', /^[a-f0-9-]{36}$/);
  assert.match(receipt.productionSource ?? '', /^[a-f0-9]{40}$/);
  assert.equal(receipt.source, receipt.productionSource);
  if (env.GITHUB_SHA) assert.equal(receipt.source, env.GITHUB_SHA);
  const age = Date.now() - Date.parse(receipt.capturedAt);
  assert(age >= 0 && age < 90 * 60 * 1000, 'Dev archive receipt is expired.');
  const file = resolve(root, 'src/data/api-archive.json');
  assert.equal(sha256(readFileSync(file)), receipt.archiveSha256, 'Captured dev archive changed.');
  return file;
}

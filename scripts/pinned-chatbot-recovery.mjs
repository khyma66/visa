// One owner-authorized recovery of the observed October 15 deployment. A dirty
// build is never treated as ordinary ancestry. Future/unrecognized builds fail.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const CHATBOT_RECOVERY = Object.freeze({
  deploymentId: 'f22d382e-0904-4e41-a30f-c687634163cd',
  previousVersion: '9be26341-637e-4384-9e53-712d5fa27e5a',
  worker: 'visaflow-dev', siteOrigin: 'https://visathreads.com',
  databaseOrigin: 'https://cycnichledvqbxevrwnt.supabase.co',
  build: Object.freeze({
    gitSha: '8e1e8ea187a91a2aed732426683adc6c7febfcec',
    gitTree: 'a4a405855ddb0edb0f53bfca9978ded2a2e778eb',
    sourceSha256: '436ecb482a70c58846f347217f4ebe71111597a91d540d12d54744e2757b75bf',
    configSha256: '9d296d40f0e0e2a324902f7982d4964652bec964580848372731a37abd7a2411',
    appEnvironment: 'development', siteOrigin: null, dirty: true,
  }),
  // These are the only uncommitted changes in the observed deployment checkout.
  // The logo bytes were independently matched against the live public asset.
  retainedFiles: Object.freeze({
    'src/components/SiteHeader.tsx': '298206ee21520fbd9af4b14473f71407ed55d4ecbabf5188d180638bcc73cd52',
    'src/styles/globals.css': '103e98a5a5148f2577d92ef42874fc2374a0ae6e3f4b8b739658d31d938ab802',
    'public/assets/brand/visathreads-integrated-logo.png': '9f01fa97253b999a2ca902e5493ac9fc25e703b7119dcbf9b1348e1e10780a3b',
  }),
});

export function pinnedChatbotRecovery(build, baseline) {
  return Object.entries(CHATBOT_RECOVERY.build).every(([key, value]) => build?.[key] === value)
    && ['deploymentId', 'previousVersion', 'worker', 'siteOrigin', 'databaseOrigin'].every(key => baseline?.[key] === CHATBOT_RECOVERY[key]);
}

export function verifyRecoveryFiles(repository) {
  for (const [path, digest] of Object.entries(CHATBOT_RECOVERY.retainedFiles)) {
    assert.equal(createHash('sha256').update(readFileSync(resolve(repository, path))).digest('hex'), digest,
      `Observed branding change was not preserved: ${path}`);
  }
}

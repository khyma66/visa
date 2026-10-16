// A one-release, logo-only production path. It deliberately reuses the normal
// archive, provenance, assistant-acceptance, deploy and rollback safeguards.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sourceProvenance } from './build-provenance.mjs';
import { LIVE_SITE } from './live-preview-archive.mjs';

export const HEADER_LOGO_BASELINE = 'aeebd8aeb0791dbc9b5bcc0ee252b4314c88ff3f';
export const HEADER_LOGO_BRANCH = 'refs/heads/release/header-logo-production-20261016';
export const HEADER_LOGO_PATHS = Object.freeze([
  'src/components/SiteHeader.tsx',
  'src/styles/globals.css',
  'scripts/test-brand-assets.mjs',
  'scripts/test-typography.mjs',
]);
export const HEADER_LOGO_TOOLING = Object.freeze([
  '.github/workflows/header-logo-release.yml',
  'scripts/header-logo-release.mjs',
  'scripts/test-header-logo-release.mjs',
]);
const root = fileURLToPath(new URL('../', import.meta.url));
const receiptPath = resolve(root, '.cache/visaflow/live-preview/receipt.json');
const scopePath = resolve(root, '.cache/visaflow/live-preview/header-logo-scope.json');
const flags = Object.freeze({ posts: true, communities: false, catchup: false });
const features = Object.freeze({ communities: 'false', catchup: 'false' });

export function verifyHeaderLogoSource(repository, { expectedSha, workflowSha, workflowRef, baselineSha = HEADER_LOGO_BASELINE } = {}) {
  assert.match(expectedSha ?? '', /^[a-f0-9]{40}$/, 'An immutable header-logo candidate SHA is required.');
  assert.equal(workflowSha, expectedSha, 'Workflow revision must be the exact requested candidate.');
  assert.equal(workflowRef, HEADER_LOGO_BRANCH, 'Only the dedicated header-logo branch may use this release.');
  const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const source = sourceProvenance(repository);
  assert.equal(source.gitSha, expectedSha, 'Checked-out source does not match the requested candidate.');
  assert.equal(source.dirty, false, 'Header-logo source must be committed and clean.');
  assert.notEqual(expectedSha, baselineSha, 'Header-logo candidate must contain reviewed changes.');
  git('merge-base', '--is-ancestor', baselineSha, expectedSha);
  git('merge-base', '--is-ancestor', expectedSha, 'refs/remotes/origin/main');
  const allowed = new Set([...HEADER_LOGO_PATHS, ...HEADER_LOGO_TOOLING]);
  const changedPaths = git('diff', '--name-only', '--no-renames', '-z', baselineSha, expectedSha).split('\0').filter(Boolean).sort();
  assert(changedPaths.some(path => path === 'src/components/SiteHeader.tsx'), 'No header-logo source change was found.');
  for (const path of changedPaths) {
    assert(allowed.has(path), `Non-logo change is forbidden: ${path}`);
    assert.match(git('ls-tree', expectedSha, '--', path), /^100644 blob [a-f0-9]{40}\t/, `Changed file must be a regular non-executable file: ${path}`);
  }
  for (const path of HEADER_LOGO_TOOLING) {
    assert.equal(git('rev-parse', `${expectedSha}:${path}`), git('rev-parse', `refs/remotes/origin/main:${path}`), `Release tooling must exactly match merged main: ${path}`);
  }
  return { schemaVersion: 1, baselineSha, candidateSha: source.gitSha, gitTree: source.gitTree, sourceSha256: source.sourceSha256, changedPaths };
}

export function verifyHeaderLogoBaseline(receipt, scope) {
  assert.equal(receipt?.health?.build?.gitSha, HEADER_LOGO_BASELINE, 'Live source changed; review this isolated logo release again.');
  assert.equal(receipt.health.build.dirty, false);
  assert.equal(scope.baselineSha, HEADER_LOGO_BASELINE);
  assert.equal(receipt.siteOrigin, LIVE_SITE);
  assert.equal(receipt.questionCount, 563);
  assert.equal(receipt.replyCount, 628);
}

function candidateScope() {
  assert.equal(process.env.ASSISTANT_ENABLED, 'true', 'Keep the existing production assistant enabled.');
  assert.equal(process.env.ASSISTANT_COMMUNITIES_ENABLED, 'false');
  assert.equal(process.env.ASSISTANT_CATCHUP_ENABLED, 'false');
  return verifyHeaderLogoSource(root, { expectedSha: process.env.HEADER_LOGO_CANDIDATE_SHA, workflowSha: process.env.GITHUB_SHA, workflowRef: process.env.GITHUB_REF });
}

async function verifyLiveFlags() {
  const response = await fetch(`${LIVE_SITE}/api/assistant?headerLogo=${Date.now()}`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200, 'Could not check existing assistant flags.');
  assert.equal(response.headers.get('x-visathreads-build'), HEADER_LOGO_BASELINE, 'Assistant flags belong to another live revision.');
  assert.deepEqual(await response.json(), flags, 'Existing assistant features changed; refuse to overwrite them.');
}

async function checkedScope() {
  const scope = candidateScope();
  assert.deepEqual(JSON.parse(await readFile(scopePath, 'utf8')), scope, 'Header-logo scope changed after capture.');
  verifyHeaderLogoBaseline(JSON.parse(await readFile(receiptPath, 'utf8')), scope);
  return scope;
}

export async function headerLogoRelease(command) {
  if (command === 'check-source') { console.log(JSON.stringify(candidateScope())); return; }
  const { captureFeatureBaseline, buildFeatureRelease, predeployFeatureCheck, verifyAssistantAcceptance } = await import('./production-feature-release.mjs');
  if (command === 'capture') {
    const scope = candidateScope(); await verifyLiveFlags(); await captureFeatureBaseline();
    verifyHeaderLogoBaseline(JSON.parse(await readFile(receiptPath, 'utf8')), scope);
    await writeFile(scopePath, `${JSON.stringify(scope, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  } else if (command === 'build') { await checkedScope(); await buildFeatureRelease('true', features); }
  else if (command === 'deploy-check') {
    const scope = await checkedScope();
    verifyAssistantAcceptance(JSON.parse(await readFile(resolve(root, '.cache/visaflow/assistant-acceptance.json'), 'utf8')), scope.candidateSha, features);
    await verifyLiveFlags(); await predeployFeatureCheck('true', features);
  } else throw new Error('Use check-source, capture, build or deploy-check. This helper does not deploy.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) headerLogoRelease(process.argv[2]).catch(error => { console.error(`Header-logo release blocked: ${error.message.split('\n')[0]}`); process.exitCode = 1; });

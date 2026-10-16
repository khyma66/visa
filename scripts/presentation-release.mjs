// A one-release, presentation-only path. The ordinary main/AI release gate is
// unchanged. This candidate must be merged, immutable and based on exact live
// source; no assistant, dependency, configuration or backend file may change.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sourceProvenance } from './build-provenance.mjs';
import { LIVE_SITE } from './live-preview-archive.mjs';

export const PRESENTATION_BASELINE = 'd03201df33eabfd6e7ad8311beac9b03bbcb510b';
export const PRESENTATION_BRANCH = 'refs/heads/codex/feed-typography-responsive-tabs';
export const PRESENTATION_PATHS = Object.freeze([
  'src/styles/globals.css',
  'src/components/CommunityHome.tsx',
  'src/components/RelatedQuestions.tsx',
  'src/components/TopicCollections.tsx',
  'src/components/ExploreCommunities.tsx',
  'src/components/NewsFeed.tsx',
  'src/components/OfficialNewsFeed.tsx',
  'src/components/TagDirectory.tsx',
  'src/components/QuestionDetail.tsx',
  'scripts/test-typography.mjs',
  'scripts/test-auth-presentation.mjs',
  'scripts/test-typography-pages.mjs',
  'scripts/test-feed-ui.mjs',
]);
export const PRESENTATION_TOOLING = Object.freeze([
  '.github/workflows/presentation-release.yml',
  'scripts/presentation-release.mjs',
  'scripts/test-presentation-release.mjs',
]);
const root = fileURLToPath(new URL('../', import.meta.url));
const receiptPath = resolve(root, '.cache/visaflow/live-preview/receipt.json');
const scopePath = resolve(root, '.cache/visaflow/live-preview/presentation-scope.json');
const flags = Object.freeze({ posts: true, communities: false, catchup: false });
const features = Object.freeze({ communities: 'false', catchup: 'false' });

// These files contain auth or posting behavior outside their presentation. Only
// the reviewed literal class/token changes are permitted, not arbitrary edits.
const restrictedReplacements = Object.freeze({
  'src/components/QuestionDetail.tsx': [
    ['className="mt-4 text-3xl font-normal text-slate-950"', 'className="mt-4 text-2xl font-semibold text-slate-950 sm:text-3xl"'],
    ['className="text-2xl font-black text-slate-950"', 'className="text-thread-title font-semibold text-slate-950"'],
    ['className="text-xl font-black text-slate-950"', 'className="text-thread-title font-semibold text-slate-950"'],
  ],
  'scripts/test-auth-presentation.mjs': [["assert(css.includes('--type-ui: 0.875rem;'));", "assert(css.includes('--type-ui: 1rem;'));"]],
});

export function verifyRestrictedPresentationChange(path, before, after) {
  const replacements = restrictedReplacements[path];
  if (!replacements) return;
  let expected = before;
  for (const [previous, next] of replacements) {
    assert.equal(expected.split(previous).length, 2, `Expected one reviewed presentation token: ${path}`);
    expected = expected.replace(previous, next);
  }
  assert.equal(after, expected, `Only the reviewed typography literals may change: ${path}`);
}

/** Options are explicit for isolated test repositories. The executable below
 * supplies only immutable workflow identity; baseline/branch/main are fixed. */
export function verifyPresentationSource(repository, { expectedSha, workflowSha, workflowRef, baselineSha = PRESENTATION_BASELINE } = {}) {
  assert.match(expectedSha ?? '', /^[a-f0-9]{40}$/, 'An immutable presentation candidate SHA is required.');
  assert.equal(workflowSha, expectedSha, 'Workflow revision must be the exact requested candidate.');
  assert.equal(workflowRef, PRESENTATION_BRANCH, 'Only the dedicated presentation branch may use this release.');
  const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const source = sourceProvenance(repository);
  assert.equal(source.gitSha, expectedSha, 'Checked-out source does not match the requested candidate.');
  assert.equal(source.dirty, false, 'Presentation source must be committed and clean.');
  assert.notEqual(expectedSha, baselineSha, 'Presentation candidate must contain reviewed changes.');
  git('merge-base', '--is-ancestor', baselineSha, expectedSha);
  // A normal merge retains this exact candidate as an ancestor. Squash/rebase
  // merges do not suffice: never substitute a different, unreviewed revision.
  git('merge-base', '--is-ancestor', expectedSha, 'refs/remotes/origin/main');
  const allowed = new Set([...PRESENTATION_PATHS, ...PRESENTATION_TOOLING]);
  const changedPaths = git('diff', '--name-only', '--no-renames', '-z', baselineSha, expectedSha).split('\0').filter(Boolean).sort();
  assert(changedPaths.length > 0 && changedPaths.some(path => path.startsWith('src/')), 'No presentation source change was found.');
  for (const path of changedPaths) {
    assert(allowed.has(path), `Non-presentation change is forbidden: ${path}`);
    assert.match(git('ls-tree', expectedSha, '--', path), /^100644 blob [a-f0-9]{40}\t/, `Changed file must be a regular non-executable file: ${path}`);
    if (restrictedReplacements[path]) verifyRestrictedPresentationChange(path, git('show', `${baselineSha}:${path}`), git('show', `${expectedSha}:${path}`));
  }
  for (const path of PRESENTATION_TOOLING) {
    assert.equal(git('rev-parse', `${expectedSha}:${path}`), git('rev-parse', `refs/remotes/origin/main:${path}`), `Release tooling must exactly match merged main: ${path}`);
  }
  return { schemaVersion: 1, baselineSha, candidateSha: source.gitSha, gitTree: source.gitTree, sourceSha256: source.sourceSha256, changedPaths };
}

export function verifyPresentationBaseline(receipt, scope) {
  assert.equal(receipt?.health?.build?.gitSha, PRESENTATION_BASELINE, 'Live source changed; this isolated presentation release must be reviewed again.');
  assert.equal(receipt.health.build.dirty, false);
  assert.equal(scope.baselineSha, PRESENTATION_BASELINE);
  assert.equal(receipt.siteOrigin, LIVE_SITE);
  assert.equal(receipt.questionCount, 563);
  assert.equal(receipt.replyCount, 628);
}

function candidateScope() {
  assert.equal(process.env.ASSISTANT_ENABLED, 'true', 'Keep the existing production assistant enabled.');
  assert.equal(process.env.ASSISTANT_COMMUNITIES_ENABLED, 'false');
  assert.equal(process.env.ASSISTANT_CATCHUP_ENABLED, 'false');
  return verifyPresentationSource(root, {
    expectedSha: process.env.PRESENTATION_CANDIDATE_SHA,
    workflowSha: process.env.GITHUB_SHA,
    workflowRef: process.env.GITHUB_REF,
  });
}

async function verifyLiveFlags() {
  const response = await fetch(`${LIVE_SITE}/api/assistant?presentation=${Date.now()}`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200, 'Could not check existing assistant flags.');
  assert.equal(response.headers.get('x-visathreads-build'), PRESENTATION_BASELINE, 'Assistant flags belong to another live revision.');
  assert.deepEqual(await response.json(), flags, 'Existing assistant features changed; refuse to overwrite them.');
}

async function checkedScope() {
  const scope = candidateScope();
  assert.deepEqual(JSON.parse(await readFile(scopePath, 'utf8')), scope, 'Presentation scope changed after capture.');
  verifyPresentationBaseline(JSON.parse(await readFile(receiptPath, 'utf8')), scope);
  return scope;
}

export async function presentationRelease(command) {
  if (command === 'check-source') {
    console.log(JSON.stringify(candidateScope()));
    return;
  }
  // Keep check-source dependency-free so it runs before npm install/credentials.
  const { captureFeatureBaseline, buildFeatureRelease, predeployFeatureCheck, verifyAssistantAcceptance } = await import('./production-feature-release.mjs');
  if (command === 'capture') {
    const scope = candidateScope();
    await verifyLiveFlags();
    await captureFeatureBaseline();
    verifyPresentationBaseline(JSON.parse(await readFile(receiptPath, 'utf8')), scope);
    await writeFile(scopePath, `${JSON.stringify(scope, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  } else if (command === 'build') {
    await checkedScope();
    await buildFeatureRelease('true', features);
  } else if (command === 'deploy-check') {
    const scope = await checkedScope();
    // Same complete hosted acceptance used by this exact deployed assistant,
    // bound to this candidate SHA, three samples per case and cleanup required.
    verifyAssistantAcceptance(JSON.parse(await readFile(resolve(root, '.cache/visaflow/assistant-acceptance.json'), 'utf8')), scope.candidateSha, features);
    await verifyLiveFlags();
    // The separate narrow branch proof replaces ONLY the ordinary main-branch
    // requirement. All unchanged-live, archive and build checks are reused.
    await predeployFeatureCheck('true', features);
  } else {
    throw new Error('Use check-source, capture, build or deploy-check. This helper does not deploy.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  presentationRelease(process.argv[2]).catch(error => {
    console.error(`Presentation release blocked: ${error.message.split('\n')[0]}`);
    process.exitCode = 1;
  });
}

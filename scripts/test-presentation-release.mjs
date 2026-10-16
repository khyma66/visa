import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PRESENTATION_BASELINE, PRESENTATION_BRANCH, PRESENTATION_PATHS, PRESENTATION_TOOLING, verifyPresentationSource, verifyPresentationBaseline, verifyRestrictedPresentationChange } from './presentation-release.mjs';

async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), 'visa-presentation-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = async (path, text = 'fixture\n') => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); };
  const commit = () => { git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  git('init', '-q');
  await put('src/styles/globals.css', 'body { font-size: 16px; }\n');
  await put('src/lib/assistant-core.ts', 'protected assistant source\n');
  await put('package.json', '{}\n');
  await put('wrangler.jsonc', '{}\n');
  const baselineSha = commit();
  await put('src/styles/globals.css', 'body { font-size: 17px; }\n');
  for (const path of PRESENTATION_TOOLING) await put(path);
  const expectedSha = commit();
  git('update-ref', 'refs/remotes/origin/main', expectedSha);
  const options = { expectedSha, workflowSha: expectedSha, workflowRef: PRESENTATION_BRANCH, baselineSha };
  const verify = (changes = {}) => verifyPresentationSource(root, { ...options, ...changes });
  return { root, git, put, commit, options, verify };
}

test('exact clean merged presentation candidate is accepted with a recorded path scope', async t => {
  const f = await repository(t);
  const receipt = f.verify();
  assert.equal(receipt.candidateSha, f.options.expectedSha);
  assert.equal(receipt.baselineSha, f.options.baselineSha);
  assert.deepEqual(receipt.changedPaths, [...PRESENTATION_TOOLING, 'src/styles/globals.css'].sort());
  assert.match(receipt.sourceSha256, /^[a-f0-9]{64}$/);
});

test('candidate, workflow revision and dedicated branch must match exactly', async t => {
  const f = await repository(t);
  for (const changes of [{ expectedSha: 'main' }, { workflowSha: 'f'.repeat(40) }, { workflowRef: 'refs/heads/main' }, { workflowRef: 'refs/heads/unreviewed' }, { expectedSha: 'f'.repeat(40), workflowSha: 'f'.repeat(40) }]) {
    assert.throws(() => f.verify(changes));
  }
});

test('dirty or untracked source is rejected', async t => {
  const f = await repository(t);
  await f.put('src/styles/globals.css', 'uncommitted\n');
  assert.throws(() => f.verify(), /committed and clean/);
  f.git('restore', 'src/styles/globals.css');
  await f.put('untracked.txt');
  assert.throws(() => f.verify(), /committed and clean/);
});

test('candidate must already be merged into main and retain the captured live ancestry', async t => {
  const f = await repository(t);
  f.git('update-ref', 'refs/remotes/origin/main', f.options.baselineSha);
  assert.throws(() => f.verify());
  f.git('update-ref', 'refs/remotes/origin/main', f.options.expectedSha);
  assert.throws(() => f.verify({ baselineSha: 'f'.repeat(40) }));
});

test('every non-presentation path, including assistant, dependency and config changes, is forbidden', async t => {
  for (const path of ['src/lib/assistant-core.ts', 'src/components/AssistantPanel.tsx', 'scripts/assistant-acceptance-fixtures.ts', 'scripts/evaluate-hosted-assistant.mjs', 'scripts/production-feature-release.mjs', '.github/workflows/production-features.yml', 'package.json', 'package-lock.json', 'wrangler.jsonc', 'src/app/api/assistant/route.ts', 'src/data/api-archive.json', 'src/lib/supabase/client.ts']) {
    await t.test(path, async inner => {
      const f = await repository(inner);
      await f.put(path, 'unauthorized change\n');
      const sha = f.commit();
      f.git('update-ref', 'refs/remotes/origin/main', sha);
      assert.throws(() => f.verify({ expectedSha: sha, workflowSha: sha }), /Non-presentation change is forbidden/);
    });
  }
});

test('deleted, executable and symbolic-link presentation paths are rejected', async t => {
  for (const change of ['delete', 'executable', 'symlink']) {
    await t.test(change, async inner => {
      const f = await repository(inner);
      const file = join(f.root, 'src/styles/globals.css');
      if (change === 'executable') { await chmod(file, 0o755); f.git('update-index', '--chmod=+x', 'src/styles/globals.css'); }
      else { await rm(file); if (change === 'symlink') await symlink('../lib/assistant-core.ts', file); }
      const sha = f.commit();
      f.git('update-ref', 'refs/remotes/origin/main', sha);
      assert.throws(() => f.verify({ expectedSha: sha, workflowSha: sha }), /regular non-executable file/);
    });
  }
});

test('main must retain the exact reviewed release tooling even if its app moves forward', async t => {
  const f = await repository(t);
  await f.put('src/lib/assistant-core.ts', 'newer main-only assistant change\n');
  const mainSha = f.commit();
  f.git('update-ref', 'refs/remotes/origin/main', mainSha);
  f.git('checkout', '--detach', f.options.expectedSha);
  assert.equal(f.verify().candidateSha, f.options.expectedSha);
  f.git('checkout', '--detach', mainSha);
  await f.put('scripts/presentation-release.mjs', 'changed release guard\n');
  f.git('update-ref', 'refs/remotes/origin/main', f.commit());
  f.git('checkout', '--detach', f.options.expectedSha);
  assert.throws(() => f.verify(), /Release tooling must exactly match merged main/);
});

test('live baseline and content counts are pinned rather than inferred from available credentials', () => {
  const receipt = { health: { build: { gitSha: PRESENTATION_BASELINE, dirty: false } }, siteOrigin: 'https://visathreads.com', questionCount: 563, replyCount: 628 };
  const scope = { baselineSha: PRESENTATION_BASELINE };
  verifyPresentationBaseline(receipt, scope);
  for (const change of [{ siteOrigin: 'https://visa-central.com' }, { questionCount: 42 }, { replyCount: 627 }, { health: { build: { gitSha: 'f'.repeat(40), dirty: false } } }, { health: { build: { gitSha: PRESENTATION_BASELINE, dirty: true } } }]) assert.throws(() => verifyPresentationBaseline({ ...receipt, ...change }, scope));
  assert.throws(() => verifyPresentationBaseline(receipt, { baselineSha: 'f'.repeat(40) }));
});

test('question detail allows only the three reviewed heading classes, never auth or posting changes', () => {
  const before = '<h1 className="mt-4 text-3xl font-normal text-slate-950">Title</h1>\n<h2 className="text-2xl font-black text-slate-950">Replies</h2>\n<h2 className="text-xl font-black text-slate-950">Your answer</h2>\nif (!user) return login();';
  const after = before.replace('mt-4 text-3xl font-normal text-slate-950', 'mt-4 text-2xl font-semibold text-slate-950 sm:text-3xl').replace('text-2xl font-black text-slate-950', 'text-thread-title font-semibold text-slate-950').replace('text-xl font-black text-slate-950', 'text-thread-title font-semibold text-slate-950');
  verifyRestrictedPresentationChange('src/components/QuestionDetail.tsx', before, after);
  assert.throws(() => verifyRestrictedPresentationChange('src/components/QuestionDetail.tsx', before, after.replace('if (!user)', 'if (false)')), /Only the reviewed typography literals/);
  assert.throws(() => verifyRestrictedPresentationChange('src/components/QuestionDetail.tsx', before, `${after}\nsubmitWithoutValidation();`), /Only the reviewed typography literals/);
});

test('auth presentation test permits only its expected font token, keeping all auth assertions intact', () => {
  const before = "assert(css.includes('--type-ui: 0.875rem;'));\nassert(authIsRequired);";
  const after = before.replace('--type-ui: 0.875rem;', '--type-ui: 1rem;');
  verifyRestrictedPresentationChange('scripts/test-auth-presentation.mjs', before, after);
  assert.throws(() => verifyRestrictedPresentationChange('scripts/test-auth-presentation.mjs', before, after.replace('assert(authIsRequired);', '')), /Only the reviewed typography literals/);
});

test('push trigger is limited to the dedicated branch and workflow path with immutable SHA fallback', async () => {
  const workflow = await readFile(new URL('../.github/workflows/presentation-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /push:\n\s+branches: \[codex\/feed-typography-responsive-tabs\]\n\s+paths: \[\.github\/workflows\/presentation-release\.yml\]/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/codex\/feed-typography-responsive-tabs' && \(github\.event_name == 'push' \|\| \(github\.event_name == 'workflow_dispatch' && inputs\.candidate_sha == github\.sha\)\)/);
  assert.match(workflow, /PRESENTATION_CANDIDATE_SHA: \$\{\{ inputs\.candidate_sha \|\| github\.sha \}\}/);
  // A failed pre-install source check must not cause always-cleanup to acquire
  // credentials. Cleanup runs only if the inference step actually ran.
  assert.match(workflow, /name: Ensure temporary evaluation Worker is removed\n\s+if: always\(\) && \(steps\.evaluate\.outcome == 'success' \|\| steps\.evaluate\.outcome == 'failure'\)/);
  assert.match(workflow, /name: Evaluate unchanged hosted assistant with all three samples per case\n\s+id: evaluate/);
});

test('release workflow keeps full model acceptance, exact provenance, archive, smoke and owned rollback', async () => {
  const workflow = await readFile(new URL('../.github/workflows/presentation-release.yml', import.meta.url), 'utf8');
  const helper = await readFile(new URL('./presentation-release.mjs', import.meta.url), 'utf8');
  assert.match(workflow, /group: visaflow-production\n\s+cancel-in-progress: false/);
  assert.match(workflow, /inputs\.candidate_sha == github\.sha/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /persist-credentials: false/);
  for (const command of ['npm run check:secrets && npm test && npm run typecheck', 'npm audit --audit-level=high', 'scripts/evaluate-hosted-assistant.mjs', 'scripts/presentation-release.mjs deploy-check', 'scripts/production-feature-release.mjs record-deployment', 'scripts/smoke-production-features.mjs', 'scripts/production-feature-release.mjs rollback-version', 'scripts/evaluate-hosted-assistant.mjs --cleanup']) assert(workflow.includes(command), command);
  assert(workflow.indexOf('presentation-release.mjs check-source') < workflow.indexOf('run: npm ci'));
  assert(workflow.indexOf('presentation-release.mjs deploy-check') < workflow.indexOf('vinext-cloudflare deploy'));
  assert.match(helper, /verifyAssistantAcceptance\([\s\S]*?scope\.candidateSha, features\)/);
  assert.match(helper, /await predeployFeatureCheck\('true', features\)/);
  assert(!PRESENTATION_PATHS.some(path => /assistant|auth|api\/|package|wrangler/.test(path) && path !== 'scripts/test-auth-presentation.mjs'));
  assert(!PRESENTATION_PATHS.includes('.github/workflows/production-features.yml'));
  assert(!workflow.includes('deploy:dev'));
});

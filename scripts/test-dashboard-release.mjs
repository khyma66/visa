import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DASHBOARD_BASELINE, DASHBOARD_BRANCH, DASHBOARD_TOOLING, verifyDashboardSource, verifyDashboardBaseline, verifyDashboardRuntime, verifyRestrictedDashboardChange } from './dashboard-release.mjs';

async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), 'visa-dashboard-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = async (path, value = 'fixture\n') => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), value); };
  const commit = () => { git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  git('init', '-q');
  await put('src/lib/assistant-core.ts', 'protected assistant source\n');
  await put('src/middleware.ts', 'sensitive=/(login|owner|feedback|assistant)/; requireLaunchApproval();\n');
  await put('package.json', JSON.stringify({ scripts: { test: 'node --test previous.mjs' }, dependencies: { original: '1.0.0' } }));
  await put('wrangler.jsonc', '{}\n');
  const baselineSha = commit();
  await put('src/app/admin/analytics/page.tsx');
  for (const path of DASHBOARD_TOOLING) await put(path);
  const expectedSha = commit();
  git('update-ref', 'refs/remotes/origin/main', expectedSha);
  const options = { expectedSha, workflowSha: expectedSha, workflowRef: DASHBOARD_BRANCH, baselineSha };
  return { root, git, put, commit, options, verify: (changes = {}) => verifyDashboardSource(root, { ...options, ...changes }) };
}

test('exact clean merged dashboard candidate records its narrow source scope', async t => {
  const f = await repository(t);
  const receipt = f.verify();
  assert.equal(receipt.candidateSha, f.options.expectedSha);
  assert.equal(receipt.baselineSha, f.options.baselineSha);
  assert.deepEqual(receipt.changedPaths, [...DASHBOARD_TOOLING, 'src/app/admin/analytics/page.tsx'].sort());
  assert.match(receipt.sourceSha256, /^[a-f0-9]{64}$/);
});

test('candidate, workflow revision, dedicated branch and merged ancestry must match', async t => {
  const f = await repository(t);
  for (const changes of [{ expectedSha: 'main' }, { workflowSha: 'f'.repeat(40) }, { workflowRef: 'refs/heads/main' }, { workflowRef: 'refs/heads/unreviewed' }, { baselineSha: 'f'.repeat(40) }]) assert.throws(() => f.verify(changes));
  f.git('update-ref', 'refs/remotes/origin/main', f.options.baselineSha);
  assert.throws(() => f.verify());
});

test('dirty and untracked candidates are rejected', async t => {
  const f = await repository(t);
  await f.put('untracked.txt');
  assert.throws(() => f.verify(), /committed and clean/);
  await rm(join(f.root, 'untracked.txt'));
  await f.put('src/app/admin/analytics/page.tsx', 'uncommitted\n');
  assert.throws(() => f.verify(), /committed and clean/);
});

test('assistant, dependencies, scheduled jobs, client/auth code and existing guards cannot change', async t => {
  for (const path of ['src/lib/assistant-core.ts', 'src/components/AssistantPanel.tsx', 'src/app/api/assistant/route.ts', 'src/components/SiteHeader.tsx', 'src/components/FeedbackInbox.tsx', 'src/lib/supabase/client.ts', 'src/data/api-archive.json', 'wrangler.jsonc', 'package-lock.json', 'src/worker.ts', 'scripts/production-feature-release.mjs', 'scripts/evaluate-groq-assistant.mjs', '.github/workflows/production-features.yml', 'docs/release-review.json', 'supabase/migrations/other.sql']) {
    await t.test(path, async inner => {
      const f = await repository(inner); await f.put(path, 'unauthorized\n');
      const sha = f.commit(); f.git('update-ref', 'refs/remotes/origin/main', sha);
      assert.throws(() => f.verify({ expectedSha: sha, workflowSha: sha }), /Non-dashboard change is forbidden/);
    });
  }
});

test('deleted, executable or linked allowed paths cannot be released', async t => {
  for (const kind of ['delete', 'executable', 'symlink']) await t.test(kind, async inner => {
    const f = await repository(inner); const path = join(f.root, 'scripts/dashboard-release.mjs');
    if (kind === 'executable') { await chmod(path, 0o755); f.git('update-index', '--chmod=+x', 'scripts/dashboard-release.mjs'); }
    else { await rm(path); if (kind === 'symlink') await symlink('../src/lib/assistant-core.ts', path); }
    const sha = f.commit(); f.git('update-ref', 'refs/remotes/origin/main', sha);
    assert.throws(() => f.verify({ expectedSha: sha, workflowSha: sha }), /regular non-executable file/);
  });
});

test('main must retain exact reviewed guard blobs even if unrelated main work advances', async t => {
  const f = await repository(t);
  await f.put('src/lib/assistant-core.ts', 'new main-only work\n');
  const main = f.commit(); f.git('update-ref', 'refs/remotes/origin/main', main); f.git('checkout', '--detach', f.options.expectedSha);
  assert.equal(f.verify().candidateSha, f.options.expectedSha);
  f.git('checkout', '--detach', main); await f.put('scripts/dashboard-release.mjs', 'changed guard\n');
  f.git('update-ref', 'refs/remotes/origin/main', f.commit()); f.git('checkout', '--detach', f.options.expectedSha);
  assert.throws(() => f.verify(), /Release tooling must exactly match merged main/);
});

test('middleware can only add admin to the private-route expression', () => {
  const before = 'sensitive=/(login|owner|feedback|assistant)/; requireLaunchApproval();';
  const after = before.replace('|assistant)', '|assistant|admin)');
  verifyRestrictedDashboardChange('src/middleware.ts', before, after);
  assert.throws(() => verifyRestrictedDashboardChange('src/middleware.ts', before, after.replace('requireLaunchApproval();', '')), /Only admin noindex/);
  assert.throws(() => verifyRestrictedDashboardChange('src/middleware.ts', before, after.replace('login|', '')), /Only admin noindex/);
});

test('package change is exactly additive analytics tests with no dependency or release edits', () => {
  const before = { scripts: { test: 'node --test previous.mjs', deploy: 'guarded-release' }, dependencies: { original: '1.0.0' } };
  const after = structuredClone(before);
  after.scripts['test:analytics'] = 'node --test scripts/test-analytics.mjs scripts/test-search-visibility.mjs';
  after.scripts.test += ' && npm run test:analytics';
  verifyRestrictedDashboardChange('package.json', JSON.stringify(before), JSON.stringify(after));
  for (const mutate of [v => { v.dependencies.original = '2.0.0'; }, v => { v.scripts.deploy = 'unprotected'; }, v => { v.scripts.test = 'true'; }, v => { v.scripts['test:analytics'] = 'true'; }]) {
    const changed = structuredClone(after); mutate(changed);
    assert.throws(() => verifyRestrictedDashboardChange('package.json', JSON.stringify(before), JSON.stringify(changed)), /Only the analytics test script/);
  }
});

test('baseline source, destinations and existing archive counts are pinned', () => {
  const receipt = { health: { build: { gitSha: DASHBOARD_BASELINE, dirty: false } }, siteOrigin: 'https://visathreads.com', databaseOrigin: 'https://cycnichledvqbxevrwnt.supabase.co', worker: 'visaflow-dev', questionCount: 563, replyCount: 628 };
  const scope = { baselineSha: DASHBOARD_BASELINE };
  verifyDashboardBaseline(receipt, scope);
  for (const change of [{ siteOrigin: 'https://visa-central.com' }, { databaseOrigin: 'https://ppdwysmeistjxzjpmxyk.supabase.co' }, { worker: 'visaflow' }, { questionCount: 42 }, { replyCount: 627 }, { health: { build: { gitSha: 'f'.repeat(40), dirty: false } } }, { health: { build: { gitSha: DASHBOARD_BASELINE, dirty: true } } }]) assert.throws(() => verifyDashboardBaseline({ ...receipt, ...change }, scope));
});

function runtime() {
  const vars = { APP_ENV: 'development', PUBLIC_LAUNCH_APPROVED: 'false', IMPORTED_CONTENT_APPROVED: 'false', APIFY_LIVE_FETCH_ENABLED: 'false', COMMUNITY_SOURCE_MODE: 'snapshot', NEXT_PUBLIC_SITE_URL: 'https://visathreads.com', NEXT_PUBLIC_SUPABASE_URL: 'https://cycnichledvqbxevrwnt.supabase.co', ASSISTANT_PROVIDER: 'groq', ASSISTANT_ENABLED: 'true', ASSISTANT_COMMUNITIES_ENABLED: 'false', ASSISTANT_CATCHUP_ENABLED: 'false', ASSISTANT_PROJECT_REF: 'cycnichledvqbxevrwnt' };
  return { bindings: [...Object.entries(vars).map(([name, text]) => ({ name, text, type: 'plain_text' })), { name: 'GROQ_API_KEY', type: 'secret_text' }] };
}

test('runtime proof preserves provider, flags, project, secret storage and stopped schedules', () => {
  verifyDashboardRuntime(runtime(), { schedules: [] });
  for (const name of ['APP_ENV', 'PUBLIC_LAUNCH_APPROVED', 'APIFY_LIVE_FETCH_ENABLED', 'ASSISTANT_PROVIDER', 'ASSISTANT_ENABLED', 'NEXT_PUBLIC_SUPABASE_URL']) {
    const changed = runtime(); changed.bindings.find(row => row.name === name).text = 'changed';
    assert.throws(() => verifyDashboardRuntime(changed, { schedules: [] }), /Existing runtime setting changed/);
  }
  assert.throws(() => verifyDashboardRuntime(runtime(), { schedules: [{ cron: '0 * * * *' }] }), /Schedules must remain stopped/);
  assert.throws(() => verifyDashboardRuntime(runtime(), {}), /Schedules must remain stopped/);
  const missing = runtime(); missing.bindings = missing.bindings.filter(row => row.name !== 'GROQ_API_KEY');
  assert.throws(() => verifyDashboardRuntime(missing, { schedules: [] }), /secret must remain/);
  const leaked = runtime(); leaked.bindings.push({ name: 'GROQ_API_KEY', type: 'plain_text', text: 'fixture-only' });
  assert.throws(() => verifyDashboardRuntime(leaked, { schedules: [] }), /stored secrets/);
});

test('workflow is manual, merged-source gated, full-acceptance preserving and rollback protected', async () => {
  const workflow = await readFile(new URL('../.github/workflows/dashboard-release.yml', import.meta.url), 'utf8');
  const helper = await readFile(new URL('./dashboard-release.mjs', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/); assert(!/^\s*(schedule|push):/m.test(workflow));
  assert.match(workflow, /inputs\.candidate_sha == github\.sha/);
  assert.match(workflow, /group: visaflow-production\n\s+cancel-in-progress: false/);
  assert.match(workflow, /environment: production/); assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /ASSISTANT_PROVIDER: 'groq'/);
  for (const command of ['npm run check:secrets && npm test && npm run typecheck', 'npm audit --audit-level=high', 'scripts/evaluate-groq-assistant.mjs --release', 'scripts/dashboard-release.mjs deploy-check', 'scripts/production-feature-release.mjs record-deployment', 'scripts/smoke-production-features.mjs', 'scripts/smoke-dashboard-release.mjs', 'scripts/production-feature-release.mjs rollback-version', 'scripts/evaluate-groq-assistant.mjs --cleanup']) assert(workflow.includes(command), command);
  assert(workflow.indexOf('dashboard-release.mjs check-source') < workflow.indexOf('run: npm ci'));
  assert(workflow.indexOf('dashboard-release.mjs deploy-check') < workflow.indexOf('vinext-cloudflare deploy'));
  assert.match(helper, /verifyAssistantAcceptance\([\s\S]*?scope\.candidateSha, features\)/);
  assert.match(helper, /await predeployFeatureCheck\('true', features\)/);
  assert.match(workflow, /name: Restore isolated evaluation routing\n\s+if: always\(\) && \(steps\.evaluate\.outcome == 'success' \|\| steps\.evaluate\.outcome == 'failure'\)/);
  assert(!workflow.includes('deploy:dev')); assert(!workflow.includes('visa-central.com'));
});

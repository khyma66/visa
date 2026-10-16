import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { HEADER_LOGO_BASELINE, HEADER_LOGO_BRANCH, HEADER_LOGO_PATHS, HEADER_LOGO_TOOLING, verifyHeaderLogoBaseline } from './header-logo-release.mjs';

test('header-logo release remains a narrow production-only path', async () => {
  const workflow = await readFile(new URL('../.github/workflows/header-logo-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /branches: \[release\/header-logo-production-20261016\]/);
  assert.match(workflow, /inputs\.candidate_sha == github\.sha/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /persist-credentials: false/);
  for (const command of ['header-logo-release.mjs check-source', 'scripts/evaluate-hosted-assistant.mjs', 'header-logo-release.mjs deploy-check', 'scripts/smoke-production-features.mjs', 'scripts/production-feature-release.mjs rollback-version']) assert(workflow.includes(command), command);
  assert(!workflow.includes('visa-central.com'));
  assert(!workflow.includes('deploy:dev'));
  assert.equal(HEADER_LOGO_PATHS.length, 4);
  assert.equal(HEADER_LOGO_TOOLING.length, 3);
});

test('the checked live baseline is pinned with imported content counts', () => {
  const receipt = { health: { build: { gitSha: HEADER_LOGO_BASELINE, dirty: false } }, siteOrigin: 'https://visathreads.com', questionCount: 563, replyCount: 628 };
  verifyHeaderLogoBaseline(receipt, { baselineSha: HEADER_LOGO_BASELINE });
  assert.throws(() => verifyHeaderLogoBaseline({ ...receipt, questionCount: 562 }, { baselineSha: HEADER_LOGO_BASELINE }));
  assert.equal(HEADER_LOGO_BRANCH, 'refs/heads/release/header-logo-production-20261016');
});

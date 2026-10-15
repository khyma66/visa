import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { archiveSource } from './archive-source.mjs';
import { checkedLiveArchive, LIVE_SITE, LIVE_DATABASE, sha256 } from './live-preview-archive.mjs';
import { featureEnvironment, verifyFeatureWorker, verifyAssistantAcceptance, verifyExistingLiveProvenance, verifySourceAncestry, uploadedFeatureVersion, verifyCurrentFeatureDeployment, snapshotFeatureBuildProvenance, readFeatureBuildProvenance } from './production-feature-release.mjs';
import { buildProvenance, sourceProvenance } from './build-provenance.mjs';
import { assertHealthProvenance } from './smoke-site.mjs';
import { archiveFromWorkerModule, recoverWorkerArchive, canonicalJson, publishedArchive } from './recover-worker-archive.mjs';

const values = { NEXT_PUBLIC_SITE_URL: LIVE_SITE, NEXT_PUBLIC_SUPABASE_URL: LIVE_DATABASE, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'fixture'.repeat(5)}` };
const config = enabled => ({ name: 'visaflow-dev', routes: ['visathreads.com', 'www.visathreads.com'].map(pattern => ({ pattern, custom_domain: true })), vars: featureEnvironment(values, enabled), ai: { binding: 'ASSISTANT_AI' } });

test('only the independently identified legacy version may omit a site origin', () => {
  const health = { environment: 'development', releaseStatus: 'configured', build: { gitSha: '0624c651cb252436c47c5f2b020baecfec0bfbd0', gitTree: '1e67b513d22bd843ddcb587548feb68e71f0ef92', sourceSha256: '2b0809b06597008d2f9b911ec76b13648cfb3cefd271bdbe20809c2826762ea7', dirty: false, siteOrigin: null } };
  const deployment = { id: '82f636de-0d17-4625-9510-4480c11dc8e0', versions: [{ version_id: '879503b4-e947-420e-8ad8-e1f2f7082ae5', percentage: 100 }] };
  verifyExistingLiveProvenance(health, deployment);
  verifyExistingLiveProvenance(health, { ...deployment, id: '5763d137-9c62-4646-a35b-efbe947cfe65' });
  assert.throws(() => verifyExistingLiveProvenance(health, { ...deployment, id: 'unobserved-deployment' }));
  verifyExistingLiveProvenance({ ...health, build: { ...health.build, gitSha: 'a'.repeat(40), siteOrigin: LIVE_SITE } }, deployment);
  for (const change of [{ gitSha: 'a'.repeat(40) }, { gitTree: 'b'.repeat(40) }, { sourceSha256: 'c'.repeat(64) }, { dirty: true }, { siteOrigin: undefined }, { siteOrigin: '' }, { siteOrigin: 'https://visa-central.com' }]) assert.throws(() => verifyExistingLiveProvenance({ ...health, build: { ...health.build, ...change } }, deployment));
  for (const changed of [{ versions: [{ version_id: '11111111-1111-1111-1111-111111111111', percentage: 100 }] }, { versions: [{ ...deployment.versions[0], percentage: 50 }] }, { versions: [...deployment.versions, deployment.versions[0]] }]) assert.throws(() => verifyExistingLiveProvenance(health, changed));
  assert.throws(() => verifyExistingLiveProvenance({ ...health, environment: 'production' }, deployment));
});

test('an unavailable original commit requires exact tracked-source fingerprint in current ancestry', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'visa-source-parity-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Isolated test');
    await writeFile(resolve(root, 'app.js'), 'original source'); git('add', 'app.js'); git('commit', '-m', 'original');
    const original = sourceProvenance(root);
    await writeFile(resolve(root, 'app.js'), 'original source plus features'); git('add', 'app.js'); git('commit', '-m', 'features');
    assert.equal(verifySourceAncestry(root, original).method, 'git-ancestor');
    const unpushed = { ...original, gitSha: 'f'.repeat(40) };
    const recovered = verifySourceAncestry(root, unpushed);
    assert.equal(recovered.method, 'exact-source-fingerprint');
    assert.equal(recovered.ancestor, original.gitSha);
    assert.throws(() => verifySourceAncestry(root, { ...unpushed, sourceSha256: 'e'.repeat(64) }), /no exact tracked-source fingerprint/);
    assert.throws(() => verifySourceAncestry(root, { ...unpushed, sourceSha256: undefined }), /fingerprint is missing/);
    const legacy = { gitSha: '0624c651cb252436c47c5f2b020baecfec0bfbd0', gitTree: '1e67b513d22bd843ddcb587548feb68e71f0ef92', sourceSha256: '2b0809b06597008d2f9b911ec76b13648cfb3cefd271bdbe20809c2826762ea7', dirty: false };
    const baseline = { deploymentId: '82f636de-0d17-4625-9510-4480c11dc8e0', previousVersion: '879503b4-e947-420e-8ad8-e1f2f7082ae5', worker: 'visaflow-dev', siteOrigin: LIVE_SITE, databaseOrigin: LIVE_DATABASE };
    const transition = verifySourceAncestry(root, legacy, baseline);
    assert.equal(transition.method, 'pinned-legacy-replacement');
    assert.equal(transition.sourceEquivalence, 'not-established');
    const rollbackTransition = verifySourceAncestry(root, legacy, { ...baseline, deploymentId: '5763d137-9c62-4646-a35b-efbe947cfe65' });
    assert.equal(rollbackTransition.previousDeployment, '5763d137-9c62-4646-a35b-efbe947cfe65');
    assert.throws(() => verifySourceAncestry(root, legacy));
    for (const change of [{ previousVersion: '11111111-1111-1111-1111-111111111111' }, { deploymentId: '22222222-2222-2222-2222-222222222222' }, { worker: 'visathreads-sandbox' }, { siteOrigin: 'https://visa-central.com' }]) assert.throws(() => verifySourceAncestry(root, legacy, { ...baseline, ...change }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('existing preview feature configuration preserves launch gates and production-only AI', () => {
  for (const enabled of ['true', 'false']) {
    const env = featureEnvironment(values, enabled);
    assert.equal(env.PUBLIC_LAUNCH_APPROVED, 'false');
    assert.equal(env.NEXT_PUBLIC_APP_ENV, 'development');
    assert.equal(env.ASSISTANT_COMMUNITIES_ENABLED, 'false');
    assert.equal(env.ASSISTANT_CATCHUP_ENABLED, 'false');
    verifyFeatureWorker(config(enabled), enabled);
  }
  for (const change of [{ NEXT_PUBLIC_SITE_URL: 'https://visa-central.com' }, { NEXT_PUBLIC_SUPABASE_URL: 'https://ppdwysmeistjxzjpmxyk.supabase.co' }, { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_rejected' }]) assert.throws(() => featureEnvironment({ ...values, ...change }, 'true'));
  assert.throws(() => featureEnvironment(values, 'unexpected'));
  const all = featureEnvironment(values, 'true', { communities: 'true', catchup: 'true' });
  verifyFeatureWorker({ ...config('true'), vars: all }, 'true', { communities: 'true', catchup: 'true' });
  assert.throws(() => featureEnvironment(values, 'false', { catchup: 'true' }));
});

test('feature deployment rejects target swaps, public launch and additional AI modes', () => {
  for (const mutate of [
    value => { value.name = 'visathreads-sandbox'; },
    value => { value.routes[0].pattern = 'visa-central.com'; },
    value => { value.routes.push({ pattern: 'attacker.invalid', custom_domain: true }); },
    value => { value.vars.NEXT_PUBLIC_SUPABASE_URL = 'https://ppdwysmeistjxzjpmxyk.supabase.co'; },
    value => { value.vars.PUBLIC_LAUNCH_APPROVED = 'true'; },
    value => { value.vars.IMPORTED_CONTENT_APPROVED = 'true'; },
    value => { value.vars.APP_ENV = 'production'; },
    value => { value.vars.ASSISTANT_COMMUNITIES_ENABLED = 'true'; },
    value => { value.vars.ASSISTANT_CATCHUP_ENABLED = 'true'; },
    value => { value.vars.APIFY_LIVE_FETCH_ENABLED = 'true'; },
    value => { value.ai = { binding: 'UNEXPECTED' }; },
  ]) { const changed = config('true'); mutate(changed); assert.throws(() => verifyFeatureWorker(changed, 'true')); }
});

test('Worker archive recovery interprets only static literals and never executes downloaded code', async () => {
  const fixture = { questions: [{ id: 'apify-example', body: 'Original text', answer_count: 2 }], answersByQuestionId: { 'apify-example': [{ id: 'one', question_id: 'apify-example', status: 'active' }, { id: 'one', question_id: 'apify-example', status: 'archived' }] }, source: { name: 'Synthetic test' }, fetchedAt: '2026-10-14T00:00:00Z' };
  const js = `var a=${JSON.stringify(fixture)};throw new Error('never execute');export{a as archive};`;
  assert.equal(canonicalJson(archiveFromWorkerModule(js)), canonicalJson(fixture));
  assert.equal(archiveFromWorkerModule('var a=(()=>{throw Error("neverexecute")})();var answersByQuestionId={};'), null);
  assert.equal(archiveFromWorkerModule('var a={questions:[],answersByQuestionId:{},source:Date.now()};'), null);
  const minified = 'var e={questions:[{id:`apify-example`,accepted:!0,rejected:!1}],answersByQuestionId:{},source:{ready:!0}};export{e as t};';
  const decoded = archiveFromWorkerModule(minified);
  assert.equal(decoded.questions[0].accepted, true);
  assert.equal(decoded.questions[0].rejected, false);
  assert.equal(decoded.source.ready, true);
  assert.equal(archiveFromWorkerModule('var e={questions:[],answersByQuestionId:{},source:{ready:!dangerous()}};'), null);
  const parsedNested = `var e={questions:JSON.parse(${JSON.stringify(JSON.stringify(fixture.questions))}),answersByQuestionId:JSON.parse(${JSON.stringify(JSON.stringify(fixture.answersByQuestionId))}),source:{name:'Synthetic test'}};`;
  const recoveredNested = archiveFromWorkerModule(parsedNested);
  assert.deepEqual(recoveredNested.questions, fixture.questions);
  assert.deepEqual(recoveredNested.answersByQuestionId, fixture.answersByQuestionId);
  assert.equal(archiveFromWorkerModule('var e={questions:JSON.parse(dangerous()),answersByQuestionId:{},source:{}};'), null);
  assert.equal(archiveFromWorkerModule('var e={questions:JSON.parse("[]",dangerous),answersByQuestionId:{},source:{}};'), null);
  assert.equal(archiveFromWorkerModule('var e={questions:dangerous.parse("[]"),answersByQuestionId:{},source:{}};'), null);
  const form = new FormData(); form.append('archive.js', new Blob([js], { type: 'application/javascript' }), 'archive.js');
  assert.equal(canonicalJson(await recoverWorkerArchive(new Response(form))), canonicalJson(fixture));
  const stringForm = new FormData(); stringForm.append('archive.js', js);
  assert.equal(canonicalJson(await recoverWorkerArchive(new Response(stringForm))), canonicalJson(fixture));
  const filenameForm = new FormData(); filenameForm.append('script-part', new Blob([js], { type: 'application/javascript' }), 'archive.js');
  assert.equal(canonicalJson(await recoverWorkerArchive(new Response(filenameForm))), canonicalJson(fixture));
  const published = publishedArchive(fixture);
  assert.equal(published.questions[0].answer_count, 0, 'Last-row-wins precedes visibility filtering.');
  assert.equal(published.questions[0].source_comment_count, 2);
  assert.equal(fixture.questions[0].answer_count, 2, 'Original source is immutable.');
});

function acceptanceReceipt() {
  const ids = ['post-question', 'post-summary', 'public-question', 'community-question', 'community-catchup', 'community-catchup-partial', 'conflicting-reports', 'unsupported-policy', 'irrelevant-evidence', 'prompt-injection', 'multilingual-post', 'concise-question-relevance', 'conversation-topic-switch', 'long-post-tail-answer'];
  const model = '@cf/openai/gpt-oss-120b';
  return { schemaVersion: 1, sourceSha: 'a'.repeat(40), provider: 'workers-ai', model, createdAt: new Date().toISOString(), passed: true, repetitions: 3, features: { posts: true, communities: true, catchup: true }, workerDeleted: true, cases: ids.map(id => ({
    id, model, passed: true,
    samples: Array.from({ length: 3 }, () => ({ id, model, passed: true, checks: [{ name: 'supported', passed: true }] })),
    checks: Array.from({ length: 3 }, (_, index) => ({ name: `sample_${index + 1}_supported`, passed: true })),
  })) };
}

test('production activation requires fresh exact-source hosted acceptance for every enabled feature', () => {
  const receipt = acceptanceReceipt();
  verifyAssistantAcceptance(receipt, receipt.sourceSha, { communities: 'true', catchup: 'true' });
  for (const change of [{ sourceSha: 'b'.repeat(40) }, { model: 'wrong-model' }, { passed: false }, { workerDeleted: false }, { createdAt: '2020-01-01T00:00:00Z' }, { features: { posts: true } }, { cases: receipt.cases.slice(1) }, { cases: receipt.cases.map(row => ({ ...row, checks: [{ name: 'supported', passed: false }] })) }]) assert.throws(() => verifyAssistantAcceptance({ ...receipt, ...change }, receipt.sourceSha, { communities: 'true', catchup: 'true' }));
});

test('production acceptance cannot pass through aggregate-only, incomplete or failing samples', () => {
  const mutations = [
    receipt => { delete receipt.repetitions; },
    ...[1, 2, 4].map(count => receipt => { receipt.repetitions = count; }),
    receipt => { delete receipt.cases[0].samples; },
    receipt => { receipt.cases[0].samples.pop(); },
    receipt => { receipt.cases[0].samples.push(receipt.cases[0].samples[0]); },
    receipt => { receipt.cases[0].samples[0].passed = false; },
    receipt => { receipt.cases[0].samples[0].checks[0].passed = false; },
    receipt => { receipt.cases[0].samples[0].checks = []; },
    receipt => { receipt.cases[0].samples[0].checks[0].name = ''; },
    receipt => { receipt.cases[0].samples[0].model = 'another-model'; },
    receipt => { receipt.cases[0].samples[0].id = receipt.cases[1].id; },
    receipt => { receipt.cases[0].checks.pop(); },
    receipt => { receipt.cases[0].checks[0].name = 'unsupported-aggregate'; },
    receipt => { receipt.cases[0].model = 'another-model'; },
    receipt => { receipt.cases[0].passed = false; },
    receipt => { receipt.cases[0] = receipt.cases[1]; },
  ];
  for (const mutate of mutations) {
    const receipt = acceptanceReceipt(); mutate(receipt);
    assert.throws(() => verifyAssistantAcceptance(receipt, receipt.sourceSha, { communities: 'true', catchup: 'true' }));
  }
});

const uploadedVersion = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const deploymentEntry = { type: 'deploy', version: 1, worker_name: 'visaflow-dev', version_id: uploadedVersion };

test('deployment ownership requires the exact structured Wrangler deploy receipt', () => {
  const output = JSON.stringify({ type: 'unrelated-informational-entry' }) + '\n' + JSON.stringify(deploymentEntry) + '\n';
  assert.equal(uploadedFeatureVersion(output), uploadedVersion);
  for (const value of ['', '{}', 'invalid json', JSON.stringify({ ...deploymentEntry, type: 'version-upload' }), JSON.stringify({ ...deploymentEntry, worker_name: 'unrelated-worker' }), JSON.stringify({ ...deploymentEntry, version: 2 }), JSON.stringify({ ...deploymentEntry, version_id: null }), JSON.stringify({ ...deploymentEntry, version_id: 'not-a-version' }), JSON.stringify(deploymentEntry) + '\n' + JSON.stringify(deploymentEntry), ' '.repeat(1024 * 1024 + 1)]) assert.throws(() => uploadedFeatureVersion(value));
});

test('recording and rollback refuse unrelated deployments and accept a provable upload after recording failed', () => {
  const baseline = { deploymentId: 'captured-baseline' };
  const current = { id: 'owned-deployment', versions: [{ version_id: uploadedVersion, percentage: 100 }] };
  verifyCurrentFeatureDeployment(current, uploadedVersion, baseline);
  verifyCurrentFeatureDeployment(current, uploadedVersion, baseline, current);
  for (const changed of [undefined, { ...current, id: baseline.deploymentId }, { ...current, versions: [] }, { ...current, versions: [current.versions[0], current.versions[0]] }, { ...current, versions: [{ version_id: uploadedVersion, percentage: 99 }] }, { ...current, versions: [{ version_id: '11111111-2222-3333-4444-555555555555', percentage: 100 }] }]) assert.throws(() => verifyCurrentFeatureDeployment(changed, uploadedVersion, baseline));
  assert.throws(() => verifyCurrentFeatureDeployment({ ...current, id: 'later-deployment' }, uploadedVersion, baseline, current), /later deployment/);
  assert.throws(() => verifyCurrentFeatureDeployment(current, 'unproven', baseline));
});

test('production workflow captures structured deploy output and attempts guarded recovery after upload failure', async () => {
  const workflow = await readFile(new URL('../.github/workflows/production-features.yml', import.meta.url), 'utf8');
  assert.match(workflow, /WRANGLER_OUTPUT_FILE_PATH: \$\{\{ github.workspace \}\}\/\.cache\/visaflow\/live-preview\/wrangler-deploy\.ndjson/);
  assert.match(workflow, /if: always\(\) && \(steps\.deploy\.outcome == 'success' \|\| steps\.deploy\.outcome == 'failure'\)\n\s+run: node scripts\/production-feature-release\.mjs record-deployment/);
  assert.match(workflow, /if: failure\(\) && \(steps\.deploy\.outcome == 'success' \|\| steps\.deploy\.outcome == 'failure'\)/);
  assert.match(workflow, /ROLLBACK_VERSION=\$\(node scripts\/production-feature-release\.mjs rollback-version\)/);
});

test('only a fresh unchanged current-live archive may be used by an explicit preview release', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'visa-release-fixture-'));
  try {
    await mkdir(resolve(root, 'src/data'), { recursive: true });
    await mkdir(resolve(root, '.cache/visaflow/live-preview'), { recursive: true });
    const content = '{"syntheticTestOnly":true}\n';
    await writeFile(resolve(root, 'src/data/api-archive.json'), content);
    const receipt = { siteOrigin: LIVE_SITE, databaseOrigin: LIVE_DATABASE, worker: 'visaflow-dev', health: { environment: 'development', build: { dirty: false, gitSha: 'a'.repeat(40) } }, deploymentId: '11111111-1111-1111-1111-111111111111', questionCount: 563, replyCount: 628, capturedAt: new Date().toISOString(), archiveSha256: sha256(content) };
    const write = object => writeFile(resolve(root, '.cache/visaflow/live-preview/receipt.json'), JSON.stringify(object));
    await write(receipt);
    const env = { ...featureEnvironment(values, 'true'), CI: 'true' };
    assert.equal(checkedLiveArchive(root, env), resolve(root, 'src/data/api-archive.json'));
    assert.equal(archiveSource(root, env), resolve(root, 'src/data/api-archive.json'));
    for (const change of [{ NEXT_PUBLIC_APP_ENV: 'production' }, { CLOUDFLARE_ENV: 'production' }, { NEXT_PUBLIC_SITE_URL: 'https://visa-central.com' }, { VISATHREADS_EXISTING_PREVIEW: 'false' }]) assert.throws(() => checkedLiveArchive(root, { ...env, ...change }));
    for (const change of [{ questionCount: 42 }, { replyCount: 0 }, { capturedAt: '2020-01-01T00:00:00Z' }, { archiveSha256: 'a'.repeat(64) }]) { await write({ ...receipt, ...change }); assert.throws(() => checkedLiveArchive(root, env)); }
    await write(receipt); await writeFile(resolve(root, 'src/data/api-archive.json'), 'changed');
    assert.throws(() => checkedLiveArchive(root, env), /changed after capture/);
    // Generic CI and the formal public launch still never select private data.
    assert.equal(archiveSource(root, { CI: 'true' }), resolve(root, 'src/data/archive-fixture.json'));
    assert.equal(archiveSource(root, { NEXT_PUBLIC_APP_ENV: 'production' }), resolve(root, 'src/data/archive-fixture.json'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('deploy metadata regeneration cannot replace immutable checked build provenance', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'visa-feature-provenance-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Isolated test');
    await writeFile(resolve(root, '.gitignore'), '.cache/\n');
    await writeFile(resolve(root, 'wrangler.jsonc'), '{"name":"visaflow-dev"}\n');
    await writeFile(resolve(root, 'app.js'), 'reviewed feature source');
    git('add', '.'); git('commit', '-m', 'reviewed feature');
    await mkdir(resolve(root, '.cache/visaflow/live-preview'), { recursive: true });
    await writeFile(resolve(root, '.cache/visaflow/live-preview/receipt.json'), JSON.stringify({ archiveSha256: 'a'.repeat(64) }));
    const buildEnv = featureEnvironment(values, 'true', { communities: 'true', catchup: 'true' });
    const expected = buildProvenance(root, buildEnv);
    const mutablePath = resolve(root, '.cache/visaflow/build-provenance.json');
    await writeFile(mutablePath, JSON.stringify(expected));
    await snapshotFeatureBuildProvenance(root, expected);
    // --skip-build still evaluates Vite config with the deployment step's
    // different environment. Reproduce that overwrite without running deploy.
    const regenerated = buildProvenance(root, { ASSISTANT_ENABLED: 'true' });
    assert.equal(regenerated.gitSha, expected.gitSha);
    assert.notEqual(regenerated.configSha256, expected.configSha256);
    await writeFile(mutablePath, JSON.stringify(regenerated));
    assert.deepEqual(await readFeatureBuildProvenance(root), expected);
    await assert.rejects(() => snapshotFeatureBuildProvenance(root, regenerated), /EEXIST/);
    const deployedHealth = { build: expected, environment: 'development', releaseStatus: 'configured' };
    assertHealthProvenance(deployedHealth, await readFeatureBuildProvenance(root));
    assert.throws(() => assertHealthProvenance(deployedHealth, regenerated), /configSha256/);
    await writeFile(resolve(root, 'app.js'), 'different release source');
    git('add', 'app.js'); git('commit', '-m', 'different release');
    await assert.rejects(() => readFeatureBuildProvenance(root), /gitSha does not match release source/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('provenance snapshot rejects a stale source or incorrectly configured build before freezing', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'visa-feature-provenance-rejection-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Isolated test');
    await writeFile(resolve(root, '.gitignore'), '.cache/\n');
    await writeFile(resolve(root, 'wrangler.jsonc'), '{"name":"visaflow-dev"}\n');
    git('add', '.'); git('commit', '-m', 'reviewed feature');
    await mkdir(resolve(root, '.cache/visaflow'), { recursive: true });
    const expected = buildProvenance(root, values);
    const mutablePath = resolve(root, '.cache/visaflow/build-provenance.json');
    await writeFile(mutablePath, JSON.stringify({ ...expected, gitSha: 'b'.repeat(40) }));
    await assert.rejects(() => snapshotFeatureBuildProvenance(root, expected), /gitSha does not match release source/);
    await writeFile(mutablePath, JSON.stringify({ ...expected, configSha256: 'b'.repeat(64) }));
    await assert.rejects(() => snapshotFeatureBuildProvenance(root, expected), /checked build environment/);
    await assert.rejects(() => readFeatureBuildProvenance(root), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

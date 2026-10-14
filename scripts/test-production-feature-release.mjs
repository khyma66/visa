import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { archiveSource } from './archive-source.mjs';
import { checkedLiveArchive, LIVE_SITE, LIVE_DATABASE, sha256 } from './live-preview-archive.mjs';
import { featureEnvironment, verifyFeatureWorker, verifyAssistantAcceptance, verifyExistingLiveProvenance } from './production-feature-release.mjs';
import { archiveFromWorkerModule, recoverWorkerArchive, canonicalJson, publishedArchive } from './recover-worker-archive.mjs';

const values = { NEXT_PUBLIC_SITE_URL: LIVE_SITE, NEXT_PUBLIC_SUPABASE_URL: LIVE_DATABASE, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'fixture'.repeat(5)}` };
const config = enabled => ({ name: 'visaflow-dev', routes: ['visathreads.com', 'www.visathreads.com'].map(pattern => ({ pattern, custom_domain: true })), vars: featureEnvironment(values, enabled), ai: { binding: 'ASSISTANT_AI' } });

test('only the independently identified legacy version may omit a site origin', () => {
  const health = { environment: 'development', releaseStatus: 'configured', build: { gitSha: '0624c651cb252436c47c5f2b020baecfec0bfbd0', dirty: false, siteOrigin: null } };
  const deployment = { versions: [{ version_id: '879503b4-e947-420e-8ad8-e1f2f7082ae5', percentage: 100 }] };
  verifyExistingLiveProvenance(health, deployment);
  verifyExistingLiveProvenance({ ...health, build: { ...health.build, gitSha: 'a'.repeat(40), siteOrigin: LIVE_SITE } }, deployment);
  for (const change of [{ gitSha: 'a'.repeat(40) }, { dirty: true }, { siteOrigin: undefined }, { siteOrigin: '' }, { siteOrigin: 'https://visa-central.com' }]) assert.throws(() => verifyExistingLiveProvenance({ ...health, build: { ...health.build, ...change } }, deployment));
  for (const changed of [{ versions: [{ version_id: '11111111-1111-1111-1111-111111111111', percentage: 100 }] }, { versions: [{ ...deployment.versions[0], percentage: 50 }] }, { versions: [...deployment.versions, deployment.versions[0]] }]) assert.throws(() => verifyExistingLiveProvenance(health, changed));
  assert.throws(() => verifyExistingLiveProvenance({ ...health, environment: 'production' }, deployment));
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
  const form = new FormData(); form.append('archive.js', new Blob([js], { type: 'application/javascript' }), 'archive.js');
  assert.equal(canonicalJson(await recoverWorkerArchive(new Response(form))), canonicalJson(fixture));
  const published = publishedArchive(fixture);
  assert.equal(published.questions[0].answer_count, 0, 'Last-row-wins precedes visibility filtering.');
  assert.equal(published.questions[0].source_comment_count, 2);
  assert.equal(fixture.questions[0].answer_count, 2, 'Original source is immutable.');
});

test('production activation requires fresh exact-source hosted acceptance for every enabled feature', () => {
  const ids = ['post-question', 'post-summary', 'public-question', 'community-question', 'community-catchup', 'public-catchup-partial', 'conflicting-reports', 'unsupported-policy', 'irrelevant-evidence', 'prompt-injection', 'multilingual-post'];
  const receipt = { schemaVersion: 1, sourceSha: 'a'.repeat(40), provider: 'workers-ai', model: '@cf/qwen/qwen3-30b-a3b-fp8', createdAt: new Date().toISOString(), passed: true, features: { posts: true, communities: true, catchup: true }, workerDeleted: true, cases: ids.map(id => ({ id, passed: true, checks: [{ name: 'supported', passed: true }] })) };
  verifyAssistantAcceptance(receipt, receipt.sourceSha, { communities: 'true', catchup: 'true' });
  for (const change of [{ sourceSha: 'b'.repeat(40) }, { model: 'wrong-model' }, { passed: false }, { workerDeleted: false }, { createdAt: '2020-01-01T00:00:00Z' }, { features: { posts: true } }, { cases: receipt.cases.slice(1) }, { cases: receipt.cases.map(row => ({ ...row, checks: [{ name: 'supported', passed: false }] })) }]) assert.throws(() => verifyAssistantAcceptance({ ...receipt, ...change }, receipt.sourceSha, { communities: 'true', catchup: 'true' }));
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

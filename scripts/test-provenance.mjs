import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { buildProvenance, buildProvenanceSource, sourceProvenance } from './build-provenance.mjs';
import { releaseProblems, requiredReviews } from './release-check.mjs';
import { assertHealthProvenance, smokeRoutes } from './smoke-site.mjs';

const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'x'.repeat(30)}`, NEXT_PUBLIC_APP_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'https://visaflow.example.org', CLOUDFLARE_ENV: 'production' };
const source = { gitSha: 'a'.repeat(40), gitTree: 'b'.repeat(40), sourceSha256: 'c'.repeat(64), dirty: false };
const review = { siteOrigin: env.NEXT_PUBLIC_SITE_URL, databaseOrigin: env.NEXT_PUBLIC_SUPABASE_URL, checks: Object.fromEntries(requiredReviews.map((name) => [name, { status: 'verified', evidence: 'Isolated test fixture', verifiedBy: 'Test', ...(name === 'source_parity' ? { sourceSha256: source.sourceSha256 } : {}) }])) };
const config = { env: { production: { vars: { APP_ENV: 'production', PUBLIC_LAUNCH_APPROVED: 'true', IMPORTED_CONTENT_APPROVED: 'false' } } } };
const build = { schemaVersion: 1, ...source, configSha256: 'd'.repeat(64), appEnvironment: 'production', siteOrigin: env.NEXT_PUBLIC_SITE_URL };

test('release refuses missing or mismatched live-source parity even with other approvals', () => {
  const missing = structuredClone(review);
  delete missing.checks.source_parity;
  assert(releaseProblems(env, missing, config, source).some((p) => p.includes('source_parity')));
  const mismatch = structuredClone(review);
  mismatch.checks.source_parity.sourceSha256 = 'e'.repeat(64);
  assert(releaseProblems(env, mismatch, config, source).some((p) => p.includes('Source-parity')));
  assert.deepEqual(releaseProblems(env, review, config, source), []);
});

test('release refuses unavailable Git, uncommitted edits and a different workflow commit', () => {
  assert(releaseProblems(env, review, config).some((p) => p.includes('traceable')));
  assert(releaseProblems(env, review, config, { ...source, dirty: true }).some((p) => p.includes('clean Git')));
  assert(releaseProblems({ ...env, GITHUB_SHA: 'e'.repeat(40) }, review, config, source).some((p) => p.includes('workflow commit')));
});

test('source provenance follows committed code, excludes only review evidence and detects untracked files', () => {
  const root = mkdtempSync(join(tmpdir(), 'visa-provenance-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  try {
    git('init', '--quiet');
    git('config', 'user.name', 'Isolated test');
    git('config', 'user.email', 'test@example.invalid');
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, '.gitignore'), '.cache/\n');
    writeFileSync(join(root, 'app.txt'), 'app fixture\n');
    writeFileSync(join(root, 'wrangler.jsonc'), JSON.stringify(config));
    writeFileSync(join(root, 'docs/release-review.json'), '{}');
    git('add', '.');
    git('commit', '--quiet', '-m', 'fixture');
    const initial = sourceProvenance(root);
    assert.equal(initial.gitSha, git('rev-parse', 'HEAD'));
    assert.equal(initial.gitTree, git('rev-parse', 'HEAD^{tree}'));
    assert.equal(initial.dirty, false);
    writeFileSync(join(root, 'docs/release-review.json'), '{"fixture":true}');
    git('add', '.');
    git('commit', '--quiet', '-m', 'review fixture');
    const approved = sourceProvenance(root);
    assert.notEqual(approved.gitSha, initial.gitSha);
    assert.notEqual(approved.gitTree, initial.gitTree);
    assert.equal(approved.sourceSha256, initial.sourceSha256);
    writeFileSync(join(root, 'new-route.txt'), 'uncommitted route');
    assert.equal(sourceProvenance(root).dirty, true);
    git('add', '.');
    git('commit', '--quiet', '-m', 'code fixture');
    assert.notEqual(sourceProvenance(root).sourceSha256, initial.sourceSha256);
    const metadata = buildProvenance(root, { ...env, SERVER_SECRET: 'never-expose-fixture-secret' });
    assert.deepEqual(metadata, buildProvenance(root, env), 'Repeated build-config evaluation must produce identical metadata');
    assert(!JSON.stringify(metadata).includes('never-expose-fixture-secret'));
    assert(!JSON.stringify(metadata).includes(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY));
    assert(!JSON.stringify(metadata).includes(env.NEXT_PUBLIC_SUPABASE_URL));
    assert.equal(metadata.configSha256, buildProvenance(root, env).configSha256);
    assert.notEqual(metadata.configSha256, buildProvenance(root, { ...env, NEXT_PUBLIC_SITE_URL: 'https://other.example.org' }).configSha256);
    const filename = buildProvenanceSource(root, env);
    assert.equal(JSON.parse(readFileSync(filename, 'utf8')).gitSha, metadata.gitSha);
    assert.equal(sourceProvenance(root).dirty, false, 'Generated metadata must not dirty the worktree');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('missing Git is reported honestly without preventing local build metadata generation', () => {
  const root = mkdtempSync(join(tmpdir(), 'visa-no-git-'));
  try {
    writeFileSync(join(root, 'wrangler.jsonc'), '{}');
    const metadata = buildProvenance(root, {});
    assert.equal(metadata.gitSha, null);
    assert.equal(metadata.dirty, true);
    assert.equal(metadata.appEnvironment, 'development');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('smoke checks require exact immutable build provenance, not just a healthy older deployment', () => {
  const health = { environment: 'production', releaseStatus: 'configured', build };
  assert.doesNotThrow(() => assertHealthProvenance(health, build));
  for (const field of ['gitSha', 'gitTree', 'sourceSha256', 'configSha256', 'appEnvironment', 'siteOrigin', 'dirty']) {
    assert.throws(() => assertHealthProvenance({ ...health, build: { ...build, [field]: 'different' } }, build), /does not match/);
  }
  assert.throws(() => assertHealthProvenance({ ...health, build: undefined }, build), /no supported provenance/);
  assert.throws(() => assertHealthProvenance(health, { ...build, dirty: true }), /clean reviewed build/);
  assert.throws(() => assertHealthProvenance({ ...health, releaseStatus: 'not-ready' }, build), /approval is missing/);
  for (const path of ['/explore', '/my-communities', '/communities/new', '/news']) assert(smokeRoutes.includes(path));
});

test('health publishes bundled metadata and retains production approval and provenance gates', async () => {
  const original = readFileSync(new URL('../src/app/api/health/route.ts', import.meta.url), 'utf8');
  const source = ts.transpileModule(original, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  const moduleUrl = (value) => `data:text/javascript;base64,${Buffer.from(value).toString('base64')}`;
  const old = Object.fromEntries([...Object.keys(env), 'APP_ENV', 'PUBLIC_LAUNCH_APPROVED'].map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, env, { APP_ENV: 'production', PUBLIC_LAUNCH_APPROVED: 'false' });
    const { GET } = await import(moduleUrl(source.replace("'@visa/build-provenance'", JSON.stringify(moduleUrl(`export default ${JSON.stringify(build)};`)))));
    assert.equal(GET().status, 503);
    process.env.PUBLIC_LAUNCH_APPROVED = 'true';
    const response = GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const health = await response.json();
    assert.deepEqual(health.build, build);
    assert.equal(health.dependencyCheck, 'not-performed');
    const dirtyModule = moduleUrl(`export default ${JSON.stringify({ ...build, dirty: true })};`);
    const dirty = await import(moduleUrl(source.replace("'@visa/build-provenance'", JSON.stringify(dirtyModule))));
    assert.equal(dirty.GET().status, 503);
  } finally {
    for (const [key, value] of Object.entries(old)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('both builders bundle generated provenance and reviewed workflow verifies its exact commit', () => {
  for (const filename of ['next.config.js', 'vite.config.ts']) {
    const config = readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8');
    assert(config.includes('buildProvenanceSource'));
    assert(config.includes('@visa/build-provenance'));
  }
  const workflow = readFileSync(new URL('../.github/workflows/public-release.yml', import.meta.url), 'utf8');
  assert(workflow.includes("if: github.ref == 'refs/heads/main'"));
  assert(workflow.includes('environment: production'));
  assert(workflow.includes('npm audit --audit-level=high'));
  assert(workflow.includes('smoke-site.mjs "$NEXT_PUBLIC_SITE_URL" .cache/visaflow/build-provenance.json "$GITHUB_SHA"'));
});

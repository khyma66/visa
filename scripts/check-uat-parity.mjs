import assert from 'node:assert/strict';
const production = 'https://visathreads.com';
const uat = 'https://visa-central.com';
const read = async (origin, path) => {
  const response = await fetch(origin + path, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, `${origin}${path}`);
  return response;
};
const [prod, dev] = await Promise.all([production, uat].map(async origin => (await read(origin, '/api/health')).json()));
for (const key of ['gitSha', 'gitTree', 'sourceSha256']) assert.equal(dev.build[key], prod.build[key], `UAT ${key} must match live production, not just latest main`);
assert.equal(dev.build.siteOrigin, uat); assert.equal(prod.build.siteOrigin, production);
assert.equal(dev.build.dirty, false); assert.equal(prod.build.dirty, false);
assert.notEqual(dev.build.configSha256, prod.build.configSha256, 'Environment-specific configuration must remain separate');
const home = await read(uat, '/');
assert.match(home.headers.get('x-robots-tag') ?? '', /noindex/);
assert.doesNotMatch(await home.text(), /aria-label="Ask VisaThreads assistant"/);
assert.match(await (await read(uat, '/robots.txt')).text(), /Disallow: \/\s*$/);
assert.deepEqual(await (await read(uat, '/api/assistant')).json(), { posts: false, communities: false, catchup: false });
// Re-read to catch a release racing this audit. This never changes deployment or data.
assert.equal((await (await read(production, '/api/health')).json()).build.gitSha, prod.build.gitSha, 'Production changed during audit; rerun');
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), source: prod.build.gitSha, uatMatchesProduction: true, uatSearch: 'blocked', uatAssistant: 'disabled', dataCopied: false }));

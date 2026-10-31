import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { LIVE_SITE, sha256 } from './live-preview-archive.mjs';
import { canonicalJson } from './recover-worker-archive.mjs';
import { smokeSite } from './smoke-site.mjs';
import { readFeatureBuildProvenance } from './production-feature-release.mjs';
import { createRolloutProbe, probeRolloutHealth, publicClientAssets, verifyClientAssets, verifyStableRollout } from './rollout-verification.mjs';
import { verifyPlaybookPages } from './smoke-playbook.mjs';

const receipt = JSON.parse(await readFile('.cache/visaflow/live-preview/receipt.json', 'utf8'));
const expected = await readFeatureBuildProvenance();
const assets = await publicClientAssets('dist/client');
const features = { posts: process.env.ASSISTANT_ENABLED === 'true', communities: process.env.ASSISTANT_COMMUNITIES_ENABLED === 'true', catchup: process.env.ASSISTANT_CATCHUP_ENABLED === 'true' };
await verifyStableRollout({ expected, previous: receipt.health,
  persist: report => writeFile('.cache/visaflow/live-preview/rollout-verification.json', JSON.stringify(report, null, 2), { mode: 0o600 }),
  runRound: async ({ signal, record }) => {
    const probe = createRolloutProbe({ origin: LIVE_SITE, expected, previous: receipt.health, signal, record });
    await probeRolloutHealth(probe, 'start');
    assert.equal(expected.appEnvironment, 'development', 'Launch state must remain the existing early preview.');
    const feedResponse = await probe.request('archive', '/api/community');
    const feed = await feedResponse.json();
    assert.equal(sha256(canonicalJson(feed)), receipt.publishedArchiveSha256, 'Published content changed during feature deployment.');
    for (const method of ['GET', 'POST']) {
      const response = await probe.request('removed-chatbot-' + method, '/api/assistant', { method }, { status: 410 });
      assert.deepEqual(await response.json(), { posts: false, communities: false, catchup: false, code: 'removed' });
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    }
    const removedPage = await probe.request('removed-chatbot-page', '/assistant', {}, { status: 404 });
    await removedPage.body?.cancel();
    await smokeSite(LIVE_SITE, expected, { fetchImpl: probe.siteFetch, skipHealthWait: true });
    await verifyPlaybookPages(probe, feed, true);
    const home = await probe.request('search-home', '/');
    assert.equal(home.headers.get('x-visathreads-search'), 'editorial');
    assert(!/noindex/i.test(home.headers.get('x-robots-tag') ?? ''));
    const html = await home.text();
    assert(!html.includes('href="/assistant"'), 'Chatbot navigation must be absent.');
    assert(!/<meta[^>]+name="robots"[^>]+content="[^"]*noindex/i.test(html));
    const robots = await (await probe.request('search-robots', '/robots.txt')).text();
    assert.match(robots, /Allow: \/\s/);
    assert.match(robots, /Sitemap: https:\/\/visathreads.com\/sitemap.xml/);
    const sitemap = await (await probe.request('search-sitemap', '/sitemap.xml')).text();
    assert.match(sitemap, /<loc>https:\/\/visathreads.com\/guides/);
    assert(!/<loc>[^<]*\/(questions|experiences|admin|owner|account|messages)\//.test(sitemap));
    await verifyClientAssets(probe, assets);
    await probeRolloutHealth(probe, 'end');
  },
});
console.log(JSON.stringify({ status: 'verified', source: expected.gitSha, features, archiveUnchanged: !receipt.archiveRefresh, archiveRefresh: receipt.archiveRefresh?.status ?? null, questions: receipt.questionCount, replies: receipt.replyCount, assetsVerified: assets.length, signedInAcceptance: 'requires real user session; not established by this smoke check' }));

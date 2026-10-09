// Read-only release checks. Does not create accounts, posts, memberships or messages.
import assert from 'node:assert/strict';
const origin = new URL(process.argv[2] ?? 'https://visathreads.com').origin;
assert(['https://visathreads.com', 'http://127.0.0.1:3000'].includes(origin), 'Use the owned site or isolated local preview');
const paths = ['/', '/?sort=score', '/explore', '/news', '/experiences', '/tags', '/my-communities', '/messages', '/communities/new', '/ask', '/experiences/new', '/login', '/account', '/community-safety', '/privacy', '/terms', '/cookies', '/privacy-choices', '/countries', '/contact'];
const tags = ['h1b', 'h4', 'f1', 'ead', 'stamping', 'timeline'];
const experiences = ['apify-2284772032337912', 'apify-2270233223791793', 'apify-2258283714986744', 'apify-2257123705102745'];
paths.push(...tags.map(tag => `/?tag=${tag}`), ...experiences.map(id => `/questions/${id}`));
const results = [];
for (const path of paths) {
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(20_000), redirect: 'error' });
  const html = await response.text();
  assert.equal(response.status, 200, path); assert.match(html, /VisaThreads/, path);
  assert.doesNotMatch(html, /<h1[^>]*>404|Application error:|Internal Server Error/, path);
  if (origin.startsWith('https:')) {
    assert.match(response.headers.get('Content-Security-Policy') ?? '', /frame-ancestors 'none'/, path);
    assert.match(response.headers.get('X-Robots-Tag') ?? '', /noindex/, 'Preview must remain unindexed');
  }
  results.push({ path, status: response.status });
}
const archive = await (await fetch(`${origin}/api/community`)).json();
for (const id of experiences) assert(archive.questions.some(q => q.id === id), `Missing selected story ${id}`);
const summary = await (await fetch(`${origin}/api/tags`)).json();
const topics = tags.map(tag => { const row = summary.tags.find(row => row.tag === tag); assert(row?.count > 0, `Empty topic ${tag}`); return { tag, count: row.count }; });
const newsResponse = await fetch(`${origin}/api/official-news`, { signal: AbortSignal.timeout(15_000) });
assert.equal(newsResponse.status, 200, 'Official news feed');
const news = await newsResponse.json(); assert.equal(news.source, 'Federal Register'); assert(news.articles.length > 0 && news.articles.length <= 24);
for (const article of news.articles) assert.equal(new URL(article.url).origin, 'https://www.federalregister.gov');
if (origin.startsWith('https:')) {
  // Edge cache partitions may return different valid snapshots. The unit test
  // checks the canonical key; live checks require bounded freshness, not strong consistency.
  const next = await (await fetch(`${origin}/api/official-news?ignored=1`)).json();
  assert.equal(next.source, 'Federal Register'); assert(next.articles?.length > 0);
  for (const feed of [news, next]) {
    const age = Date.now() - Date.parse(feed.retrievedAt);
    assert(age >= -5000 && age <= 15 * 60_000, 'Public news freshness bound');
  }
}
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), origin, pages: results, topics, selectedExperiences: experiences.length, notices: news.articles.length, newestNotice: news.articles[0].publishedOn, archivePosts: archive.questions.length, note: 'HTTP/data checks; authenticated flows require separate browser verification.' }, null, 2));

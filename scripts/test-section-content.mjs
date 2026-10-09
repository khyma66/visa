import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const dependencies = Object.fromEntries(['react', 'react/jsx-runtime'].map(name => [name, pathToFileURL(require.resolve(name)).href]));
dependencies['next/link'] = moduleUrl(`import {jsx} from ${JSON.stringify(dependencies['react/jsx-runtime'])};export default function Link(props){return jsx('a',{href:props.href,className:props.className,children:props.children})}`);
async function compile(path, suffix = '') {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  return moduleUrl(ts.transpileModule(source + `\n// ${suffix}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/(from\s+)(['"])([^'"]+)\2/g, (_, prefix, quote, name) => {
    assert(dependencies[name], `Missing import: ${name}`); return prefix + JSON.stringify(dependencies[name]);
  }));
}
dependencies['@/lib/official-news-shared'] = dependencies['./official-news-shared'] = await compile('../src/lib/official-news-shared.ts');
dependencies['@/lib/official-news'] = await compile('../src/lib/official-news.ts');
const shared = await import(dependencies['./official-news-shared']);
const { createOfficialNewsService, OFFICIAL_NEWS_URL } = await import(dependencies['@/lib/official-news']);
const { OfficialNewsResults, OfficialNewsFeed, VISA_RESOURCES } = await import(await compile('../src/components/OfficialNewsFeed.tsx'));
const { topicCollections, TopicCollectionCards } = await import(await compile('../src/components/TopicCollections.tsx'));
const { selectedExperiences, usVisaPost } = await import(await compile('../src/lib/post-presentation.ts'));
const now = Date.parse('2026-10-08T12:00:00Z');
const row = (overrides = {}) => ({ title: 'Optional Practical Training Fees', document_number: '2026-20660', html_url: 'https://www.federalregister.gov/documents/2026/10/08/2026-20660/optional-practical-training-fees', publication_date: '2026-10-08', type: 'Proposed Rule', agencies: [{ name: 'Homeland Security Department', slug: 'homeland-security-department' }], ...overrides });
const payload = (rows = [row()]) => ({ results: rows });
const response = (value = payload()) => Response.json(value);
const parse = rows => shared.parseOfficialNews(payload(rows), now);

test('news uses a fixed, keyless, bounded government query', () => {
  const url = new URL(OFFICIAL_NEWS_URL);
  assert.equal(url.origin, 'https://www.federalregister.gov');
  assert.equal(url.searchParams.get('per_page'), '60');
  assert.equal(url.searchParams.get('conditions[term]'), 'visa');
  assert(!url.searchParams.has('api_key')); assert(!url.searchParams.getAll('fields[]').includes('body_html'));
});
test('news retains original title, publication date, agency and proposed-rule label, not body copy', () => {
  const feed = parse([row({ body_html: 'SECRET_FULL_TEXT' })]);
  assert(shared.isOfficialNews(feed, now)); assert.equal(feed.articles[0].type, 'Proposed Rule');
  assert.equal(feed.articles[0].publishedOn, '2026-10-08'); assert(!JSON.stringify(feed).includes('SECRET_FULL_TEXT'));
});
test('news rejects unsafe URLs, markup, mismatched dates/IDs, unrelated agencies and payment topics', () => {
  const invalid = [
    { html_url: 'javascript:alert(1)' }, { html_url: row().html_url.replace('www.federalregister.gov', 'www.federalregister.gov.evil.test') },
    { html_url: row().html_url + '?redirect=https://evil.test' }, { html_url: row().html_url.replace('https://', 'https://user@') },
    { document_number: '2026-99999' }, { publication_date: '2026-10-09' }, { publication_date: '2026-02-31' },
    { publication_date: '2020-01-01' }, { title: '<script>Visa update</script>' }, { title: 'Visa Inc payment network merger' , agencies: [{ name: 'Securities and Exchange Commission', slug: 'securities-and-exchange-commission' }] },
    { title: 'Low Value Shipments' }, { type: 'Unknown' }, { agencies: [] },
  ];
  for (const value of invalid) assert.equal(parse([row(value)]).articles.length, 0, JSON.stringify(value));
});
test('news deduplicates, sorts, and caps documents; malformed payload fails closed', () => {
  assert.equal(parse([row(), row()]).articles.length, 1);
  const rows = Array.from({ length: 30 }, (_, i) => row({ document_number: `2026-${20000 + i}`, html_url: row().html_url.replace('2026-20660', `2026-${20000 + i}`) }));
  assert.equal(parse(rows).articles.length, 24);
  assert.equal(parse(rows).articles[0].id, '2026-20029');
  assert.throws(() => shared.parseOfficialNews({ results: 'bad' }, now)); assert.throws(() => parse(Array(61).fill(row())));
});
test('client validation rejects tampered cache values', () => {
  const feed = parse([row()]);
  for (const invalid of [{ ...feed, source: 'Unknown' }, { ...feed, retrievedAt: 'invalid' }, { ...feed, retrievedAt: '2100-01-01' }, { ...feed, articles: [{ ...feed.articles[0], url: 'https://evil.test/' }] }, { ...feed, articles: [feed.articles[0], feed.articles[0]] }]) assert(!shared.isOfficialNews(invalid, now));
});
test('public news requests coalesce and expire; no user credentials are forwarded', async () => {
  let calls = 0, clock = now;
  const service = createOfficialNewsService(async (url, options) => { calls++; assert.equal(url, OFFICIAL_NEWS_URL); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); return response(); }, () => clock);
  const [a, b] = await Promise.all([service(), service()]); assert.deepEqual(a, b); assert.equal(calls, 1);
  await service(); assert.equal(calls, 1); clock += shared.OFFICIAL_NEWS_TTL; await service(); assert.equal(calls, 2);
});
test('upstream errors back off, then recover', async () => {
  let calls = 0, clock = now;
  const service = createOfficialNewsService(async () => { calls++; if (calls === 1) throw new Error('INTERNAL_SECRET'); return response(); }, () => clock);
  await assert.rejects(service(), /News temporarily unavailable/); await assert.rejects(service()); assert.equal(calls, 1);
  clock += shared.OFFICIAL_NEWS_BACKOFF; assert.equal((await service()).articles.length, 1); assert.equal(calls, 2);
});
test('news rejects wrong content, declared and streamed oversized bodies', async () => {
  const factories = [() => new Response('{}', { headers: { 'Content-Type': 'text/html' } }), () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '999999' } }), () => new Response(' '.repeat(524289), { headers: { 'Content-Type': 'application/json' } }), () => Response.json({ error: 'bad' }), () => new Response('', { status: 503 })];
  for (const factory of factories) await assert.rejects(createOfficialNewsService(async () => factory(), () => now)(), /News temporarily unavailable/);
});
test('news timeout aborts upstream work', async () => {
  let aborted = false;
  const service = createOfficialNewsService((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('abort')); })), () => now, 5);
  await assert.rejects(service()); assert(aborted);
});
test('official news UI has source links, proposal warnings and durable resource links', () => {
  const html = renderToStaticMarkup(createElement(OfficialNewsResults, { feed: parse([row()]) }));
  assert.match(html, /Proposal, not a final rule/); assert.match(html, /noopener noreferrer/); assert.match(html, /Read Source Notice/);
  const shell = renderToStaticMarkup(createElement(OfficialNewsFeed));
  assert.match(shell, /Loading recent visa notices/); assert.match(shell, /publication does not establish an effective date/);
  for (const resource of VISA_RESOURCES) assert(shell.includes(resource.url));
});
test('edge cache is public, canonical, time bounded, and never trusts an arbitrary cached link', async () => {
  const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
  let requests = 0; const entries = new Map();
  globalThis.fetch = async () => { requests++; return response(); };
  globalThis.caches = { default: { match: async key => entries.get(key.url)?.clone(), put: async (key, value) => { entries.set(key.url, value.clone()); } } };
  try {
    const { GET } = await import(await compile('../src/app/api/official-news/route.ts', 'cache-test'));
    const first = await GET(new Request('https://visathreads.com/api/official-news?user=a')); assert.equal(first.status, 200);
    assert.match(first.headers.get('Cache-Control'), /public/);
    const cached = await GET(new Request('https://visathreads.com/api/official-news?user=b')); assert.equal(cached.status, 200); assert.equal(requests, 1);
    assert.deepEqual([...entries.keys()], ['https://visathreads.com/api/official-news?feed=visa-v1']);
    const poisoned = await cached.json(); poisoned.articles[0].url = 'https://evil.test/'; entries.set([...entries.keys()][0], Response.json(poisoned));
    assert(!JSON.stringify(await (await GET(new Request('https://visathreads.com/api/official-news'))).json()).includes('evil.test'));
  } finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }
});
test('topic cards show only actual positive counts and link to valid tag filters', () => {
  const topics = topicCollections({ tags: [{ tag: 'h1b', count: 42 }, { tag: 'h4', count: 0 }, { tag: 'ead', count: -1 }, { tag: 'f1', count: '100' }, { tag: 'stamping', count: 3 }] });
  assert.equal(topics.length, 2); assert.equal(topics[0].href, '/?tag=h1b'); assert.equal(topics[0].count, 42);
  const html = renderToStaticMarkup(createElement(TopicCollectionCards, { topics })); assert.match(html, /42 existing discussions/); assert.doesNotMatch(html, /members|Join/);
  assert.throws(() => topicCollections({ tags: 'bad' })); assert.deepEqual(topicCollections({ tags: [] }), []);
});
test('edge failure backoff prevents repeated source requests without exposing internal errors', async () => {
  const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
  let requests = 0, entry;
  globalThis.fetch = async () => { requests++; throw new Error('INTERNAL_SECRET'); };
  globalThis.caches = { default: { match: async () => entry?.clone(), put: async (_key, value) => { entry = value.clone(); } } };
  try {
    const { GET } = await import(await compile('../src/app/api/official-news/route.ts', 'failure-test'));
    for (let index = 0; index < 2; index++) {
      const result = await GET(new Request('https://visathreads.com/api/official-news'));
      assert.equal(result.status, 503); assert.equal(result.headers.get('Cache-Control'), 'no-store'); assert(Number(result.headers.get('Retry-After')) <= 60);
      assert.equal(await result.text(), '{"status":"unavailable"}');
    }
    assert.equal(requests, 1);
    entry = Response.json({status:'backoff',retryAt:Date.now()+86_400_000});
    await GET(new Request('https://visathreads.com/api/official-news')); assert.equal(requests, 2, 'An invalid long backoff cannot suppress refresh');
  } finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }
});
test('experience selection uses four reviewed real posts without mutating originals', async () => {
  const archive = JSON.parse(await readFile(new URL('../src/data/api-archive.json', import.meta.url), 'utf8'));
  const before = JSON.stringify(archive.questions); const selected = selectedExperiences(archive.questions);
  assert.equal(selected.length, 4); assert.equal(JSON.stringify(archive.questions), before);
  for (const post of selected) {
    const original = archive.questions.find(q => q.id === post.id); assert(original); assert(usVisaPost(post));
    assert.equal(post.body, original.body); assert.equal(post.created_at, original.created_at); assert.equal(post.answer_count, original.answer_count);
    assert.equal(post.post_kind, 'experience'); assert(post.experience_category);
  }
  assert.equal(selectedExperiences(selected.map(p => ({ ...p, status: 'archived' }))).length, 0);
  assert.equal(selectedExperiences([{ ...selected[0], id: 'apify-unreviewed', body: 'Can anyone share their experience?' }]).length, 0);
});
test('Applewood logo colors meet WCAG normal text contrast on white', async () => {
  const css = await readFile(new URL('../src/styles/globals.css', import.meta.url), 'utf8');
  for (const hex of ['#795548', '#334e68']) {
    assert(css.includes(hex)); const rgb = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    assert(1.05 / (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 + 0.05) >= 4.5);
  }
});

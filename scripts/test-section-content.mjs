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
  const service = createOfficialNewsService(async (url, options) => { calls++; assert.equal(url, OFFICIAL_NEWS_URL); assert(!options.headers.Cookie); assert(!options.headers.Authorization); assert.equal(options.redirect, 'manual'); return response(); }, () => clock);
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
  const factories = [() => new Response('{}', { headers: { 'Content-Type': 'text/html' } }), () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '999999' } }), () => new Response(' '.repeat(524289), { headers: { 'Content-Type': 'application/json' } }), () => Response.json({ error: 'bad' }), () => new Response('', { status: 503 }), () => new Response('', { status: 302, headers: { Location: 'https://evil.test/' } })];
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
test('official lead, secondary cards and remaining notices preserve all dates, agencies, titles and source links', () => {
  const types = ['Proposed Rule', 'Rule', 'Notice', 'Presidential Document'];
  const feed = parse(Array.from({ length: 24 }, (_, index) => row({
    title: `Visa notice fixture ${String(index).padStart(2, '0')}`,
    document_number: `2026-${20000 + index}`,
    html_url: row().html_url.replace('2026-20660', `2026-${20000 + index}`),
    type: types[index % types.length],
  })));
  const html = renderToStaticMarkup(createElement(OfficialNewsResults, { feed }));
  const rendered = [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)].map(match => match[0]);
  assert.equal(rendered.length, feed.articles.length);
  assert.equal((html.match(/Latest notice/g) ?? []).length, 1);
  assert.match(html, /aria-label="More official notices"/);
  assert.doesNotMatch(html, /<img\b|<script\b/);
  feed.articles.forEach((article, index) => {
    const card = rendered[index];
    assert.equal(html.split(article.title).length - 1, 1, `Notice ${index} must not be duplicated`);
    assert(card.includes(article.title), `Notice ${index} must keep the upstream order`);
    assert(card.includes(`dateTime="${article.publishedOn}"`));
    assert(card.includes(article.type));
    assert(card.includes(article.agencies.join(' · ')));
    assert.equal(card.split(`href="${article.url}"`).length - 1, 2);
    assert.equal((card.match(/target="_blank" rel="noopener noreferrer"/g) ?? []).length, 2);
    assert.match(card, /focus-visible:outline/);
    assert.equal(card.includes('Proposal, not a final rule.'), article.type === 'Proposed Rule');
  });
});
test('official single and empty result states leave the source resources available', () => {
  const single = renderToStaticMarkup(createElement(OfficialNewsResults, { feed: parse([row()]) }));
  assert.equal((single.match(/<article\b/g) ?? []).length, 1);
  assert.match(single, /Latest notice/);
  assert.doesNotMatch(single, /More from the Federal Register|aria-label="More official notices"/);
  const empty = renderToStaticMarkup(createElement(OfficialNewsResults, { feed: parse([]) }));
  assert.match(empty, /No matching recent notices/);
  assert.doesNotMatch(empty, /<article\b|Latest notice/);
  const shell = renderToStaticMarkup(createElement(OfficialNewsFeed));
  assert.match(shell, /<main class="page-shell /);
  assert.match(shell, /href="#visa-official-resources"/);
  assert.match(shell, /id="visa-official-resources"/);
  for (const resource of VISA_RESOURCES) assert(shell.includes(`href="${resource.url}"`));
});
test('official resource index numbers cannot shrink or wrap inside the narrow sidebar', () => {
  const html = renderToStaticMarkup(createElement(OfficialNewsFeed));
  const numbers = [...html.matchAll(/<span aria-hidden="true" class="([^"]*)">(0[1-4])<\/span>/g)];
  assert.equal(numbers.length, VISA_RESOURCES.length);
  numbers.forEach(([, className, label], index) => {
    assert.equal(label, String(index + 1).padStart(2, '0'));
    const classes = new Set(className.split(/\s+/));
    assert(classes.has('shrink-0'), `${label} must retain its width beside long resource descriptions`);
    assert(classes.has('whitespace-nowrap'), `${label} must remain on one line`);
  });
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
// These IDs are already public selection configuration. All text and metadata
// below are synthetic: public CI must not require or copy the private archive.
const reviewedExperienceIds = ['apify-2284772032337912', 'apify-2270233223791793', 'apify-2258283714986744', 'apify-2257123705102745'];
const experienceFixture = (id, index = 0, overrides = {}) => ({
  id, title: `Synthetic visa experience ${index + 1}`, body: `Synthetic account ${index + 1}: I attended a U.S. visa interview and recorded my timeline.`,
  source: 'apify', author_id: `apify-fixture-${index}`, author_username: `fixture-member-${index}`, author_avatar_seed: `fixture-${index}`,
  destination_country: 'United States', visa_type: 'H-1B', tags: ['h1b', 'interview'], status: 'open', post_kind: 'discussion',
  created_at: `2026-09-0${index + 1}T12:00:00.000Z`, updated_at: `2026-09-0${index + 1}T12:00:00.000Z`,
  answer_count: index + 2, vote_score: index, view_count: 0, accepted_answer_id: null,
  source_url: `https://example.test/synthetic-discussion/${index}`, ...overrides,
});
test('experience selection applies reviewed categories without changing source content, dates or ownership', () => {
  const questions = reviewedExperienceIds.map((id, index) => experienceFixture(id, index));
  const before = JSON.stringify(questions); const selected = selectedExperiences(questions);
  assert.deepEqual(selected.map(post => post.id), reviewedExperienceIds);
  assert.equal(JSON.stringify(questions), before);
  assert.deepEqual(selected.map(post => post.experience_category), ['Visa interview', 'Travel & arrival', 'Visa interview', 'Approval & timeline']);
  assert.equal(selected[1].title, questions[1].title); assert.equal(selected[3].title, questions[3].title);
  for (const post of selected) {
    const original = questions.find(q => q.id === post.id); assert(original); assert(usVisaPost(post)); assert.notStrictEqual(post, original);
    for (const field of ['body', 'created_at', 'updated_at', 'answer_count', 'author_id', 'author_username', 'source', 'source_url'])
      assert.equal(post[field], original[field], field);
    assert.deepEqual(post.tags, original.tags);
    assert.equal(post.post_kind, 'experience'); assert(post.experience_category);
  }
});
test('experience selection rejects archived, unreviewed, native and unrelated-market posts', () => {
  const reviewed = reviewedExperienceIds[0];
  const rejected = [
    experienceFixture(reviewed, 0, { status: 'archived' }),
    experienceFixture('apify-unreviewed', 0, { body: 'Can anyone share their experience?' }),
    experienceFixture('11111111-1111-4111-8111-111111111111', 0, { source: 'visaflow' }),
    experienceFixture(reviewed, 0, { destination_country: 'Canada', visa_type: 'Canada work permit' }),
    experienceFixture(reviewed, 0, { destination_country: 'France', visa_type: 'Schengen' }),
    experienceFixture(reviewed, 0, { destination_country: 'Canada', visa_type: 'General', title: 'Synthetic unrelated experience', body: 'Synthetic account of a Canadian visitor permit.' }),
  ];
  assert.deepEqual(selectedExperiences(rejected), []);
  assert.deepEqual(selectedExperiences([]), []);
});
test('Applewood logo colors meet WCAG normal text contrast on white', async () => {
  const css = await readFile(new URL('../src/styles/globals.css', import.meta.url), 'utf8');
  for (const hex of ['#795548', '#334e68']) {
    assert(css.includes(hex)); const rgb = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    assert(1.05 / (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 + 0.05) >= 4.5);
  }
});

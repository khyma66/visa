import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { SaxesParser } from 'saxes';
import ts from 'typescript';

const code = ts.transpileModule(await readFile(new URL('../src/lib/licensed-news-shared.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { LICENSED_NEWS_POLICY, LICENSED_NEWS_LIMIT, LICENSED_NEWS_MAX_AGE_MS, licensedStoryUrl, licensedPhotoUrl, licensedPhotoCredit, isLicensedNews } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
export const FEED_URL = 'https://www.texastribune.org/topics/immigration/feed/';
// Deliberate policy review gate: changing publisher terms halts ingestion, not automatic approval.
export const REVIEWED_POLICY_DIGEST = '83e8cafce5e3cba8d74297f86204f3a50ff06a6f6cd84ed93dac0bc33fc2d1d5';
export function plain(value = '') {
  return value.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (_, entity) => {
    const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
    if (!entity.startsWith('#')) return named[entity.toLowerCase()];
    const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return n > 31 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  }).replace(/\s+/g, ' ').trim();
}
export function policyDigest(html) {
  const section = html.match(/<h4\b[^>]*>Story Republishing Guidelines<\/h4>([\s\S]*?)<h4\b[^>]*>Multimedia Republishing Guidelines<\/h4>/)?.[1];
  if (!section) throw new Error('Publisher permission terms could not be verified');
  return createHash('sha256').update(plain(section)).digest('hex');
}
export async function bounded(response, maximum = 1_000_000) {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > maximum) { await response.body?.cancel(); throw new Error('Publisher response unavailable or too large'); }
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > maximum) throw new Error('Publisher response too large'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
export function parseFeed(xml) {
  if (Buffer.byteLength(xml) > 1_000_000) throw new Error('Feed too large');
  const rows = [], path = []; let row, nodes = 0;
  const fields = new Set(['title', 'link', 'pubDate', 'description', 'dc:creator', 'post-id']);
  const parser = new SaxesParser({ xmlns: false });
  parser.on('error', error => { throw error; });
  parser.on('doctype', () => { throw new Error('DTD not allowed'); });
  parser.on('processinginstruction', () => { throw new Error('Processing instructions not allowed'); });
  parser.on('opentag', tag => {
    if (++nodes > 6000 || path.length > 12) throw new Error('Feed too complex');
    path.push(tag.name);
    if (path.join('/') === 'rss/channel/item') { if (rows.length >= 50) throw new Error('Too many items'); row = {}; }
    if (row && path.length === 4 && fields.has(tag.name)) { if (Object.hasOwn(row, tag.name)) throw new Error('Duplicate feed field'); row[tag.name] = ''; }
    if (row && path.length > 4 && fields.has(path[3])) throw new Error('Nested feed field');
  });
  const append = t => { if (row && path.length === 4 && fields.has(path[3])) { row[path[3]] += t; if (row[path[3]].length > 80_000) throw new Error('Field too large'); } };
  parser.on('text', append); parser.on('cdata', append);
  parser.on('closetag', () => { if (path.join('/') === 'rss/channel/item') { rows.push(row); row = null; } path.pop(); });
  parser.write(xml).close();
  return rows;
}
export function articleFrom(row, html, now = Date.now()) {
  const url = row.link?.trim(), author = plain(row['dc:creator']).replace(/^By\s+/i, '');
  // Partner stories do not carry the publisher's republication control. Require the primary post ID too.
  if (!licensedStoryUrl(url) || !/^\d{1,10}$/.test(row['post-id'] ?? '')
    || !html.includes(`id="post-${row['post-id']}"`) || !html.includes('id="republication-tracker-tool-plain-text-content"')
    || /\b(?:Associated Press|Reuters|ProPublica|El Paso Matters|New York Times|Washington Post|Houston Landing)\b/i.test(author)) return null;
  const time = Date.parse(row.pubDate);
  if (!Number.isFinite(time) || time > now + 300_000 || time < now - LICENSED_NEWS_MAX_AGE_MS) return null;
  const description = row.description ?? '';
  // Use the publisher's supplied teaser unchanged, never generate an immigration summary.
  const excerptHtml = description.replace(/<figure\b[\s\S]*?<\/figure>/gi, '').match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1];
  if (!excerptHtml || /<a\b|<script\b|<iframe\b/i.test(excerptHtml)) return null;
  const article = { id: `tt-${row['post-id']}`, title: plain(row.title), url, author, publishedAt: new Date(time).toISOString(), excerpt: plain(excerptHtml), publisher: 'The Texas Tribune', permissionUrl: LICENSED_NEWS_POLICY };
  const figure = html.match(/<figure class="post-thumbnail">([\s\S]*?)<\/figure>/)?.[1];
  const credit = plain(figure?.match(/<span class="image-credit">([\s\S]*?)<\/span>/)?.[1]);
  const caption = plain(figure?.match(/<figcaption>([\s\S]*?)<span class="image-credit">/)?.[1]);
  const img = description.match(/<img\s[^>]*>/)?.[0] ?? '';
  const attr = name => plain(img.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1]);
  const imageUrl = attr('src');
  // Article-specific credit and exact same image path are both required; never use og:image as a licence.
  if (figure && licensedPhotoUrl(imageUrl) && licensedPhotoCredit(credit) && caption
    && figure.includes(new URL(imageUrl).pathname.split('/').at(-1))
    && !/\b(?:illustration|collage|graphic|Getty|Reuters|Alamy|Shutterstock|handout|courtesy)\b/i.test(`${imageUrl} ${caption} ${credit}`)) {
    const id = article.id + '-' + createHash('sha256').update(imageUrl).digest('hex').slice(0, 16);
    article.photo = { id, url: imageUrl, caption, credit, width: Number(attr('width')), height: Number(attr('height')) };
  }
  return article;
}
export async function refreshLicensedNews(previous, fetcher = fetch, now = Date.now) {
  const get = async url => bounded(await fetcher(url, { signal: AbortSignal.timeout(12_000), redirect: 'error', credentials: 'omit', headers: { 'User-Agent': 'VisaThreads-News/1.0 (+https://visathreads.com/news)', Accept: 'application/rss+xml, text/html;q=0.9' } }));
  if (policyDigest(await get(LICENSED_NEWS_POLICY)) !== REVIEWED_POLICY_DIGEST) throw new Error('Publisher terms changed; review required before republication');
  const articles = [];
  const seen = new Set();
  // The publisher serves ten stories per RSS page. Read a bounded rolling
  // edition; recheck permissions on every included article each day.
  for (let page = 1; page <= 6 && articles.length < LICENSED_NEWS_LIMIT; page++) {
    const rows = parseFeed(await get(page === 1 ? FEED_URL : `${FEED_URL}?paged=${page}`));
    if (!rows.length) {
      if (page === 1) throw new Error('Empty feed; saved edition unchanged');
      break;
    }
    let newRows = 0;
    for (const row of rows) {
      const url = row.link?.trim();
      const time = Date.parse(row.pubDate);
      if (!licensedStoryUrl(url) || seen.has(url) || !Number.isFinite(time)
        || time < now() - LICENSED_NEWS_MAX_AGE_MS || time > now() + 300_000) continue;
      seen.add(url); newRows++;
      // Sequential, spaced requests keep the daily crawl small and polite.
      await new Promise(resolve => setTimeout(resolve, 250));
      const article = articleFrom(row, await get(url), now());
      if (article && !articles.some(a => a.id === article.id)) articles.push(article);
      if (articles.length === LICENSED_NEWS_LIMIT) break;
    }
    if (!newRows) break;
  }
  const stamp = new Date(now()).toISOString();
  const next = { source: 'The Texas Tribune', retrievedAt: stamp, policyCheckedAt: stamp, policyDigest: REVIEWED_POLICY_DIGEST, articles: articles.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)) };
  // A successfully checked feed can contain only partner/revoked stories. Publish an empty
  // edition in that case so old permissions are not treated as permanent republication rights.
  if (!isLicensedNews(next, now())) throw new Error('Invalid reusable stories; saved edition unchanged');
  return next;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = process.argv[2] || 'src/data/licensed-news-snapshot.json';
  let previous; try { previous = JSON.parse(await readFile(output, 'utf8')); } catch { /* First edition. */ }
  const next = await refreshLicensedNews(previous);
  await writeFile(output, JSON.stringify(next, null, 2) + '\n');
  console.log(`Saved ${next.articles.length} permitted news previews, ${next.articles.filter(a => a.photo).length} credited photos; updated ${next.retrievedAt}.`);
}

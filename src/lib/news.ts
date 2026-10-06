import { SaxesParser } from 'saxes';
import { cleanText, safeNewsUrl, GOOGLE_NEWS_RSS_URL, NEWS_CACHE_MS, NEWS_LIMIT, NEWS_MAX_BYTES, NEWS_TIMEOUT_MS } from './news-shared';
import type { NewsArticle, NewsFeedData } from './news-shared';

const WEEK_MS = 7 * 86_400_000;
const CLOCK_TOLERANCE_MS = 5 * 60_000;

function newsDate(value: string): string | null {
  // Google RSS publishes RFC 822 dates in GMT. Reject rollover dates and impossible weekdays.
  const match = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (20\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(value.trim());
  if (!match) return null;
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(match[3]);
  const values = [Number(match[4]), month, Number(match[2]), Number(match[5]), Number(match[6]), Number(match[7])];
  const date = new Date(Date.UTC(values[0], values[1], values[2], values[3], values[4], values[5]));
  if (date.getUTCFullYear() !== values[0] || date.getUTCMonth() !== values[1] || date.getUTCDate() !== values[2]
    || date.getUTCHours() !== values[3] || date.getUTCMinutes() !== values[4] || date.getUTCSeconds() !== values[5]
    || ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][date.getUTCDay()] !== match[1]) return null;
  return date.toISOString();
}

// Server-only module: client presentation imports news-shared instead.
// No full article, description, image, or publisher URL is copied from the RSS feed.
export async function parseGoogleNewsRss(xml: string, now = Date.now()): Promise<NewsArticle[]> {
  if (new TextEncoder().encode(xml).byteLength > NEWS_MAX_BYTES) throw new Error('News response too large');
  const parser = new SaxesParser({ xmlns: false });
  const path: string[] = [];
  const rows: Array<Record<string, string>> = [];
  const fields = new Set(['title', 'link', 'pubDate', 'source']);
  let row: Record<string, string> | null = null;
  let invalidRow = false, nodes = 0, itemCount = 0, channels = 0;
  parser.on('error', (error) => { throw error; });
  parser.on('doctype', () => { throw new Error('News document declarations are unsupported'); });
  parser.on('processinginstruction', () => { throw new Error('News processing instructions are unsupported'); });
  parser.on('opentag', (tag) => {
    if (++nodes > 10_000 || path.length >= 16) throw new Error('News XML is too complex');
    if (!path.length && tag.name !== 'rss') throw new Error('Expected RSS document');
    path.push(tag.name);
    if (path.join('/') === 'rss/channel' && ++channels !== 1) throw new Error('Expected one news channel');
    if (path.join('/') === 'rss/channel/item') {
      if (++itemCount > 150) throw new Error('Too many news items');
      row = Object.create(null) as Record<string, string>;
      invalidRow = false;
    }
    if (row && path.length === 4 && fields.has(tag.name)) {
      if (Object.hasOwn(row, tag.name)) invalidRow = true;
      row[tag.name] = '';
    } else if (row && path.length > 4 && fields.has(path[3])) invalidRow = true;
  });
  const appendText = (text: string) => {
    const field = path[3];
    if (row && path.length === 4 && fields.has(field) && !invalidRow) {
      row[field] += text;
      if (row[field].length > 2_048) invalidRow = true;
    }
  };
  parser.on('text', appendText);
  parser.on('cdata', appendText);
  parser.on('closetag', () => {
    if (path.join('/') === 'rss/channel/item') {
      if (row && !invalidRow) rows.push(row);
      row = null;
    }
    path.pop();
  });
  parser.write(xml).close();
  if (channels !== 1) throw new Error('Missing news channel');
  const articles = new Map<string, NewsArticle>();
  let validRecords = 0;
  for (const record of rows) {
    const rawTitle = cleanText(record.title ?? '', 600);
    const publisher = cleanText(record.source ?? '', 180);
    const sourceUrl = safeNewsUrl(record.link?.trim());
    const publishedAt = newsDate(record.pubDate ?? '');
    if (!rawTitle || !publisher || !sourceUrl || !publishedAt) continue;
    validRecords++;
    const publishedTime = Date.parse(publishedAt);
    if (publishedTime > now + CLOCK_TOLERANCE_MS || publishedTime < now - WEEK_MS) continue;
    // The search excludes these terms too; filter obvious payment-company noise defensively.
    if (/\b(?:Visa\s+(?:Inc\.?|shares|stock)|Mastercard|credit cards?|debit cards?|NYSE)\b/i.test(rawTitle)) continue;
    const title = rawTitle.endsWith(` - ${publisher}`) ? rawTitle.slice(0, -(publisher.length + 3)).trim() : rawTitle;
    if (!title) continue;
    const id = new URL(sourceUrl).pathname.split('/').at(-1)!;
    const article = { id, title, publishedAt, sourceUrl, publisher };
    const existing = articles.get(id);
    if (!existing || existing.publishedAt < publishedAt) articles.set(id, article);
  }
  if (itemCount && !validRecords) throw new Error('No valid news records');
  return [...articles.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id)).slice(0, NEWS_LIMIT);
}

async function readBoundedXml(response: Response): Promise<string> {
  if (!response.ok || !response.body || !/^(?:application\/(?:rss\+xml|xml)|text\/xml)(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel().catch(() => {});
    throw new Error('News source unavailable');
  }
  if (Number(response.headers.get('content-length')) > NEWS_MAX_BYTES) {
    await response.body.cancel();
    throw new Error('News response too large');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, body = '';
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > NEWS_MAX_BYTES) throw new Error('News response too large');
      body += decoder.decode(result.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// One fixed query and in-flight coalescing; the route also uses Cloudflare's shared edge cache.
export function createNewsService(fetcher: typeof fetch = fetch, now: () => number = Date.now, timeoutMs = NEWS_TIMEOUT_MS) {
  let cached: { expiresAt: number; data: NewsFeedData } | null = null;
  let pending: Promise<NewsFeedData> | null = null;
  return async function getNews(): Promise<NewsFeedData> {
    if (cached && cached.expiresAt > now()) return cached.data;
    if (pending) return pending;
    const task = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(GOOGLE_NEWS_RSS_URL, {
          signal: controller.signal, redirect: 'error', headers: { Accept: 'application/rss+xml, application/xml;q=0.9' },
        });
        const articles = await parseGoogleNewsRss(await readBoundedXml(response), now());
        const data: NewsFeedData = { status: 'ok', source: 'Google News', articles, retrievedAt: new Date(now()).toISOString(), limit: NEWS_LIMIT };
        cached = { expiresAt: now() + NEWS_CACHE_MS, data };
        return data;
      } finally { clearTimeout(timer); }
    })();
    pending = task;
    try { return await task; } finally { pending = null; }
  };
}

export type NewsArticle = {
  id: string;
  title: string;
  publishedAt: string;
  sourceUrl: string;
  publisher: string;
};
export type NewsFeedData = {
  status: 'ok';
  source: 'Google News';
  articles: NewsArticle[];
  retrievedAt: string;
  limit: number;
};

export const NEWS_LIMIT = 24;
export const NEWS_CACHE_MS = 5 * 60_000;
export const NEWS_FAILURE_BACKOFF_MS = 60_000;
export const NEWS_TIMEOUT_MS = 8_000;
export const NEWS_MAX_BYTES = 512 * 1024;
export const NEWS_QUERY = '(visa OR immigration OR H-1B OR USCIS) -"Visa Inc" -Mastercard -"credit card" -"debit card" -NYSE when:7d';
const searchParameters = new URLSearchParams({ q: NEWS_QUERY, hl: 'en-US', gl: 'US', ceid: 'US:en' });
export const GOOGLE_NEWS_SEARCH_URL = `https://news.google.com/search?${searchParameters}`;
export const GOOGLE_NEWS_RSS_URL = `https://news.google.com/rss/search?${searchParameters}`;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function safeNewsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'news.google.com' || url.port || url.username || url.password
      || !/^\/(?:rss\/)?articles\/[A-Za-z0-9_-]{12,1800}$/.test(url.pathname)) return null;
    // Only the article identity is used. Do not retain upstream redirect parameters.
    return `https://news.google.com${url.pathname}`;
  } catch { return null; }
}

export function cleanText(value: string, maximum: number): string | null {
  const text = value.replace(/\s+/g, ' ').trim();
  return text && text.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text) ? text : null;
}

export function isNewsFeedData(value: unknown): value is NewsFeedData {
  return isRecord(value) && value.status === 'ok' && value.source === 'Google News'
    && typeof value.retrievedAt === 'string' && Number.isFinite(Date.parse(value.retrievedAt))
    && value.limit === NEWS_LIMIT && Array.isArray(value.articles) && value.articles.length <= NEWS_LIMIT
    && value.articles.every((item) => isRecord(item) && typeof item.id === 'string'
      && /^[A-Za-z0-9_-]{12,1800}$/.test(item.id) && typeof item.title === 'string' && Boolean(cleanText(item.title, 600))
      && typeof item.publisher === 'string' && Boolean(cleanText(item.publisher, 180))
      && typeof item.publishedAt === 'string' && /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(item.publishedAt)
      && Number.isFinite(Date.parse(item.publishedAt))
      && new Date(item.publishedAt).toISOString() === item.publishedAt
      && typeof item.sourceUrl === 'string' && safeNewsUrl(item.sourceUrl) === item.sourceUrl && new URL(item.sourceUrl).pathname.endsWith(`/${item.id}`));
}

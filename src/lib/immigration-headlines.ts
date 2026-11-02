export const HEADLINE_LIMIT = 30;
export type ImmigrationHeadline = { title: string; url: string; publisher: string; publishedAt: string };
export type ImmigrationHeadlines = { source: 'GDELT Project'; retrievedAt: string; articles: ImmigrationHeadline[] };
const TOPIC = /\b(?:immigration|immigrant|visa|visas|H-?1B|H-?2[AB]|F-?1|J-?1|green card|USCIS|DHS|citizenship|deportation|asylum)\b/i;
const US_CONTEXT = /\b(?:U\.?S\.?A?\.?|United States|American|USCIS|DHS|H-?1B|H-?2[AB]|F-?1|green card)\b/i;
const NOISE = /\b(?:Visa Inc\.?|Visa stock|Visa shares|credit card|debit card|Mastercard)\b/i;
function clean(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f<>]/.test(value);
}
function safeUrl(value: unknown): value is string {
  if (!clean(value, 2048)) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
      && host.includes('.') && !host.endsWith('.local') && !host.endsWith('.internal')
      && !/^(?:localhost|\d+\.\d+\.\d+\.\d+)$/.test(host)
      && !/^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host);
  } catch { return false; }
}
function date(value: unknown, now: number): value is string {
  if (!clean(value, 40)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= now + 5 * 60_000 && time >= now - 14 * 86_400_000;
}
export function isImmigrationHeadlines(value: unknown, now = Date.now()): value is ImmigrationHeadlines {
  if (!value || typeof value !== 'object' || !('source' in value) || value.source !== 'GDELT Project'
    || !('retrievedAt' in value) || !date(value.retrievedAt, now)
    || !('articles' in value) || !Array.isArray(value.articles) || value.articles.length > HEADLINE_LIMIT) return false;
  const urls = new Set<string>();
  return value.articles.every(row => {
    if (!row || typeof row !== 'object' || !clean(row.title, 500) || !TOPIC.test(row.title) || !US_CONTEXT.test(row.title)
      || NOISE.test(row.title) || !safeUrl(row.url) || !clean(row.publisher, 120)
      || !date(row.publishedAt, now) || urls.has(row.url)) return false;
    urls.add(row.url);
    return true;
  });
}
export function parseGdelt(value: unknown, now = Date.now()): ImmigrationHeadlines {
  if (!value || typeof value !== 'object' || !('articles' in value) || !Array.isArray(value.articles) || value.articles.length > 250) throw new Error('Invalid news index');
  const articles: ImmigrationHeadline[] = [];
  const urls = new Set<string>();
  for (const row of value.articles) {
    if (!row || typeof row !== 'object' || !clean(row.title, 500) || !TOPIC.test(row.title) || !US_CONTEXT.test(row.title)
      || NOISE.test(row.title) || !safeUrl(row.url) || urls.has(row.url)) continue;
    const rawDate = typeof row.seendate === 'string' && /^\d{14}$/.test(row.seendate)
      ? `${row.seendate.slice(0, 4)}-${row.seendate.slice(4, 6)}-${row.seendate.slice(6, 8)}T${row.seendate.slice(8, 10)}:${row.seendate.slice(10, 12)}:${row.seendate.slice(12, 14)}Z` : '';
    if (!date(rawDate, now)) continue;
    const publisher = clean(row.domain, 120) ? row.domain : new URL(row.url).hostname;
    if (!clean(publisher, 120)) continue;
    urls.add(row.url);
    articles.push({ title: row.title, url: row.url, publisher, publishedAt: rawDate });
    if (articles.length >= HEADLINE_LIMIT) break;
  }
  return { source: 'GDELT Project', retrievedAt: new Date(now).toISOString(), articles };
}

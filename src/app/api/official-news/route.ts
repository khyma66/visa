import { createOfficialNewsService } from '@/lib/official-news';
import { isOfficialNews, OFFICIAL_NEWS_BACKOFF, OFFICIAL_NEWS_TTL, OFFICIAL_NEWS_LIMIT, type OfficialNews } from '@/lib/official-news-shared';
import snapshot from '@/data/official-news-snapshot.json';

export const runtime = 'edge';
const EDITION_URL = 'https://raw.githubusercontent.com/khyma66/visa/news-data/official-news.json';
type EdgeCache = { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<void> };
function success(data: OfficialNews) {
  return Response.json(data, { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300', 'X-Content-Type-Options': 'nosniff' } });
}
// The scheduled edition is durable across edge evictions and deployments. Bound
// its bytes and validate every source URL just as strictly as the live source.
async function savedEdition(): Promise<OfficialNews | undefined> {
  const response = await fetch(EDITION_URL, { signal: AbortSignal.timeout(4000), redirect: 'manual', credentials: 'omit' });
  if (!response.ok || !response.body) { await response.body?.cancel(); return; }
  const reader = response.body.getReader(); let size = 0, body = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 512 * 1024) throw new Error('Edition too large');
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    const data: unknown = JSON.parse(body);
    if (isOfficialNews(data) && data.articles.length) return data;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function GET(request: Request) {
  const edge = typeof caches === 'undefined' ? undefined : (caches as unknown as { default?: EdgeCache }).default;
  const key = new Request(new URL('/api/official-news?feed=visa-v2', request.url));
  let best: OfficialNews | undefined = isOfficialNews(snapshot) && snapshot.articles.length ? snapshot : undefined;
  const choose = (data: OfficialNews) => {
    if (!data.articles.length || (best && Date.parse(data.retrievedAt) <= Date.parse(best.retrievedAt))) return;
    const articles = new Map((best?.articles ?? []).map(article => [article.id, article]));
    for (const article of data.articles) articles.set(article.id, article);
    best = { ...data, articles: [...articles.values()].sort((a, b) => b.publishedOn.localeCompare(a.publishedOn) || b.id.localeCompare(a.id)).slice(0, OFFICIAL_NEWS_LIMIT) };
  };
  try {
    const cached = await edge?.match(key);
    if (cached?.ok) {
      const value = await cached.json();
      if (isOfficialNews(value) && value.articles.length) {
        choose(value);
        const retryAt = (value as OfficialNews & { refreshAfter?: number }).refreshAfter;
        if (typeof retryAt === 'number' && retryAt > Date.now() && retryAt <= Date.now() + OFFICIAL_NEWS_TTL) return success(best!);
      }
    }
  } catch { /* A cache outage must not hide the bundled edition. */ }
  try { const edition = await savedEdition(); if (edition) choose(edition); } catch { /* Try the direct source next. */ }
  if (!best || Date.now() - Date.parse(best.retrievedAt) >= OFFICIAL_NEWS_TTL) {
    try { choose(await createOfficialNewsService()()); } catch { /* Keep the last successful edition, with its original date. */ }
  }
  if (!best) return Response.json({ status: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  const age = Date.now() - Date.parse(best.retrievedAt);
  const refreshAfter = Date.now() + (age < OFFICIAL_NEWS_TTL ? Math.min(OFFICIAL_NEWS_TTL - age, 30 * 60_000) : OFFICIAL_NEWS_BACKOFF);
  // Retain the data much longer than the refresh interval. Failures never replace
  // articles with a backoff marker; clients receive the original retrieval date.
  try { await edge?.put(key, Response.json({ ...best, refreshAfter }, { headers: { 'Cache-Control': 'public, max-age=31536000' } })); } catch { /* Still serve data. */ }
  return success(best);
}

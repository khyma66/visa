import { createNewsService } from '@/lib/news';
import { isNewsFeedData, NEWS_CACHE_MS } from '@/lib/news-shared';
import type { NewsFeedData } from '@/lib/news-shared';

export const runtime = 'edge';
const getNews = createNewsService();
type EdgeCache = { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<void> };

function newsResponse(data: NewsFeedData) {
  const secondsRemaining = Math.max(1, Math.ceil((Date.parse(data.retrievedAt) + NEWS_CACHE_MS - Date.now()) / 1_000));
  return Response.json(data, {
    headers: { 'Cache-Control': `public, max-age=${Math.min(60, secondsRemaining)}, s-maxage=${secondsRemaining}`, 'X-Content-Type-Options': 'nosniff' },
  });
}

export async function GET(request: Request) {
  // Google RSS restricts reuse to personal, non-commercial feed readers.
  // Enable only when source permission or eligible use has been established.
  // Check before cache reads so disabling reuse immediately stops serving cached results.
  if (process.env.GOOGLE_NEWS_RSS_ENABLED !== 'true') {
    return Response.json({ status: 'external' }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  const edgeCache = typeof caches === 'undefined' ? undefined : (caches as unknown as { default?: EdgeCache }).default;
  // Canonical key shares the same public feed across visitors and arbitrary URL queries.
  const cacheKey = new Request(new URL('/api/news?feed=google-visa-v1', request.url));
  if (edgeCache) {
    try {
      const cached = await edgeCache.match(cacheKey);
      if (cached?.ok) {
        const data: unknown = await cached.json();
        if (isNewsFeedData(data)) {
          const age = Date.now() - Date.parse(data.retrievedAt);
          if (age >= 0 && age < NEWS_CACHE_MS) return newsResponse(data);
        }
      }
    } catch { /* Cache availability must not block a fresh read. */ }
  }
  try {
    const response = newsResponse(await getNews());
    if (edgeCache) {
      try { await edgeCache.put(cacheKey, response.clone()); } catch { /* Serve a successful fetch even if caching fails. */ }
    }
    return response;
  } catch {
    return Response.json({ status: 'unavailable', error: 'News headlines are temporarily unavailable. Try again or read the latest visa news on Google News.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' },
    });
  }
}

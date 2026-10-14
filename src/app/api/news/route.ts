import { createNewsService } from '@/lib/news';
import { isNewsFeedData, NEWS_CACHE_MS, NEWS_FAILURE_BACKOFF_MS } from '@/lib/news-shared';
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

function unavailableResponse(retryAfter = NEWS_FAILURE_BACKOFF_MS / 1_000) {
  return Response.json({ status: 'unavailable', error: 'News headlines are temporarily unavailable. Try again or read the latest visa news on Google News.' }, {
    status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(retryAfter), 'X-Content-Type-Options': 'nosniff' },
  });
}

function cachedBackoffSeconds(value: unknown): number | null {
  if (!value || typeof value !== 'object' || !('status' in value) || value.status !== 'backoff'
    || !('retryAt' in value) || typeof value.retryAt !== 'number' || !Number.isFinite(value.retryAt)) return null;
  const remaining = value.retryAt - Date.now();
  return remaining > 0 && remaining <= NEWS_FAILURE_BACKOFF_MS ? Math.ceil(remaining / 1_000) : null;
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
        const retryAfter = cachedBackoffSeconds(data);
        if (retryAfter !== null) return unavailableResponse(retryAfter);
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
    if (edgeCache) {
      try {
        // Cache an internal marker, never the browser-facing error response.
        // A bounded failure window protects the upstream across warm isolates.
        await edgeCache.put(cacheKey, Response.json({ status: 'backoff', retryAt: Date.now() + NEWS_FAILURE_BACKOFF_MS }, {
          headers: { 'Cache-Control': `public, max-age=${NEWS_FAILURE_BACKOFF_MS / 1_000}` },
        }));
      } catch { /* The per-instance backoff still limits requests without Cache API. */ }
    }
    return unavailableResponse();
  }
}

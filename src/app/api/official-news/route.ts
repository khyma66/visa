import { createOfficialNewsService } from '@/lib/official-news';
import { isOfficialNews, OFFICIAL_NEWS_BACKOFF, OFFICIAL_NEWS_TTL, type OfficialNews } from '@/lib/official-news-shared';

export const runtime = 'edge';
type EdgeCache = { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<void> };
function success(data: OfficialNews) {
  const ttl = Math.max(1, Math.ceil((Date.parse(data.retrievedAt) + OFFICIAL_NEWS_TTL - Date.now()) / 1000));
  return Response.json(data, { headers: { 'Cache-Control': `public, max-age=${Math.min(60, ttl)}, s-maxage=${ttl}`, 'X-Content-Type-Options': 'nosniff' } });
}
function unavailable(retry = 60) {
  return Response.json({ status: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(retry), 'X-Content-Type-Options': 'nosniff' } });
}
export async function GET(request: Request) {
  const edgeCache = typeof caches === 'undefined' ? undefined : (caches as unknown as { default?: EdgeCache }).default;
  // One public cache key per edge, irrespective of query strings or visitor identity.
  const key = new Request(new URL('/api/official-news?feed=visa-v1', request.url));
  try {
    const cached = await edgeCache?.match(key);
    if (cached?.ok) {
      const value = await cached.json();
      if (isOfficialNews(value) && Date.now() - Date.parse(value.retrievedAt) < OFFICIAL_NEWS_TTL) return success(value);
      if (value && typeof value === 'object' && 'status' in value && value.status === 'backoff' && 'retryAt' in value && typeof value.retryAt === 'number' && Number.isFinite(value.retryAt)) {
        const remaining = value.retryAt - Date.now();
        if (remaining > 0 && remaining <= OFFICIAL_NEWS_BACKOFF) return unavailable(Math.ceil(remaining / 1000));
      }
    }
  } catch { /* Cache failure is not a source failure. */ }
  try {
    // Keep fetch promises inside this request's I/O context. Cross-request reuse
    // goes through the edge cache, never a module-scoped in-flight promise.
    const response = success(await createOfficialNewsService()());
    try { await edgeCache?.put(key, response.clone()); } catch { /* Serve the successful response. */ }
    return response;
  } catch {
    try { await edgeCache?.put(key, Response.json({ status: 'backoff', retryAt: Date.now() + OFFICIAL_NEWS_BACKOFF }, { headers: { 'Cache-Control': 'public, max-age=60' } })); } catch { /* Return an explicit, uncached error if edge storage is unavailable. */ }
    return unavailable();
  }
}

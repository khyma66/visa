import { boundedNewsBytes, loadLicensedNews, newsCache, newsImageType } from '@/lib/licensed-news';
export const runtime = 'edge';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const missing = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'public, max-age=60', 'X-Content-Type-Options': 'nosniff' } });
  if (!/^tt-\d{1,10}-[a-f0-9]{16}$/.test(id) || new URL(request.url).search) return missing();
  try {
    // Never accept a caller-provided image URL. Only exact images in the reviewed edition may be fetched.
    const { edition } = await loadLicensedNews();
    const photo = edition.articles.find(a => a.photo?.id === id)?.photo;
    if (!photo) return missing();
    const cache = await newsCache(); const key = new Request(`https://visathreads.com/__news-cache/photo/${id}`);
    const cached = await cache?.match(key).catch(() => undefined); if (cached) return cached;
    const upstream = await fetch(photo.url, { signal: AbortSignal.timeout(8000), redirect: 'error', credentials: 'omit', headers: { Accept: 'image/jpeg,image/png,image/webp' } });
    const bytes = await boundedNewsBytes(upstream, 768_000);
    const type = newsImageType(bytes); if (!type) return missing();
    const response = new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' } });
    await cache?.put(key, response.clone()).catch(() => {});
    return response;
  } catch { return missing(); }
}

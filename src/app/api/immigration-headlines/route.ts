import { isImmigrationHeadlines } from '@/lib/immigration-headlines';

export const runtime = 'edge';
const EDITION_URL = 'https://raw.githubusercontent.com/khyma66/visa/news-data/immigration-headlines.json';

export async function GET() {
  try {
    const response = await fetch(EDITION_URL, { signal: AbortSignal.timeout(5000), redirect: 'manual', credentials: 'omit' });
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > 256 * 1024) {
      await response.body?.cancel().catch(() => {});
      throw new Error('No available headlines edition');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let body = '', bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        bytes += value.byteLength; if (bytes > 256 * 1024) throw new Error('Edition too large');
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const edition: unknown = JSON.parse(body);
    if (!isImmigrationHeadlines(edition) || !edition.articles.length) throw new Error('Invalid headline edition');
    return Response.json(edition, { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=900', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60', 'X-Content-Type-Options': 'nosniff' } });
  }
}

import { OFFICIAL_NEWS_BACKOFF, OFFICIAL_NEWS_TTL, parseOfficialNews, type OfficialNews } from './official-news-shared';

const query = new URLSearchParams({ per_page: '60', order: 'newest', 'conditions[term]': 'visa' });
for (const field of ['title', 'document_number', 'html_url', 'publication_date', 'type', 'agencies']) query.append('fields[]', field);
export const OFFICIAL_NEWS_URL = `https://www.federalregister.gov/api/v1/documents.json?${query}`;
const MAX_BYTES = 512 * 1024;

/** Fixed, anonymous public source. No keys, user content, cookies, or prompts leave the app. */
export function createOfficialNewsService(fetcher: typeof fetch = fetch, now = Date.now, timeoutMs = 8000) {
  let cached: OfficialNews | undefined;
  let pending: Promise<OfficialNews> | undefined;
  let retryAt = 0;
  return function getNews(): Promise<OfficialNews> {
    const age = cached ? now() - Date.parse(cached.retrievedAt) : Infinity;
    if (cached && age >= 0 && age < OFFICIAL_NEWS_TTL) return Promise.resolve(cached);
    if (now() < retryAt) return Promise.reject(new Error('News temporarily unavailable'));
    if (pending) return pending;
    pending = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(OFFICIAL_NEWS_URL, { signal: controller.signal, redirect: 'error', credentials: 'omit', headers: { Accept: 'application/json', 'User-Agent': 'VisaThreads/1.0 (+https://visathreads.com/contact)' } });
        if (!response.ok || !response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || Number(response.headers.get('content-length')) > MAX_BYTES) {
          console.warn('Official visa news upstream rejected', { status: response.status, contentType: response.headers.get('content-type')?.slice(0, 80) });
          await response.body?.cancel(); throw new Error('Invalid upstream response');
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let bytes = 0, body = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > MAX_BYTES) throw new Error('Response too large');
            body += decoder.decode(value, { stream: true });
          }
          body += decoder.decode();
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        cached = parseOfficialNews(JSON.parse(body), now());
        retryAt = 0;
        return cached;
      } catch (error) { console.warn('Official visa news refresh failed', { kind: error instanceof Error ? error.name : 'Unknown' }); retryAt = now() + OFFICIAL_NEWS_BACKOFF; throw new Error('News temporarily unavailable'); }
      finally { clearTimeout(timer); pending = undefined; }
    })();
    return pending;
  };
}

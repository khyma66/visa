export type NewsAgency = 'all' | 'uscis' | 'state';
export type NewsDocumentType = 'Rule' | 'Proposed Rule' | 'Notice' | 'Other';
export type NewsArticle = {
  id: string;
  title: string;
  publishedAt: string;
  sourceUrl: string;
  agency: Exclude<NewsAgency, 'all'>;
  agencyName: string;
  documentType: NewsDocumentType;
};
export type NewsFeedData = {
  status: 'ok';
  articles: NewsArticle[];
  agency: NewsAgency;
  retrievedAt: string;
  limit: number;
};

export const NEWS_LIMIT = 24;
export const NEWS_CACHE_MS = 5 * 60_000;
export const NEWS_TIMEOUT_MS = 8_000;
export const NEWS_MAX_BYTES = 512 * 1024;
export const NEWS_SOURCES = [
  { name: 'USCIS newsroom', url: 'https://www.uscis.gov/newsroom' },
  { name: 'State Department visa news', url: 'https://travel.state.gov/content/travel/en/News/visas-news.html' },
  { name: 'Visa Bulletin', url: 'https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin.html' },
] as const;

const agencySlugs = {
  uscis: 'u-s-citizenship-and-immigration-services',
  state: 'state-department',
} as const;
const agencyNames = { uscis: 'USCIS', state: 'Department of State' } as const;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function isNewsAgency(value: unknown): value is NewsAgency {
  return value === 'all' || value === 'uscis' || value === 'state';
}

// This URL never includes arbitrary user input, credentials or case data.
export function buildNewsUrl(agency: NewsAgency, currentTime = Date.now()): string {
  if (!isNewsAgency(agency)) throw new Error('Invalid news agency');
  const url = new URL('https://www.federalregister.gov/api/v1/documents.json');
  for (const value of agency === 'all' ? Object.values(agencySlugs) : [agencySlugs[agency]]) {
    url.searchParams.append('conditions[agencies][]', value);
  }
  url.searchParams.set('conditions[term]', 'visa OR immigration OR citizenship');
  url.searchParams.set('conditions[publication_date][gte]', new Date(currentTime - 365 * 86_400_000).toISOString().slice(0, 10));
  url.searchParams.set('conditions[publication_date][lte]', new Date(currentTime).toISOString().slice(0, 10));
  url.searchParams.set('order', 'newest');
  url.searchParams.set('per_page', String(NEWS_LIMIT));
  for (const field of ['document_number', 'title', 'publication_date', 'html_url', 'type', 'agencies']) {
    url.searchParams.append('fields[]', field);
  }
  return url.toString();
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function safeNewsUrl(value: unknown, date: string, id: string): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    const prefix = `/documents/${date.replaceAll('-', '/')}/${id}/`;
    return url.protocol === 'https:' && url.hostname === 'www.federalregister.gov'
      && !url.port && !url.username && !url.password && url.pathname.startsWith(prefix)
      ? url.toString() : null;
  } catch { return null; }
}

export function normalizeNews(payload: unknown, requestedAgency: NewsAgency): NewsArticle[] {
  if (!isRecord(payload) || !Array.isArray(payload.results)) throw new Error('Invalid news response');
  const articles = new Map<string, NewsArticle>();
  for (const record of payload.results.slice(0, NEWS_LIMIT)) {
    if (!isRecord(record) || typeof record.document_number !== 'string'
      || !/^\d{4}-\d{4,6}$/.test(record.document_number)
      || typeof record.title !== 'string' || !record.title.trim() || record.title.length > 1_200
      || !validDate(record.publication_date) || !Array.isArray(record.agencies)) continue;
    const agencies = record.agencies;
    const allowedAgencies = requestedAgency === 'all'
      ? Object.keys(agencySlugs) as Array<Exclude<NewsAgency, 'all'>> : [requestedAgency];
    const agency = allowedAgencies
      .find((key) => agencies.some((item: unknown) => isRecord(item) && item.slug === agencySlugs[key]));
    if (!agency || (requestedAgency !== 'all' && agency !== requestedAgency)) continue;
    const sourceUrl = safeNewsUrl(record.html_url, record.publication_date, record.document_number);
    if (!sourceUrl) continue;
    const documentType = ['Rule', 'Proposed Rule', 'Notice'].includes(String(record.type))
      ? record.type as NewsDocumentType : 'Other';
    articles.set(record.document_number, {
      id: record.document_number,
      title: record.title.trim(),
      publishedAt: record.publication_date,
      sourceUrl,
      agency,
      agencyName: agencyNames[agency],
      documentType,
    });
  }
  // A nonempty malformed response is a source failure, not an empty news day.
  if (payload.results.length && !articles.size) throw new Error('No valid news records');
  return [...articles.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
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
    return JSON.parse(body + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Bounded to three keys, coalesces concurrent reads within each Worker isolate.
// Response cache headers also permit shared HTTP caches to reuse successful reads.
export function createNewsService(fetcher: typeof fetch = fetch, now: () => number = Date.now, timeoutMs = NEWS_TIMEOUT_MS) {
  const cache = new Map<NewsAgency, { expiresAt: number; data: NewsFeedData }>();
  const pending = new Map<NewsAgency, Promise<NewsFeedData>>();
  return async function getNews(agency: NewsAgency): Promise<NewsFeedData> {
    if (!isNewsAgency(agency)) throw new Error('Invalid news agency');
    const cached = cache.get(agency);
    if (cached && cached.expiresAt > now()) return cached.data;
    const existing = pending.get(agency);
    if (existing) return existing;
    const task = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(buildNewsUrl(agency, now()), {
          signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' },
        });
        const articles = normalizeNews(await readBoundedJson(response), agency);
        const data: NewsFeedData = { status: 'ok', articles, agency, retrievedAt: new Date(now()).toISOString(), limit: NEWS_LIMIT };
        cache.set(agency, { expiresAt: now() + NEWS_CACHE_MS, data });
        return data;
      } finally { clearTimeout(timer); }
    })();
    pending.set(agency, task);
    try { return await task; } finally { pending.delete(agency); }
  };
}

export function filterNews(articles: NewsArticle[], type: string, query: string): NewsArticle[] {
  const term = query.trim().toLowerCase();
  return articles.filter((article) => (type === 'all' || article.documentType === type)
    && (!term || `${article.title} ${article.agencyName}`.toLowerCase().includes(term)));
}

export function isNewsFeedData(value: unknown): value is NewsFeedData {
  return isRecord(value) && value.status === 'ok' && isNewsAgency(value.agency)
    && typeof value.retrievedAt === 'string' && Number.isFinite(Date.parse(value.retrievedAt))
    && value.limit === NEWS_LIMIT && Array.isArray(value.articles) && value.articles.length <= NEWS_LIMIT
    && value.articles.every((item) => isRecord(item) && typeof item.id === 'string'
      && /^\d{4}-\d{4,6}$/.test(item.id) && typeof item.title === 'string' && item.title.length <= 1_200
      && validDate(item.publishedAt) && Boolean(safeNewsUrl(item.sourceUrl, item.publishedAt, item.id))
      && (item.agency === 'uscis' || item.agency === 'state')
      && item.agencyName === agencyNames[item.agency]
      && ['Rule', 'Proposed Rule', 'Notice', 'Other'].includes(String(item.documentType)));
}

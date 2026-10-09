export const OFFICIAL_NEWS_TTL = 15 * 60_000;
export const OFFICIAL_NEWS_BACKOFF = 60_000;
export const OFFICIAL_NEWS_LIMIT = 24;
export const OFFICIAL_DOCUMENT_TYPES = ['Rule', 'Proposed Rule', 'Notice', 'Presidential Document'] as const;
export type OfficialArticle = { id: string; title: string; url: string; publishedOn: string; type: typeof OFFICIAL_DOCUMENT_TYPES[number]; agencies: string[] };
export type OfficialNews = { source: 'Federal Register'; articles: OfficialArticle[]; retrievedAt: string };
const ALLOWED_AGENCIES = new Set(['homeland-security-department', 'citizenship-and-immigration-services', 'u-s-customs-and-border-protection', 'state-department', 'justice-department', 'executive-office-of-the-president', 'labor-department']);
const VISA_TOPIC = /\b(?:visas?|immigra(?:nt|tion)|nonimmigrant|H-?1B|H-?4|L-?1|F-?1|OPT|optional practical training|USCIS|citizenship|academic students)\b/i;

function text(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\x00-\x1f\x7f<>]/.test(value);
}
function publishedDate(value: unknown, now: number): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value && timestamp <= now && now - timestamp <= 180 * 86_400_000;
}
export function safeOfficialUrl(value: unknown, id: string, date: string): value is string {
  if (typeof value !== 'string' || value.length > 2000 || !/^\d{4}-\d{4,6}$/.test(id)) return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://www.federalregister.gov' && !url.username && !url.password && !url.search && !url.hash
      && url.pathname.startsWith(`/documents/${date.replaceAll('-', '/')}/${id}/`) && /^\/[a-z0-9/-]+$/.test(url.pathname);
  } catch { return false; }
}
export function parseOfficialNews(value: unknown, now = Date.now()): OfficialNews {
  if (!value || typeof value !== 'object' || !('results' in value) || !Array.isArray(value.results) || value.results.length > 60) throw new Error('Invalid official feed');
  const articles: OfficialArticle[] = [];
  const seen = new Set<string>();
  for (const row of value.results) {
    if (!row || typeof row !== 'object' || !text(row.title, 1000) || !VISA_TOPIC.test(row.title)
      || !text(row.document_number, 20) || !publishedDate(row.publication_date, now)
      || !safeOfficialUrl(row.html_url, row.document_number, row.publication_date)
      || !OFFICIAL_DOCUMENT_TYPES.includes(row.type) || !Array.isArray(row.agencies) || row.agencies.length > 20
      || !row.agencies.some((agency: { slug?: string }) => agency && ALLOWED_AGENCIES.has(agency.slug ?? '')) || seen.has(row.document_number)) continue;
    const agencies = row.agencies.filter((agency: { name?: unknown }) => agency && text(agency.name, 200)).map((agency: { name: string }) => agency.name).slice(0, 5);
    if (!agencies.length) continue;
    seen.add(row.document_number);
    articles.push({ id: row.document_number, title: row.title, url: row.html_url, publishedOn: row.publication_date, type: row.type, agencies });
  }
  articles.sort((a, b) => b.publishedOn.localeCompare(a.publishedOn) || b.id.localeCompare(a.id));
  return { source: 'Federal Register', articles: articles.slice(0, OFFICIAL_NEWS_LIMIT), retrievedAt: new Date(now).toISOString() };
}
export function isOfficialNews(value: unknown, now = Date.now()): value is OfficialNews {
  if (!value || typeof value !== 'object' || !('source' in value) || value.source !== 'Federal Register'
    || !('retrievedAt' in value) || typeof value.retrievedAt !== 'string' || !Number.isFinite(Date.parse(value.retrievedAt))
    || Date.parse(value.retrievedAt) > now || !('articles' in value) || !Array.isArray(value.articles) || value.articles.length > OFFICIAL_NEWS_LIMIT) return false;
  const seen = new Set<string>();
  return value.articles.every(row => {
    if (!row || typeof row !== 'object' || !text(row.id, 20) || seen.has(row.id) || !text(row.title, 1000)
      || !VISA_TOPIC.test(row.title) || !publishedDate(row.publishedOn, now) || !safeOfficialUrl(row.url, row.id, row.publishedOn)
      || !OFFICIAL_DOCUMENT_TYPES.includes(row.type) || !Array.isArray(row.agencies) || !row.agencies.length || row.agencies.length > 5
      || !row.agencies.every((name: unknown) => text(name, 200))) return false;
    seen.add(row.id); return true;
  });
}

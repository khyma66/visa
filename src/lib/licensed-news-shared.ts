export const LICENSED_NEWS_POLICY = 'https://www.texastribune.org/republishing-guidelines/';
export const LICENSED_NEWS_LIMIT = 12;
export const LICENSED_NEWS_REFRESH_MS = 60 * 60_000;
export type LicensedNewsPhoto = { id: string; url: string; caption: string; credit: string; width: number; height: number };
export type LicensedNewsArticle = {
  id: string; title: string; url: string; author: string; publishedAt: string; excerpt: string;
  publisher: 'The Texas Tribune'; permissionUrl: typeof LICENSED_NEWS_POLICY; photo?: LicensedNewsPhoto;
};
export type LicensedNewsEdition = { source: 'The Texas Tribune'; retrievedAt: string; policyCheckedAt: string; policyDigest: string; articles: LicensedNewsArticle[] };
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[<>\x00-\x1f\x7f]/.test(value);
export function licensedStoryUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { const u = new URL(value); return u.origin === 'https://www.texastribune.org' && !u.username && !u.password && !u.search && !u.hash && /^\/20\d{2}\/\d{2}\/\d{2}\/[a-z0-9-]+\/$/.test(u.pathname); } catch { return false; }
}
export function licensedPhotoUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1500) return false;
  try {
    const u = new URL(value);
    return u.origin === 'https://i0.wp.com' && !u.username && !u.password && !u.hash
      && /^\/www\.texastribune\.org\/wp-content\/uploads\/20\d{2}\/\d{2}\/[a-zA-Z0-9_.-]+\.(?:jpg|jpeg|png|webp)$/i.test(u.pathname)
      && [...u.searchParams.keys()].every(key => ['fit', 'ssl'].includes(key))
      && /^\d{2,4},\d{2,4}$/.test(u.searchParams.get('fit') ?? '') && u.searchParams.get('ssl') === '1';
  } catch { return false; }
}
export function licensedPhotoCredit(value: unknown): value is string {
  return text(value, 200) && /(?:for |\/|, |© |^)(?:The )?Texas Tribune$/i.test(value)
    && !/\b(?:Reuters|Getty|AP|Associated Press|Alamy|Shutterstock|handout|courtesy|illustration|graphic|collage)\b/i.test(value);
}
export function isLicensedNews(value: unknown, now = Date.now()): value is LicensedNewsEdition {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<LicensedNewsEdition>;
  const validTime = (time: unknown) => typeof time === 'string' && Number.isFinite(Date.parse(time)) && Date.parse(time) <= now + 300_000;
  if (v.source !== 'The Texas Tribune' || !validTime(v.retrievedAt) || !validTime(v.policyCheckedAt)
    || typeof v.policyDigest !== 'string' || !/^[a-f0-9]{64}$/.test(v.policyDigest)
    || !Array.isArray(v.articles) || v.articles.length > LICENSED_NEWS_LIMIT) return false;
  const seen = new Set<string>();
  return v.articles.every(a => {
    if (!a || typeof a !== 'object' || !/^tt-\d{1,10}$/.test(a.id) || seen.has(a.id) || !text(a.title, 500)
      || !licensedStoryUrl(a.url) || !text(a.author, 240) || !validTime(a.publishedAt) || !text(a.excerpt, 800)
      || a.publisher !== v.source || a.permissionUrl !== LICENSED_NEWS_POLICY) return false;
    if (a.photo && (!new RegExp(`^${a.id}-[a-f0-9]{16}$`).test(a.photo.id) || !licensedPhotoUrl(a.photo.url)
      || !text(a.photo.caption, 1400) || !licensedPhotoCredit(a.photo.credit)
      || !Number.isInteger(a.photo.width) || !Number.isInteger(a.photo.height)
      || a.photo.width < 100 || a.photo.width > 1600 || a.photo.height < 100 || a.photo.height > 1600)) return false;
    seen.add(a.id); return true;
  });
}

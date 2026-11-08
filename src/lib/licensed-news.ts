import snapshot from '@/data/licensed-news-snapshot.json';
import { isLicensedNews, LICENSED_NEWS_STALE_MS, type LicensedNewsEdition } from './licensed-news-shared';

const EDITION_URL = 'https://raw.githubusercontent.com/khyma66/visa/news-data/licensed-news.json';
export async function boundedNewsBytes(response: Response, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > maximum) {
    await response.body?.cancel().catch(() => {}); throw new Error('News response unavailable');
  }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > maximum) throw new Error('News response too large'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export async function newsCache(): Promise<Cache | null> {
  try { return typeof caches === 'undefined' ? null : await caches.open('visathreads-licensed-news-v1'); } catch { return null; }
}
async function loadLicensedEdition(): Promise<{ edition: LicensedNewsEdition; stale: boolean }> {
  const cache = await newsCache();
  const key = new Request('https://visathreads.com/__news-cache/edition-v1');
  const savedKey = new Request('https://visathreads.com/__news-cache/last-good-edition-v1');
  const cached = await cache?.match(key).catch(() => undefined);
  if (cached) { const value: unknown = await cached.json().catch(()=>null); if (isLicensedNews(value)) return { edition: value, stale: Date.now() - Date.parse(value.retrievedAt) > LICENSED_NEWS_STALE_MS }; }
  try {
    // workerd supports manual/follow, not redirect:error. boundedNewsBytes rejects 3xx.
    const response = await fetch(EDITION_URL, { signal: AbortSignal.timeout(5000), redirect: 'manual', credentials: 'omit' });
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedNewsBytes(response, 100_000)));
    if (!isLicensedNews(value)) throw new Error('Invalid licensed news edition');
    await cache?.put(key, Response.json(value, { headers: { 'Cache-Control': 'public, max-age=300' } })).catch(() => {});
    await cache?.put(savedKey, Response.json(value, { headers: { 'Cache-Control': 'public, max-age=86400' } })).catch(() => {});
    return { edition: value, stale: Date.now() - Date.parse(value.retrievedAt) > LICENSED_NEWS_STALE_MS };
  } catch {
    const saved = await cache?.match(savedKey).catch(() => undefined);
    if (saved) { const value: unknown = await saved.json().catch(()=>null); if (isLicensedNews(value)) return { edition: value, stale: true }; }
    // Bundled edition provides useful first paint, not a fabricated successful refresh timestamp.
    if (!isLicensedNews(snapshot)) throw new Error('No valid news edition');
    return { edition: snapshot, stale: true };
  }
}
let editionRequest:ReturnType<typeof loadLicensedEdition>|null=null;
export function loadLicensedNews():ReturnType<typeof loadLicensedEdition>{
  if(editionRequest)return editionRequest;
  editionRequest=loadLicensedEdition().finally(()=>{editionRequest=null;});return editionRequest;
}
export function newsImageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b)) return 'image/png';
  if (new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP') return 'image/webp';
  return null;
}

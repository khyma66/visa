import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const code = ts.transpileModule(await readFile(new URL('../src/lib/licensed-news-shared.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { isLicensedNews } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const origin = process.argv[2] || 'https://visathreads.com';
assert(['https://visathreads.com', 'https://visa-central.com'].includes(origin), 'Use only an intended deployment.');
const get = path => fetch(origin + path, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(20_000) });
const response = await get('/api/licensed-news');
assert.equal(response.status, 200, 'Licensed news API must be available.');
const edition = await response.json();
assert(isLicensedNews(edition), 'Edition must retain permission proof and attribution.');
let photos = 0;
for (const article of edition.articles) {
  if (!article.photo) continue;
  const image = await get('/api/news-photo/' + article.photo.id);
  assert.equal(image.status, 200, `Credited photo must load: ${article.id}`);
  assert.match(image.headers.get('content-type') || '', /^image\/(jpeg|png|webp)$/);
  assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
  const bytes = new Uint8Array(await image.arrayBuffer());
  assert(bytes.length > 100 && bytes.length <= 768_000, 'Photo payload must be useful and bounded.');
  photos++;
}
const denied = await get('/api/news-photo/unknown?url=https://example.com');
assert.equal(denied.status, 404, 'Image route must not be an arbitrary URL proxy.');
console.log(JSON.stringify({ origin, status: 'verified', previews: edition.articles.length, photos, updated: edition.retrievedAt, stale: edition.stale, scope: 'Live API and photo checks; not a browser visual review.' }));

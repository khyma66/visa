import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/** Anonymous, read-only migration checks. Never follow a redirect to another origin. */
export async function verifyDestinationRoutes(origin) {
  const base = new URL(origin);
  assert(['https:', 'http:'].includes(base.protocol) && base.pathname === '/' && !base.search && !base.hash && !base.username && !base.password);
  const get = path => fetch(new URL(path, base), { redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  for (const suffix of ['', '?q=h1b&tag=f1&tag=h4']) {
    const response = await get('/'+suffix);
    try {
      assert.equal(response.status,307,'homepage uses a changeable default');
      assert.equal(new URL(response.headers.get('location'),base).href,base.origin+'/us/en'+suffix);
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    } finally { await response.body?.cancel(); }
  }
  for (const [from,to] of [['/us','/us/en'],['/news','/us/en/news'],['/tags','/us/en/tags'],['/explore','/us/en/explore'],['/guides','/us/en/guides'],['/experiences','/us/en/experiences'],['/questions/migration-check','/us/en/questions/migration-check'],['/c/migration-check','/us/en/c/migration-check']]) {
    const response = await get(from+'?sort=score&tag=h1b&tag=f1');
    try { assert.equal(response.status,308,from); assert.equal(new URL(response.headers.get('location'),base).href,base.origin+to+'?sort=score&tag=h1b&tag=f1'); }
    finally { await response.body?.cancel(); }
  }
  for (const path of ['/us/en','/us/en/news','/us/en/guides']) {
    const response = await get(path);assert.equal(response.status,200,path);
    const html = await response.text();
    assert(html.includes(`rel="canonical" href="https://visathreads.com${path}"`),path+' canonical');
    assert.match(html,/nonce=/,path+' nonce');
    assert(!html.includes('Visa destination: United States'), 'Removed destination banner');
  }
  for (const path of ['/gb/en','/ca/fr','/au/en','/us/fr','/us/en/login','/us/en/api/health','/us/en/admin/reports']) {
    const response=await get(path);
    try { assert.equal(response.status,404,path+' must not expose the US application'); }
    finally { await response.body?.cancel(); }
  }
  console.log('PASS destination routes, same-origin legacy redirects, canonical URLs and unopened-country 404s.');
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) await verifyDestinationRoutes(process.argv[2]);

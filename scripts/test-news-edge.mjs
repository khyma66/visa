import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import ts from 'typescript';

test('official news request options and parsing work in the real edge runtime without following redirects', { timeout: 20_000 }, async () => {
  const compile = async path => ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  const shared = await compile('../src/lib/official-news-shared.ts');
  const service = (await compile('../src/lib/official-news.ts')).replace(/^import .* from ['"].*['"];?\s*$/m, '');
  // Actual workerd Request validates the service's options; response is a local
  // fixture. No real network requests, API keys, accounts, or hosted writes.
  const script = (shared + service).replace(/^export /gm, '') + `
    export default { async fetch() {
      let redirectRejected = false;
      const fixtureFetch = async (url, options) => {
        const request = new Request(url, options);
        if (request.redirect !== 'manual' || request.headers.has('Cookie') || request.headers.has('Authorization')) throw new Error('Unsafe request');
        return Response.json({results:[{title:'Optional Practical Training Fees',document_number:'2026-20660',html_url:'https://www.federalregister.gov/documents/2026/10/08/2026-20660/optional-practical-training-fees',publication_date:'2026-10-08',type:'Proposed Rule',agencies:[{name:'Homeland Security Department',slug:'homeland-security-department'}]}]});
      };
      const feed = await createOfficialNewsService(fixtureFetch, () => Date.parse('2026-10-08T12:00:00Z'))();
      try { await createOfficialNewsService(async () => new Response('', {status:302,headers:{Location:'https://example.invalid/'}}))(); } catch { redirectRejected = true; }
      return Response.json({articles:feed.articles.length,source:feed.source,redirectRejected});
    }};
  `;
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, compatibilityDate: '2026-09-09', script }));
  try {
    const result = await runtime.dispatchFetch('http://localhost/'); assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { articles: 1, source: 'Federal Register', redirectRejected: true });
  } finally { await runtime.dispose(); }
});

test('licensed edition and photo requests use workerd-supported options and reject redirects', { timeout: 20_000 }, async () => {
  const compile = async path => ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace(/^import .* from ['"].*['"];?\s*$/gm, '').replace(/^export /gm, '');
  const snapshot = JSON.parse(await readFile(new URL('../src/data/licensed-news-snapshot.json', import.meta.url), 'utf8'));
  snapshot.retrievedAt = new Date().toISOString();
  snapshot.policyCheckedAt = snapshot.retrievedAt;
  const script = `const snapshot = ${JSON.stringify(snapshot)};\n`
    + await compile('../src/lib/licensed-news-shared.ts')
    + await compile('../src/lib/licensed-news.ts')
    + await compile('../src/app/api/news-photo/[id]/route.ts') + `
    export default { async fetch() {
      let calls = 0, redirectPhoto = false;
      globalThis.fetch = async (url, options) => {
        // Instantiate the actual workerd Request. A plain mocked Node fetch misses unsupported options.
        const request = new Request(url, options); calls++;
        if (request.redirect !== 'manual' || request.headers.has('Cookie') || request.headers.has('Authorization')) throw new Error('Unsafe request options');
        if (String(url).includes('raw.githubusercontent.com')) return Response.json(snapshot);
        return redirectPhoto ? new Response(null, {status:302,headers:{Location:'https://example.invalid/'}}) : new Response(new Uint8Array([255,216,255,224,0,1]));
      };
      const edition = await loadLicensedNews();
      const id = snapshot.articles[0].photo.id;
      const request = new Request('https://visathreads.com/api/news-photo/' + id);
      const params = Promise.resolve({id});
      const image = await GET(request, {params});
      const byteCount = (await image.arrayBuffer()).byteLength;
      const cache = await newsCache();
      await cache.delete('https://visathreads.com/__news-cache/photo/' + id);
      redirectPhoto = true;
      const redirect = await GET(request, {params});
      return Response.json({stale:edition.stale, imageStatus:image.status, imageType:image.headers.get('content-type'), byteCount, redirectStatus:redirect.status, calls});
    }};`;
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, compatibilityDate: '2026-09-09', script }));
  try {
    const response = await runtime.dispatchFetch('http://localhost/');assert.equal(response.status,200);
    const result = await response.json();
    assert.equal(result.stale,false);assert.equal(result.imageStatus,200);assert.equal(result.imageType,'image/jpeg');
    assert.equal(result.byteCount,6);assert.equal(result.redirectStatus,404);assert.equal(result.calls,3);
  } finally { await runtime.dispose(); }
});

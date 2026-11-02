import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/immigration-headlines.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { parseGdelt, isImmigrationHeadlines } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
export const GDELT_QUERY = '("US immigration" OR "U.S. visa" OR "H-1B visa" OR "USCIS" OR "green card") sourcelang:english';
export async function refreshImmigrationHeadlines(previous, fetcher = fetch, now = Date.now) {
  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  for (const [key, value] of Object.entries({ query: GDELT_QUERY, mode: 'artlist', format: 'json', timespan: '3d', maxrecords: '100', sort: 'datedesc' })) url.searchParams.set(key, value);
  const response = await fetcher(url, { signal: AbortSignal.timeout(20_000), redirect: 'error', headers: { Accept: 'application/json' } });
  if (!response.ok || !response.body) throw new Error(`News index unavailable (${response.status}); existing edition preserved.`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let body = '', bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > 512 * 1024) throw new Error('News index too large');
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const fresh = parseGdelt(JSON.parse(body), now());
  if (!fresh.articles.length) throw new Error('No verified U.S. visa headlines; existing edition preserved.');
  const prior = isImmigrationHeadlines(previous, now()) ? previous.articles : [];
  const articles = new Map(prior.map(article => [article.url, article]));
  for (const article of fresh.articles) articles.set(article.url, article);
  const next = { ...fresh, articles: [...articles.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 30) };
  if (!isImmigrationHeadlines(next, now())) throw new Error('Invalid headline edition; existing edition preserved.');
  return next;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = process.argv[2] || 'src/data/immigration-headlines-snapshot.json';
  let previous;
  try { previous = JSON.parse(await readFile(output, 'utf8')); } catch { /* First edition. */ }
  const next = await refreshImmigrationHeadlines(previous);
  await writeFile(output, JSON.stringify(next, null, 2) + '\n');
  console.log(`Saved ${next.articles.length} attributed publisher headlines; checked ${next.retrievedAt}.`);
}

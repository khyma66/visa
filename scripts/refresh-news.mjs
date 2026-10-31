import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const sharedUrl = moduleUrl(compile(await readFile(new URL('../src/lib/official-news-shared.ts', import.meta.url), 'utf8')));
const { isOfficialNews, OFFICIAL_NEWS_LIMIT } = await import(sharedUrl);
const serviceCode = compile(await readFile(new URL('../src/lib/official-news.ts', import.meta.url), 'utf8')).replace("'./official-news-shared'", JSON.stringify(sharedUrl));
const { createOfficialNewsService } = await import(moduleUrl(serviceCode));
export async function refreshNews(previous, fetcher = fetch, now = Date.now) {
  const feeds = await Promise.allSettled(['visa', 'immigration'].map(term => createOfficialNewsService((url, options) => {
    const target = new URL(url); target.searchParams.set('conditions[term]', term);
    return fetcher(target, options);
  }, now)()));
  const good = feeds.filter(result => result.status === 'fulfilled' && result.value.articles.length).map(result => result.value);
  if (!good.length) throw new Error('All public sources failed; existing edition preserved.');
  const articles = new Map((isOfficialNews(previous, now()) ? previous.articles : []).map(article => [article.id, article]));
  for (const feed of good) for (const article of feed.articles) articles.set(article.id, article);
  const next = { source: 'Federal Register', retrievedAt: new Date(now()).toISOString(), articles: [...articles.values()].sort((a, b) => b.publishedOn.localeCompare(a.publishedOn) || b.id.localeCompare(a.id)).slice(0, OFFICIAL_NEWS_LIMIT) };
  if (!isOfficialNews(next, now())) throw new Error('Invalid edition; existing edition preserved.');
  return next;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = process.argv[2] || 'src/data/official-news-snapshot.json';
  let previous;
  try { previous = JSON.parse(await readFile(output, 'utf8')); } catch { /* First edition. */ }
  const next = await refreshNews(previous);
  await writeFile(output, JSON.stringify(next, null, 2) + '\n');
  console.log(`Saved ${next.articles.length} verified public notices; checked ${next.retrievedAt}.`);
}

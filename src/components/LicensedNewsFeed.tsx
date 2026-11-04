'use client';
import { useEffect, useState } from 'react';
import { isLicensedNews, LICENSED_NEWS_REFRESH_MS, type LicensedNewsArticle, type LicensedNewsEdition } from '@/lib/licensed-news-shared';

export function LicensedStory({ article, lead = false }: { article: LicensedNewsArticle; lead?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const photo = !imageFailed && article.photo;
  return <article className={lead ? 'overflow-hidden rounded-2xl border border-slate-200 bg-white' : 'border-b border-slate-200 py-6 last:border-0'}>
    <div className={lead ? `grid ${photo ? 'md:grid-cols-2' : ''}` : 'flex items-start gap-4 sm:gap-6'}>
      <div className={lead ? 'order-2 p-5 sm:p-7 md:order-1' : 'min-w-0 flex-1'}>
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500"><span className="font-semibold text-teal-800 capitalize">The Texas Tribune</span><span aria-hidden="true" className="capitalize">·</span><time dateTime={article.publishedAt}>{new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</time>{lead && <span className="rounded bg-orange-50 px-2 py-1 font-semibold text-orange-800 capitalize">In focus</span>}</div>
        <h3 className="text-thread-title font-semibold leading-snug text-slate-950"><a href={article.url} target="_blank" rel="noopener noreferrer" className="hover:text-teal-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700">{article.title}<span className="sr-only capitalize"> (opens in a new tab)</span></a></h3>
        <p className="mt-3 text-base leading-7 text-slate-600">{article.excerpt}</p>
        <p className="mt-3 text-xs leading-5 text-slate-500">By {article.author}, <a href="https://www.texastribune.org/" target="_blank" rel="noopener noreferrer" className="underline capitalize">The Texas Tribune</a></p>
        <a href={article.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800 hover:underline capitalize">Read the full story <span aria-hidden="true" className="capitalize">↗</span></a>
      </div>
      {photo && <figure className={lead ? 'order-1 min-w-0 bg-slate-50 md:order-2' : 'w-24 shrink-0 sm:w-44 lg:w-56'}>
          <img src={`/api/news-photo/${photo.id}`} alt={photo.caption} width={photo.width} height={photo.height} loading={lead ? 'eager' : 'lazy'} fetchPriority={lead ? 'high' : 'auto'} decoding="async" onError={() => setImageFailed(true)} className={lead ? 'h-auto w-full' : 'h-auto w-full rounded-lg'} />
        <figcaption className={lead ? 'px-4 py-3 text-xs leading-5 text-slate-500' : 'mt-2 text-xs leading-5 text-slate-500'}>
          {lead && <span className="mb-1 block">{photo.caption}</span>}Photo: {photo.credit}
          {!lead && <details className="mt-1"><summary className="cursor-pointer underline capitalize">Photo context</summary><p className="mt-1">{photo.caption}</p></details>}
        </figcaption>
      </figure>}
    </div>
  </article>;
}

export function LicensedNewsFeed({ initialEdition }: { initialEdition: LicensedNewsEdition }) {
  const [edition, setEdition] = useState(initialEdition);
  const [stale, setStale] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(5);
  useEffect(() => {
    let active = true; let controller: AbortController | undefined;
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      controller?.abort(); const requestController = new AbortController(); controller = requestController;
      const timer = setTimeout(() => requestController.abort(), 8000);
      try {
        const response = await fetch('/api/licensed-news', { signal: requestController.signal, credentials: 'omit' });
        if (!response.ok) throw new Error('Unavailable');
        const value: unknown = await response.json();
        if (!isLicensedNews(value)) throw new Error('Invalid news');
        if (active) { setEdition(current => Date.parse(value.retrievedAt) >= Date.parse(current.retrievedAt) ? value : current); setStale('stale' in value && value.stale === true); }
      } catch { if (active) setStale(true); } finally { clearTimeout(timer); }
    };
    void refresh(); const interval = setInterval(() => { void refresh(); }, LICENSED_NEWS_REFRESH_MS);
    return () => { active = false; controller?.abort(); clearInterval(interval); };
  }, []);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const articles = edition.articles.filter(a => words.every(w => `${a.title} ${a.excerpt} ${a.author}`.toLowerCase().includes(w)));
  const [lead, ...rest] = articles;
  return <section aria-labelledby="reporting-heading" className="border-b border-slate-200 py-7">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="capitalize"><p className="text-xs font-semibold tracking-[0.14em] text-teal-800 capitalize">Independent reporting</p><h2 id="reporting-heading" className="mt-1 text-thread-title font-semibold text-slate-950 capitalize">Immigration in the news</h2><p className="mt-1 text-sm text-slate-500 capitalize">From The Texas Tribune · Texas and U.S. immigration coverage</p></div>
      <p className="text-xs text-slate-500 capitalize">Updated <time dateTime={edition.retrievedAt}>{new Date(edition.retrievedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC</time></p>
    </div>
    <label className="mb-5 block max-w-md text-sm font-medium text-slate-600 capitalize"><span className="sr-only capitalize">Search independent reporting</span><input type="search" value={query} maxLength={120} onChange={e => { setQuery(e.target.value); setLimit(5); }} placeholder="Search immigration reporting…" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100" /></label>
    {(stale || Date.now() - Date.parse(edition.retrievedAt) > 3 * LICENSED_NEWS_REFRESH_MS) && <p role="status" className="mb-4 text-sm text-amber-900 capitalize">Showing the last saved edition. Story dates below are the original publication dates.</p>}
    {lead ? <><LicensedStory key={lead.photo?.id ?? lead.id} article={lead} lead /><div className="mt-2">{rest.slice(0, limit - 1).map(article => <LicensedStory key={article.photo?.id ?? article.id} article={article} />)}</div>{articles.length > limit && <button type="button" onClick={() => setLimit(v => v + 5)} className="mt-4 min-h-11 rounded-lg border border-slate-300 px-5 py-2 text-sm font-semibold hover:bg-white">More stories ({articles.length - limit})</button>}</> : <p role="status" className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600 capitalize">{query.trim() ? 'No stories match. Try a different search.' : 'No eligible reporting is available in this edition. Official updates remain below.'}</p>}
    <details className="mt-5 text-xs leading-5 text-slate-500"><summary className="cursor-pointer font-medium text-slate-600 capitalize">Sources &amp; photo credits</summary><p className="mt-2 capitalize">Publisher-provided previews link to the full reporting. Photos are shown only with the story they accompanied and retain the original credit. No stock illustrations or unlicensed wire-service photos.</p><p className="mt-2 capitalize"><a href="https://www.texastribune.org/" className="underline capitalize" target="_blank" rel="noopener noreferrer">The Texas Tribune</a> is a nonprofit, nonpartisan media organization that informs Texans — and engages with them — about public policy, politics, government and statewide issues. <a href="https://www.texastribune.org/republishing-guidelines/" className="underline capitalize" target="_blank" rel="noopener noreferrer">Republishing guidelines</a>. Feed checked hourly; publication frequency varies.</p></details>
  </section>;
}

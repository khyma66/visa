'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { GOOGLE_NEWS_SEARCH_URL, isNewsFeedData } from '@/lib/news-shared';
import type { NewsArticle, NewsFeedData } from '@/lib/news-shared';

const dateLabel = (value: string) => new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
}).format(new Date(value));

export function NewsResults({ feed }: { feed: NewsFeedData }) {
  const [lead, ...remaining] = feed.articles;
  return <>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-4">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-teal-800">The latest coverage</p>
      <p role="status" className="text-xs leading-5 text-slate-500">{feed.articles.length} {feed.articles.length === 1 ? 'headline' : 'headlines'} · Updated <time dateTime={feed.retrievedAt}>{dateLabel(feed.retrievedAt)}</time></p>
    </div>
    {!lead ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><p className="font-semibold text-slate-800">No recent visa headlines were returned.</p><p className="mt-2 text-sm text-slate-600">Check Google News for more coverage.</p></div>
      : <>
        <div className={`grid gap-4 ${remaining.length ? 'lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]' : ''}`}>
          <NewsStory article={lead} featured />
          {remaining.length > 0 && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">{remaining.slice(0, 2).map(article => <NewsStory key={article.id} article={article} />)}</div>}
        </div>
        {remaining.length > 2 && <section aria-label="More visa headlines" className="mt-8">
          <h2 className="mb-4 flex items-center gap-3 text-sm font-bold text-slate-900">More coverage<span aria-hidden="true" className="h-px flex-1 bg-slate-200" /></h2>
          <div className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">{remaining.slice(2).map(article => <NewsStory key={article.id} article={article} compact />)}</div>
        </section>}
      </>}
    <p className="mt-6 text-xs leading-5 text-slate-500">Recent visa and immigration headlines, newest first. Open a headline to read the publisher’s report.</p>
  </>;
}

function NewsStory({ article, featured = false, compact = false }: { article: NewsArticle; featured?: boolean; compact?: boolean }) {
  return <article className={featured ? 'flex min-w-0 flex-col rounded-2xl border border-teal-200 bg-teal-50/60 p-6 sm:p-8' : compact ? 'min-w-0 p-5 sm:p-6' : 'flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5 sm:p-6'}>
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
      {featured && <span className="rounded-md bg-teal-800 px-2.5 py-1 font-bold uppercase tracking-wider text-white">Latest headline</span>}
      <span className="font-semibold text-slate-700">{article.publisher}</span>
    </div>
    <h2 className={`${featured ? 'text-2xl' : 'text-thread-title'} break-words font-bold leading-snug tracking-tight text-slate-950`}><a href={article.sourceUrl} target="_blank" rel="noopener noreferrer" className="rounded-sm hover:text-blue-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700">{article.title}<span className="sr-only"> (opens on Google News in a new tab)</span></a></h2>
    <div className={`${featured ? 'mt-auto pt-8' : 'mt-4'} flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-slate-500`}>
      <time dateTime={article.publishedAt}>{dateLabel(article.publishedAt)}</time>
      <span>Via Google News</span>
    </div>
  </article>;
}

export function NewsUnavailable({ retry }: { retry: () => void }) {
  return <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm leading-6 text-amber-950"><p className="font-semibold">We couldn’t load the headlines.</p><p className="mt-1">News headlines are currently unavailable here. You can still read the latest visa news on Google News.</p><button type="button" onClick={retry} className="mt-4 min-h-11 rounded-lg border border-amber-500 bg-white px-4 py-2 font-semibold hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800">Try again</button></div>;
}

export function NewsExternal() {
  return <section aria-label="U.S. Visa News" className="rounded-2xl border border-blue-200 bg-blue-50/60 p-6 sm:p-8"><p className="text-xs font-bold uppercase tracking-[0.12em] text-blue-800">Explore the headlines</p><h2 className="mt-3 text-xl font-bold text-slate-950">A wider view of visa news</h2><p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">Follow the latest U.S. visa and immigration coverage directly on Google News.</p><a href={GOOGLE_NEWS_SEARCH_URL} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-800 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700">Browse Google News <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a></section>;
}

export function NewsFeed({ initialFeed = null }: { initialFeed?: NewsFeedData | null }) {
  const [feed, setFeed] = useState<NewsFeedData | null>(initialFeed);
  const [error, setError] = useState(false);
  const [external, setExternal] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timer = setTimeout(() => controller.abort(), 12_000);
    setError(false);
    setExternal(false);
    setFeed(null);
    void fetch('/api/news', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('News unavailable');
      const data: unknown = await response.json();
      if (data !== null && typeof data === 'object' && 'status' in data && data.status === 'external') {
        if (!disposed) setExternal(true);
        return;
      }
      if (!isNewsFeedData(data)) throw new Error('Invalid news response');
      if (!disposed) setFeed(data);
    }).catch(() => {
      if (!disposed) setError(true);
    }).finally(() => clearTimeout(timer));
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [attempt]);

  return <main className="page-shell py-7 sm:py-10">
    <Link href="/explore" className="text-sm font-semibold text-teal-800 hover:underline">← Explore Communities</Link>
    <div className="mt-6 flex flex-wrap items-end justify-between gap-5 border-b border-slate-200 pb-7">
      <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-800">VisaThreads · News desk</p><h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Your visa news brief</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">U.S. visa and immigration coverage from Google News.</p></div>
      <a href={GOOGLE_NEWS_SEARCH_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">Open Google News <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a>
    </div>
    <div className="mt-6">{external ? <NewsExternal/> : error ? <NewsUnavailable retry={() => setAttempt((value) => value + 1)}/>
      : !feed ? <div role="status" aria-live="polite" className="rounded-2xl border border-slate-200 bg-white p-7"><p className="text-sm text-slate-600">Loading latest headlines…</p><div aria-hidden="true" className="mt-5 space-y-3 motion-safe:animate-pulse"><div className="h-3 w-28 rounded bg-teal-100"/><div className="h-6 w-5/6 rounded bg-slate-100"/><div className="h-6 w-2/3 rounded bg-slate-100"/></div></div>
        : <section aria-label="Latest visa news" aria-live="polite"><NewsResults feed={feed}/></section>}</div>
  </main>;
}

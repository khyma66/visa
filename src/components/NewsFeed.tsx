'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { GOOGLE_NEWS_SEARCH_URL, isNewsFeedData } from '@/lib/news-shared';
import type { NewsFeedData } from '@/lib/news-shared';

const dateLabel = (value: string) => new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
}).format(new Date(value));

export function NewsResults({ feed }: { feed: NewsFeedData }) {
  return <>
    <p role="status" className="mb-4 text-sm text-slate-500">{feed.articles.length} {feed.articles.length === 1 ? 'headline' : 'headlines'} · Updated <time dateTime={feed.retrievedAt}>{dateLabel(feed.retrievedAt)}</time></p>
    {!feed.articles.length ? <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-600">No recent visa headlines were returned. Check Google News for more coverage.</p>
      : <div className="space-y-4">{feed.articles.map((article) => <article key={article.id} className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{article.publisher}</span>
          <time dateTime={article.publishedAt}>{dateLabel(article.publishedAt)}</time>
        </div>
        <h2 className="text-lg font-semibold leading-7"><a href={article.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-slate-900 hover:text-teal-700 hover:underline">{article.title}<span className="sr-only"> (opens on Google News in a new tab)</span></a></h2>
        <p className="mt-3 text-xs text-slate-500">Via Google News</p>
      </article>)}</div>}
    <p className="mt-5 text-xs leading-5 text-slate-500">Recent visa and immigration headlines, newest first. Open a headline to read the publisher’s report.</p>
  </>;
}

export function NewsUnavailable({ retry }: { retry: () => void }) {
  return <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"><p>News headlines are currently unavailable here. You can still read the latest visa news on Google News.</p><button type="button" onClick={retry} className="mt-3 rounded border border-amber-500 px-3 py-2 font-semibold hover:bg-amber-100">Try again</button></div>;
}

export function NewsExternal() {
  return <section aria-label="Visa news" className="rounded-lg border border-slate-200 bg-white p-6"><p className="text-sm leading-6 text-slate-600">Follow the latest visa and immigration coverage directly on Google News.</p></section>;
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

  return <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
    <Link href="/explore" className="text-sm text-teal-700 hover:underline">← Explore communities</Link>
    <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-3xl font-semibold">News</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">Visa and immigration coverage from Google News.</p></div>
      <a href={GOOGLE_NEWS_SEARCH_URL} target="_blank" rel="noopener noreferrer" className="rounded-full bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">Open Google News<span className="sr-only"> (opens in a new tab)</span></a>
    </div>
    <div className="mt-6">{external ? <NewsExternal/> : error ? <NewsUnavailable retry={() => setAttempt((value) => value + 1)}/>
      : !feed ? <p role="status" aria-live="polite" className="rounded-lg border bg-white p-6 text-slate-600">Loading latest headlines…</p>
        : <section aria-label="Latest visa news" aria-live="polite"><NewsResults feed={feed}/></section>}</div>
  </main>;
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { filterNews, isNewsFeedData, NEWS_SOURCES } from '@/lib/news';
import type { NewsAgency, NewsFeedData } from '@/lib/news';

const dateLabel = (value: string) => new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${value}T00:00:00Z`));

export function NewsResults({ feed, query = '', type = 'all' }: { feed: NewsFeedData; query?: string; type?: string }) {
  const articles = filterNews(feed.articles, type, query);
  return <>
    <p role="status" className="mb-4 text-sm text-slate-500">{articles.length} {articles.length === 1 ? 'update' : 'updates'} · Retrieved <time dateTime={feed.retrievedAt}>{new Date(feed.retrievedAt).toLocaleString('en-US', { timeZone: 'UTC', timeZoneName: 'short' })}</time></p>
    {!articles.length ? <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-600">{feed.articles.length ? 'No updates match these filters. Try another document type or search.' : 'No updates were returned for this agency. You can check its newsroom below.'}</p>
      : <div className="space-y-4">{articles.map((article) => <article key={article.id} className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{article.agencyName}</span>
          <span className="rounded bg-teal-50 px-2 py-1 text-teal-800">{article.documentType}</span>
          <time dateTime={article.publishedAt}>{dateLabel(article.publishedAt)}</time>
        </div>
        <h2 className="text-lg font-semibold leading-7"><a href={article.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-slate-900 hover:text-teal-700 hover:underline">{article.title}<span className="sr-only"> (opens Federal Register in a new tab)</span></a></h2>
        <p className="mt-3 text-xs text-slate-500">Federal Register · Document {article.id}</p>
      </article>)}</div>}
    <p className="mt-5 text-xs leading-5 text-slate-500">Shows up to {feed.limit} matching Federal Register documents from the past year. Dates are publication dates; a proposed rule or notice does not necessarily change current requirements. This feed does not include every agency announcement.</p>
  </>;
}

export function NewsUnavailable({ error, retry }: { error: string; retry: () => void }) {
  return <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"><p>{error}</p><button type="button" onClick={retry} className="mt-3 rounded border border-amber-500 px-3 py-2 font-semibold hover:bg-amber-100">Try again</button></div>;
}

export function NewsFeed({ initialFeed = null }: { initialFeed?: NewsFeedData | null }) {
  const [agency, setAgency] = useState<NewsAgency>(initialFeed?.agency ?? 'all');
  const [feed, setFeed] = useState<NewsFeedData | null>(initialFeed);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setFeed(null);
    void fetch(`/api/news?agency=${agency}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Agency updates are temporarily unavailable. Use an official newsroom below or try again.');
      const data: unknown = await response.json();
      if (!isNewsFeedData(data) || data.agency !== agency) throw new Error('Agency updates could not be loaded. Use an official newsroom below or try again.');
      if (!controller.signal.aborted) setFeed(data);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Agency updates could not be loaded.');
    });
    return () => controller.abort();
  }, [agency, attempt]);

  return <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
    <Link href="/explore" className="text-sm text-teal-700 hover:underline">← Explore communities</Link>
    <h1 className="mt-5 text-3xl font-semibold">News</h1>
    <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">Follow U.S. visa and immigration agency updates. Read the original document for its scope, dates, and requirements.</p>
    <div className="my-6 grid gap-3 sm:grid-cols-3">
      <label className="text-sm font-semibold text-slate-700">Agency<select value={agency} onChange={(event) => setAgency(event.target.value as NewsAgency)} className="mt-2 block w-full rounded border border-slate-300 bg-white p-2 font-normal"><option value="all">USCIS + State Department</option><option value="uscis">USCIS</option><option value="state">State Department</option></select></label>
      <label className="text-sm font-semibold text-slate-700">Document type<select value={type} onChange={(event) => setType(event.target.value)} className="mt-2 block w-full rounded border border-slate-300 bg-white p-2 font-normal"><option value="all">All documents</option><option value="Rule">Rules</option><option value="Proposed Rule">Proposed rules</option><option value="Notice">Notices</option><option value="Other">Other documents</option></select></label>
      <label className="text-sm font-semibold text-slate-700">Search loaded updates<input value={query} onChange={(event) => setQuery(event.target.value)} type="search" maxLength={120} placeholder="Visa, citizenship…" className="mt-2 block w-full rounded border border-slate-300 bg-white p-2 font-normal"/></label>
    </div>
    {error ? <NewsUnavailable error={error} retry={() => setAttempt((value) => value + 1)}/>
      : !feed ? <p role="status" aria-live="polite" className="rounded-lg border bg-white p-6 text-slate-600">Loading agency updates…</p>
        : <section aria-label="Agency updates" aria-live="polite"><NewsResults feed={feed} query={query} type={type}/></section>}
    <aside aria-labelledby="official-newsrooms" className="mt-8 rounded-lg border border-slate-200 bg-white p-5">
      <h2 id="official-newsrooms" className="font-semibold">Official newsrooms and visa dates</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">Check these sources for announcements and updates beyond the Federal Register feed.</p>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-3">{NEWS_SOURCES.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-teal-700 underline">{source.name}<span className="sr-only"> (opens in a new tab)</span></a></li>)}</ul>
    </aside>
  </main>;
}

'use client';

import { useEffect, useState } from 'react';
import { isOfficialNews, type OfficialArticle, type OfficialNews } from '@/lib/official-news-shared';

export const VISA_RESOURCES = [
  { title: 'USCIS News', description: 'Agency announcements and immigration updates.', url: 'https://www.uscis.gov/newsroom' },
  { title: 'Visa Bulletin', description: 'Monthly immigrant visa availability from the State Department.', url: 'https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin.html' },
  { title: 'Visa Appointment Wait Times', description: 'Official appointment estimates by embassy or consulate.', url: 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/global-visa-wait-times.html' },
  { title: 'USCIS Processing Times', description: 'Processing-time estimates by form and office.', url: 'https://egov.uscis.gov/processing-times/' },
];
function dateLabel(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
export function OfficialNewsResults({ feed }: { feed: OfficialNews }) {
  const [lead, ...remaining] = feed.articles;
  return <>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
      <h2 className="text-sm font-bold text-slate-950">Recent notices <span className="ml-1.5 rounded-md bg-teal-100 px-2 py-1 text-xs text-teal-900">{feed.articles.length}</span></h2>
      <p role="status" className="text-xs leading-5 text-slate-500">Latest check <time dateTime={feed.retrievedAt}>{new Date(feed.retrievedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC</time></p>
    </div>
    {lead ? <>
      <div className={`grid gap-4 ${remaining.length ? 'lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] xl:grid-cols-1 2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]' : ''}`}>
        <OfficialStory article={lead} featured />
        {remaining.length > 0 && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 2xl:grid-cols-1">{remaining.slice(0, 2).map(article => <OfficialStory key={article.id} article={article} />)}</div>}
      </div>
      {remaining.length > 2 && <section aria-label="More official notices" className="mt-8">
        <h2 className="mb-4 flex items-center gap-3 text-sm font-bold text-slate-900">More from the Federal Register<span aria-hidden="true" className="h-px flex-1 bg-slate-200" /></h2>
        <div className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">{remaining.slice(2).map(article => <OfficialStory key={article.id} article={article} compact />)}</div>
      </section>}
    </> : <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><p className="font-semibold text-slate-800">No matching recent notices were returned.</p><p className="mt-2 text-sm text-slate-600">The official resources on this page remain available.</p></div>}
    <p className="mt-5 text-xs leading-5 text-slate-500">Newest publications first. Checks are cached for up to 15 minutes.</p>
  </>;
}

function OfficialStory({ article, featured = false, compact = false }: { article: OfficialArticle; featured?: boolean; compact?: boolean }) {
  const badge = article.type === 'Proposed Rule' ? 'bg-amber-100 text-amber-950' : article.type === 'Rule' ? 'bg-teal-100 text-teal-900' : 'bg-blue-100 text-blue-900';
  return <article className={featured ? 'flex min-w-0 flex-col rounded-2xl border border-teal-200 bg-teal-50/60 p-6 sm:p-7' : compact ? 'min-w-0 p-5 sm:p-6' : 'flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5'}>
    {featured && <p className="mb-4 text-xs font-bold uppercase tracking-[0.13em] text-teal-800">Latest notice</p>}
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs"><span className={`rounded-md px-2.5 py-1 font-semibold ${badge}`}>{article.type}</span><time dateTime={article.publishedOn} className="text-slate-600">{dateLabel(article.publishedOn)}</time></div>
    <h3 className={`${featured ? 'text-2xl' : 'text-thread-title'} break-words font-bold leading-snug tracking-tight text-slate-950`}><a href={article.url} target="_blank" rel="noopener noreferrer" className="rounded-sm hover:text-blue-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700">{article.title}<span className="sr-only"> (opens in a new tab)</span></a></h3>
    <p className="mt-3 break-words text-xs leading-5 text-slate-600">{article.agencies.join(' · ')} <span className="text-slate-400">/</span> Federal Register</p>
    {article.type === 'Proposed Rule' && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">Proposal, not a final rule. Check the source for comment deadlines and status.</p>}
    <div className={featured ? 'mt-auto pt-6' : 'mt-3'}><a href={article.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-sm text-sm font-semibold text-blue-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700">Read Source Notice <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a></div>
  </article>;
}
export function OfficialNewsFeed() {
  const [feed, setFeed] = useState<OfficialNews | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => controller.abort(), 12_000);
    setError(false); setFeed(null);
    void fetch('/api/official-news', { signal: controller.signal, credentials: 'omit' }).then(async response => {
      if (!response.ok) throw new Error('Unavailable');
      const data: unknown = await response.json();
      if (!isOfficialNews(data)) throw new Error('Invalid news');
      if (active) setFeed(data);
    }).catch(() => { if (active) setError(true); }).finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [attempt]);
  return <main className="page-shell py-7 sm:py-10">
    <header className="flex flex-wrap items-end justify-between gap-5 border-b border-slate-200 pb-7">
      <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-800">VisaThreads · News desk</p><h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">News & Official Resources</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Recent visa notices and official tools, together in one place. Original headlines, publication dates and direct source links.</p></div>
      <a href="#visa-official-resources" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-teal-200 bg-white px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">Find official tools <span aria-hidden="true">↓</span></a>
    </header>
    <div className="grid items-start gap-7 pt-6 xl:grid-cols-[minmax(0,1fr)_290px]">
      <section aria-label="Visa-related Federal Register notices" className="min-w-0">
        {feed ? <OfficialNewsResults feed={feed} /> : error ? <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm leading-6 text-amber-950"><p className="font-bold">We couldn’t refresh the notices.</p><p className="mt-1">You can still use the official resources on this page.</p><div className="mt-4 flex flex-wrap items-center gap-4"><button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-11 rounded-lg border border-amber-500 bg-white px-4 py-2 font-semibold hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800">Try Again</button><a href="https://www.federalregister.gov/documents/search?conditions%5Bterm%5D=visa" target="_blank" rel="noopener noreferrer" className="font-semibold underline">Search Federal Register <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a></div></div> : <div role="status" className="rounded-2xl border border-slate-200 bg-white p-7"><p className="text-sm text-slate-600">Loading recent visa notices…</p><div aria-hidden="true" className="mt-5 space-y-3 motion-safe:animate-pulse"><div className="h-3 w-28 rounded bg-teal-100"/><div className="h-6 w-5/6 rounded bg-slate-100"/><div className="h-6 w-2/3 rounded bg-slate-100"/><div className="h-3 w-1/2 rounded bg-slate-100"/></div></div>}
        <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50/70 p-4"><p className="text-xs font-bold text-blue-900">Before acting on an update</p><p className="mt-1.5 text-xs leading-5 text-slate-600">Not every notice changes current policy. Proposals are not final rules, and publication does not establish an effective date. Read the full document and official PDF before relying on it. VisaThreads is independent of the U.S. government.</p></div>
      </section>
      <aside id="visa-official-resources" aria-label="Official visa resources" className="scroll-mt-32 xl:sticky xl:top-28">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b border-teal-100 bg-teal-50/70 p-5"><p className="text-xs font-bold uppercase tracking-[0.12em] text-teal-800">Useful bookmarks</p><h2 className="mt-2 text-lg font-bold text-slate-950">Go to the Source</h2><p className="mt-1 text-xs leading-5 text-slate-600">Official tools for your next step.</p></div><div className="divide-y divide-slate-100">{VISA_RESOURCES.map((resource, index) => <a key={resource.url} href={resource.url} target="_blank" rel="noopener noreferrer" className="group flex gap-3 p-5 hover:bg-blue-50/60 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-700"><span aria-hidden="true" className="mt-0.5 shrink-0 whitespace-nowrap text-xs font-semibold tabular-nums text-slate-400">{String(index + 1).padStart(2, '0')}</span><div className="min-w-0"><h3 className="text-sm font-semibold text-blue-800 group-hover:underline">{resource.title} <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></h3><p className="mt-1.5 text-xs leading-5 text-slate-600">{resource.description}</p></div></a>)}</div></div>
        <p className="mt-4 px-1 text-xs leading-5 text-slate-500">Community posts and news are informational, not legal advice. Individual eligibility and timelines vary.</p>
      </aside>
    </div>
  </main>;
}

'use client';

import { useEffect, useState } from 'react';
import { isOfficialNews, type OfficialNews } from '@/lib/official-news-shared';

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
  return <>
    <p className="my-4 text-xs leading-5 text-slate-500">{feed.articles.length} recent notices · Latest check <time dateTime={feed.retrievedAt}>{new Date(feed.retrievedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC</time> · Checks are cached for up to 15 minutes.</p>
    {feed.articles.length ? <div className="divide-y divide-slate-200">{feed.articles.map(article => <article key={article.id} className="py-5">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs"><span className={`rounded px-2 py-1 font-semibold ${article.type === 'Proposed Rule' ? 'bg-amber-50 text-amber-900' : 'bg-blue-50 text-blue-800'}`}>{article.type}</span><time dateTime={article.publishedOn} className="text-slate-500">{dateLabel(article.publishedOn)}</time></div>
      <h2 className="text-lg font-semibold leading-7 text-slate-950"><a href={article.url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-700 hover:underline">{article.title}<span className="sr-only"> (opens in a new tab)</span></a></h2>
      <p className="mt-2 text-xs leading-5 text-slate-500">{article.agencies.join(' · ')} · Federal Register</p>
      {article.type === 'Proposed Rule' && <p className="mt-2 text-xs text-amber-900">Proposal, not a final rule. Check the source for comment deadlines and status.</p>}
      <a href={article.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-semibold text-blue-700 hover:underline">Read Source Notice <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a>
    </article>)}</div> : <p className="my-6 text-sm text-slate-600">No matching recent notices were returned. The official resources below remain available.</p>}
  </>;
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
  return <main className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6">
    <header className="border-b border-slate-200 pb-5"><p className="text-xs font-semibold tracking-wide text-blue-700">U.S. VISA UPDATES</p><h1 className="mt-2 text-2xl font-bold text-slate-950">News & Official Resources</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Visa-related notices from the Federal Register, with original dates and direct source links. No generated headlines or summaries.</p></header>
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_280px]">
      <section aria-label="Visa-related Federal Register notices">
        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">Not every notice changes current policy. Proposals are not final rules, and publication does not establish an effective date. Read the full document and official PDF before relying on it. VisaThreads is independent of the U.S. government.</p>
        {feed ? <OfficialNewsResults feed={feed} /> : error ? <div role="alert" className="my-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><p>We couldn’t refresh the notices. You can still use the official resources on this page.</p><button onClick={() => setAttempt(value => value + 1)} className="mt-2 font-semibold underline">Try Again</button><a href="https://www.federalregister.gov/documents/search?conditions%5Bterm%5D=visa" target="_blank" rel="noopener noreferrer" className="ml-4 font-semibold underline">Search Federal Register ↗</a></div> : <p role="status" className="py-8 text-sm text-slate-500">Loading recent visa notices…</p>}
      </section>
      <aside aria-label="Official visa resources" className="pt-5"><h2 className="text-base font-bold text-slate-950">Go to the Source</h2><p className="mt-1 text-xs leading-5 text-slate-500">Official tools for your next step.</p><div className="mt-4 space-y-3">{VISA_RESOURCES.map(resource => <a key={resource.url} href={resource.url} target="_blank" rel="noopener noreferrer" className="block rounded-xl border border-slate-200 p-4 hover:border-blue-300 hover:bg-blue-50/40"><h3 className="text-sm font-semibold text-blue-700">{resource.title} <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></h3><p className="mt-1 text-xs leading-5 text-slate-600">{resource.description}</p></a>)}</div><p className="mt-4 text-xs leading-5 text-slate-500">Community posts and news are informational, not legal advice. Individual eligibility and timelines vary.</p></aside>
    </div>
  </main>;
}

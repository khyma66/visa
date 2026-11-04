'use client';

import { ResizablePostLayout } from './ResizablePostLayout';

import { useEffect, useState, type ReactNode } from 'react';
import { isOfficialNews, NEWS_TOPICS, newsTopic, OFFICIAL_NEWS_TTL, OFFICIAL_NEWS_STALE_MS, type OfficialArticle, type OfficialNews } from '@/lib/official-news-shared';
import { isImmigrationHeadlines, type ImmigrationHeadlines } from '@/lib/immigration-headlines';

export const VISA_RESOURCES = [
  { title: 'USCIS News', description: 'Agency announcements and immigration updates.', url: 'https://www.uscis.gov/newsroom' },
  { title: 'Visas News from the State Department', description: 'Official updates about U.S. visa services and policy.', url: 'https://travel.state.gov/content/travel/en/News/visas-news.html' },
  { title: 'Visa Bulletin', description: 'Monthly immigrant visa availability from the State Department.', url: 'https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin.html' },
  { title: 'Visa Appointment Wait Times', description: 'Official appointment estimates by embassy or consulate.', url: 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/global-visa-wait-times.html' },
  { title: 'USCIS Processing Times', description: 'Processing-time estimates by form and office.', url: 'https://egov.uscis.gov/processing-times/' },
];
function dateLabel(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
export function OfficialNewsResults({ feed }: { feed: OfficialNews }) {
  const [topic, setTopic] = useState<string>('All updates');
  const visible = topic === 'All updates' ? feed.articles : feed.articles.filter(article => newsTopic(article) === topic);
  const [lead, ...remaining] = visible;
  return <>
    <nav aria-label="News topics" className="mb-6 flex flex-wrap gap-2">{NEWS_TOPICS.map(label => <button type="button" key={label} aria-pressed={topic === label} onClick={() => setTopic(label)} className={`rounded-full border px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 ${topic === label ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}`}>{label}</button>)}</nav>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
      <h2 className="text-thread-title font-semibold text-slate-950">Latest updates <span className="ml-1.5 rounded-md bg-teal-100 px-2 py-1 text-xs text-teal-900">{visible.length}</span></h2>
      <p role="status" className="text-xs leading-5 text-slate-500 capitalize">Updated <time dateTime={feed.retrievedAt}>{new Date(feed.retrievedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC</time></p>
    </div>
    {lead ? <>
      <div className={`grid gap-4 ${remaining.length ? 'lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] xl:grid-cols-1 2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]' : ''}`}>
        <OfficialStory article={lead} featured />
        {remaining.length > 0 && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 2xl:grid-cols-1">{remaining.slice(0, 2).map(article => <OfficialStory key={article.id} article={article} />)}</div>}
      </div>
      {remaining.length > 2 && <section aria-label="More official notices" className="mt-8">
        <h2 className="mb-4 flex items-center gap-3 text-thread-title font-semibold text-slate-900 capitalize">More from the Federal Register<span aria-hidden="true" className="h-px flex-1 bg-slate-200" /></h2>
        <div className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">{remaining.slice(2).map(article => <OfficialStory key={article.id} article={article} compact />)}</div>
      </section>}
    </> : <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center capitalize"><p className="font-semibold text-slate-800 capitalize">No matching recent notices in this section.</p><p className="mt-2 text-sm text-slate-600 capitalize">Choose All updates for the full edition. The official resources remain available.</p></div>}
    <p className="mt-5 text-xs leading-5 text-slate-500 capitalize">Newest publications first. The news edition is refreshed daily from public government notices; source publication dates are preserved. Headlines change when a source publishes a relevant notice.</p>
  </>;
}

function OfficialStory({ article, featured = false, compact = false }: { article: OfficialArticle; featured?: boolean; compact?: boolean }) {
  const badge = article.type === 'Proposed Rule' ? 'bg-amber-100 text-amber-950' : article.type === 'Rule' ? 'bg-teal-100 text-teal-900' : 'bg-blue-100 text-blue-900';
  return <article className={featured ? 'flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-6 sm:p-8' : compact ? 'min-w-0 p-5 sm:p-6' : 'flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5'}>
    {featured && <p className="mb-4 text-xs font-bold tracking-[0.13em] text-teal-800 capitalize">Latest notice</p>}
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs"><span className={`rounded-md px-2.5 py-1 font-semibold ${badge}`}>{article.type}</span><time dateTime={article.publishedOn} className="text-slate-600">{dateLabel(article.publishedOn)}</time></div>
    <h3 className="break-words font-serif text-thread-title font-semibold text-slate-950"><a href={article.url} target="_blank" rel="noopener noreferrer" className="rounded-sm hover:text-blue-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700">{article.title}<span className="sr-only capitalize"> (opens in a new tab)</span></a></h3>
    {article.summary && <p className={`mt-4 text-base leading-7 text-slate-600 ${featured ? 'line-clamp-5' : 'line-clamp-3'}`}>{article.summary}</p>}
    <p className="mt-3 break-words text-xs leading-5 text-slate-600">{article.agencies.join(' · ')} <span className="text-slate-400 capitalize">/</span> Federal Register</p>
    {article.type === 'Proposed Rule' && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-base leading-6 text-amber-950 capitalize">Proposal, not a final rule. Check the source for comment deadlines and status.</p>}
    <div className={`${featured ? 'mt-auto pt-6' : 'mt-3'} capitalize`}><a href={article.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-sm text-sm font-semibold text-blue-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700 capitalize">Read Source Notice <span aria-hidden="true" className="capitalize">↗</span><span className="sr-only capitalize"> (opens in a new tab)</span></a></div>
  </article>;
}
export function HeadlineResults({ headlines }: { headlines: ImmigrationHeadlines }) {
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('All headlines');
  const [limit, setLimit] = useState(12);
  const topics: Record<string, RegExp> = {
    'Work visas': /\b(?:H-?1B|H-?2[AB]|L-?1|workers?|employment)\b/i,
    'Students': /\b(?:F-?1|J-?1|OPT|students?|universit\w*)\b/i,
    'Green cards & family': /\b(?:green cards?|family|spous\w*|residen\w*|H-?4)\b/i,
    'Policy & courts': /\b(?:rule\w*|polic\w*|court\w*|judge\w*|lawsuit\w*|ban\w*)\b/i,
  };
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const articles = headlines.articles.filter(article => words.every(word => `${article.title} ${article.publisher}`.toLowerCase().includes(word)) && (topic === 'All headlines' || topics[topic].test(article.title)));
  const searchUrl = `https://www.google.com/search?${new URLSearchParams({ q: `${query.trim() || 'us immigration visa'} news`, tbm: 'nws' })}`;
  return <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
    <div className="min-w-0">
      <label className="block text-sm font-semibold text-slate-700 capitalize">Search this news edition
        <input type="search" value={query} maxLength={150} onChange={event => { setQuery(event.target.value); setLimit(12); }} placeholder="Try H-1B, green card, USCIS…" className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100" />
      </label>
      <nav aria-label="Headline topics" className="my-4 flex flex-wrap gap-2">{['All headlines', ...Object.keys(topics)].map(label => <button type="button" key={label} aria-pressed={topic === label} onClick={() => { setTopic(label); setLimit(12); }} className={`min-h-10 rounded-full border px-3 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${topic === label ? 'border-teal-800 bg-teal-800 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}`}>{label}</button>)}</nav>
      <p role="status" aria-live="polite" className="mb-3 text-xs text-slate-500">{articles.length} {articles.length === 1 ? 'headline' : 'headlines'} · {headlines.source === 'GDELT Project' ? 'News coverage · dates indicate when indexed' : 'Agency announcements · publication dates'}</p>
      <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {articles.slice(0, limit).map(article => <article key={article.url} className="p-5 transition-colors hover:bg-slate-50 sm:p-6">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500"><span className="font-semibold text-teal-800">{article.publisher}</span><span aria-hidden="true" className="capitalize">·</span><span>{headlines.source === 'GDELT Project' ? 'Indexed ' : ''}<time dateTime={article.publishedAt}>{new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</time></span></div>
          <h3 className="max-w-3xl break-words text-thread-title font-semibold leading-7 text-slate-950"><a href={article.url} target="_blank" rel="noopener noreferrer" className="rounded-sm hover:text-blue-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">{article.title}<span className="sr-only capitalize"> (opens in a new tab)</span></a></h3>
          <a href={article.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-9 items-center text-sm font-medium text-blue-800 hover:underline capitalize">Read at source <span aria-hidden="true" className="ml-1 capitalize">↗</span><span className="sr-only capitalize"> (opens in a new tab)</span></a>
        </article>)}
        {!articles.length && <div className="p-6 capitalize"><p className="font-semibold text-slate-800 capitalize">No headlines match these filters.</p><button type="button" onClick={() => { setQuery(''); setTopic('All headlines'); setLimit(12); }} className="mt-3 min-h-10 text-sm font-semibold text-blue-800 underline capitalize">Clear filters</button></div>}
      </div>
      {articles.length > limit && <button type="button" onClick={() => setLimit(value => value + 12)} className="mt-4 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">Show more headlines ({articles.length - limit} remaining)</button>}
    </div>
    <aside aria-label="More news coverage" className="space-y-4">
      <section className="rounded-2xl border border-teal-200 bg-teal-50/60 p-5"><p className="text-xs font-bold tracking-wider text-teal-800 capitalize">Beyond this edition</p><h3 className="mt-2 text-thread-title font-semibold text-slate-950 capitalize">Explore wider coverage</h3><p className="mt-2 text-sm leading-6 text-slate-600 capitalize">Compare reporting across publishers. Google News opens separately; its results are not copied into this feed.</p><a href={searchUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900 capitalize">Search Google News ↗<span className="sr-only capitalize"> (opens in a new tab)</span></a></section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="text-thread-title font-semibold text-slate-900 capitalize">News, then the official record</h3><p className="mt-2 text-sm leading-6 text-slate-600 capitalize">Reporting explains the story. Agency notices below provide the original policy documents and effective dates.</p><a href="#government-notices" className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold text-blue-800 hover:underline capitalize">Browse government notices ↓</a></section>
    </aside>
  </div>;
}

export function OfficialNewsFeed({ initialFeed = null, children }: { initialFeed?: OfficialNews | null; children?: ReactNode }) {
  const [feed, setFeed] = useState<OfficialNews | null>(initialFeed);
  const [headlines, setHeadlines] = useState<ImmigrationHeadlines | null>(null);
  const [headlinesFailed, setHeadlinesFailed] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => controller.abort(), 12_000);
    setError(false);
    void fetch('/api/official-news', { signal: controller.signal, credentials: 'omit' }).then(async response => {
      if (!response.ok) throw new Error('Unavailable');
      const data: unknown = await response.json();
      if (!isOfficialNews(data)) throw new Error('Invalid news');
      if (active && data.articles.length) setFeed(current => !current || Date.parse(data.retrievedAt) >= Date.parse(current.retrievedAt) ? data : current);
    }).catch(() => { if (active) setError(true); }).finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [attempt]);
  useEffect(() => {
    const timer = setInterval(() => setAttempt(value => value + 1), OFFICIAL_NEWS_TTL);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => { if (active) setHeadlinesFailed(true); controller.abort(); }, 10_000);
    void fetch('/api/immigration-headlines', { signal: controller.signal, credentials: 'omit' }).then(async response => {
      if (!response.ok) throw new Error('Headlines unavailable');
      const data: unknown = await response.json();
      if (!isImmigrationHeadlines(data) || !data.articles.length) throw new Error('Invalid headlines');
      if (active) {
        setHeadlines(current => !current || Date.parse(data.retrievedAt) >= Date.parse(current.retrievedAt) ? data : current);
        setHeadlinesFailed(false);
      }
    }).catch(() => { if (active) setHeadlinesFailed(true); }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);
  return <main className="page-shell py-7 sm:py-10">
    <header className="flex flex-wrap items-end justify-between gap-5 border-b-4 border-slate-900 pb-7">
      <div className="capitalize"><p className="text-xs font-bold tracking-[0.16em] text-orange-700 capitalize">VisaThreads · News desk</p><h1 className="mt-3 font-serif text-2xl font-semibold text-slate-950 sm:text-3xl capitalize">The Visa Brief</h1><p className="mt-3 max-w-2xl text-base leading-6 text-slate-600 capitalize">U.S. immigration and visa headlines alongside official government notices. Follow each link to its original publisher or agency.</p></div>
      <a href="#visa-official-resources" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-teal-200 bg-white px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 capitalize">Find official tools <span aria-hidden="true" className="capitalize">↓</span></a>
    </header>
    {children}
    <details className="border-b border-slate-200 py-5">
      <summary className="cursor-pointer text-thread-title font-semibold text-slate-800 capitalize">More headlines &amp; agency announcements</summary>
    <section aria-labelledby="headline-section-title" className="pt-5">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div className="capitalize"><p className="text-xs font-bold tracking-[0.14em] text-teal-800 capitalize">Your daily reading list</p><h2 id="headline-section-title" className="mt-1 text-thread-title font-semibold text-slate-950 capitalize">U.S. Immigration &amp; Visa Headlines</h2></div>{headlines && <p className="text-xs text-slate-500 capitalize">Updated <time dateTime={headlines.retrievedAt}>{new Date(headlines.retrievedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC</time></p>}</div>
      {headlines && (headlinesFailed || Date.now() - Date.parse(headlines.retrievedAt) > OFFICIAL_NEWS_STALE_MS) && <p role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 capitalize">A newer headline edition is not available yet. Your saved headlines remain readable with their original dates.</p>}
      {headlines ? <HeadlineResults headlines={headlines} /> : <div role="status" className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 capitalize"><p className="capitalize">{headlinesFailed ? 'Publisher headlines are temporarily unavailable. Official notices remain below.' : 'Gathering publisher headlines…'}</p>{headlinesFailed && <button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-3 min-h-10 rounded-lg border border-slate-300 px-3 py-1.5 font-semibold text-blue-800 capitalize">Try again</button>}</div>}
      <p className="mt-4 text-xs leading-5 text-slate-500 capitalize">Daily edition · Headlines from {headlines?.source === 'USCIS Newsroom' ? <a href="https://www.uscis.gov/newsroom/all-news" target="_blank" rel="noopener noreferrer" className="underline capitalize">USCIS Newsroom</a> : <a href="https://www.gdeltproject.org/" target="_blank" rel="noopener noreferrer" className="underline capitalize">the GDELT Project</a>}. Updated is the edition retrieval time, not the article publication time. Full reporting is available at each source.</p>
    </section>
    </details>
    <ResizablePostLayout mainLabel="Government notices" relatedLabel="Official visa resources" className="pt-6" related={<div id="visa-official-resources" aria-label="Official visa resources" className="scroll-mt-32">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b border-teal-100 bg-teal-50/70 p-5 capitalize"><p className="text-xs font-bold tracking-[0.12em] text-teal-800 capitalize">Useful bookmarks</p><h2 className="mt-2 text-thread-title font-semibold text-slate-950 capitalize">Go to the Source</h2><p className="mt-1 text-base leading-6 text-slate-600 capitalize">Official tools for your next step.</p></div><div className="divide-y divide-slate-100">{VISA_RESOURCES.map((resource, index) => <a key={resource.url} href={resource.url} target="_blank" rel="noopener noreferrer" className="group flex gap-3 p-5 hover:bg-blue-50/60 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-700"><span aria-hidden="true" className="mt-0.5 shrink-0 whitespace-nowrap text-xs font-semibold tabular-nums text-slate-400">{String(index + 1).padStart(2, '0')}</span><div className="min-w-0"><h3 className="text-thread-title font-semibold text-blue-800 group-hover:underline">{resource.title} <span aria-hidden="true" className="capitalize">↗</span><span className="sr-only capitalize"> (opens in a new tab)</span></h3><p className="mt-1.5 text-base leading-6 text-slate-600">{resource.description}</p></div></a>)}</div></div>
        <p className="mt-4 px-1 text-base leading-6 text-slate-500 capitalize">Community posts and news are informational, not legal advice. Individual eligibility and timelines vary.</p>
      </div>}>
      <section id="government-notices" aria-label="Visa-related Federal Register notices" className="min-w-0 scroll-mt-28">
        <div className="mb-5 capitalize"><p className="text-xs font-bold tracking-[0.14em] text-teal-800 capitalize">Official record</p><h2 className="mt-1 font-serif text-thread-title font-semibold text-slate-950 capitalize">Government Notices</h2></div>
        {feed && (error || Date.now() - Date.parse(feed.retrievedAt) >= OFFICIAL_NEWS_STALE_MS) && <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950 capitalize"><p className="capitalize">{error ? 'The latest source check did not complete. Showing the last saved edition; all available articles remain readable below.' : 'This saved edition is older than 36 hours. Showing all available articles while the next daily source check runs.'}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-10 rounded-lg border border-amber-500 bg-white px-3 py-1.5 font-semibold hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800 capitalize">Check again</button></div>}
        {feed ? <OfficialNewsResults feed={feed} /> : error ? <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm leading-6 text-amber-950 capitalize"><p className="font-bold capitalize">We couldn’t refresh the notices.</p><p className="mt-1 capitalize">You can still use the official resources on this page.</p><div className="mt-4 flex flex-wrap items-center gap-4 capitalize"><button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-11 rounded-lg border border-amber-500 bg-white px-4 py-2 font-semibold hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800 capitalize">Try Again</button><a href="https://www.federalregister.gov/documents/search?conditions%5Bterm%5D=visa" target="_blank" rel="noopener noreferrer" className="font-semibold underline capitalize">Search Federal Register <span aria-hidden="true" className="capitalize">↗</span><span className="sr-only capitalize"> (opens in a new tab)</span></a></div></div> : <div role="status" className="rounded-2xl border border-slate-200 bg-white p-7 capitalize"><p className="text-sm text-slate-600 capitalize">Loading recent visa notices…</p><div aria-hidden="true" className="mt-5 space-y-3 motion-safe:animate-pulse"><div className="h-3 w-28 rounded bg-teal-100"/><div className="h-6 w-5/6 rounded bg-slate-100"/><div className="h-6 w-2/3 rounded bg-slate-100"/><div className="h-3 w-1/2 rounded bg-slate-100"/></div></div>}
        <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50/70 p-4 capitalize"><p className="text-thread-title font-semibold text-blue-900 capitalize">Before acting on an update</p><p className="mt-1.5 text-base leading-6 text-slate-600 capitalize">Not every notice changes current policy. Proposals are not final rules, and publication does not establish an effective date. Read the full document and official PDF before relying on it. VisaThreads is independent of the U.S. government.</p></div>
      </section>

    </ResizablePostLayout>
  </main>;
}

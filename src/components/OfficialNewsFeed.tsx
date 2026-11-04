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
    <nav aria-label="News topics" className="news-topics">{NEWS_TOPICS.map(label => <button type="button" key={label} aria-pressed={topic === label} onClick={() => setTopic(label)}>{label}</button>)}</nav>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
      <h2 className="text-thread-title font-semibold text-slate-950">Latest updates <span className="ml-1.5 rounded-md bg-teal-100 px-2 py-1 text-xs text-teal-900">{visible.length}</span></h2>
      <p role="status" className="text-xs leading-5 text-slate-500">Updated <time dateTime={feed.retrievedAt}>{new Date(feed.retrievedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC</time></p>
    </div>
    {lead ? <div className="news-story-list">
      <OfficialStory article={lead} featured />
      {remaining.length > 0 && <div aria-label="More official notices">{remaining.map(article => <OfficialStory key={article.id} article={article} />)}</div>}
    </div> : <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><p className="font-semibold text-slate-800">No matching recent notices in this section.</p><p className="mt-2 text-sm text-slate-600">Choose All updates for the full edition. The official resources remain available.</p></div>}
    <p className="mt-5 text-xs leading-5 text-slate-500">Newest publications first. The news edition is refreshed daily from public government notices; source publication dates are preserved. Headlines change when a source publishes a relevant notice.</p>
  </>;
}

function OfficialStory({ article, featured = false }: { article: OfficialArticle; featured?: boolean }) {
  const badge = article.type === 'Proposed Rule' ? 'bg-amber-100 text-amber-950' : article.type === 'Rule' ? 'bg-teal-100 text-teal-900' : 'bg-blue-100 text-blue-900';
  return <article className="news-story">
    {featured && <p className="mb-4 text-xs font-bold tracking-[0.13em] text-teal-800">Latest notice</p>}
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs"><span className={`rounded-md px-2.5 py-1 font-semibold ${badge}`}>{article.type}</span><time dateTime={article.publishedOn} className="text-slate-600">{dateLabel(article.publishedOn)}</time></div>
    <h3 className="break-words text-thread-title font-semibold text-slate-950"><a href={article.url} target="_blank" rel="noopener noreferrer" className="rounded-sm hover:text-teal-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700">{article.title}<span className="sr-only"> (opens in a new tab)</span></a></h3>
    {article.summary && <p className="mt-4 line-clamp-3 text-base leading-7 text-slate-600">{article.summary}</p>}
    <p className="mt-3 break-words text-xs leading-5 text-slate-600">{article.agencies.join(' · ')} <span className="text-slate-400">/</span> Federal Register</p>
    {article.type === 'Proposed Rule' && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-base leading-6 text-amber-950">Proposal, not a final rule. Check the source for comment deadlines and status.</p>}
    <div className="mt-3"><a href={article.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-sm text-sm font-semibold text-teal-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700">Read Source Notice <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a></div>
  </article>;
}
export function HeadlineResults({ headlines }: { headlines: ImmigrationHeadlines }) {
  const [topic, setTopic] = useState('All Headlines');
  const [limit, setLimit] = useState(12);
  const topics: Record<string, RegExp> = {
    'Work Visas': /\b(?:H-?1B|H-?2[AB]|L-?1|workers?|employment)\b/i,
    'Students': /\b(?:F-?1|J-?1|OPT|students?|universit\w*)\b/i,
    'Green Cards & Family': /\b(?:green cards?|family|spous\w*|residen\w*|H-?4)\b/i,
    'Policy & Courts': /\b(?:rule\w*|polic\w*|court\w*|judge\w*|lawsuit\w*|ban\w*)\b/i,
  };
  const articles = [...headlines.articles].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).filter(article => (topic === 'All Headlines' || topics[topic].test(article.title)));
  const searchUrl = `https://www.google.com/search?${new URLSearchParams({ q: 'us immigration visa news', tbm: 'nws' })}`;
  return <div className="min-w-0">
    <div className="min-w-0">
      <nav aria-label="Headline topics" className="news-topics mt-4">{['All Headlines', ...Object.keys(topics)].map(label => <button type="button" key={label} aria-pressed={topic === label} onClick={() => { setTopic(label); setLimit(12); }}>{label}</button>)}</nav>
      <p role="status" aria-live="polite" className="mb-3 text-xs text-slate-500">{articles.length} {articles.length === 1 ? 'headline' : 'headlines'} · {headlines.source === 'GDELT Project' ? 'News coverage · dates indicate when indexed' : 'Agency announcements · publication dates'}</p>
      <div className="news-story-list">
        {articles.slice(0, limit).map(article => <article key={article.url} className="news-story">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500"><span className="font-semibold text-teal-800">{article.publisher}</span><span aria-hidden="true">·</span><span>{headlines.source === 'GDELT Project' ? 'Indexed ' : ''}<time dateTime={article.publishedAt}>{new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</time></span></div>
          <h3 className="break-words text-thread-title font-semibold text-slate-950"><a href={article.url} target="_blank" rel="noopener noreferrer" className="rounded-sm hover:text-teal-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">{article.title}<span className="sr-only"> (opens in a new tab)</span></a></h3>
          <a href={article.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-9 items-center text-sm font-medium text-teal-800 hover:underline">Read at source <span aria-hidden="true" className="ml-1">↗</span><span className="sr-only"> (opens in a new tab)</span></a>
        </article>)}
        {!articles.length && <div className="p-6"><p className="font-semibold text-slate-800">No headlines match these filters.</p><button type="button" onClick={() => { setTopic('All Headlines'); setLimit(12); }} className="mt-3 min-h-10 text-sm font-semibold text-teal-800 underline">Clear filters</button></div>}
      </div>
      {articles.length > limit && <button type="button" onClick={() => setLimit(value => value + 12)} className="mt-4 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">Show more headlines ({articles.length - limit} remaining)</button>}
    </div>
    <p className="mt-6 text-sm leading-6 text-slate-600">Looking for more perspectives? <a href={searchUrl} target="_blank" rel="noopener noreferrer" className="news-source-link">Search Google News ↗<span className="sr-only"> (opens in a new tab)</span></a></p>
  </div>;
}

export function OfficialNewsFeed({ initialFeed = null, children }: { initialFeed?: OfficialNews | null; children?: ReactNode }) {
  const [feed, setFeed] = useState<OfficialNews | null>(initialFeed);
  const [headlines, setHeadlines] = useState<ImmigrationHeadlines | null>(null);
  const [headlinesFailed, setHeadlinesFailed] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [section, setSection] = useState(children ? 'reporting' : 'official');
  const sections = [
    ...(children ? [{ id: 'reporting', label: 'Latest News' }] : []),
    { id: 'headlines', label: 'News Headlines' },
    { id: 'official', label: 'Official Notices' },
  ];
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
  return <main className="page-shell news-desk py-7 sm:py-10">
    <header className="border-b border-slate-300 pb-5">
      <div className="flex items-end justify-between gap-4">
        <div><p className="text-xs font-semibold text-teal-800">VisaThreads · News desk</p><h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">The Visa Brief</h1></div>
        <a href="#visa-official-resources" className="news-source-link inline-flex min-h-11 shrink-0 items-center text-sm">Official tools <span aria-hidden="true" className="ml-1">↓</span></a>
      </div>
      <p className="mt-2 max-w-2xl text-base leading-6 text-slate-600">Immigration reporting, the latest headlines, and official updates — organized in one place.</p>
    </header>
    <div role="tablist" aria-label="News sections" aria-orientation="horizontal" className="news-tabs">
      {sections.map((item, index) => <button key={item.id} type="button" role="tab" id={`news-tab-${item.id}`} aria-controls={`news-panel-${item.id}`} aria-selected={section === item.id} tabIndex={section === item.id ? 0 : -1}
        onClick={() => setSection(item.id)}
        onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % sections.length
            : event.key === 'ArrowLeft' ? (index - 1 + sections.length) % sections.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : null;
          if (next === null) return;
          event.preventDefault();
          setSection(sections[next].id);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>{item.label}</button>)}
    </div>
    <ResizablePostLayout mainLabel="News" relatedLabel="Official visa resources" className="pt-6" related={<div id="visa-official-resources" aria-label="Official visa resources" className="scroll-mt-32">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-200 p-5"><p className="text-xs font-bold tracking-[0.12em] text-teal-800">Useful bookmarks</p><h2 className="mt-2 text-thread-title font-semibold text-slate-950">Official resources</h2><p className="mt-1 text-base leading-6 text-slate-600">Official tools for your next step.</p></div><div className="divide-y divide-slate-100">{VISA_RESOURCES.map((resource, index) => <a key={resource.url} href={resource.url} target="_blank" rel="noopener noreferrer" className="group flex gap-3 p-5 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal-700"><span aria-hidden="true" className="mt-0.5 shrink-0 whitespace-nowrap text-xs font-semibold tabular-nums text-slate-400">{String(index + 1).padStart(2, '0')}</span><div className="min-w-0"><h3 className="text-thread-title font-semibold text-teal-800 group-hover:underline">{resource.title} <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></h3><p className="mt-1.5 text-base leading-6 text-slate-600">{resource.description}</p></div></a>)}</div></div>
        <p className="mt-4 px-1 text-base leading-6 text-slate-500">Community posts and news are informational, not legal advice. Individual eligibility and timelines vary.</p>
      </div>}>
      {/* Keep editions mounted so switching tabs preserves filters and saved content. */}
      {children && <div id="news-panel-reporting" role="tabpanel" aria-labelledby="news-tab-reporting" tabIndex={0} hidden={section !== 'reporting'} className="news-edition">{children}</div>}
      <div id="news-panel-headlines" role="tabpanel" aria-labelledby="news-tab-headlines" tabIndex={0} hidden={section !== 'headlines'} className="news-edition">
    <section aria-labelledby="headline-section-title">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h2 id="headline-section-title" className="text-thread-title font-semibold text-slate-950">Immigration &amp; visa headlines</h2></div>{headlines && <p className="text-xs text-slate-500">Updated <time dateTime={headlines.retrievedAt}>{new Date(headlines.retrievedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC</time></p>}</div>
      {headlines && (headlinesFailed || Date.now() - Date.parse(headlines.retrievedAt) > OFFICIAL_NEWS_STALE_MS) && <p role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">A newer headline edition is not available yet. Your saved headlines remain readable with their original dates.</p>}
      {headlines ? <HeadlineResults headlines={headlines} /> : <div role="status" className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600"><p>{headlinesFailed ? 'Publisher headlines are temporarily unavailable. Official notices are available in their tab.' : 'Gathering publisher headlines…'}</p>{headlinesFailed && <button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-3 min-h-10 rounded-lg border border-slate-300 px-3 py-1.5 font-semibold text-teal-800">Try again</button>}</div>}
      <p className="mt-4 text-xs leading-5 text-slate-500">Daily edition · Headlines from {headlines?.source === 'USCIS Newsroom' ? <a href="https://www.uscis.gov/newsroom/all-news" target="_blank" rel="noopener noreferrer" className="underline">USCIS Newsroom</a> : <a href="https://www.gdeltproject.org/" target="_blank" rel="noopener noreferrer" className="underline">the GDELT Project</a>}. Updated is the edition retrieval time, not the article publication time. Full reporting is available at each source.</p>
    </section>
      </div>
      <div id="news-panel-official" role="tabpanel" aria-labelledby="news-tab-official" tabIndex={0} hidden={section !== 'official'} className="news-edition">
      <section id="government-notices" aria-label="Visa-related Federal Register notices" className="min-w-0 scroll-mt-28">
        <div className="mb-5"><h2 className="text-thread-title font-semibold text-slate-950">Government notices</h2></div>
        {feed && (error || Date.now() - Date.parse(feed.retrievedAt) >= OFFICIAL_NEWS_STALE_MS) && <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"><p>{error ? 'The latest source check did not complete. Showing the last saved edition; all available articles remain readable below.' : 'This saved edition is older than 36 hours. Showing all available articles while the next daily source check runs.'}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-10 rounded-lg border border-amber-500 bg-white px-3 py-1.5 font-semibold hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800">Check again</button></div>}
        {feed ? <OfficialNewsResults feed={feed} /> : error ? <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm leading-6 text-amber-950"><p className="font-bold">We couldn’t refresh the notices.</p><p className="mt-1">You can still use the official resources on this page.</p><div className="mt-4 flex flex-wrap items-center gap-4"><button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-11 rounded-lg border border-amber-500 bg-white px-4 py-2 font-semibold hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800">Try Again</button><a href="https://www.federalregister.gov/documents/search?conditions%5Bterm%5D=visa" target="_blank" rel="noopener noreferrer" className="font-semibold underline">Search Federal Register <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a></div></div> : <div role="status" className="rounded-2xl border border-slate-200 bg-white p-7"><p className="text-sm text-slate-600">Loading recent visa notices…</p><div aria-hidden="true" className="mt-5 space-y-3 motion-safe:animate-pulse"><div className="h-3 w-28 rounded bg-teal-100"/><div className="h-6 w-5/6 rounded bg-slate-100"/><div className="h-6 w-2/3 rounded bg-slate-100"/><div className="h-3 w-1/2 rounded bg-slate-100"/></div></div>}
        <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50/70 p-4"><p className="text-thread-title font-semibold text-blue-900">Before acting on an update</p><p className="mt-1.5 text-base leading-6 text-slate-600">Not every notice changes current policy. Proposals are not final rules, and publication does not establish an effective date. Read the full document and official PDF before relying on it. VisaThreads is independent of the U.S. government.</p></div>
      </section>
      </div>
    </ResizablePostLayout>
  </main>;
}

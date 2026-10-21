'use client';

import { isImportedPost, topicLabel } from '@/lib/post-presentation';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowUpRight, Compass, GripVertical, MessageSquare, Plus, Search, SlidersHorizontal, Tags, X } from 'lucide-react';
import { getCommunitySource, getQuestionPage } from '@/lib/community';
import type { Question } from '@/lib/types';
import { subscribeLive } from '@/lib/realtime';
import { QuestionCard } from './QuestionCard';
import { useAuth } from './AuthProvider';
import { RelatedQuestions } from './RelatedQuestions';

import { EXPERIENCE_CATEGORIES, VISA_TYPES } from '@/lib/post-categories';

const PAGE_SIZE = 20;
const PANEL_WIDTH_KEY = 'visathreads:discovery-panel-width:v1';
const MIN_PANEL_WIDTH = 240;
const MAX_PANEL_WIDTH = 640;
const SORTS = [['newest', 'New'], ['activity', 'Active'], ['score', 'Top'], ['unanswered', 'Unanswered']] as const;
type SortMode = typeof SORTS[number][0];
type PostKind = '' | 'question' | 'discussion' | 'promotion';

export function CommunityHome({ initialKind = '', experience = false }: { initialKind?: PostKind; experience?: boolean } = {}) {
  const { user, loading: authLoading, demoMode } = useAuth();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [search, setSearch] = useState('');
  const [visaType, setVisaType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [tag, setTag] = useState('');
  const [kind, setKind] = useState<PostKind>(initialKind);
  const [page, setPage] = useState(1);
  const [feedUnavailable, setFeedUnavailable] = useState(false);
  const [more, setMore] = useState(false);
  const [cursor, setCursor] = useState<Question>();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [revision, setRevision] = useState(0);
  const [related, setRelated] = useState<Question | null>(null);
  const [category, setCategory] = useState('');
  const [origin, setOrigin] = useState<'' | 'member' | 'archive'>('');
  const [loadedFilterKey, setLoadedFilterKey] = useState<string | null>(null);
  const olderLock = useRef<symbol | null>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; width: number; current: number } | null>(null);
  const alive = useRef(true);
  const [panelWidth, setPanelWidth] = useState(300);
  const [layoutWidth, setLayoutWidth] = useState(1000);
  const maxPanelWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, layoutWidth - 440));
  const visiblePanelWidth = Math.min(panelWidth, maxPanelWidth);
  const askHref = user || authLoading ? '/ask' : '/login?next=%2Fask#sign-in';

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
      if (Number.isFinite(saved) && saved >= MIN_PANEL_WIDTH && saved <= MAX_PANEL_WIDTH) setPanelWidth(saved);
    } catch { /* The layout remains usable when storage is unavailable. */ }
    const layout = layoutRef.current;
    if (!layout) return;
    const measure = () => setLayoutWidth(layout.clientWidth);
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(layout);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  function savePanelWidth(width: number) {
    const bounded = Math.max(MIN_PANEL_WIDTH, Math.min(maxPanelWidth, width));
    setPanelWidth(bounded);
    try { window.localStorage.setItem(PANEL_WIDTH_KEY, String(bounded)); } catch { /* Browser storage is optional. */ }
  }

  function startResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, width: visiblePanelWidth, current: visiblePanelWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveResize(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.current = Math.max(MIN_PANEL_WIDTH, Math.min(maxPanelWidth, drag.width + drag.x - event.clientX));
    setPanelWidth(drag.current);
  }

  function stopResize(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    savePanelWidth(drag.current);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const next = event.key === 'ArrowLeft' ? visiblePanelWidth + 24
      : event.key === 'ArrowRight' ? visiblePanelWidth - 24
      : event.key === 'Home' ? MIN_PANEL_WIDTH
      : event.key === 'End' ? maxPanelWidth : null;
    if (next === null) return;
    event.preventDefault();
    savePanelWidth(next);
  }
  // Sort immediately over the already loaded rows while the fresh server page
  // arrives, but never present rows from a different search/filter as results.
  const contentFilterKey = JSON.stringify([search, tag, visaType, experience, category, origin]);
  const filterKey = JSON.stringify([search, tag, visaType, sortMode, revision, experience, category, origin]);
  const filterRef = useRef(filterKey);
  filterRef.current = filterKey;
  const previousSearch = useRef(search);

  useEffect(() => {
    const params = new URLSearchParams(queryString);
    const sort = params.get('sort');
    const postKind = params.get('type');
    setSearch(params.get('q')?.slice(0, 200) ?? '');
    setTag(params.get('tag')?.slice(0, 60) ?? '');
    const visa = params.get('visa')?.slice(0, 80) ?? '';
    setVisaType(VISA_TYPES.includes(visa) ? visa : '');
    const experienceCategory = params.get('category') ?? '';
    setCategory(experience && EXPERIENCE_CATEGORIES.includes(experienceCategory) ? experienceCategory : '');
    const source = params.get('origin');
    setOrigin(source === 'member' || source === 'archive' ? source : '');
    setSortMode(SORTS.some(([value]) => value === sort) ? sort as SortMode : 'newest');
    setKind(experience ? '' : postKind === 'question' || postKind === 'discussion' || postKind === 'promotion' ? postKind : initialKind);
    setPage(1);
  }, [queryString, initialKind, experience]);

  useEffect(() => {
    alive.current = true;
    getCommunitySource().then((metadata) => { if (alive.current) setFeedUnavailable(!metadata); }).catch(() => { if (alive.current) setFeedUnavailable(true); });
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const typing = previousSearch.current !== search;
    previousSearch.current = search;
    setLoading(true); setError(''); setMore(false); setCursor(undefined);
    olderLock.current = null; setLoadingOlder(false);
    const fetchQuestions = () => {
      void getQuestionPage({ search, tag, visaType, sort: sortMode, experience, category, ...(origin ? { origin } : {}) })
        .then((data) => { if (active) { setQuestions(data.questions); setMore(data.more); setCursor(data.cursor); setLoadedFilterKey(contentFilterKey); } })
        .catch(() => { if (active) { setQuestions([]); setError('Questions could not be loaded. Please try again.'); } })
        .finally(() => { if (active) setLoading(false); });
    };
    // Only text input is debounced. Buttons start their request in this effect,
    // without a second event-loop turn or hover-triggered background requests.
    const timer = typing && search ? setTimeout(fetchQuestions, 200) : undefined;
    if (timer === undefined) fetchQuestions();
    return () => { active = false; clearTimeout(timer); };
  }, [search, tag, visaType, sortMode, revision, experience, category, origin]);

  async function loadOlder() {
    if (loading || olderLock.current || !cursor) return;
    const operation = Symbol();
    olderLock.current = operation; setLoadingOlder(true);
    const requestedFilter = filterKey;
    try {
      const data = await getQuestionPage({ search, tag, visaType, sort: sortMode, before: cursor, experience, category, ...(origin ? { origin } : {}) });
      if (!alive.current || filterRef.current !== requestedFilter) return;
      setQuestions((current) => [...current, ...data.questions.filter((question) => !current.some((item) => item.id === question.id))]);
      setMore(data.more); setCursor(data.cursor); setError('');
    } catch {
      if (alive.current && filterRef.current === requestedFilter) setError('More questions could not be loaded. Please try again.');
    } finally {
      if (olderLock.current === operation) {
        olderLock.current = null;
        if (alive.current) setLoadingOlder(false);
      }
    }
  }

  function updateQuery(updates: Record<string, string>) {
    const url = new URL(window.location.href);
    Object.entries(updates).forEach(([key, value]) => { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); });
    window.history.replaceState(null, '', url);
    setPage(1); setRelated(null);
  }

  function selectTag(value: string) { setTag(value); updateQuery({ tag: value }); }
  function selectSort(value: SortMode) {
    if (value === sortMode) return;
    setSortMode(value);
    updateQuery({ sort: value === 'newest' ? '' : value });
  }
  function resetFilters() {
    setCategory(''); setSearch(''); setVisaType(''); setTag(''); setKind(initialKind); setSortMode('newest'); setOrigin('');
    updateQuery({ q: '', visa: '', tag: '', type: '', sort: '', category: '', origin: '' });
  }
  function goToPage(value: number) {
    setPage(value);
    document.getElementById('question-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const visibleQuestions = useMemo(() => {
    const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const items = questions.filter((question) => {
      const haystack = [question.title, question.body, question.visa_type, question.destination_country, ...question.tags].join(' ').toLowerCase();
      return (experience ? question.post_kind === 'experience' : question.post_kind !== 'experience') && (!category || question.experience_category === category) && (!visaType || question.visa_type === visaType) && (!tag || question.tags.includes(tag))
        && (!origin || (origin === 'archive' ? isImportedPost(question) : !isImportedPost(question)))
        && (experience || !kind || (question.post_kind ?? 'question') === kind)
        && (sortMode !== 'unanswered' || question.answer_count === 0)
        && ((!demoMode && !isImportedPost(question)) || terms.every((term) => haystack.includes(term)));
    });
    return items.sort((a, b) => {
      const score = sortMode === 'activity' ? (b.vote_score + b.answer_count * 2) - (a.vote_score + a.answer_count * 2)
        : sortMode === 'score' ? b.vote_score - a.vote_score : 0;
      return score || Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id);
    });
  }, [questions, sortMode, search, visaType, tag, kind, demoMode, experience, category, origin]);
  const pageCount = Math.max(1, Math.ceil(visibleQuestions.length / PAGE_SIZE));
  const refreshing = loading && loadedFilterKey === contentFilterKey && questions.length > 0;
  const currentPage = Math.min(page, pageCount);
  const pageQuestions = visibleQuestions.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pageNumbers = Array.from({ length: pageCount }, (_, index) => index + 1)
    .filter((value) => value === 1 || value === pageCount || Math.abs(value - currentPage) <= 2);
  const visaTypes = [...new Set(questions.map((question) => question.visa_type).filter(type => VISA_TYPES.includes(type)))].sort();
  const filtered = Boolean(origin || category || search || visaType || tag || kind !== initialKind || sortMode !== 'newest');
  const popularTags = useMemo(() => {
    const counts = new Map<string, number>();
    questions.forEach((question) => question.tags.forEach((name) => counts.set(name, (counts.get(name) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);
  }, [questions]);

  const liveTopics = tag || popularTags.slice(0, 5).map(([name]) => name).join('|');
  useEffect(() => subscribeLive(liveTopics.split('|').filter(Boolean).map((name) => `discovery:${name}`),
    () => setRevision((value) => value + 1)), [liveTopics, user?.id]);

  return (
    <main className="page-shell">
      <div ref={layoutRef} className="home-feed-layout" style={{ '--discovery-width': `${visiblePanelWidth}px` } as CSSProperties}>
        <div id="home-feed-main" className="min-w-0">
          <header className="feed-heading flex flex-wrap items-center justify-between gap-4">
            <div><p className="mb-2 text-sm font-semibold text-teal-800">Your visa journey, together</p><h1 className="text-2xl font-semibold text-slate-950 sm:text-3xl">{experience ? 'U.S. Visa Experiences' : initialKind === 'discussion' ? 'U.S. Visa Discussions' : 'U.S. Visa Community'}</h1><p className="mt-2 max-w-2xl text-base leading-6 text-slate-600">{experience ? 'First-hand stories selected from existing discussions, alongside experiences shared here. Original dates and replies are preserved. Personal accounts are not verified outcomes or legal advice.' : 'Questions, shared experiences, and practical discussions about U.S. visas.'}</p></div>
            <Link href={experience ? '/experiences/new' : askHref} className="inline-flex items-center gap-1.5 rounded-full bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-800"><Plus size={17} aria-hidden="true" />{experience ? 'Share Your Experience' : 'Ask a Question'}</Link>
          </header>

          <label className="relative my-4 block">
            <span className="sr-only">Search visa questions</span><Search className="absolute left-3.5 top-3 text-slate-500" size={18} aria-hidden="true" />
            <input value={search} maxLength={200} onChange={(event) => { setSearch(event.target.value); updateQuery({ q: event.target.value }); }} placeholder="Search questions, visa types, and tags" className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100" />
          </label>

          {experience && <label className="mb-4 flex flex-wrap items-center gap-2 text-sm">Experience Category<select value={category} onChange={event => { setCategory(event.target.value); updateQuery({ category: event.target.value }); }} className="rounded border px-3 py-2"><option value="">All Experience Categories</option>{EXPERIENCE_CATEGORIES.map(value => <option key={value} value={value}>{value.replace(/\b\w/g, letter => letter.toUpperCase())}</option>)}</select></label>}
          <section id="question-list" aria-label="Community questions" aria-busy={loading} className="min-w-0 scroll-mt-24">
            <div className="feed-controls">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1" aria-label="Sort questions">{SORTS.map(([value, label]) => <button key={value} type="button" onClick={() => selectSort(value)} aria-pressed={sortMode === value} className={`feed-sort-button rounded-lg px-3 py-2 text-sm font-semibold ${sortMode === value ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>)}</div>
                <label className="flex min-w-0 items-center gap-1.5 text-sm text-slate-600"><SlidersHorizontal size={15} aria-hidden="true" /><select aria-label="Visa Type" value={visaType} onChange={(event) => { setVisaType(event.target.value); updateQuery({ visa: event.target.value }); }} className="max-w-[180px] rounded bg-transparent py-2 font-medium focus:outline-blue-600"><option value="">All U.S. Visa Types</option>{visaTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
                <select aria-label="Post origin" value={origin} onChange={event => { const value = event.target.value as typeof origin; setOrigin(value); updateQuery({ origin: value }); }} className="max-w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm font-medium text-slate-700"><option value="">All Sources</option><option value="member">Member Posts</option><option value="archive">Community Archive</option></select>
                {!experience && <select aria-label="Post type" value={kind} onChange={(event) => { const value = event.target.value as PostKind; setKind(value); updateQuery({ type: value }); }} className="max-w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-600"><option value="">All Post Types</option><option value="question">Questions</option><option value="discussion">Discussions & experiences</option><option value="promotion">Promotional posts</option></select>}
                {tag && <button onClick={() => selectTag('')} className="inline-flex max-w-full items-center gap-1 break-words rounded bg-blue-50 px-2 py-1.5 text-sm font-semibold text-blue-700">{topicLabel(tag)}<X size={13} aria-hidden="true" /><span className="sr-only">Clear tag</span></button>}
                {filtered && <button onClick={resetFilters} className="text-sm font-semibold text-blue-700 hover:underline">Clear Filters</button>}
                <span aria-live="polite" className="ml-auto text-xs text-slate-500">{loading ? refreshing ? 'Updating results…' : 'Loading questions...' : visibleQuestions.length ? `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, visibleQuestions.length)} of ${visibleQuestions.length} loaded${more ? ' · More available' : ''}` : '0 posts shown'}</span>
              </div>
              {origin === 'archive' && <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-600">Previously shared discussions, collected in the Community archive. Archive authors are not linked to member accounts; you can reply here, but cannot message the original author.</p>}
            </div>
            {!loading && feedUnavailable && <p className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">Some discussions are temporarily unavailable. Please try again later.</p>}
            {error && <div role="alert" className="my-3 rounded-lg bg-rose-50 p-4 text-sm text-rose-800">{error} <button onClick={() => setRevision((value) => value + 1)} className="font-semibold underline">Retry</button></div>}
            {loading && !refreshing ? <div role="status" aria-label="Loading questions" className="divide-y divide-slate-100">{[1, 2, 3, 4].map((item) => <div key={item} className="space-y-3 py-5"><div className="h-5 w-2/5 animate-pulse rounded bg-slate-100" /><div className="h-6 w-4/5 animate-pulse rounded bg-slate-100" /><div className="h-10 animate-pulse rounded bg-slate-100" /></div>)}</div> : <>
              {!loading && !error && visibleQuestions.length === 0 && <div className="px-6 py-12 text-center"><Search className="mx-auto text-slate-400" size={28} aria-hidden="true" /><h2 className="mt-3 font-semibold text-slate-900">{experience ? 'No matching experiences' : 'No matching questions'}</h2><p className="mt-1 text-sm text-slate-500">{more ? 'Load more posts or adjust your filters.' : experience ? 'Try another filter or share your own first-hand story.' : 'Try another search or sign in to contribute.'}</p><Link href={experience ? '/experiences/new' : askHref} className="mt-4 inline-block text-sm font-semibold text-blue-700 hover:underline">{experience ? 'Share Your Experience' : 'Ask a Question'}</Link></div>}
              {pageQuestions.map((question) => <QuestionCard key={question.id} question={question} onTagSelect={selectTag} onRelated={(value) => { setRelated(value); document.getElementById('feed-related')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }} />)}
              {pageCount > 1 && <nav aria-label="Post pagination" className="flex flex-wrap items-center justify-center gap-2 py-5"><button disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)} className="rounded-full px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-40">Previous</button>{pageNumbers.map((value, index) => <span key={value} className="inline-flex items-center gap-2">{index > 0 && value > pageNumbers[index - 1] + 1 && <span aria-hidden="true">...</span>}<button aria-label={`Page ${value}`} aria-current={currentPage === value ? 'page' : undefined} onClick={() => goToPage(value)} className={`min-w-9 rounded-full px-3 py-2 text-sm ${currentPage === value ? 'bg-blue-700 text-white' : 'hover:bg-slate-100'}`}>{value}</button></span>)}<button disabled={currentPage === pageCount} onClick={() => goToPage(currentPage + 1)} className="rounded-full px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-40">Next</button></nav>}
              {more && <div className="py-4 text-center"><button onClick={() => void loadOlder()} disabled={loadingOlder} className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">{loadingOlder ? 'Loading...' : 'Load more questions'}</button></div>}
            </>}
          </section>
        </div>

        <div role="separator" tabIndex={0} aria-label="Resize posts and discovery panels" aria-orientation="vertical" aria-controls="home-feed-main home-feed-aside" aria-valuemin={MIN_PANEL_WIDTH} aria-valuemax={maxPanelWidth} aria-valuenow={visiblePanelWidth} title="Drag to resize panels. Use arrow keys when focused; double-click to reset." className="home-feed-resizer" onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={stopResize} onPointerCancel={stopResize} onKeyDown={resizeWithKeyboard} onDoubleClick={() => savePanelWidth(300)}><GripVertical size={16} aria-hidden="true" /></div>
        <aside id="home-feed-aside" aria-label="Community discovery" className="feed-discovery min-w-0 space-y-5">
          <section className="rounded-xl bg-teal-50 p-4">
            <h2 className="text-thread-title font-semibold text-slate-900">Find Your Community</h2><p className="mt-2 text-base leading-6 text-slate-600">Connect around a U.S. visa or stage of your journey.</p>
            <Link href="/explore" className="mt-3 flex items-center justify-between rounded-lg bg-white px-3 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50"><span className="inline-flex items-center gap-2"><Compass size={17} aria-hidden="true" />Explore Communities</span><ArrowUpRight size={16} aria-hidden="true" /></Link>
            <Link href="/communities/new" className="mt-2 flex items-center gap-2 px-3 py-2 text-sm font-semibold text-slate-700 hover:text-blue-700"><Plus size={17} aria-hidden="true" />Start a Community</Link>
          </section>
          <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4"><h2 className="text-thread-title font-semibold text-slate-900">Know the Source</h2><p className="mt-2 text-base leading-6 text-slate-600"><span className="font-semibold text-amber-900">Community archive</span> identifies imported discussions. Member posts are created directly on VisaThreads. Topic tags work the same for both.</p><button onClick={() => { setOrigin(origin === 'member' ? '' : 'member'); updateQuery({ origin: origin === 'member' ? '' : 'member' }); }} className="mt-3 text-sm font-semibold text-teal-800 hover:underline">{origin === 'member' ? 'Show all sources' : 'See member posts'} <ArrowUpRight className="inline" size={13} aria-hidden="true" /></button></section>
          {popularTags.length > 0 && <section className="border-b border-slate-200 px-2 pb-5"><div className="flex items-center gap-2"><Tags size={17} className="shrink-0 text-slate-500" aria-hidden="true" /><h2 className="text-thread-title font-semibold text-slate-900">Topics in This Feed</h2></div><div className="mt-3 flex flex-wrap gap-2">{popularTags.map(([name, count]) => <button key={name} onClick={() => selectTag(name)} className="max-w-full break-words rounded bg-blue-50 px-2 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100">{topicLabel(name)}<span className="ml-1.5 text-xs text-blue-500">{count}</span></button>)}</div><Link href="/tags" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-blue-700">All Tags<ArrowUpRight size={13} aria-hidden="true" /></Link></section>}
          {(related || search || tag || pageQuestions[0]) && <div id="feed-related" className="scroll-mt-24">{related && <div className="mb-2 flex items-start justify-between gap-2 px-2 text-xs text-slate-500"><span className="line-clamp-2">Similar to: {related.title}</span><button onClick={() => setRelated(null)} title="Clear related question selection" aria-label="Clear related question selection" className="shrink-0 rounded p-1 hover:bg-slate-100"><X size={14} /></button></div>}<RelatedQuestions context={related ?? (search || tag ? { title: search, tags: tag ? [tag] : [] } : pageQuestions[0])} /></div>}
        </aside>
      </div>
    </main>
  );
}

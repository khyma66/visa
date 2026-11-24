'use client';

import { isImportedPost, topicLabel } from '@/lib/post-presentation';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowUpRight, Compass, MessageSquare, Plus, Search, Tags, X } from 'lucide-react';
import { getCommunitySource, getQuestionPage } from '@/lib/community';
import type { Question } from '@/lib/types';
import { subscribeLive } from '@/lib/realtime';
import { QuestionCard } from './QuestionCard';
import { useAuth } from './AuthProvider';
import { RelatedQuestions } from './RelatedQuestions';
import { HomeSidePanel } from './HomeSidePanel';
import { ResizablePostLayout } from './ResizablePostLayout';

import { EXPERIENCE_CATEGORIES, VISA_TYPES } from '@/lib/post-categories';

const PAGE_SIZE = 20;
const DEFAULT_VISA = 'F-1 / OPT';
const FEED_VISAS = [DEFAULT_VISA, ...VISA_TYPES.filter(value => value !== DEFAULT_VISA), ''];
const SORTS = [['newest', 'New'], ['activity', 'Active'], ['score', 'Top'], ['unanswered', 'Unanswered'], ['sos', 'SOS']] as const;
type SortMode = typeof SORTS[number][0];
type PostKind = '' | 'question' | 'discussion' | 'promotion';

function visaFromQuery(params: URLSearchParams) {
  const visa = params.get('visa')?.slice(0, 80) ?? '';
  if (VISA_TYPES.includes(visa)) return visa;
  // Global search/topic links should still find discussions across all visas.
  if (visa === 'all' || ['q', 'tag', 'category', 'origin'].some(key => params.get(key))) return '';
  return DEFAULT_VISA;
}

const MAX_FILL_REQUESTS = 5;
function pageFromQuery(value: string | null) {
  const page = Number(value);
  return Number.isInteger(page) && page > 1 && page <= 500 ? page : 1;
}

export function CommunityHome({ initialKind = '', experience = false }: { initialKind?: PostKind; experience?: boolean } = {}) {
  const { user, demoMode } = useAuth();
  const searchParams = useSearchParams();
  const queryString = useMemo(() => { const params = new URLSearchParams(searchParams.toString()); params.delete('page'); return params.toString(); }, [searchParams]);
  const requestedPage = useRef(pageFromQuery(searchParams.get('page')));
  const [questions, setQuestions] = useState<Question[]>([]);
  const [initialPageSize, setInitialPageSize] = useState(0);
  const [search, setSearch] = useState('');
  const [visaType, setVisaType] = useState(() => visaFromQuery(new URLSearchParams(queryString)));
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
  const [category, setCategory] = useState('');
  const [origin, setOrigin] = useState<'' | 'member' | 'earlier'>('');
  const [loadedFilterKey, setLoadedFilterKey] = useState<string | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const olderLock = useRef<symbol | null>(null);
  const alive = useRef(true);
  const askTarget = sortMode === 'sos' ? '/ask?sos=1' : '/ask';
  const askHref = user ? askTarget : `/login?next=${encodeURIComponent(askTarget)}#sign-in`;

  // Sort immediately over the already loaded rows while the fresh server page
  // arrives, but never present rows from a different search/filter as results.
  const contentFilterKey = JSON.stringify([search, tag, visaType, experience, category, origin]);
  const filterKey = JSON.stringify([search, tag, visaType, sortMode, revision, experience, category, origin, kind]);
  const filterRef = useRef(filterKey);
  filterRef.current = filterKey;
  const previousSearch = useRef(search);

  useEffect(() => {
    const params = new URLSearchParams(queryString);
    const sort = params.get('sort');
    const postKind = params.get('type');
    setSearch(params.get('q')?.slice(0, 200) ?? '');
    setTag(params.get('tag')?.slice(0, 60) ?? '');
    setVisaType(visaFromQuery(params));
    const experienceCategory = params.get('category') ?? '';
    setCategory(experience && EXPERIENCE_CATEGORIES.includes(experienceCategory) ? experienceCategory : '');
    const source = params.get('origin');
    if (source === 'archive') {
      const url = new URL(window.location.href);
      url.searchParams.set('origin', 'earlier');
      window.history.replaceState(window.history.state, '', url);
    }
    setOrigin(source === 'member' ? 'member' : source === 'earlier' || source === 'archive' ? 'earlier' : '');
    setSortMode(SORTS.some(([value]) => value === sort) ? sort as SortMode : 'newest');
    setKind(experience ? '' : postKind === 'question' || postKind === 'discussion' || postKind === 'promotion' ? postKind : initialKind);
    setPage(requestedPage.current);
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
      const dataOrigin = origin === 'earlier' ? 'archive' : origin;
      void getQuestionPage({ search, tag: sortMode === 'sos' ? 'sos' : tag, visaType, sort: sortMode === 'sos' ? 'newest' : sortMode, experience, category, ...(kind ? {kind} : {}), ...(dataOrigin ? { origin: dataOrigin } : {}) })
        .then((data) => { if (active) { setQuestions(data.questions); setInitialPageSize(data.questions.length); setMore(data.more); setCursor(data.cursor); setLoadedFilterKey(contentFilterKey); } })
        .catch(() => { if (active) { setQuestions([]); setError('Questions could not be loaded. Please try again.'); } })
        .finally(() => { if (active) setLoading(false); });
    };
    // Only text input is debounced. Buttons start their request in this effect,
    // without a second event-loop turn or hover-triggered background requests.
    const timer = typing && search ? setTimeout(fetchQuestions, 200) : undefined;
    if (timer === undefined) fetchQuestions();
    return () => { active = false; clearTimeout(timer); };
  }, [search, tag, visaType, sortMode, revision, experience, category, origin, kind]);

  async function loadOlder(targetPage = Math.floor(visibleQuestions.length / PAGE_SIZE) + 1) {
    if (loading || olderLock.current || !cursor) return;
    const operation = Symbol();
    olderLock.current = operation; setLoadingOlder(true);
    const requestedFilter = filterKey;
    try {
      const dataOrigin = origin === 'earlier' ? 'archive' : origin;
      const loaded = [...questions];
      let nextCursor: Question | undefined = cursor;
      let hasMore = true;
      for (let request = 0; request < MAX_FILL_REQUESTS && nextCursor && hasMore && loaded.filter(matchesFilters).length < targetPage * PAGE_SIZE; request++) {
        const data = await getQuestionPage({ search, tag: sortMode === 'sos' ? 'sos' : tag, visaType, sort: sortMode === 'sos' ? 'newest' : sortMode, before: nextCursor, experience, category, ...(kind ? {kind} : {}), ...(dataOrigin ? { origin: dataOrigin } : {}) });
        if (!alive.current || filterRef.current !== requestedFilter) return;
        const fresh = data.questions.filter((question) => !loaded.some((item) => item.id === question.id));
        loaded.push(...fresh);
        nextCursor = data.cursor; hasMore = data.more;
        if (!fresh.length) break;
      }
      setQuestions(loaded);
      setMore(hasMore && Boolean(nextCursor)); setCursor(nextCursor); setError('');
      goToPage(Math.min(targetPage, Math.max(1, Math.ceil(loaded.filter(matchesFilters).length / PAGE_SIZE))));
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
    setSelectedPostId(null);
    const url = new URL(window.location.href);
    if (!Object.hasOwn(updates, 'visa')) url.searchParams.set('visa', visaType || 'all');
    Object.entries(updates).forEach(([key, value]) => { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); });
    url.searchParams.delete('page');
    requestedPage.current = 1;
    window.history.replaceState(null, '', url);
    setPage(1);
  }

  function selectTag(value: string) { setTag(value); updateQuery({ tag: value }); }
  function selectVisa(value: string) {
    if (value === visaType) return;
    setVisaType(value);
    updateQuery({ visa: value || 'all' });
  }
  function selectSort(value: SortMode) {
    if (value === sortMode) return;
    setSortMode(value);
    updateQuery({ sort: value === 'newest' ? '' : value });
  }
  function resetFilters() {
    setCategory(''); setSearch(''); setVisaType(DEFAULT_VISA); setTag(''); setKind(initialKind); setSortMode('newest'); setOrigin('');
    updateQuery({ q: '', visa: '', tag: '', type: '', sort: '', category: '', origin: '' });
  }
  function goToPage(value: number) {
    setSelectedPostId(null);
    setPage(value);
    // Keep the page in the address so it can be shared, reloaded and bookmarked.
    const url = new URL(window.location.href);
    if (value > 1) url.searchParams.set('page', String(value)); else url.searchParams.delete('page');
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url);
    const list = document.getElementById('question-list');
    // On desktop the list itself scrolls, so reset it before aligning the page.
    if (list) list.scrollTop = 0;
    list?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const matchesFilters = useMemo(() => (question: Question) => {
    const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const haystack = [question.title, question.body, question.visa_type, question.destination_country, ...question.tags].join(' ').toLowerCase();
    return (experience ? question.post_kind === 'experience' : question.post_kind !== 'experience') && (!category || question.experience_category === category) && (!visaType || question.visa_type === visaType) && (!tag || question.tags.includes(tag))
      && (!origin || (origin === 'earlier' ? isImportedPost(question) : !isImportedPost(question)))
      && (experience || !kind || (question.post_kind ?? 'question') === kind)
      && (sortMode !== 'unanswered' || question.answer_count === 0)
      && (sortMode !== 'sos' || question.tags.includes('sos'))
      && ((!demoMode && !isImportedPost(question)) || terms.every((term) => haystack.includes(term)));
  }, [sortMode, search, visaType, tag, kind, demoMode, experience, category, origin]);
  const visibleQuestions = useMemo(() => {
    const items = questions.filter(matchesFilters);
    return items.sort((a, b) => {
      const score = sortMode === 'activity' ? (b.vote_score + b.answer_count * 2) - (a.vote_score + a.answer_count * 2)
        : sortMode === 'score' ? b.vote_score - a.vote_score : 0;
      return score || Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id);
    });
  }, [questions, sortMode, matchesFilters]);
  const pageCount = Math.max(1, Math.ceil(visibleQuestions.length / PAGE_SIZE));
  const refreshing = loading && loadedFilterKey === contentFilterKey && questions.length > 0;
  const currentPage = Math.min(page, pageCount);
  // A shared ?page= link may point past the first batch: load forward once.
  useEffect(() => {
    const target = requestedPage.current;
    if (loading || loadingOlder || target <= 1) return;
    requestedPage.current = 1;
    if (target > pageCount && more && cursor) void loadOlder(target);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when a batch settles
  }, [loading, loadingOlder, pageCount, more, cursor]);
  const pageQuestions = visibleQuestions.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  // Filters run in the browser, so a server batch may hold only a few matches.
  // Fill a partial page in place; otherwise open the next page, loading enough
  // older posts that it is full (unless the feed has no more posts).
  function goNext() {
    const target = pageQuestions.length < PAGE_SIZE ? currentPage : currentPage + 1;
    if (more && cursor && visibleQuestions.length < target * PAGE_SIZE) void loadOlder(target);
    else if (target <= pageCount && target !== currentPage) goToPage(target);
  }
  const selectedPost = pageQuestions.find(question => question.id === selectedPostId) ?? pageQuestions[0];
  const pageNumbers = Array.from({ length: pageCount }, (_, index) => index + 1)
    .filter((value) => value === 1 || value === pageCount || Math.abs(value - currentPage) <= 2);
  const filtered = Boolean(origin || category || search || visaType !== DEFAULT_VISA || tag || kind !== initialKind || sortMode !== 'newest');
  const experienceParams = new URLSearchParams({ visa: visaType || 'all' });
  // Experience is a separate feed: carry the visa, not question-only filters
  // (in particular SOS/unanswered), which can otherwise hide every story.
  const experienceHref = `/us/en/experiences?${experienceParams}`;
  const createExperienceHref = `/experiences/new?${new URLSearchParams({ visa: visaType || DEFAULT_VISA })}`;
  const popularTags = useMemo(() => {
    const counts = new Map<string, number>();
    questions.forEach((question) => question.tags.forEach((name) => counts.set(name, (counts.get(name) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);
  }, [questions]);

  // Keep subscriptions stable when older pages are appended. A new subscription
  // refreshes the feed, which would otherwise replace those pages with page one.
  const liveTopics = useMemo(() => {
    if (tag) return tag;
    const counts = new Map<string, number>();
    questions.slice(0, initialPageSize).forEach(question => question.tags.forEach(name => counts.set(name, (counts.get(name) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([name]) => name).join('|');
  }, [tag, questions, initialPageSize]);
  useEffect(() => subscribeLive(liveTopics.split('|').filter(Boolean).map((name) => `discovery:${name}`),
    () => setRevision((value) => value + 1)), [liveTopics, user?.id]);

  return (
    <main className="page-shell home-workspace">
      <ResizablePostLayout fill className="home-fit min-h-0 flex-1" mainLabel="Posts" relatedLabel="Community discovery" related={<HomeSidePanel visaType={visaType}><div id="home-feed-aside" className="min-w-0 space-y-5">
          {(selectedPost || search || tag) && <div id="feed-related" className="scroll-mt-24">
            {selectedPost && <p aria-live="polite" className="mb-3 border-l-2 border-teal-800 pl-3 text-sm text-slate-600">Related To <span className="block break-words font-semibold text-slate-900">{selectedPost.title}</span></p>}
            <RelatedQuestions key={selectedPost?.id ?? `${search}:${tag}`} context={selectedPost ?? { title: search, tags: tag ? [tag] : [] }} />
          </div>}
          <section className="rounded-xl bg-teal-50 p-4">
            <h2 className="text-thread-title font-semibold text-slate-900 capitalize">Find Your Community</h2><p className="mt-2 text-base leading-6 text-slate-600">Connect around a U.S. visa or stage of your journey.</p>
            <Link href="/us/en/explore" className="mt-3 flex items-center justify-between rounded-lg bg-white px-3 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 capitalize"><span className="inline-flex items-center gap-2 capitalize"><Compass size={17} aria-hidden="true" />Explore Communities</span><ArrowUpRight size={16} aria-hidden="true" /></Link>
            <Link href="/communities/new" className="mt-2 flex items-center gap-2 px-3 py-2 text-sm font-semibold text-slate-700 hover:text-blue-700 capitalize"><Plus size={17} aria-hidden="true" />Start a Community</Link>
          </section>
          <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4"><h2 className="text-thread-title font-semibold text-slate-900 capitalize">Member Discussions</h2><p className="mt-2 text-sm leading-6 text-slate-600">See questions and experiences shared directly by VisaThreads members.</p><button onClick={() => { setOrigin(origin === 'member' ? '' : 'member'); updateQuery({ origin: origin === 'member' ? '' : 'member' }); }} className="mt-3 text-sm font-semibold text-teal-800 hover:underline capitalize">{origin === 'member' ? 'Show all posts' : 'See member posts'} <ArrowUpRight className="inline" size={13} aria-hidden="true" /></button></section>
          {popularTags.length > 0 && <section className="border-b border-slate-200 px-2 pb-5"><div className="flex items-center gap-2"><Tags size={17} className="shrink-0 text-slate-500" aria-hidden="true" /><h2 className="text-thread-title font-semibold text-slate-900 capitalize">Topics in This Feed</h2></div><div className="mt-3 flex flex-wrap gap-2">{popularTags.map(([name, count]) => <button key={name} onClick={() => selectTag(name)} className="max-w-full break-words rounded bg-blue-50 px-2 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100">{topicLabel(name)}<span className="ml-1.5 text-xs text-blue-500">{count}</span></button>)}</div><Link href="/us/en/tags" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-blue-700 capitalize">All Tags<ArrowUpRight size={13} aria-hidden="true" /></Link></section>}

        </div></HomeSidePanel>}>

        <div id="home-feed-main" className="flex min-w-0 flex-col lg:h-full lg:min-h-0">
          <header className="home-heading flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-teal-100 bg-gradient-to-r from-[#effaf6] to-[#f2f7ff] px-4 py-2 sm:px-5">
            <div className="min-w-0 flex-1 capitalize"><h1 className="truncate text-xl font-semibold leading-7 text-slate-950 sm:text-2xl capitalize">{experience ? 'U.S. Visa Experiences' : initialKind === 'discussion' ? 'U.S. Visa Discussions' : 'U.S. Visa Community'}</h1><p className="line-clamp-2 text-sm leading-5 text-slate-600 sm:hidden">{experience ? 'First-hand stories from existing discussions and shared experiences. Original dates and replies are preserved.' : 'Ask about U.S. visas and find people with the same issue.'}</p></div>
            <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0">
              <label className="relative block min-w-0 flex-1 capitalize sm:w-56 xl:w-80">
                <span className="sr-only capitalize">Search visa questions</span><Search className="absolute left-3.5 top-2.5 text-slate-500" size={17} aria-hidden="true" />
                <input value={search} maxLength={200} onChange={(event) => { setSearch(event.target.value); updateQuery({ q: event.target.value }); }} placeholder="Search questions, visa types, and tags" className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100" />
              </label>
              {!experience && <Link href={askHref} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-teal-700 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 capitalize"><Plus size={16} aria-hidden="true" /><span className="hidden min-[420px]:inline">Ask</span><span className="sr-only min-[420px]:hidden">Ask a Question</span></Link>}
            </div>
          </header>

          <div className="feed-toolbar mt-2 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 sm:px-3 lg:mt-1 lg:py-1">
              <div role="group" aria-label="Filter by visa">
                <div className="flex items-center gap-1.5 overflow-x-auto overscroll-x-contain pb-0.5 lg:pb-0 [scrollbar-width:none] sm:gap-2">
                  {FEED_VISAS.map((value) => <button key={value || 'all'} type="button" onClick={() => selectVisa(value)} aria-pressed={visaType === value} className={`min-h-11 shrink-0 rounded-full border px-3 py-2 text-sm font-medium lg:px-2.5 lg:py-0 lg:leading-8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${visaType === value ? 'border-teal-700 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:bg-teal-50'}`}>{value.replace(/-/g, '') || 'All visas'}</button>)}
                  {filtered && <button type="button" onClick={resetFilters} aria-label="Reset filters" className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"><X size={14} aria-hidden="true" />Clear filters</button>}
                </div>
              </div>
              <div className="mt-1 flex items-center gap-1 overflow-x-auto overscroll-x-contain border-t border-slate-100 pt-1 [scrollbar-width:none] lg:mt-0 lg:border-0 lg:pt-0 sm:flex-wrap lg:flex-nowrap" role="group" aria-label={experience ? 'Sort experiences' : 'Sort questions'}>
                {SORTS.map(([value, label]) => <button key={value} type="button" onClick={() => selectSort(value)} aria-pressed={sortMode === value} className={`feed-sort-button capitalize rounded-lg px-1 py-2 text-sm font-semibold sm:px-3 ${sortMode === value ? experience ? 'bg-slate-100 text-slate-900 ring-1 ring-inset ring-slate-300' : 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-teal-50 hover:text-teal-900'}`}>{label}</button>)}
                <Link href={experienceHref} prefetch={false} aria-current={experience ? 'page' : undefined} className={`feed-sort-button inline-flex min-h-11 items-center justify-center rounded-lg px-1 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 sm:px-3 ${experience ? 'bg-teal-700 text-white hover:bg-teal-800' : 'text-slate-600 hover:bg-teal-50 hover:text-teal-900'}`}>Experience</Link>
                {experience && <Link href={createExperienceHref} prefetch={false} className="col-span-full inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 sm:ml-auto"><Plus size={16} aria-hidden="true" />Create Experience</Link>}
              </div>
          </div>

          <section id="question-list" aria-label="Community questions" aria-busy={loading} className="mt-2 min-w-0 lg:mt-0.5 scroll-mt-24 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
          {experience && <label className="mb-4 flex flex-wrap items-center gap-2 text-sm">Experience Category<select value={category} onChange={event => { setCategory(event.target.value); updateQuery({ category: event.target.value }); }} className="rounded border px-3 py-2"><option value="" className="capitalize">All Experience Categories</option>{EXPERIENCE_CATEGORIES.map(value => <option key={value} value={value}>{value.replace(/\b\w/g, letter => letter.toUpperCase())}</option>)}</select></label>}
            {sortMode === 'sos' && !experience && <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><strong>Urgent community questions</strong><p>Replies are not immediate or guaranteed. If someone is in immediate danger in the U.S., call 911.</p><Link href={askHref} className="mt-2 inline-block font-semibold underline">Post an SOS question</Link></div>}
              {(experience || initialKind || tag) && <div className="mt-3 flex flex-wrap items-center gap-2">
                {(experience || initialKind) && <select aria-label="Post source" value={origin} onChange={event => { const value = event.target.value as typeof origin; setOrigin(value); updateQuery({ origin: value }); }} className="max-w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm font-medium text-slate-700"><option value="" className="capitalize">All Posts</option><option value="member" className="capitalize">Member Posts</option><option value="earlier" className="capitalize">Earlier Discussions</option></select>}
                {!experience && initialKind && <select aria-label="Post type" value={kind} onChange={(event) => { const value = event.target.value as PostKind; setKind(value); updateQuery({ type: value }); }} className="max-w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-600"><option value="" className="capitalize">All Post Types</option><option value="question" className="capitalize">Questions</option><option value="discussion" className="capitalize">Discussions & experiences</option><option value="promotion" className="capitalize">Promotional posts</option></select>}
                {tag && <button onClick={() => selectTag('')} className="inline-flex max-w-full items-center gap-1 break-words rounded bg-blue-50 px-2 py-1.5 text-sm font-semibold text-blue-700">{topicLabel(tag)}<X size={13} aria-hidden="true" /><span className="sr-only capitalize">Clear tag</span></button>}
              </div>}
              <span aria-live="polite" aria-atomic="true" className="sr-only">{loading ? refreshing ? 'Updating results…' : 'Loading questions...' : `${pageQuestions.length} posts on page ${currentPage}`}</span>
              {origin === 'earlier' && <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-600">Previously published discussions use neutral public aliases. You can reply here, but the original contributor is not a VisaThreads member and cannot receive direct messages.</p>}
            {!loading && feedUnavailable && <p className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">Some discussions are temporarily unavailable. Please try again later.</p>}
            {error && <div role="alert" className="my-3 rounded-lg bg-rose-50 p-4 text-sm text-rose-800">{error} <button onClick={() => setRevision((value) => value + 1)} className="font-semibold underline capitalize">Retry</button></div>}
            {loading && !refreshing ? <div role="status" aria-label="Loading questions" className="divide-y divide-slate-100">{[1, 2, 3, 4].map((item) => <div key={item} className="space-y-3 py-5"><div className="h-5 w-2/5 animate-pulse rounded bg-slate-100" /><div className="h-6 w-4/5 animate-pulse rounded bg-slate-100" /><div className="h-10 animate-pulse rounded bg-slate-100" /></div>)}</div> : <>
              {!loading && !error && visibleQuestions.length === 0 && <div className="px-6 py-12 text-center"><Search className="mx-auto text-slate-400" size={28} aria-hidden="true" /><h2 className="mt-3 font-semibold text-slate-900">{visaType ? `No matching ${visaType} ${experience ? 'experiences' : 'posts'}` : experience ? 'No matching experiences' : 'No matching questions'}</h2><p className="mt-1 text-sm text-slate-500">{visaType ? 'Try another visa or clear the filters.' : experience ? 'Try another filter or share your own first-hand story.' : 'Try another search or sign in to contribute.'}</p><Link href={experience ? createExperienceHref : askHref} className="mt-4 inline-block text-sm font-semibold text-blue-700 hover:underline capitalize">{experience ? 'Create Experience' : 'Ask a Question'}</Link></div>}
              {pageQuestions.map((question) => <QuestionCard key={question.id} question={question} onTagSelect={selectTag} selected={selectedPost?.id === question.id} onSelect={() => setSelectedPostId(question.id)} />)}
              {(pageCount > 1 || more) && <div className="border-t border-slate-100 py-4">
                {pageQuestions.length > 0 && <p className="mb-2 text-center text-xs tabular-nums text-slate-500">{`Posts ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, visibleQuestions.length)}`}</p>}
                <nav aria-label="Post pagination" className="tab-row items-center tab-row-centered"><button disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)} className="rounded-full px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-40 capitalize">Previous</button>{pageNumbers.map((value, index) => <span key={value} className="inline-flex items-center gap-2">{index > 0 && value > pageNumbers[index - 1] + 1 && <span aria-hidden="true" className="capitalize">...</span>}<button aria-label={`Page ${value}`} aria-current={currentPage === value ? 'page' : undefined} onClick={() => goToPage(value)} className={`min-w-11 rounded-full px-3 py-2 text-sm ${currentPage === value ? 'bg-teal-700 font-semibold text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{value}</button></span>)}<button disabled={loading || loadingOlder || (currentPage === pageCount && !more)} onClick={goNext} className="rounded-full px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-40 capitalize">{loadingOlder ? 'Loading…' : 'Next'}</button></nav>
              </div>}
            </>}
          </section>
        </div>


      </ResizablePostLayout>
    </main>
  );
}

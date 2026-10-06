'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Search, SlidersHorizontal, Sparkles, Tags, TrendingUp, Users, MessageCircle, CircleHelp } from 'lucide-react';
import { getCommunitySource, getQuestionPage } from '@/lib/community';
import type { Question } from '@/lib/types';
import { subscribeLive } from '@/lib/realtime';
import { QuestionCard } from './QuestionCard';
import { useAuth } from './AuthProvider';
import { RelatedQuestions } from './RelatedQuestions';

const PAGE_SIZE = 20;
type SortMode = 'newest' | 'activity' | 'unanswered' | 'score';

export function CommunityHome() {
  const { user, demoMode } = useAuth();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [search, setSearch] = useState('');
  const [visaType, setVisaType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [tag, setTag] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [feedUnavailable, setFeedUnavailable] = useState(false);
  const [more, setMore] = useState(false);
  const [cursor, setCursor] = useState<Question>();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [revision, setRevision] = useState(0);
  const [related, setRelated] = useState<Question | null>(null);
  const filterKey = JSON.stringify([search,tag,visaType,sortMode]);
  const filterRef = useRef(filterKey);
  filterRef.current = filterKey;

  useEffect(() => {
    let active = true;
    const restoreTag = () => { setTag(new URLSearchParams(window.location.search).get('tag') ?? ''); setPage(1); };
    restoreTag();
    window.addEventListener('popstate', restoreTag);
    getCommunitySource().then((metadata) => { if (active) setFeedUnavailable(!metadata); }).catch(() => { if (active) setFeedUnavailable(true); });
    return () => { active = false; window.removeEventListener('popstate', restoreTag); };
  }, []);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void getQuestionPage({ search, tag, visaType, sort: sortMode })
      .then((data) => { if (active) { setQuestions(data.questions); setMore(data.more); setCursor(data.cursor); setError(''); } })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [search, tag, visaType, sortMode, revision]);

  async function loadOlder() {
    if (loadingOlder || !cursor) return;
    setLoadingOlder(true);
    const requestedFilter = filterKey;
    try {
      const data = await getQuestionPage({ search, tag, visaType, sort: sortMode, before: cursor });
      if (filterRef.current !== requestedFilter) return;
      setQuestions((current) => [...current, ...data.questions.filter((q) => !current.some((item) => item.id === q.id))]);
      setMore(data.more); setCursor(data.cursor);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load older questions.'); }
    finally { setLoadingOlder(false); }
  }

  function selectTag(value: string) {
    setTag(value);
    setPage(1);
    const url = new URL(window.location.href);
    if (value) url.searchParams.set('tag', value); else url.searchParams.delete('tag');
    window.history.replaceState(window.history.state, '', url);
  }

  function goToPage(value: number) {
    setPage(value);
    document.getElementById('question-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const visibleQuestions = useMemo(() => {
    const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const items = questions.filter((question) => {
      const haystack = [question.title, question.body, question.visa_type, question.destination_country, ...question.tags].join(' ').toLowerCase();
      return (!visaType || question.visa_type === visaType) && (!tag || question.tags.includes(tag))
        && (!kind || (question.post_kind ?? 'question') === kind)
        && (sortMode !== 'unanswered' || question.answer_count === 0)
        && ((!demoMode && question.source !== 'apify') || terms.every((term) => haystack.includes(term)));
    });
    return items.sort((a, b) => sortMode === 'activity'
      ? (b.vote_score + b.answer_count * 2) - (a.vote_score + a.answer_count * 2)
      : sortMode === 'score' ? b.vote_score - a.vote_score : Date.parse(b.created_at) - Date.parse(a.created_at));
  }, [questions, sortMode, search, visaType, tag, kind, demoMode]);
  const pageCount = Math.max(1, Math.ceil(visibleQuestions.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageQuestions = visibleQuestions.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pageNumbers = Array.from({ length: pageCount }, (_, index) => index + 1)
    .filter((value) => value === 1 || value === pageCount || Math.abs(value - currentPage) <= 2);
  const visaTypes = [...new Set(questions.map((question) => question.visa_type))].sort();

  const popularTags = useMemo(() => {
    const counts = new Map<string, number>();
    questions.forEach((question) => question.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);
  }, [questions]);

  const liveTopics = tag || popularTags.slice(0, 5).map(([name]) => name).join('|');
  useEffect(() => {
    let active = true;
    const stop = subscribeLive(liveTopics.split('|').filter(Boolean).map((name) => `discovery:${name}`), () => {
      if (active) setRevision((value) => value + 1);
    });
    return () => { active = false; stop(); };
  }, [liveTopics, user?.id]);


  return (
    <main className="mx-auto grid max-w-[1500px] md:grid-cols-[155px_minmax(0,1fr)]">
      <nav aria-label="Community sections" className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 p-3 text-sm md:sticky md:top-16 md:h-[calc(100vh-4rem)] md:flex-col md:gap-2 md:border-b-0 md:border-r md:pt-7">
        <Link href="/" aria-current="page" className="flex items-center gap-2 rounded bg-orange-100 px-3 py-2 font-bold text-slate-900"><CircleHelp size={16} /> Questions</Link>
        <Link href="/explore" className="rounded px-3 py-2 text-slate-600 hover:bg-slate-200">Explore communities</Link>
        <Link href="/news" className="rounded px-3 py-2 text-slate-600 hover:bg-slate-200">News</Link>
        <Link href="/communities/new" className="rounded px-3 py-2 font-bold text-teal-700 hover:bg-teal-50">Start a community</Link>
        <Link href="/tags" className="flex items-center gap-2 rounded px-3 py-2 text-slate-600 hover:bg-slate-200"><Tags size={16} /> Tags</Link>
        <Link href="/messages" className="flex items-center gap-2 rounded px-3 py-2 text-slate-600 hover:bg-slate-200"><MessageCircle size={16} /> Messages</Link>
        <p className="mt-7 hidden px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 md:block">VisaFlow community</p>
        <p className="hidden px-3 text-xs leading-5 text-slate-500 md:block">Real questions.<br />Shared experience.<br />Public pseudonyms.</p>
      </nav>
      <div className="min-w-0">
      <section className="border-b border-slate-200 bg-white">
        <div className="px-4 py-6 sm:px-6">
          <div className="max-w-3xl">
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-orange-700">Questions · Answers · Community</p>
            <h1 className="text-3xl font-medium tracking-tight text-slate-950">All visa questions</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Explore discussions, browse topics, and find cases like yours.</p>
          </div>
          <div className="mt-5 flex max-w-4xl flex-col gap-3 sm:flex-row">
            <label className="relative flex-1">
              <span className="sr-only">Search visa questions</span>
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search all posts: H-1B transfer, DS-160, proof of funds…"
                className="h-14 w-full rounded-xl border border-slate-300 bg-white pl-12 pr-4 text-base shadow-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100" />
            </label>
            <Link href="/ask" className="grid h-14 place-items-center rounded-xl bg-teal-700 px-6 font-bold text-white shadow-sm hover:bg-teal-800">Ask your question</Link>
          </div>
        </div>
      </section>

      <div className="grid gap-5 px-3 py-5 sm:px-5 xl:grid-cols-[minmax(0,1fr)_290px]">
        <section id="question-list" className="scroll-mt-20 overflow-hidden rounded border border-slate-200 bg-white">
          <div className="flex flex-col gap-4 border-b border-slate-200 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-xl font-extrabold text-slate-950">{tag ? `Posts tagged [${tag}]` : 'All community posts'}</h2>
              <p className="mt-1 text-sm text-slate-500" aria-live="polite">{loading ? 'Loading questions…' : `${visibleQuestions.length} posts · ${visibleQuestions.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}–${Math.min(currentPage * PAGE_SIZE, visibleQuestions.length)} shown`}</p>
            </div>
            <label className="ml-auto flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
              <SlidersHorizontal size={15} className="text-slate-500" />
              <select aria-label="Visa type" value={visaType} onChange={(event) => { setVisaType(event.target.value); setPage(1); }} className="h-10 bg-transparent text-sm font-semibold text-slate-700 outline-none">
                {['', ...visaTypes].map((type) => <option key={type || 'all'} value={type}>{type || 'All visa types'}</option>)}
              </select>
            </label>
            </div>
            <div className="flex flex-wrap items-center gap-2" aria-label="Sort questions">
              {([
                ['newest', 'Newest'], ['activity', 'Most active'], ['score', 'Top score'], ['unanswered', 'No replies'],
              ] as const).map(([value, label]) => (
                <button key={value} onClick={() => { setSortMode(value); setPage(1); }} aria-pressed={sortMode === value}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${sortMode === value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Post type" value={kind} onChange={(event) => { setKind(event.target.value); setPage(1); }} className="rounded-lg border border-slate-200 p-2 text-sm">
                <option value="">All post types</option><option value="question">Questions</option><option value="discussion">Discussions & experiences</option><option value="promotion">Promotional posts</option>
              </select>
              {tag && <button onClick={() => selectTag('')} className="rounded bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">[{tag}] × Clear tag</button>}
              {(search || visaType || tag || kind || sortMode !== 'newest') && <button onClick={() => { setSearch(''); setVisaType(''); setKind(''); setSortMode('newest'); selectTag(''); }} className="text-xs font-bold text-slate-600 underline">Reset filters</button>}
            </div>
            {!loading && feedUnavailable && <p className="text-sm text-amber-800">Some discussions are temporarily unavailable. Please try again later.</p>}
          </div>
          {error && <p className="m-5 rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
          {!loading && visibleQuestions.length === 0 && (
            <div className="px-6 py-16 text-center">
              <Search className="mx-auto text-slate-300" size={36} />
              <h3 className="mt-3 font-bold text-slate-900">No close match yet</h3>
              <p className="mt-1 text-sm text-slate-500">Try fewer terms or ask the community.</p>
            </div>
          )}
          {pageQuestions.map((question) => <QuestionCard key={question.id} question={question} onTagSelect={selectTag} onRelated={(q) => { setRelated(q); document.getElementById('feed-related')?.scrollIntoView({behavior:'smooth',block:'nearest'}); }} />)}
          {!loading && visibleQuestions.length > 0 && <nav aria-label="Post pagination" className="flex flex-wrap items-center gap-2 p-5">
            <button disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)} className="rounded border px-3 py-2 text-sm disabled:opacity-40">Previous</button>
            {pageNumbers.map((value, index) => <span key={value} className="inline-flex items-center gap-2">
              {index > 0 && value > pageNumbers[index - 1] + 1 && <span aria-hidden="true">…</span>}
              <button aria-label={`Page ${value}`} aria-current={currentPage === value ? 'page' : undefined} onClick={() => goToPage(value)} className={`rounded border px-3 py-2 text-sm ${currentPage === value ? 'border-teal-700 bg-teal-700 text-white' : 'hover:bg-slate-50'}`}>{value}</button>
            </span>)}
            <button disabled={currentPage === pageCount} onClick={() => goToPage(currentPage + 1)} className="rounded border px-3 py-2 text-sm disabled:opacity-40">Next</button>
            <span className="ml-auto text-xs text-slate-500">{PAGE_SIZE} per page · Page {currentPage} of {pageCount}</span>
          </nav>}
          {loading && <div className="space-y-5 p-6">{[1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl bg-slate-100" />)}</div>}
          {more && <div className="border-t p-5"><button onClick={() => void loadOlder()} disabled={loadingOlder} className="rounded-lg border border-teal-200 px-4 py-2 text-sm font-bold text-teal-700 disabled:opacity-50">{loadingOlder ? 'Loading…' : 'Load more questions'}</button></div>}
        </section>

        <aside className="space-y-5">
          {(related || search || tag || pageQuestions[0]) && <div id="feed-related" className="scroll-mt-24">
            {related && <div className="mb-2 flex items-start justify-between gap-2 text-xs text-slate-600"><span>Similar to: <b>{related.title}</b></span><button onClick={() => setRelated(null)} aria-label="Clear related question selection">×</button></div>}
            <RelatedQuestions context={related ?? (search || tag ? {title:search,tags:tag ? [tag] : []} : pageQuestions[0])} />
          </div>}
          {popularTags.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2"><Tags className="text-blue-600" size={19} /><h3 className="font-extrabold text-slate-900">Popular tags</h3></div>
              <p className="mt-2 text-sm leading-6 text-slate-500">Jump into the topics appearing across current group conversations.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {popularTags.map(([tag, count]) => (
                  <button key={tag} onClick={() => selectTag(tag)} className="rounded-md bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100">
                    {tag} <span className="text-blue-400">×{count}</span>
                  </button>
                ))}
              </div>
              <Link href="/tags" className="mt-4 inline-block text-xs font-bold text-blue-700 underline">Browse all tags →</Link>
            </div>
          )}
          <div className="rounded-2xl border border-teal-100 bg-teal-50 p-5">
            <Sparkles className="text-teal-700" size={22} />
            <h3 className="mt-3 font-extrabold text-slate-900">Better questions get better answers</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">Include the country, visa type, timeline, and what you have already tried. Remove names, receipt numbers, and passport details.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2"><TrendingUp className="text-indigo-600" size={19} /><h3 className="font-extrabold text-slate-900">Useful signal first</h3></div>
            <p className="mt-3 text-sm leading-6 text-slate-600">Compare reactions and replies at a glance. Open a post for its full text, available comments, and questions with matching visa topics.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2"><Users className="text-violet-600" size={19} /><h3 className="font-extrabold text-slate-900">Connect with the community</h3></div>
            <p className="mt-3 text-sm leading-6 text-slate-600">Join a discussion or message a registered member. Keep personal documents and application numbers private.</p>
          </div>
          <p className="px-2 text-xs leading-5 text-slate-400">Community posts are personal experiences, not legal advice. Verify important decisions with an official source or qualified professional.</p>
        </aside>
      </div>
      </div>
    </main>
  );
}

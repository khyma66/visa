'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Users } from 'lucide-react';
import { getCommunityBySlug, getMembershipForCommunity, joinCommunity, leaveCommunity, listCommunityQuestions, type Community, type CommunityMembership, type QuestionCursor } from '@/lib/groups';
import type { Question } from '@/lib/types';
import { useAuth } from './AuthProvider';
import { QuestionCard } from './QuestionCard';

export function CommunityPage({ slug }: { slug: string }) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [community, setCommunity] = useState<Community | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [membership, setMembership] = useState<CommunityMembership | null>(null);
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [membershipError, setMembershipError] = useState('');
  const [membershipRetry, setMembershipRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [questionError, setQuestionError] = useState('');
  const [after, setAfter] = useState<QuestionCursor | null>(null);
  const [next, setNext] = useState<QuestionCursor | null>(null);
  const [history, setHistory] = useState<(QuestionCursor | null)[]>([]);
  const [pageNumber, setPageNumber] = useState(1);
  const questionNavigationLock = useRef(false);
  const [questionRetry, setQuestionRetry] = useState(0);
  const [tag, setTag] = useState('');
  const actionLock = useRef<symbol | null>(null);
  const alive = useRef(true);
  const currentActor = useRef(user?.id);
  currentActor.current = user?.id;
  const currentSlug = useRef(slug);
  currentSlug.current = slug;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { actionLock.current = null; setBusy(false); setActionError(''); }, [user?.id, slug]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setCommunity(null); setAfter(null); setNext(null); setQuestions([]); setHistory([]); setPageNumber(1); setTag('');
    void getCommunityBySlug(slug, controller.signal).then((value) => { if (!controller.signal.aborted) setCommunity(value); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load this community.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [slug, retry]);

  useEffect(() => {
    const controller = new AbortController();
    setMembership(null); setMembershipError(''); setActionError('');
    if (!user || authLoading || !community) { setMembershipLoading(false); return () => controller.abort(); }
    setMembershipLoading(true);
    void getMembershipForCommunity(user.id, community.id, controller.signal).then((value) => { if (!controller.signal.aborted) setMembership(value); })
      .catch((reason) => { if (!controller.signal.aborted) setMembershipError(reason instanceof Error ? reason.message : 'Could not load your membership.'); })
      .finally(() => { if (!controller.signal.aborted) setMembershipLoading(false); });
    return () => controller.abort();
  }, [user?.id, authLoading, community?.id, membershipRetry]);

  useEffect(() => {
    const controller = new AbortController();
    if (!community) return;
    setQuestionsLoading(true); setQuestionError(''); setQuestions([]); setNext(null);
    void listCommunityQuestions(community.id, { after, tag, signal: controller.signal }).then((page) => {
      if (controller.signal.aborted) return;
      setQuestions(page.questions);
      setNext(page.nextCursor);
    }).catch((reason) => { if (!controller.signal.aborted) setQuestionError(reason instanceof Error ? reason.message : 'Could not load questions.'); })
      .finally(() => { if (!controller.signal.aborted) { setQuestionsLoading(false); questionNavigationLock.current = false; } });
    return () => controller.abort();
  }, [community?.id, after, tag, questionRetry]);

  async function changeMembership() {
    if (!community || actionLock.current || authLoading || membershipLoading || membershipError) return;
    if (!user) { router.push(`/login?next=${encodeURIComponent(`/c/${slug}`)}`); return; }
    if (membership?.role === 'owner') return;
    const actor = user.id;
    const operation = Symbol();
    actionLock.current = operation; setBusy(true); setActionError('');
    try {
      if (membership) await leaveCommunity(community.id); else await joinCommunity(community.id);
      if (!alive.current || currentActor.current !== actor || currentSlug.current !== slug || actionLock.current !== operation) return;
      setMembership(membership ? null : { community_id: community.id, role: 'member', is_active: true });
      const refreshed = await getCommunityBySlug(slug);
      if (alive.current && currentActor.current === actor && currentSlug.current === slug && actionLock.current === operation && refreshed) setCommunity(refreshed);
    } catch (reason) {
      if (alive.current && currentActor.current === actor && currentSlug.current === slug && actionLock.current === operation) setActionError(reason instanceof Error ? reason.message : 'Could not update membership.');
    } finally {
      if (actionLock.current === operation) {
        actionLock.current = null; if (alive.current) setBusy(false);
      }
    }
  }

  function resetQuestionPage() { setAfter(null); setHistory([]); setPageNumber(1); }
  function nextQuestionPage() {
    if (!next || questionsLoading || questionNavigationLock.current) return;
    questionNavigationLock.current = true;
    setHistory((current) => [...current, after].slice(-50));
    setAfter(next); setPageNumber((value) => value + 1);
  }
  function previousQuestionPage() {
    if (!history.length || questionsLoading || questionNavigationLock.current) return;
    questionNavigationLock.current = true;
    setAfter(history[history.length - 1]); setHistory((current) => current.slice(0, -1)); setPageNumber((value) => Math.max(1, value - 1));
  }

  if (loading) return <main className="mx-auto max-w-6xl px-4 py-10"><p role="status">Loading community…</p></main>;
  if (error) return <main className="mx-auto max-w-6xl px-4 py-10"><Link href="/explore" className="text-blue-700 underline">Explore Communities</Link><div role="alert" className="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{error} <button onClick={() => setRetry((n) => n + 1)} className="font-bold underline">Retry</button></div></main>;
  if (!community) return <main className="mx-auto max-w-6xl px-4 py-10"><h1 className="text-2xl font-bold">Community unavailable</h1><p className="mt-3 text-sm text-slate-600">This community does not exist or is not open for public browsing.</p><Link href="/explore" className="mt-5 inline-block font-bold text-blue-700 underline">Explore Communities</Link></main>;
  const askHref = `/ask?community=${community.id}`;
  return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
    <Link href="/explore" className="text-sm font-semibold text-blue-700 hover:underline">← Explore Communities</Link>
    <header className="mt-5 rounded-xl border border-slate-200 bg-white p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold tracking-wide text-blue-700">{community.category} · {community.country || 'Worldwide'}</p><h1 className="mt-2 text-3xl font-bold tracking-tight">{community.display_name}</h1><p className="mt-2 text-sm text-slate-500">c/{community.slug}</p></div><button onClick={() => void changeMembership()} disabled={busy || authLoading || membershipLoading || !!membershipError || membership?.role === 'owner'} className={`rounded-full border px-5 py-2.5 text-sm font-bold disabled:opacity-50 ${membership ? 'border-slate-300 text-slate-700' : 'border-blue-700 bg-blue-700 text-white hover:bg-blue-800'}`}>{busy ? 'Saving…' : membership?.role === 'owner' ? 'Owner' : membership ? 'Leave community' : 'Join community'}</button></div>
      <p className="mt-5 max-w-3xl whitespace-pre-line text-sm leading-6 text-slate-600">{community.description}</p><p className="mt-4 flex items-center gap-2 text-xs text-slate-500"><Users size={16} />{Number(community.member_count).toLocaleString()} {Number(community.member_count) === 1 ? 'member' : 'members'} · Public community</p>
      {membershipError && <p role="alert" className="mt-4 text-sm text-amber-800">{membershipError} <button onClick={() => setMembershipRetry((n) => n + 1)} className="font-bold underline">Retry membership</button></p>}{actionError && <p role="alert" className="mt-4 text-sm text-rose-800">{actionError}</p>}
    </header>
    <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5"><h2 className="text-lg font-bold">Questions and answers</h2><div className="flex items-center gap-4"><button onClick={() => { resetQuestionPage(); setQuestionRetry((n) => n + 1); }} disabled={questionsLoading} className="text-sm font-bold text-slate-600 underline disabled:opacity-50">Refresh</button>{membership ? <Link href={askHref} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800">Ask a Question</Link> : !user ? <Link href={`/login?next=${encodeURIComponent(askHref)}`} className="text-sm font-bold text-blue-700 underline">Log In to ask</Link> : <button onClick={() => void changeMembership()} disabled={busy || membershipLoading || !!membershipError} className="text-sm font-bold text-blue-700 underline disabled:opacity-50">Join to ask a question</button>}</div></div>
        {tag && <p className="border-b bg-blue-50 p-4 text-sm text-blue-800">Tag: <strong>{tag}</strong> <button onClick={() => { setTag(''); resetQuestionPage(); }} className="ml-3 underline">Clear filter</button></p>}
        {questionError && <p role="alert" className="m-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{questionError} <button onClick={() => setQuestionRetry((n) => n + 1)} className="font-bold underline">Retry</button></p>}
        {questions.map((question) => <QuestionCard key={question.id} question={question} onTagSelect={(value) => { setTag(value); resetQuestionPage(); }} />)}
        {questionsLoading && <p role="status" className="p-6 text-sm text-slate-500">Loading questions…</p>}
        {!questionsLoading && !questionError && !questions.length && <div className="p-8"><h3 className="font-bold">{tag ? 'No questions with this tag yet' : 'Start the first conversation'}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{tag ? 'Try another tag or clear the filter to see all community questions.' : 'Ask a specific question with relevant tags, or share an experience others can learn from.'}</p></div>}
        {(next || after) && <nav aria-label="Question pages" className="my-5 flex flex-wrap items-center justify-center gap-3 px-4">
          {after && <button onClick={resetQuestionPage} disabled={questionsLoading} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold disabled:opacity-50">First page</button>}
          <button onClick={previousQuestionPage} disabled={questionsLoading || !history.length} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold disabled:opacity-50">Previous questions</button>
          <span className="text-xs text-slate-500">Page {pageNumber}</span>
          <button onClick={nextQuestionPage} disabled={questionsLoading || !next} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold disabled:opacity-50">Next questions</button>
        </nav>}
      </section>
      <aside className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Community Rules</h2>{community.rules.length ? <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-6 text-slate-600">{community.rules.map((rule, index) => <li key={index}>{rule}</li>)}</ol> : <p className="mt-3 text-sm leading-6 text-slate-600">Be respectful, stay on topic, and keep personal information private.</p>}<Link href="/community-safety" className="mt-5 inline-block text-sm font-semibold text-blue-700 underline">Read sitewide community rules</Link>{membership?.role === 'owner' && <p className="mt-5 border-t pt-4 text-xs leading-5 text-slate-500">You own this community. Owners remain members so the community always has an accountable owner.</p>}</aside>
    </div>
  </main>;
}

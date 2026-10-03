'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowDown, ArrowUp, Check, CheckCircle2, ExternalLink, MessageCircle, Share2, ThumbsUp } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  acceptAnswer, createAnswer, getAnswerPage, getDiscussionContext, getQuestion, sortAnswers, voteAnswer, voteQuestion,
  type AnswerCursor,
} from '@/lib/community';
import type { Answer, Question } from '@/lib/types';
import { subscribeLive, type LiveStatus } from '@/lib/realtime';
import { RelatedQuestions } from './RelatedQuestions';
import { Avatar } from './Avatar';
import { useAuth } from './AuthProvider';
import { ReportButton } from './ReportButton';
import { SafetyNotice } from './SafetyNotice';

function Author({ username, seed, createdAt }: { username: string; seed: string; createdAt: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      <Avatar seed={seed} size="sm" />
      <span><b className="text-slate-700">u/{username}</b><br />{formatDistanceToNow(new Date(createdAt), { addSuffix: true })}</span>
    </div>
  );
}

function VoteRail({ score, onVote, accepted }: { score: number; onVote: (value: -1 | 1) => void; accepted?: boolean }) {
  return (
    <div className="flex w-11 shrink-0 flex-col items-center gap-2">
      <button onClick={() => onVote(1)} className="grid h-9 w-9 place-items-center rounded-full border border-slate-300 text-slate-500 hover:border-teal-600 hover:bg-teal-50 hover:text-teal-700" aria-label="Upvote"><ArrowUp size={19} /></button>
      <b className="text-lg text-slate-800">{score}</b>
      <button onClick={() => onVote(-1)} className="grid h-9 w-9 place-items-center rounded-full border border-slate-300 text-slate-500 hover:border-rose-500 hover:bg-rose-50 hover:text-rose-600" aria-label="Downvote"><ArrowDown size={19} /></button>
      {accepted && <CheckCircle2 className="mt-2 text-emerald-600" size={28} aria-label="Accepted answer" />}
    </div>
  );
}

function ImportedScore({ score }: { score: number }) {
  return (
    <div className="flex w-11 shrink-0 flex-col items-center gap-1.5 text-blue-700" aria-label={`${score} source reactions`}>
      <span className="grid h-9 w-9 place-items-center rounded-full bg-blue-50"><ThumbsUp size={17} /></span>
      <b className="text-base text-slate-800">{score}</b>
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">likes</span>
    </div>
  );
}

export function QuestionDetail({ initialQuestion = null, initialAnswers = [] }: { initialQuestion?: Question | null; initialAnswers?: Answer[] }) {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user, demoMode } = useAuth();
  const [question, setQuestion] = useState<Question | null>(initialQuestion);
  const [answers, setAnswers] = useState<Answer[]>(initialAnswers);
  const [discussionContext, setDiscussionContext] = useState('');
  const [moreAnswers, setMoreAnswers] = useState((initialQuestion?.answer_count ?? 0) > initialAnswers.length);
  const [answerCursor, setAnswerCursor] = useState<AnswerCursor | undefined>(initialAnswers.at(-1));
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [paginationNotice, setPaginationNotice] = useState('');
  const loadedMore = useRef(false);
  const paging = useRef(false);
  const refreshInFlight = useRef(false);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting');
  const [submitting, setSubmitting] = useState(false);
  const loadVersion = useRef(0);
  const [answerBody, setAnswerBody] = useState('');
  const [loading, setLoading] = useState(!initialQuestion);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      const loaded = await getQuestion(id);
      if (version !== loadVersion.current) return;
      setQuestion(loaded);
      if (loaded) {
        const [answerPage, latestDiscussion] = await Promise.all([getAnswerPage(id), getDiscussionContext(id)]);
        if (version !== loadVersion.current) return;
        setAnswers(answerPage.answers);
        setDiscussionContext(latestDiscussion);
        setMoreAnswers(answerPage.more);
        setAnswerCursor(answerPage.cursor);
        if (loadedMore.current) setPaginationNotice('This discussion changed. Showing the top answers again so removed or reordered replies are not kept. Load more to continue.');
        loadedMore.current = false;
      }
      setError('');
    } catch (reason) {
      if (version === loadVersion.current) setError(reason instanceof Error ? reason.message : 'Could not load this question.');
    } finally {
      if (version === loadVersion.current) { refreshInFlight.current = false; setLoading(false); setRefreshing(false); }
    }
  }, [id]);

  useEffect(() => {
    setLoading(!initialQuestion);
    void load();
    const stop = subscribeLive([`question:${id}`], () => { void load(); }, setLiveStatus);
    return () => { ++loadVersion.current; stop(); };
  }, [load, id, user?.id]);

  async function loadMoreAnswers() {
    if (paging.current || refreshInFlight.current || !moreAnswers || !answerCursor) return;
    paging.current = true;
    setLoadingMore(true);
    const version = loadVersion.current;
    try {
      const next = await getAnswerPage(id, answerCursor);
      if (version !== loadVersion.current) return;
      setAnswers((current) => sortAnswers([...current, ...next.answers]));
      setMoreAnswers(next.more);
      setAnswerCursor(next.cursor);
      setPaginationNotice('');
      setError('');
      loadedMore.current = true;
    } catch (reason) {
      if (version === loadVersion.current) setError(reason instanceof Error ? reason.message : 'Could not load more answers.');
    } finally { paging.current = false; setLoadingMore(false); }
  }

  async function submitAnswer(event: FormEvent) {
    event.preventDefault();
    if (!user || submitting || question?.status !== 'open') return;
    setSubmitting(true);
    try {
      await createAnswer(id, user.id, answerBody.trim());
      setAnswerBody('');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not post answer.'); }
    finally { setSubmitting(false); }
  }

  if (loading) return <main className="mx-auto max-w-6xl p-8"><div className="h-64 animate-pulse rounded-2xl bg-slate-100" /></main>;
  if (!question) return <main className="mx-auto max-w-4xl p-8"><h1 className="text-2xl font-black">Question not found</h1><Link href="/" className="mt-4 inline-block font-bold text-teal-700">Back to questions</Link></main>;

  const owner = user?.id === question.author_id;
  const imported = question.source === 'apify';
  const canAnswer = question.status === 'open';
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_310px]">
        <div>
          <section className="border-b border-slate-200 pb-6">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-teal-800"><span className="rounded-full bg-teal-50 px-2.5 py-1">{question.visa_type}</span><span className="text-slate-400">{question.destination_country}</span>{imported && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">Imported group discussion</span>}</div>
            <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight text-slate-950 sm:text-4xl">{question.title}</h1>
            <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500"><span>Asked {formatDistanceToNow(new Date(question.created_at), { addSuffix: true })}</span><span>{question.vote_score} {imported ? 'source reactions' : 'votes'}</span><span>{question.answer_count} {imported ? 'comments' : 'answers'}</span></div>
          </section>
          <article className="flex gap-4 py-7">
            {imported ? <ImportedScore score={question.vote_score} /> : <VoteRail score={question.vote_score} onVote={(value) => {
              if (!user) { window.location.href = `/login?next=/questions/${id}`; return; }
              void voteQuestion(id, user.id, value).then((score) => setQuestion((current) => current ? { ...current, vote_score: score } : current)).catch((reason: Error) => setError(reason.message));
            }} />}
            <div className="min-w-0 flex-1">
              <SafetyNotice kind="advice" />
              <div className="whitespace-pre-wrap text-[16px] leading-8 text-slate-800">{question.body}</div>
              <div className="mt-6 flex flex-wrap gap-2">{question.tags.map((tag) => <Link key={tag} href={`/?tag=${encodeURIComponent(tag)}`} className="rounded bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100">{tag}</Link>)}</div>
              <div className="mt-7 flex flex-wrap items-end justify-between gap-4">
                <div className="flex gap-2">
                  <button onClick={() => { void navigator.clipboard.writeText(window.location.href); setCopied(true); }} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-900"><Share2 size={15} /> {copied ? 'Copied' : 'Share'}</button>
                  {imported && question.source_url && <a href={question.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-bold text-blue-700 hover:underline">Open group post <ExternalLink size={14} /></a>}
                  {!imported && user?.id !== question.author_id && <Link href={`/messages?to=${question.author_username}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-900"><MessageCircle size={15} /> Message author</Link>}
                </div>
                <Author username={question.author_username} seed={question.author_avatar_seed} createdAt={question.created_at} />
              </div>
              {!imported && <ReportButton kind="question" target={question.id} />}
              {imported && <SafetyNotice kind="imported" />}
              {imported && <p className="mt-5 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-xs leading-5 text-blue-900">Source: {question.source_group ?? 'public visa community group'}. VisaFlow organizes the public post text and available top comments; the original group remains the source of record.</p>}
            </div>
          </article>

          <section className="mt-4 border-t border-slate-200 pt-7">
            <h2 className="text-2xl font-black text-slate-950">{imported ? 'Community comments' : `${question.answer_count} ${question.answer_count === 1 ? 'answer' : 'answers'}`}</h2>
            {!imported && <p className="mt-2 text-xs text-slate-500">{answers.length} shown · Accepted answers and highest votes first</p>}
            <p className="mt-2 text-xs text-slate-500" role="status">{demoMode ? 'Development preview · updates across tabs in this browser' : !user ? 'Log in for live replies and notifications' : liveStatus === 'live' ? 'Live discussion · replies update automatically' : 'Connecting to live updates…'}</p>
            {imported && <p className="mt-2 text-sm text-slate-500">{answers.filter((a) => a.source === 'apify').length} source comments · {answers.filter((a) => a.source !== 'apify').length} VisaFlow replies shown</p>}
            {paginationNotice && <p role="status" className="mt-3 rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-800">{paginationNotice}</p>}
            <div className="divide-y divide-slate-200">
              {answers.map((answer) => (
                <article key={answer.id} className={`flex gap-4 py-7 ${answer.is_accepted ? 'rounded-xl bg-emerald-50/50 px-3' : ''}`}>
                  {answer.source === 'apify' ? <ImportedScore score={answer.vote_score} /> : imported ? <MessageCircle className="w-11 shrink-0 text-teal-600" size={22} /> : <VoteRail score={answer.vote_score} accepted={answer.is_accepted} onVote={(value) => {
                    if (!user) { window.location.href = `/login?next=/questions/${id}`; return; }
                    void voteAnswer(answer.id, user.id, value).then(load).catch((reason: Error) => setError(reason.message));
                  }} />}
                  <div className="min-w-0 flex-1">
                    {answer.source === 'apify' && <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700"><MessageCircle size={12} /> Group comment</p>}
                    {answer.is_accepted && <p className="mb-3 flex items-center gap-2 text-sm font-bold text-emerald-700"><CheckCircle2 size={17} /> Accepted by the question author</p>}
                    <div className="whitespace-pre-wrap text-[16px] leading-8 text-slate-800">{answer.body}</div>
                    {answer.source !== 'apify' && <ReportButton kind={imported ? 'imported_answer' : 'answer'} target={answer.id} />}
                    <div className="mt-6 flex items-end justify-between gap-4">
                      {answer.source_url ? <a href={answer.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:underline">View source <ExternalLink size={12} /></a> : !imported && owner && canAnswer && answer.source !== 'apify' && !answer.is_accepted ? <button onClick={() => void acceptAnswer(answer.id, question.id).then(load).catch((reason: Error) => setError(reason.message))} className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700 hover:underline"><Check size={16} /> Accept this answer</button> : <span />}
                      <div className="flex items-center gap-3"><Author username={answer.author_username} seed={answer.author_avatar_seed} createdAt={answer.created_at} />{answer.source !== 'apify' && user?.id !== answer.author_id && <Link href={`/messages?to=${answer.author_username}`} aria-label={`Message ${answer.author_username}`} className="text-slate-400 hover:text-teal-700"><MessageCircle size={18} /></Link>}</div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {moreAnswers && <button type="button" onClick={() => void loadMoreAnswers()} disabled={loadingMore || refreshing}
              className="mt-4 rounded-lg border border-teal-200 px-4 py-2 text-sm font-bold text-teal-700 disabled:opacity-50">{loadingMore ? 'Loading replies…' : imported ? 'Load more VisaFlow replies' : 'Load more answers'}</button>}
          </section>

          <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <h2 className="text-xl font-black text-slate-950">{imported ? 'Add a VisaFlow answer' : 'Your answer'}</h2>
            <SafetyNotice kind="publishing" />
            {canAnswer && <p className="mt-2 text-sm leading-6 text-slate-500">Related posts update as you write, using the topics in your reply.{imported ? ' Replies are posted to VisaFlow only.' : ''}</p>}
            {!canAnswer ? <p className="mt-3 rounded-lg bg-slate-100 p-4 text-sm text-slate-700">This question is closed. Existing answers remain available, but new answers and acceptance are disabled.</p> : !user ? <p className="mt-3 text-sm text-slate-600"><Link href={`/login?next=/questions/${id}`} className="font-bold text-teal-700 underline">Log in</Link> to answer with your public username.</p> : (
              <form onSubmit={submitAnswer} className="mt-4"><textarea aria-label="Your reply" required minLength={20} maxLength={10000} rows={7} value={answerBody} onChange={(event) => setAnswerBody(event.target.value)} placeholder="Explain what worked, cite official guidance where possible, and avoid requesting personal documents." className="w-full rounded-xl border border-slate-300 p-4 leading-7 outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-100" /><button disabled={submitting} className="mt-3 rounded-lg bg-teal-700 px-5 py-3 font-bold text-white hover:bg-teal-800 disabled:opacity-50">{submitting ? 'Posting…' : 'Post answer'}</button></form>
            )}
            {error && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          </section>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950"><b>Keep personal details private.</b><br />Never post passport, receipt, SEVIS, application, phone, or address information.</div>
          <RelatedQuestions drafting={Boolean(answerBody.trim())} context={{ ...question, draftText: answerBody, commentText: discussionContext }} />
        </aside>
      </div>
    </main>
  );
}

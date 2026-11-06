'use client';

import { CompactTextarea } from './CompactTextarea';

import { isImportedPost, topicLabel } from '@/lib/post-presentation';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowDown, ArrowUp, Check, CheckCircle2, MessageCircle, ThumbsUp } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  acceptAnswer, createAnswer, getAnswerPage, getDiscussionContext, getQuestion, sortAnswers, voteAnswer, voteQuestion,
  type AnswerCursor,
} from '@/lib/community';
import type { Answer, Question } from '@/lib/types';
import { subscribeLive, type LiveStatus } from '@/lib/realtime';
import { isMemberId } from '@/lib/messaging-state';
import { RelatedQuestions } from './RelatedQuestions';
import { ResizablePostLayout } from './ResizablePostLayout';
import { Avatar } from './Avatar';
import { useAuth } from './AuthProvider';
import { ReportButton } from './ReportButton';
import { PostOriginBadge } from './PostOriginBadge';
import { PostActions } from './PostActions';
import { PostViews } from './PostViews';
import { AuthorIdentity } from './AuthorIdentity';

function Author({ id, memberId, username, seed, createdAt, sourceOnly = false }: { id: string; memberId: string | null; username: string; seed: string; createdAt: string; sourceOnly?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      {!sourceOnly && <Avatar seed={seed} size="sm" />}
      <span><AuthorIdentity content={{id,author_id:memberId,author_username:username,source:sourceOnly ? 'apify' : undefined}}/><br />{formatDistanceToNow(new Date(createdAt), { addSuffix: true })}</span>
    </div>
  );
}

function VoteRail({ score, onVote, accepted, own = false }: { score: number; onVote: (value: -1 | 1) => void; accepted?: boolean; own?: boolean }) {
  return (
    <div className="flex w-11 shrink-0 flex-col items-center gap-2">
      <button disabled={own} title={own ? 'You cannot vote on your own contribution' : 'Helpful contribution'} onClick={() => onVote(1)} className="grid h-9 w-9 place-items-center rounded-full border border-slate-300 text-slate-500 hover:border-blue-600 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Upvote"><ArrowUp size={19} /></button>
      <b className="text-lg text-slate-800">{score}</b>
      <button disabled={own} title={own ? 'You cannot vote on your own contribution' : 'Not helpful'} onClick={() => onVote(-1)} className="grid h-9 w-9 place-items-center rounded-full border border-slate-300 text-slate-500 hover:border-rose-500 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Downvote"><ArrowDown size={19} /></button>
      {accepted && <CheckCircle2 className="mt-2 text-emerald-600" size={28} aria-label="Accepted answer" />}
    </div>
  );
}

function ImportedScore({ score }: { score: number }) {
  return (
    <div className="flex w-11 shrink-0 flex-col items-center gap-1.5 text-blue-700" aria-label={`${score} reactions`}>
      <span className="grid h-9 w-9 place-items-center rounded-full bg-blue-50"><ThumbsUp size={17} /></span>
      <b className="text-base text-slate-800">{score}</b>
      <span className="whitespace-nowrap text-xs font-bold text-slate-500 capitalize">reactions</span>
    </div>
  );
}

export function initialAnswerCursor(answers: Answer[]): AnswerCursor | undefined {
  // Archived source comments are shown with member replies, but only database
  // UUIDs belong in the member pagination cursor. Preserve their ranked order.
  return answers.filter(answer => !isImportedPost(answer) && isMemberId(answer.id)).at(-1);
}

export function QuestionDetail({ initialQuestion = null, initialAnswers = [] }: { initialQuestion?: Question | null; initialAnswers?: Answer[] }) {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user, demoMode } = useAuth();
  const [question, setQuestion] = useState<Question | null>(initialQuestion);
  const [answers, setAnswers] = useState<Answer[]>(initialAnswers);
  const [discussionContext, setDiscussionContext] = useState('');
  const [moreAnswers, setMoreAnswers] = useState((initialQuestion?.answer_count ?? 0) > initialAnswers.length);
  const [answerCursor, setAnswerCursor] = useState<AnswerCursor | undefined>(initialAnswerCursor(initialAnswers));
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

  useEffect(() => {
    const focusReply = () => { if (window.location.hash === '#reply') document.getElementById('reply-body')?.focus(); };
    focusReply();
    window.addEventListener('hashchange', focusReply);
    return () => window.removeEventListener('hashchange', focusReply);
  }, [question?.id, user?.id, loading]);

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

  if (loading) return <main className="page-shell mx-auto max-w-6xl p-8"><div className="h-64 animate-pulse rounded-2xl bg-slate-100" /></main>;
  if (!question) return <main className="page-shell mx-auto max-w-4xl p-8"><h1 className="text-2xl font-black capitalize">Question not found</h1><Link href="/us/en" className="mt-4 inline-block font-bold text-blue-700 capitalize">Back to questions</Link></main>;

  const owner = user?.id === question.author_id;
  const imported = isImportedPost(question);
  const experience = question.post_kind === 'experience';
  const threadPath = `/us/en/${experience ? 'experiences' : 'questions'}/${id}`;
  const canAnswer = question.status === 'open';
  return (
    <main className="page-shell mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <ResizablePostLayout related={<RelatedQuestions drafting={Boolean(answerBody.trim())} context={{ ...question, draftText: answerBody, commentText: discussionContext }} />}>
        <div>
          <section className="border-b border-slate-200 pb-8">
            {experience && <p className="mb-3 text-sm font-bold text-orange-800"><Link href="/us/en/experiences" className="underline capitalize">Experience</Link> · {question.experience_category}</p>}
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-blue-800"><span className="rounded-full bg-blue-50 px-2.5 py-1">{question.visa_type}</span><PostOriginBadge post={question} /></div>
            <h1 className="mt-4 text-4xl font-semibold leading-tight text-slate-950">{question.title}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-500 capitalize"><time dateTime={question.created_at} title={new Date(question.created_at).toUTCString()}>Posted {formatDistanceToNow(new Date(question.created_at), { addSuffix: true })} · {new Date(question.created_at).toISOString().slice(0,10)}</time><span>{question.vote_score} {imported ? 'reactions' : 'votes'}</span><Link href={`${threadPath}#reply`} onClick={() => document.getElementById('reply-body')?.focus()} className="rounded hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700" title="Reply to this post">{question.answer_count} {question.answer_count === 1 ? 'reply' : 'replies'}</Link><PostViews key={question.id} postId={question.id} record/><span className="ml-auto"><PostActions postId={question.id} path={threadPath} imported={imported} /></span></div>
          </section>
          <article className="flex flex-wrap gap-3 py-8 sm:gap-5">
            {imported ? <ImportedScore score={question.vote_score} /> : <VoteRail score={question.vote_score} own={question.author_id === user?.id} onVote={(value) => {
              if (!user) { window.location.href = `/login?next=${threadPath}`; return; }
              void voteQuestion(id, user.id, value).then((score) => setQuestion((current) => current ? { ...current, vote_score: score } : current)).catch((reason: Error) => setError(reason.message));
            }} />}
            <div className="min-w-0 flex-1">
              <div className="max-w-prose whitespace-pre-wrap text-lg leading-relaxed text-slate-800">{question.body}</div>
              <div className="mt-6 flex flex-wrap gap-2">{question.tags.map((tag) => <Link key={tag} href={`/us/en?tag=${encodeURIComponent(tag)}`} className="rounded bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100">{topicLabel(tag)}</Link>)}</div>
              <div className="mt-7 flex flex-wrap items-end justify-between gap-4">
                <Author id={question.id} memberId={question.author_id} username={question.author_username} seed={question.author_avatar_seed} createdAt={question.created_at} sourceOnly={imported} />
              </div>

            </div>
          </article>


          <section className="mt-4 border-t border-slate-200 pt-7">
            <h2 className="text-thread-title font-semibold text-slate-950 capitalize">{experience ? `${question.answer_count} ${question.answer_count === 1 ? 'reply' : 'replies'}` : imported ? `${question.answer_count} ${question.answer_count === 1 ? 'comment' : 'comments'}` : `${question.answer_count} ${question.answer_count === 1 ? 'answer' : 'answers'}`}</h2>
            <p className="mt-2 text-xs text-slate-500 capitalize">{answers.length} shown{!imported && (experience ? ' · Highest votes first' : ' · Accepted answers and highest votes first')}</p>
            <p className="mt-2 text-xs text-slate-500 capitalize" role="status">{demoMode ? 'Development preview · updates across tabs in this browser' : !user ? 'Log In for live replies and notifications' : liveStatus === 'live' ? 'Live discussion · replies update automatically' : 'Connecting to live updates…'}</p>
            {paginationNotice && <p role="status" className="mt-3 rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-800">{paginationNotice}</p>}
            <div className="divide-y divide-slate-200">
              {answers.map((answer) => {
                const sourceOnly = isImportedPost(answer);
                return (
                <article key={answer.id} id={`answer-${answer.id}`} className={`flex scroll-mt-24 gap-3 py-8 sm:gap-5 ${answer.is_accepted ? 'rounded-xl bg-emerald-50/50 px-3' : ''}`}>
                  {sourceOnly ? <ImportedScore score={answer.vote_score} /> : imported ? <MessageCircle className="w-11 shrink-0 text-blue-600" size={22} /> : <VoteRail score={answer.vote_score} own={answer.author_id === user?.id} accepted={answer.is_accepted} onVote={(value) => {
                    if (!user) { window.location.href = `/login?next=${threadPath}`; return; }
                    void voteAnswer(answer.id, user.id, value).then(load).catch((reason: Error) => setError(reason.message));
                  }} />}
                  <div className="min-w-0 flex-1">
                    {sourceOnly && <div className="mb-3"><PostOriginBadge post={answer} /></div>}
                    {answer.is_accepted && <p className="mb-3 flex items-center gap-2 text-sm font-bold text-emerald-700 capitalize"><CheckCircle2 size={17} /> Accepted by the question author</p>}
                    <div className="max-w-prose whitespace-pre-wrap text-lg leading-relaxed text-slate-800">{answer.body}</div>
                    {!sourceOnly && <ReportButton kind={imported ? 'imported_answer' : 'answer'} target={answer.id} />}
                    <div className="mt-6 flex items-end justify-between gap-4">
                      {!imported && !experience && owner && canAnswer && !sourceOnly && !answer.is_accepted ? <button onClick={() => void acceptAnswer(answer.id, question.id).then(load).catch((reason: Error) => setError(reason.message))} className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700 hover:underline capitalize"><Check size={16} /> Accept this answer</button> : <span />}
                      <div className="flex items-center gap-3"><Author id={answer.id} memberId={answer.author_id} username={answer.author_username} seed={answer.author_avatar_seed} createdAt={answer.created_at} sourceOnly={sourceOnly} /></div>
                    </div>
                  </div>
                </article>
              ); })}
            </div>
            {moreAnswers && <button type="button" onClick={() => void loadMoreAnswers()} disabled={loadingMore || refreshing}
              className="mt-4 rounded-lg border border-blue-200 px-4 py-2 text-sm font-bold text-blue-700 disabled:opacity-50 capitalize">{loadingMore ? 'Loading replies…' : imported || experience ? 'Load more replies' : 'Load more answers'}</button>}
          </section>

          <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <h2 id="reply" className="scroll-mt-24 text-lg font-semibold text-slate-950 capitalize">{imported || experience ? 'Join the discussion' : 'Your answer'}</h2>
            {canAnswer && <p className="mt-2 text-sm leading-6 text-slate-500 capitalize">Related posts update as you write, using the topics in your reply.</p>}
            {!canAnswer ? <p className="mt-3 rounded-lg bg-slate-100 p-4 text-sm text-slate-700 capitalize">{experience ? 'This experience is closed to new replies.' : 'This question is closed. Existing answers remain available, but new answers and acceptance are disabled.'}</p> : !user ? <p className="mt-3 text-sm text-slate-600 capitalize"><Link href={`/login?next=${threadPath}`} className="font-bold text-blue-700 underline capitalize">Log In</Link> to reply with your public username.</p> : (
              <form onSubmit={submitAnswer} className="mt-4"><CompactTextarea id="reply-body" aria-label="Your reply" required minLength={20} maxLength={10000} rows={1} value={answerBody} onChange={(event) => setAnswerBody(event.target.value)} placeholder="Explain what worked and cite official guidance where possible." className="w-full rounded-xl border border-slate-300 px-3 py-3 leading-6 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-100" /><button disabled={submitting} className="mt-3 rounded-lg bg-blue-700 px-5 py-3 font-bold text-white hover:bg-blue-800 disabled:opacity-50 capitalize">{submitting ? 'Posting…' : experience ? 'Post reply' : 'Post answer'}</button></form>
            )}
            {error && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          </section>
        </div>

      </ResizablePostLayout>
    </main>
  );
}

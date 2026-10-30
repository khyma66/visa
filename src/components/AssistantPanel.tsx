'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { usePathname } from 'next/navigation';
import { ArrowUp, ChevronDown, Clock3, Sparkles, Square } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import type { AssistantAvailability, AssistantClaim, AssistantMode, AssistantPostReference, AssistantRequest, AssistantResult, AssistantScope, AssistantSource } from '@/lib/assistant-contract';
import { assistantBoundedHistory, assistantDisplayedPosts, assistantMorePosts, assistantPreviousPost, assistantRefersToEarlierTurn } from '@/lib/assistant-context';
import { assistantFailureMessage, parseAssistantFailure, parseAssistantResult, readAssistantJson, readAssistantResponse, safeAssistantHref } from '@/lib/assistant-client';
import { useAuth } from './AuthProvider';
import { assistantChatExport } from '@/lib/assistant-export';

type Props = { scope: AssistantScope; title?: string; defaultOpen?: boolean };
type Period = 'hour' | 'six-hours' | 'day' | 'week' | 'last';
type Turn = { id: number; prompt: string; mode: AssistantMode; state: 'pending' | 'complete' | 'failed' | 'cancelled'; result?: AssistantResult; history?: string[]; seenPostIds?: string[]; focusedPost?: AssistantPostReference; referencePosts?: AssistantPostReference[] };
const periodHours = { hour: 1, 'six-hours': 6, day: 24, week: 168 } as const;
const periodLabels: Record<Period, string> = { hour: 'the past hour', 'six-hours': 'the past 6 hours', day: 'the past 24 hours', week: 'the past 7 days', last: 'since my last catch-up' };
const disabledAvailability: AssistantAvailability = { posts: false, communities: false, catchup: false };
const controlClass = 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-50';

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'Date unavailable';
}

// Model text never controls external navigation, HTML, or script execution.
function sourceHref(source: Pick<AssistantSource, 'url'>) {
  return safeAssistantHref(source.url) ? source.url : null;
}

function Claims({ claims, sources }: { claims: AssistantClaim[]; sources: AssistantSource[] }) {
  return <div className="space-y-3">{claims.map((claim, index) => <p key={index} className="whitespace-pre-wrap text-base leading-relaxed text-slate-800">
    {claim.text}{[...new Set(claim.evidence.map((item) => item.sourceId))].map((id) => {
      const sourceIndex = sources.findIndex((source) => source.id === id);
      const source = sources[sourceIndex];
      const href = source && sourceHref(source);
      return href ? <a key={id} href={href} title={source.title} aria-label={`Source ${sourceIndex + 1}: ${source.title}`} className="ml-1 rounded px-1 text-xs font-semibold text-teal-700 underline decoration-teal-200 underline-offset-2">[{sourceIndex + 1}]</a> : null;
    })}
  </p>)}</div>;
}

function PostResults({ result }: { result: AssistantResult }) {
  const posts = (result.posts ?? []).filter(post => sourceHref(post));
  const cards = (items: typeof posts, offset = 0) => <ol start={offset + 1} className="mt-3 space-y-3">{items.map((post, index) => <li key={post.questionId} className="rounded-xl border border-slate-200 p-3">
    <a href={sourceHref(post)!} className="text-base font-semibold leading-6 text-teal-700 underline decoration-teal-200 underline-offset-2">{offset + index + 1}. {post.title}</a>
    <p className="mt-1.5 whitespace-pre-wrap break-words text-base leading-relaxed text-slate-700">{post.excerpt}</p>
    <time dateTime={post.createdAt} className="mt-2 block text-xs text-slate-500">{dateLabel(post.createdAt)}</time>
  </li>)}</ol>;
  return <div aria-label="Assistant response">
    <p className="text-base leading-relaxed text-slate-800">{posts.length ? result.postsIntro ?? 'Here are discussions that match your question.' : result.unanswered[0] || 'No matching posts found. Try a visa type, location, or another keyword.'}</p>
    {cards(posts.slice(0, 8))}
    {posts.length > 8 && <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-teal-700">{`Show ${posts.length - 8} more posts`}</summary>{cards(posts.slice(8), 8)}</details>}
    <p className="mt-3 text-xs leading-5 text-slate-500">{result.notice}</p>
    {posts.length > 0 && <details className="mt-3 text-xs leading-5 text-slate-500"><summary className="cursor-pointer font-medium">Search details</summary><p className="mt-2">Showing {posts.length} matching discussion{posts.length === 1 ? '' : 's'}.{result.coverage.partial && ' Results are selected for relevance, not an exhaustive list. Ask for more posts or add a visa type, location, or date.'}</p>{result.coverage.since && result.coverage.until && <p>Posts published {dateLabel(result.coverage.since)} to {dateLabel(result.coverage.until)}.</p>}</details>}
  </div>;
}

function Result({ result, catchup }: { result: AssistantResult; catchup: boolean }) {
  if (result.kind === 'posts') return <PostResults result={result} />;
  const evidence = [...result.claims, ...result.disagreements].flatMap((claim) => claim.evidence);
  const citedSources = result.sources.flatMap((source, index) => {
    const href = sourceHref(source);
    const quotes = [...new Set(evidence.filter((item) => item.sourceId === source.id).map((item) => item.quote))];
    return href && quotes.length ? [{ source, index, href, quotes }] : [];
  });
  const coverageReasons = result.coverage.reasons ?? [];
  const coverageNotes = {
    'retrieval-limit': 'Sources were selected for relevance to your question; this is not an exhaustive review of every discussion.',
    'context-limit': 'The answer was checked against relevant excerpts. Follow the source links for the full discussions.',
    'missing-replies': 'The original discussion may contain additional replies that were not captured.',
    'unindexed-replies': 'Additional replies could not be retrieved for this answer.',
  };
  const limitation = !result.coverage.partial ? null
    : catchup ? 'This catch-up does not cover every update in the selected period. Choose a shorter range; your saved catch-up position is unchanged.'
    : coverageReasons.includes('missing-replies') ? 'Source note: This answer uses the post and replies saved here.'
    : coverageReasons.includes('unindexed-replies') ? 'Source note: Additional replies could not be retrieved for this answer.'
    : !coverageReasons.length ? 'Source note: This answer does not cover the full discussion.' : null;
  return <div aria-label="Assistant response">
    {result.status === 'insufficient' && <p className="text-base leading-relaxed text-slate-800">{result.unanswered[0] || (catchup ? 'No updates found for this time range.' : 'I couldn’t find enough relevant discussions to answer. Try a more specific question.')}</p>}
    <Claims claims={result.claims} sources={result.sources} />
    {!!result.disagreements.length && <div className="mt-3 border-l-2 border-amber-300 pl-3"><p className="mb-2 text-xs font-semibold text-amber-900">Related perspectives</p><Claims claims={result.disagreements} sources={result.sources} /></div>}
    {result.status !== 'insufficient' && !!result.unanswered.length && <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">Still unclear</summary><ul className="mt-2 list-disc space-y-1 pl-4 leading-5">{result.unanswered.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
    {result.status !== 'insufficient' && limitation && <p className="mt-3 text-xs leading-5 text-amber-800">{limitation}</p>}
    {(citedSources.length > 0 || result.coverage.partial) && <details className="mt-3 text-xs text-slate-500">
      <summary className="cursor-pointer font-medium">{citedSources.length ? `Sources · ${citedSources.length}` : 'About this answer'}</summary>
      <div className="mt-3 space-y-3 leading-5">{citedSources.map(({ source, index, href, quotes }) => <div key={source.id} className="border-l-2 border-teal-100 pl-3">
          <a href={href} className="font-semibold text-teal-700 underline">[{index + 1}] {source.title}</a>
          <p className="mt-1">{source.provenance === 'archive' ? 'Imported community' : 'Community'} {source.kind === 'reply' ? 'reply' : 'post'}{source.kind === 'reply' && source.speakerRole === 'original-poster' && ' · Original poster'}</p>
          {quotes.map((quote, quoteIndex) => <blockquote key={quoteIndex} className="mt-1 whitespace-pre-wrap text-base leading-relaxed text-slate-700">“{quote}”</blockquote>)}
          <p className="mt-1"><time dateTime={source.createdAt}>{dateLabel(source.createdAt)}</time>{source.updatedAt !== source.createdAt && <> · Updated {dateLabel(source.updatedAt)}</>}</p>
          {source.kind === 'reply' && source.provenance === 'member' && <p>Open the discussion and use “Load more” if available to see additional replies.</p>}
        </div>)}
        {result.coverage.partial && !!coverageReasons.length && <ul className="list-disc space-y-1 pl-4">{[...new Set(coverageReasons)].map((reason) => coverageNotes[reason] ? <li key={reason}>{coverageNotes[reason]}</li> : null)}</ul>}
        <p>{result.notice}</p>
        <p>{result.coverage.sourceCount} source{result.coverage.sourceCount === 1 ? '' : 's'} checked{result.coverage.since && <> · {dateLabel(result.coverage.since)}</>}{result.coverage.until && <> to {dateLabel(result.coverage.until)}</>}<br />Generated {dateLabel(result.generatedAt)}{result.cached && ' · Cached answer'}</p>
      </div>
    </details>}
  </div>;
}

export function AssistantPanel({ scope, title, defaultOpen = false }: Props) {
  const { user, loading: authLoading, demoMode } = useAuth();
  const productionSite = process.env.NEXT_PUBLIC_SITE_URL === 'https://visathreads.com';
  const pathname = usePathname();
  const scopeKey = scope.kind === 'public' ? 'public' : `${scope.kind}:${scope.id}`;
  const identity = `${user?.id ?? 'signed-out'}:${scopeKey}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const storageKey = `visathreads:assistant-catchup:v1:${identity}`;
  const [open, setOpen] = useState(defaultOpen);
  const [mode, setMode] = useState<AssistantMode>('ask');
  const [period, setPeriod] = useState<Period>('day');
  const [draft, setDraft] = useState<{ identity: string; text: string; transform?: AssistantRequest['transform'] }>({ identity, text: '' });
  const [conversation, setConversation] = useState<{ identity: string; turns: Turn[] }>({ identity, turns: [] });
  const [checkpoint, setCheckpoint] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('Connecting…');
  const [availability, setAvailability] = useState<AssistantAvailability>(disabledAvailability);
  const [checking, setChecking] = useState(true);
  const [settingsError, setSettingsError] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useRef<AbortController | null>(null);
  const requestPrompt = useRef<string | null>(null);
  const operation = useRef(0);
  const endOfChat = useRef<HTMLDivElement | null>(null);
  const turns = conversation.identity === identity ? conversation.turns : [];
  const question = draft.identity === identity ? draft.text : '';
  const completedAsks = turns.filter((turn) => turn.mode === 'ask' && turn.state === 'complete');
  const previousQuestions = completedAsks.at(-1)?.history ?? [];

  function cancel() {
    if (identityRef.current !== identity) return;
    ++operation.current; request.current?.abort(); request.current = null; requestPrompt.current = null;
    const pending = turns.find((turn) => turn.state === 'pending');
    if (pending?.mode === 'ask') setDraft((current) => current.identity === identity && !current.text.trim() ? { identity, text: pending.prompt } : current);
    setConversation((current) => current.identity === identity ? { ...current, turns: current.turns.map((turn) => turn.state === 'pending' ? { ...turn, state: 'cancelled' } : turn) } : current);
    setError(''); setBusy(false);
  }

  useEffect(() => {
    ++operation.current; request.current?.abort(); request.current = null; requestPrompt.current = null;
    setConversation({ identity, turns: [] }); setDraft({ identity, text: '' }); setError(''); setBusy(false); setMode('ask'); setPeriod('day'); setCheckpoint(null);
    if (scope.kind === 'community' && user && !demoMode) {
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (saved && Number.isFinite(Date.parse(saved)) && Date.parse(saved) <= Date.now()) setCheckpoint(new Date(saved).toISOString());
      } catch { /* Storage may be disabled; fixed time ranges remain available. */ }
    }
    return () => { ++operation.current; request.current?.abort(); };
  }, [identity, demoMode]);

  useEffect(() => {
    if (turns.length) endOfChat.current?.scrollIntoView({ block: 'nearest' });
  }, [conversation, busy]);

  useEffect(() => {
    const controller = new AbortController();
    setChecking(true); setSettingsError(false); setAvailability(disabledAvailability);
    if (!productionSite || demoMode) { setChecking(false); return () => controller.abort(); }
    const timeout = setTimeout(() => { controller.abort(); setChecking(false); setSettingsError(true); }, 8000);
    void fetch('/api/assistant', { signal: controller.signal, cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error('Unavailable');
      const value = await readAssistantJson(response) as AssistantAvailability;
      if (!controller.signal.aborted) setAvailability({ posts: value.posts === true, communities: value.communities === true, catchup: value.catchup === true });
    }).catch(() => { if (!controller.signal.aborted) setSettingsError(true); })
      .finally(() => { clearTimeout(timeout); if (!controller.signal.aborted) setChecking(false); });
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [productionSite, demoMode, retry]);

  const available = scope.kind === 'community' ? availability.communities : availability.posts;
  const canCatchup = scope.kind === 'community' && available && availability.catchup;
  const firstCatchup = mode === 'catchup' && period === 'last' && !checkpoint;
  const staleCheckpoint = mode === 'catchup' && period === 'last' && !!checkpoint && Date.parse(checkpoint) < Date.now() - 31 * 86400000;
  const canSubmit = !!user && !authLoading && !demoMode && available && (!busy || (mode === 'ask' && question.trim() !== requestPrompt.current)) && !checking && !firstCatchup && !staleCheckpoint && (mode !== 'catchup' || canCatchup) && (mode !== 'summary' || scope.kind === 'post') && (mode !== 'ask' || (question.trim().length >= 3 && question.trim().length <= 1200));
  const retryingQuestion = !!error && turns.at(-1)?.state === 'failed' && turns.at(-1)?.prompt === question.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const submittedQuestion = question.trim();
    if (!canSubmit || identityRef.current !== identity || (request.current && (mode !== 'ask' || requestPrompt.current === submittedQuestion))) return;
    // Supersede atomically before any await. Old responses cannot update the
    // conversation, error or draft even if their fetch ignores cancellation.
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    requestPrompt.current = mode === 'ask' ? submittedQuestion : null;
    const currentOperation = ++operation.current;
    const actor = identity;
    const isCurrent = () => !controller.signal.aborted && operation.current === currentOperation && identityRef.current === actor;
    const prompt = mode === 'ask' ? submittedQuestion : mode === 'summary' ? 'Summarize this discussion.' : `Catch me up ${period === 'last' ? '' : 'on '}${periodLabels[period]}.`;
    const last = turns.at(-1);
    const turnId = last && (last.state === 'failed' || last.state === 'cancelled') && last.prompt === prompt && last.mode === mode ? last.id : currentOperation;
    const turn: Turn = { id: turnId, prompt, mode, state: 'pending', ...(mode === 'ask' ? { history: assistantBoundedHistory([...previousQuestions, prompt]) } : {}) };
    const body: AssistantRequest = { scope, mode };
    if (mode === 'ask') {
      body.question = submittedQuestion;
      if (draft.transform) body.transform = draft.transform;
      if (previousQuestions.length) body.previousQuestions = previousQuestions;
      if (scope.kind === 'public') {
        body.conversation = completedAsks.slice(-3).map(item => ({ question: item.prompt.slice(0, 1200),
          answer: (item.result?.kind === 'posts' ? `Displayed ${item.result.posts?.length ?? 0} discussions.`
            : [...(item.result?.claims ?? []), ...(item.result?.disagreements ?? [])].map(claim => claim.text).join('\n') || item.result?.unanswered.join('\n') || '').slice(0, 1200) }));
        const previous = completedAsks.at(-1);
        body.conversationReferences = previous?.result?.kind === 'posts' ? assistantDisplayedPosts(previous.result)
          : previous?.referencePosts ?? assistantDisplayedPosts(previous?.result);
      }
      if (scope.kind === 'public' && assistantRefersToEarlierTurn(submittedQuestion)) {
        const previous = completedAsks.at(-1);
        // Numbered search results remain the reference list through summaries
        // and refusals. A new search (even empty) replaces it; a new topic never
        // enters this branch. Retain IDs only, with fresh server access checks.
        const previousPosts = previous?.result?.kind === 'posts' ? assistantDisplayedPosts(previous.result)
          : previous?.referencePosts ?? assistantDisplayedPosts(previous?.result);
        turn.referencePosts = previousPosts;
        if (previousPosts.length) body.previousPosts = previousPosts;
        turn.focusedPost = assistantPreviousPost({ ...body, focusedPost: previous?.focusedPost }) ?? undefined;
        if (turn.focusedPost) body.focusedPost = turn.focusedPost;
        turn.seenPostIds = [...new Set([...(previous?.seenPostIds ?? []), ...previousPosts.map(post => post.questionId)])].slice(0, 48);
        if (assistantMorePosts(submittedQuestion) && turn.seenPostIds.length) body.seenPostIds = turn.seenPostIds;
      }
    }
    if (body.previousPosts) delete body.conversationReferences;
    if (mode === 'catchup') body.since = period === 'last' && checkpoint ? checkpoint : new Date(Date.now() - (period === 'last' ? 24 : periodHours[period]) * 3600000).toISOString();
    setConversation({ identity: actor, turns: [...turns.filter((item) => item.id !== turnId).map((item) => item.state === 'pending' ? { ...item, state: 'cancelled' as const } : item), turn].slice(-20) });
    if (mode === 'ask') setDraft({ identity: actor, text: '' });
    setBusy(true); setError(''); setProgress('Connecting…');
    const fail = (message: string) => {
      if (!isCurrent()) return;
      setConversation((current) => current.identity === actor ? { ...current, turns: current.turns.map((item) => item.id === turnId ? { ...item, state: 'failed' } : item) } : current);
      if (mode === 'ask') setDraft((current) => current.identity === actor && !current.text.trim() ? { identity: actor, text: submittedQuestion } : current);
      setError(message);
    };
    const timeout = setTimeout(() => {
      if (!isCurrent()) return;
      fail(assistantFailureMessage({ code: 'timeout' })); controller.abort(); request.current = null; requestPrompt.current = null; setBusy(false);
    }, 65000);
    controller.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true });
    try {
      const { data, error: sessionError } = await getSupabase().auth.getSession();
      if (!isCurrent()) return;
      if (sessionError || !data.session?.access_token || data.session.user.id !== user?.id) { fail('Your session has expired. Sign in again.'); return; }
      const response = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify(body), signal: controller.signal, cache: 'no-store' });
      if (!isCurrent()) return;
      if (!response.ok) {
        // A proxy may return HTML or malformed JSON. Status remains a safe
        // fallback, and raw provider/database error text is never rendered.
        const failure = await readAssistantJson(response).catch(() => null);
        fail(assistantFailureMessage(parseAssistantFailure(response.status, failure, response.headers?.get('retry-after') ?? null)));
        return;
      }
      const streamed = await readAssistantResponse(response, label => { if (isCurrent()) setProgress(label); });
      if (!isCurrent()) return;
      if (streamed.status < 200 || streamed.status >= 300) {
        fail(assistantFailureMessage(parseAssistantFailure(streamed.status, streamed.value, streamed.retryAfter))); return;
      }
      const value = parseAssistantResult(streamed.value);
      if (!isCurrent()) return;
      if (!value) { fail('The answer was incomplete. Your question is saved; try again.'); return; }
      setConversation((current) => current.identity === actor ? { ...current, turns: current.turns.map((item) => item.id === turnId ? { ...item, state: 'complete', result: value,
        ...(value.resolvedQuestion ? { history: [value.resolvedQuestion], referencePosts: value.resolvedReferences ?? assistantDisplayedPosts(value), focusedPost: value.resolvedFocus } : {}) } : item) } : current);
      // A partial digest cannot mark a whole interval as read.
      if (mode === 'catchup' && scope.kind === 'community' && value.status === 'answered' && !value.coverage.partial && value.coverage.until && Number.isFinite(Date.parse(value.coverage.until)) && Date.parse(value.coverage.until) <= Date.now() && (!checkpoint || Date.parse(value.coverage.until) > Date.parse(checkpoint))) {
        const until = new Date(value.coverage.until).toISOString();
        setCheckpoint(until);
        try { window.localStorage.setItem(storageKey, until); } catch { /* Optional local checkpoint only. */ }
      }
    } catch { fail(assistantFailureMessage({ code: 'unavailable' })); }
    finally { clearTimeout(timeout); if (isCurrent()) { request.current = null; requestPrompt.current = null; setBusy(false); } }
  }

  function downloadChat() {
    if (!user || authLoading || identityRef.current !== identity || !turns.length) return;
    const url = URL.createObjectURL(new Blob([assistantChatExport(turns)], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'visathreads-chat.txt';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!productionSite) return null;
  return <section className="my-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="VisaThreads assistant">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700"><Sparkles size={18} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-900">{title ?? (scope.kind === 'post' ? 'Ask about this post' : scope.kind === 'community' ? 'Community assistant' : 'VisaThreads AI')}</span><span className="block text-xs text-slate-500">Answers from community discussions</span></span>
      <ChevronDown size={17} aria-hidden="true" className={`shrink-0 text-slate-400 ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div className="border-t border-slate-100">
      {demoMode ? <p className="p-4 text-sm text-slate-600">The assistant is unavailable in the local preview.</p> : checking || authLoading ? <p role="status" className="p-4 text-sm text-slate-500">Connecting…</p> : settingsError ? <p role="alert" className="p-4 text-sm text-slate-700">Couldn’t connect. <button type="button" onClick={() => setRetry((value) => value + 1)} className="font-semibold text-teal-700 underline">Retry</button></p> : !available ? <p className="p-4 text-sm text-slate-600">The assistant is unavailable here.</p> : !user ? <p className="p-5 text-sm text-slate-700"><a href={`/login?next=${encodeURIComponent(pathname || '/assistant')}#sign-in`} className="font-semibold text-teal-700 underline">Sign in</a> to chat.</p> : <>
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3" role="group" aria-label="Assistant task">
          {(scope.kind === 'post' || canCatchup) && <button type="button" aria-pressed={mode === 'ask'} onClick={() => { cancel(); setMode('ask'); }} className={`${controlClass} ${mode === 'ask' ? 'border-teal-300 bg-teal-50 text-teal-800' : ''}`}>Ask</button>}
          {scope.kind === 'post' && <button type="button" aria-pressed={mode === 'summary'} onClick={() => { cancel(); setMode('summary'); }} className={`${controlClass} ${mode === 'summary' ? 'border-teal-300 bg-teal-50 text-teal-800' : ''}`}>Summarize</button>}
          {canCatchup && <button type="button" aria-pressed={mode === 'catchup'} onClick={() => { cancel(); setMode('catchup'); }} className={`${controlClass} ${mode === 'catchup' ? 'border-teal-300 bg-teal-50 text-teal-800' : ''}`}><Clock3 size={12} className="mr-1 inline" aria-hidden="true" />Catch me up</button>}
          {!!turns.length && <button type="button" onClick={downloadChat} title="Save this chat as a text file on your device" className={controlClass}>Download chat</button>}
          {!!turns.length && <button type="button" onClick={() => { cancel(); setConversation({ identity, turns: [] }); setDraft({ identity, text: '' }); setMode('ask'); }} className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-800">New chat</button>}
        </div>
        <div role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text" className="max-h-[60vh] min-h-40 space-y-5 overflow-y-auto px-4 py-5 sm:px-5">
          {!turns.length && <div className="py-6 text-center"><p className="text-base font-semibold text-slate-800">{mode === 'catchup' ? 'What did you miss?' : mode === 'summary' ? 'Get the key points' : 'What would you like to know?'}</p><p className="mt-1 text-xs text-slate-500">{mode === 'catchup' ? 'Choose a time range below.' : mode === 'summary' ? 'A short summary with sources.' : 'Ask a question. Follow up naturally.'}</p></div>}
          {turns.map((turn) => <div key={turn.id} className="space-y-3">
            <div className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-sm bg-teal-700 px-4 py-2.5 text-base leading-relaxed text-white" aria-label="Your message"><p className="whitespace-pre-wrap break-words">{turn.prompt}</p></div>
            <div className="flex gap-2.5" aria-label="AI message"><span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-teal-50 text-teal-700"><Sparkles size={13} aria-hidden="true" /></span><div className="min-w-0 flex-1 pt-0.5">
              {turn.state === 'pending' ? <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-500 motion-reduce:animate-none" aria-hidden="true" />{progress}</p> : turn.result ? <Result result={turn.result} catchup={turn.mode === 'catchup'} /> : <p className="text-xs text-slate-500">{turn.state === 'cancelled' ? 'Stopped.' : 'No answer received.'}</p>}
            </div></div>
          </div>)}
          {scope.kind === 'public' && !busy && turns.at(-1)?.state === 'complete' && assistantDisplayedPosts(turns.at(-1)?.result).length > 0 && <div className="flex flex-wrap gap-2 pl-8" role="group" aria-label="Continue this conversation">
            {(turns.at(-1)?.result?.kind === 'posts' ? ['Summarize these posts', 'Compare them'] : ['Make it shorter', 'What outcomes did they report?']).map(prompt => <button key={prompt} type="button" className={`${controlClass} hover:border-teal-400 hover:text-teal-800`} onClick={() => { setMode('ask'); setDraft({ identity, text: prompt, transform: prompt === 'Summarize these posts' ? 'summarize' : prompt === 'Make it shorter' ? 'shorten' : undefined }); setError(''); }}>{prompt}</button>)}
          </div>}
          <div ref={endOfChat} />
        </div>
        <form onSubmit={submit} className="border-t border-slate-100 p-3 sm:p-4">
          {mode === 'catchup' && <div className="mb-3"><label className="text-xs font-medium text-slate-600">Time range<select value={period} disabled={busy} onChange={(event) => { setPeriod(event.target.value as Period); setError(''); }} className={`ml-2 ${controlClass}`}><option value="hour">Past hour</option><option value="six-hours">Past 6 hours</option><option value="day">Past 24 hours</option><option value="week">Past 7 days</option><option value="last">Since last catch-up</option></select></label>{period === 'last' && <p className="mt-2 text-xs text-slate-500">{staleCheckpoint ? 'Your last catch-up is older than 31 days. Choose a recent range.' : checkpoint ? `From ${dateLabel(checkpoint)}.` : 'No previous catch-up. Choose a time range first.'}</p>}</div>}
          <div className={`flex items-end gap-2 ${mode === 'ask' ? 'rounded-2xl border border-slate-300 bg-white p-2 focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-50' : ''}`}>
            {mode === 'ask' && <textarea aria-label="Your question" value={question} onChange={(event) => { setDraft({ identity, text: event.target.value }); setError(''); }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); if (canSubmit) event.currentTarget.form?.requestSubmit(); } }} required minLength={3} maxLength={1200} rows={2} placeholder={busy ? 'Draft another question…' : 'Ask a question…'} className="block min-h-12 w-full resize-none bg-transparent px-2 py-1 text-base leading-6 text-slate-800 outline-none" />}
            {busy && <button type="button" onClick={cancel} aria-label="Stop response" title="Stop response" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-700 text-white hover:bg-slate-900"><Square size={14} fill="currentColor" aria-hidden="true" /></button>}
            {(!busy || mode === 'ask') && <button type="submit" disabled={!canSubmit} aria-label={mode === 'ask' ? busy ? 'Send new message' : retryingQuestion ? 'Retry answer' : 'Send message' : mode === 'summary' ? 'Summarize discussion' : 'Create catch-up'} title={busy ? 'Stop the current response and send this question' : undefined} className={`${mode === 'ask' ? 'grid h-9 w-9 place-items-center' : 'px-4 py-2 text-sm font-semibold'} shrink-0 rounded-xl bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-40`}>
              {mode === 'ask' ? <ArrowUp size={19} aria-hidden="true" /> : mode === 'summary' ? 'Summarize discussion' : 'Create catch-up'}
            </button>}
          </div>
          {error && conversation.identity === identity && <p role="alert" className="mt-2 text-xs leading-5 text-amber-800">{error}{error.startsWith('Your session has expired') && <> <a href={`/login?next=${encodeURIComponent(pathname || '/assistant')}#sign-in`} className="font-semibold underline">Sign in</a></>}</p>}
          <p className="mt-2 text-center text-xs leading-5 text-slate-600">Answers from community discussions. Check the cited sources.</p>
        </form>
      </>}
    </div>}
  </section>;
}

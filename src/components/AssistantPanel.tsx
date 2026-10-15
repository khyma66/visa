'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { usePathname } from 'next/navigation';
import { ArrowUp, ChevronDown, Clock3, Sparkles, Square } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import type { AssistantAvailability, AssistantClaim, AssistantMode, AssistantRequest, AssistantResult, AssistantScope, AssistantSource } from '@/lib/assistant-contract';
import { useAuth } from './AuthProvider';

type Props = { scope: AssistantScope; title?: string; defaultOpen?: boolean };
type Period = 'hour' | 'six-hours' | 'day' | 'week' | 'last';
type Turn = { id: number; prompt: string; mode: AssistantMode; state: 'pending' | 'complete' | 'failed' | 'cancelled'; result?: AssistantResult };
const periodHours = { hour: 1, 'six-hours': 6, day: 24, week: 168 } as const;
const periodLabels: Record<Period, string> = { hour: 'the past hour', 'six-hours': 'the past 6 hours', day: 'the past 24 hours', week: 'the past 7 days', last: 'since my last catch-up' };
const disabledAvailability: AssistantAvailability = { posts: false, communities: false, catchup: false };
const controlClass = 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-50';

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'Date unavailable';
}

// Model text never controls external navigation, HTML, or script execution.
function sourceHref(source: AssistantSource) {
  return /^\/(?:questions|experiences)\/[a-zA-Z0-9_-]+(?:#answer-[a-zA-Z0-9_-]+)?$/.test(source.url) ? source.url : null;
}

function Claims({ claims, sources }: { claims: AssistantClaim[]; sources: AssistantSource[] }) {
  return <div className="space-y-3">{claims.map((claim, index) => <p key={index} className="whitespace-pre-wrap text-sm leading-6 text-slate-800">
    {claim.text}{[...new Set(claim.evidence.map((item) => item.sourceId))].map((id) => {
      const sourceIndex = sources.findIndex((source) => source.id === id);
      const source = sources[sourceIndex];
      const href = source && sourceHref(source);
      return href ? <a key={id} href={href} title={source.title} aria-label={`Source ${sourceIndex + 1}: ${source.title}`} className="ml-1 rounded px-1 text-xs font-semibold text-teal-700 underline decoration-teal-200 underline-offset-2">[{sourceIndex + 1}]</a> : null;
    })}
  </p>)}</div>;
}

function Result({ result, catchup }: { result: AssistantResult; catchup: boolean }) {
  const evidence = [...result.claims, ...result.disagreements].flatMap((claim) => claim.evidence);
  return <div aria-label="Assistant response">
    {result.status === 'insufficient' && <p className="text-sm leading-6 text-slate-800">{result.unanswered[0] || (catchup ? 'No updates found for this time range.' : 'I couldn’t find enough relevant discussions to answer. Try a more specific question.')}</p>}
    <Claims claims={result.claims} sources={result.sources} />
    {!!result.disagreements.length && <div className="mt-3 border-l-2 border-amber-300 pl-3"><p className="mb-2 text-xs font-semibold text-amber-900">Reports differ</p><Claims claims={result.disagreements} sources={result.sources} /></div>}
    {result.status !== 'insufficient' && !!result.unanswered.length && <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">Still unclear</summary><ul className="mt-2 list-disc space-y-1 pl-4 leading-5">{result.unanswered.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
    {result.coverage.partial && <p className="mt-3 text-xs leading-5 text-amber-800">Partial coverage: some discussions may be missing.{catchup && ' Checkpoint unchanged. Try a shorter range.'}</p>}
    <details className="mt-3 text-xs text-slate-500">
      <summary className="cursor-pointer font-medium">{evidence.length ? `Sources · ${new Set(evidence.map((item) => item.sourceId)).size}` : 'About this answer'}</summary>
      <div className="mt-3 space-y-3 leading-5">{result.sources.map((source, index) => {
        const href = sourceHref(source);
        const quotes = [...new Set(evidence.filter((item) => item.sourceId === source.id).map((item) => item.quote))];
        if (!href || !quotes.length) return null;
        return <div key={source.id} className="border-l-2 border-teal-100 pl-3">
          <a href={href} className="font-semibold text-teal-700 underline">[{index + 1}] {source.title}</a>
          {quotes.map((quote, quoteIndex) => <blockquote key={quoteIndex} className="mt-1 whitespace-pre-wrap">“{quote}”</blockquote>)}
          <p className="mt-1"><time dateTime={source.createdAt}>{dateLabel(source.createdAt)}</time>{source.updatedAt !== source.createdAt && <> · Updated {dateLabel(source.updatedAt)}</>}</p>
          {source.kind === 'reply' && <p>Use “Load more” in the discussion for older replies.</p>}
        </div>;
      })}
        <p>{result.notice}</p>
        <p>{result.coverage.sourceCount} source{result.coverage.sourceCount === 1 ? '' : 's'} checked{result.coverage.since && <> · {dateLabel(result.coverage.since)}</>}{result.coverage.until && <> to {dateLabel(result.coverage.until)}</>}<br />Generated {dateLabel(result.generatedAt)}{result.cached && ' · Cached answer'}</p>
      </div>
    </details>
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
  const [draft, setDraft] = useState({ identity, text: '' });
  const [conversation, setConversation] = useState<{ identity: string; turns: Turn[] }>({ identity, turns: [] });
  const [checkpoint, setCheckpoint] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [availability, setAvailability] = useState<AssistantAvailability>(disabledAvailability);
  const [checking, setChecking] = useState(true);
  const [settingsError, setSettingsError] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useRef<AbortController | null>(null);
  const operation = useRef(0);
  const endOfChat = useRef<HTMLDivElement | null>(null);
  const turns = conversation.identity === identity ? conversation.turns : [];
  const question = draft.identity === identity ? draft.text : '';
  const previousQuestions = turns.filter((turn) => turn.mode === 'ask' && turn.state === 'complete').slice(-3).map((turn) => turn.prompt);

  function cancel() {
    ++operation.current; request.current?.abort(); request.current = null;
    const pending = turns.find((turn) => turn.state === 'pending');
    if (pending?.mode === 'ask') setDraft({ identity, text: pending.prompt });
    setConversation((current) => current.identity === identity ? { ...current, turns: current.turns.map((turn) => turn.state === 'pending' ? { ...turn, state: 'cancelled' } : turn) } : current);
    setError(''); setBusy(false);
  }

  useEffect(() => {
    ++operation.current; request.current?.abort(); request.current = null;
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
      const value = await response.json() as AssistantAvailability;
      if (!controller.signal.aborted) setAvailability({ posts: value.posts === true, communities: value.communities === true, catchup: value.catchup === true });
    }).catch(() => { if (!controller.signal.aborted) setSettingsError(true); })
      .finally(() => { clearTimeout(timeout); if (!controller.signal.aborted) setChecking(false); });
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [productionSite, demoMode, retry]);

  const available = scope.kind === 'community' ? availability.communities : availability.posts;
  const canCatchup = scope.kind === 'community' && available && availability.catchup;
  const firstCatchup = mode === 'catchup' && period === 'last' && !checkpoint;
  const staleCheckpoint = mode === 'catchup' && period === 'last' && !!checkpoint && Date.parse(checkpoint) < Date.now() - 31 * 86400000;
  const canSubmit = !!user && !authLoading && !demoMode && available && !busy && !checking && !firstCatchup && !staleCheckpoint && (mode !== 'catchup' || canCatchup) && (mode !== 'summary' || scope.kind === 'post') && (mode !== 'ask' || (question.trim().length >= 3 && question.trim().length <= 1200));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const currentOperation = ++operation.current;
    const actor = identity;
    const isCurrent = () => !controller.signal.aborted && operation.current === currentOperation && identityRef.current === actor;
    const submittedQuestion = question.trim();
    const prompt = mode === 'ask' ? submittedQuestion : mode === 'summary' ? 'Summarize this discussion.' : `Catch me up ${period === 'last' ? '' : 'on '}${periodLabels[period]}.`;
    const last = turns.at(-1);
    const turnId = last && (last.state === 'failed' || last.state === 'cancelled') && last.prompt === prompt && last.mode === mode ? last.id : currentOperation;
    const turn: Turn = { id: turnId, prompt, mode, state: 'pending' };
    const body: AssistantRequest = { scope, mode };
    if (mode === 'ask') { body.question = submittedQuestion; if (previousQuestions.length) body.previousQuestions = previousQuestions; }
    if (mode === 'catchup') body.since = period === 'last' && checkpoint ? checkpoint : new Date(Date.now() - (period === 'last' ? 24 : periodHours[period]) * 3600000).toISOString();
    setConversation({ identity: actor, turns: [...turns.filter((item) => item.id !== turnId), turn].slice(-20) });
    if (mode === 'ask') setDraft({ identity: actor, text: '' });
    setBusy(true); setError('');
    const fail = (message: string) => {
      if (!isCurrent()) return;
      setConversation((current) => current.identity === actor ? { ...current, turns: current.turns.map((item) => item.id === turnId ? { ...item, state: 'failed' } : item) } : current);
      if (mode === 'ask') setDraft({ identity: actor, text: submittedQuestion });
      setError(message);
    };
    const timeout = setTimeout(() => {
      if (!isCurrent()) return;
      fail('That took too long. Try again.'); controller.abort(); request.current = null; setBusy(false);
    }, 45000);
    try {
      const { data, error: sessionError } = await getSupabase().auth.getSession();
      if (!isCurrent()) return;
      if (sessionError || !data.session?.access_token || data.session.user.id !== user?.id) { fail('Your session has expired. Sign in again.'); return; }
      const response = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify(body), signal: controller.signal, cache: 'no-store' });
      if (!isCurrent()) return;
      if (!response.ok) {
        fail(response.status === 401 ? 'Your session has expired. Sign in again.' : response.status === 429 ? 'You’ve reached the assistant limit. Try again later.' : response.status === 403 ? 'You don’t have access to this discussion.' : response.status === 409 ? 'This discussion changed. Try again for the latest answer.' : response.status === 502 ? 'I couldn’t verify the sources for that answer. Try again.' : 'Couldn’t get an answer. Try again.');
        return;
      }
      const value = await response.json() as AssistantResult;
      if (!isCurrent()) return;
      if (!['answered', 'insufficient'].includes(value.status) || !Array.isArray(value.claims) || !Array.isArray(value.sources) || !Array.isArray(value.disagreements) || !Array.isArray(value.unanswered) || !value.coverage) throw new Error('Invalid response');
      setConversation((current) => current.identity === actor ? { ...current, turns: current.turns.map((item) => item.id === turnId ? { ...item, state: 'complete', result: value } : item) } : current);
      // A partial digest cannot mark a whole interval as read.
      if (mode === 'catchup' && scope.kind === 'community' && value.status === 'answered' && !value.coverage.partial && value.coverage.until && Number.isFinite(Date.parse(value.coverage.until)) && Date.parse(value.coverage.until) <= Date.now() && (!checkpoint || Date.parse(value.coverage.until) > Date.parse(checkpoint))) {
        const until = new Date(value.coverage.until).toISOString();
        setCheckpoint(until);
        try { window.localStorage.setItem(storageKey, until); } catch { /* Optional local checkpoint only. */ }
      }
    } catch { fail('Couldn’t get an answer. Try again.'); }
    finally { clearTimeout(timeout); if (isCurrent()) { request.current = null; setBusy(false); } }
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
          {!!turns.length && <button type="button" onClick={() => { cancel(); setConversation({ identity, turns: [] }); setDraft({ identity, text: '' }); setMode('ask'); }} className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-800">New chat</button>}
        </div>
        <div role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text" className="max-h-[60vh] min-h-40 space-y-5 overflow-y-auto px-4 py-5 sm:px-5">
          {!turns.length && <div className="py-6 text-center"><p className="text-base font-semibold text-slate-800">{mode === 'catchup' ? 'What did you miss?' : mode === 'summary' ? 'Get the key points' : 'What would you like to know?'}</p><p className="mt-1 text-xs text-slate-500">{mode === 'catchup' ? 'Choose a time range below.' : mode === 'summary' ? 'A short summary with sources.' : 'Ask a question. Follow up naturally.'}</p></div>}
          {turns.map((turn) => <div key={turn.id} className="space-y-3">
            <div className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-sm bg-teal-700 px-4 py-2.5 text-sm leading-6 text-white" aria-label="Your message"><p className="whitespace-pre-wrap break-words">{turn.prompt}</p></div>
            <div className="flex gap-2.5" aria-label="AI message"><span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-teal-50 text-teal-700"><Sparkles size={13} aria-hidden="true" /></span><div className="min-w-0 flex-1 pt-0.5">
              {turn.state === 'pending' ? <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-500 motion-reduce:animate-none" aria-hidden="true" />Thinking…</p> : turn.result ? <Result result={turn.result} catchup={turn.mode === 'catchup'} /> : <p className="text-xs text-slate-500">{turn.state === 'cancelled' ? 'Stopped.' : 'No answer received.'}</p>}
            </div></div>
          </div>)}
          <div ref={endOfChat} />
        </div>
        <form onSubmit={submit} className="border-t border-slate-100 p-3 sm:p-4">
          {mode === 'catchup' && <div className="mb-3"><label className="text-xs font-medium text-slate-600">Time range<select value={period} disabled={busy} onChange={(event) => { setPeriod(event.target.value as Period); setError(''); }} className={`ml-2 ${controlClass}`}><option value="hour">Past hour</option><option value="six-hours">Past 6 hours</option><option value="day">Past 24 hours</option><option value="week">Past 7 days</option><option value="last">Since last catch-up</option></select></label>{period === 'last' && <p className="mt-2 text-xs text-slate-500">{staleCheckpoint ? 'Your last catch-up is older than 31 days. Choose a recent range.' : checkpoint ? `From ${dateLabel(checkpoint)}.` : 'No previous catch-up. Choose a time range first.'}</p>}</div>}
          <div className={`flex items-end gap-2 ${mode === 'ask' ? 'rounded-2xl border border-slate-300 bg-white p-2 focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-50' : ''}`}>
            {mode === 'ask' && <textarea aria-label="Your question" value={question} disabled={busy} onChange={(event) => { if (!busy) { setDraft({ identity, text: event.target.value }); setError(''); } }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); if (canSubmit) event.currentTarget.form?.requestSubmit(); } }} required minLength={3} maxLength={1200} rows={2} placeholder="Ask a question…" className="block min-h-12 w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 text-slate-800 outline-none disabled:opacity-60" />}
            {busy ? <button type="button" onClick={cancel} aria-label="Stop response" title="Stop response" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-700 text-white hover:bg-slate-900"><Square size={14} fill="currentColor" aria-hidden="true" /></button> : <button type="submit" disabled={!canSubmit} aria-label={mode === 'ask' ? error ? 'Retry answer' : 'Send message' : mode === 'summary' ? 'Summarize discussion' : 'Create catch-up'} className={`${mode === 'ask' ? 'grid h-9 w-9 place-items-center' : 'px-4 py-2 text-sm font-semibold'} shrink-0 rounded-xl bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-40`}>
              {mode === 'ask' ? <ArrowUp size={19} aria-hidden="true" /> : mode === 'summary' ? 'Summarize discussion' : 'Create catch-up'}
            </button>}
          </div>
          {error && conversation.identity === identity && <p role="alert" className="mt-2 text-xs leading-5 text-amber-800">{error}{error.startsWith('Your session has expired') && <> <a href={`/login?next=${encodeURIComponent(pathname || '/assistant')}#sign-in`} className="font-semibold underline">Sign in</a></>}</p>}
          <p className="mt-2 text-center text-[11px] leading-4 text-slate-400">Community experiences, not official visa advice. Don’t share personal identifiers.</p>
        </form>
      </>}
    </div>}
  </section>;
}

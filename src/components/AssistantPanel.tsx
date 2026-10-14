'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronDown, Clock3, MessageSquareText, Sparkles } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import type { AssistantAvailability, AssistantClaim, AssistantMode, AssistantRequest, AssistantResult, AssistantScope, AssistantSource } from '@/lib/assistant-contract';
import { useAuth } from './AuthProvider';

type Props = { scope: AssistantScope; title?: string; defaultOpen?: boolean };
type Period = 'hour' | 'six-hours' | 'day' | 'week' | 'last';
const periodHours = { hour: 1, 'six-hours': 6, day: 24, week: 168 } as const;
const disabledAvailability: AssistantAvailability = { posts: false, communities: false, catchup: false };
const controlClass = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50';

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'Date unavailable';
}

// Only the API constructs source links. This second boundary prevents a malformed
// response from turning model text into external navigation or script execution.
function sourceHref(source: AssistantSource) {
  return /^\/(?:questions|experiences)\/[a-zA-Z0-9_-]+(?:#answer-[a-zA-Z0-9_-]+)?$/.test(source.url) ? source.url : null;
}

function Claims({ claims, sources }: { claims: AssistantClaim[]; sources: AssistantSource[] }) {
  return <ul className="space-y-4">{claims.map((claim, index) => <li key={index}>
    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{claim.text}</p>
    <ul className="mt-2 space-y-2">{claim.evidence.map((evidence, evidenceIndex) => {
      const source = sources.find((item) => item.id === evidence.sourceId);
      const href = source && sourceHref(source);
      if (!source || !href) return null;
      return <li key={`${evidence.sourceId}-${evidenceIndex}`} className="rounded-lg border-l-2 border-teal-400 bg-white p-3 text-xs leading-5 text-slate-600">
        <blockquote className="whitespace-pre-wrap">“{evidence.quote}”</blockquote>
        <a href={href} className="mt-1 block break-words font-semibold text-teal-800 underline">{source.title} · {source.kind === 'reply' ? 'Reply' : 'Post'}</a>
        {source.kind === 'reply' && <span className="block">Older replies may require “Load more” in the discussion.</span>}
        <time dateTime={source.createdAt}>Posted {dateLabel(source.createdAt)}</time>
        {source.updatedAt !== source.createdAt && <span> · Updated {dateLabel(source.updatedAt)}</span>}
      </li>;
    })}</ul>
  </li>)}</ul>;
}

function Result({ result, catchup }: { result: AssistantResult; catchup: boolean }) {
  return <div className="mt-5 border-t border-teal-100 pt-5" aria-label="Assistant response" aria-live="polite">
    {result.coverage.partial && <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900">Partial coverage: this response uses a limited selection of posts and replies. It may omit relevant discussions.{catchup && ' Your catch-up checkpoint has not advanced. Try a shorter time range.'}</p>}
    <p className="mb-3 text-xs leading-5 text-slate-600">Based on {result.coverage.sourceCount} source{result.coverage.sourceCount === 1 ? '' : 's'}
      {result.coverage.since && <> · From <time dateTime={result.coverage.since}>{dateLabel(result.coverage.since)}</time></>}
      {result.coverage.until && <> to <time dateTime={result.coverage.until}>{dateLabel(result.coverage.until)}</time></>}
      <span className="block">Generated <time dateTime={result.generatedAt}>{dateLabel(result.generatedAt)}</time>{result.cached ? ' · Reused summary' : ''}</span>
    </p>
    {result.status === 'insufficient' && <p className="mb-4 font-semibold text-slate-800">There isn’t enough evidence in the available discussions to answer reliably.</p>}
    <Claims claims={result.claims} sources={result.sources} />
    {!!result.disagreements.length && <section className="mt-5"><h4 className="mb-3 text-sm font-bold text-amber-900">Different experiences or conflicting accounts</h4><Claims claims={result.disagreements} sources={result.sources} /></section>}
    {!!result.unanswered.length && <section className="mt-5"><h4 className="text-sm font-bold text-slate-800">Still unanswered</h4><ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600">{result.unanswered.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
    <p className="mt-4 rounded-lg bg-white p-3 text-xs leading-5 text-slate-600">{result.notice}</p>
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
  const [question, setQuestion] = useState('');
  const [previousQuestions, setPreviousQuestions] = useState<string[]>([]);
  const [checkpoint, setCheckpoint] = useState<string | null>(null);
  const [result, setResult] = useState<{ identity: string; value: AssistantResult } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [availability, setAvailability] = useState<AssistantAvailability>(disabledAvailability);
  const [checking, setChecking] = useState(true);
  const [settingsError, setSettingsError] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useRef<AbortController | null>(null);
  const operation = useRef(0);

  function clearResponse() {
    ++operation.current; request.current?.abort(); request.current = null;
    setResult(null); setError(''); setBusy(false);
  }

  useEffect(() => {
    clearResponse(); setQuestion(''); setPreviousQuestions([]); setMode('ask'); setPeriod('day'); setCheckpoint(null);
    if (user && !demoMode) {
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (saved && Number.isFinite(Date.parse(saved)) && Date.parse(saved) <= Date.now()) setCheckpoint(new Date(saved).toISOString());
      } catch { /* Storage may be disabled; fixed time ranges remain available. */ }
    }
    return () => { ++operation.current; request.current?.abort(); };
  }, [identity, demoMode]);

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
  const canCatchup = scope.kind !== 'post' && available && availability.communities && availability.catchup;
  const firstCatchup = mode === 'catchup' && period === 'last' && !checkpoint;
  const staleCheckpoint = mode === 'catchup' && period === 'last' && !!checkpoint && Date.parse(checkpoint) < Date.now() - 31 * 86400000;
  const canSubmit = !!user && !authLoading && !demoMode && available && !busy && !checking && !firstCatchup && !staleCheckpoint && (mode !== 'catchup' || canCatchup) && (mode !== 'ask' || question.trim().length >= 3);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const currentOperation = ++operation.current;
    const actor = identity;
    const isCurrent = () => !controller.signal.aborted && operation.current === currentOperation && identityRef.current === actor;
    const submittedQuestion = question.trim();
    const body: AssistantRequest = { scope, mode };
    if (mode === 'ask') { body.question = submittedQuestion; if (previousQuestions.length) body.previousQuestions = previousQuestions.slice(-3); }
    if (mode === 'catchup') body.since = period === 'last' && checkpoint ? checkpoint : new Date(Date.now() - (period === 'last' ? 24 : periodHours[period]) * 3600000).toISOString();
    setBusy(true); setError(''); setResult(null);
    const timeout = setTimeout(() => { if (isCurrent()) { controller.abort(); request.current = null; setBusy(false); setError('This is taking too long. Try again with a narrower question or time range.'); } }, 45000);
    try {
      const { data, error: sessionError } = await getSupabase().auth.getSession();
      if (!isCurrent()) return;
      if (sessionError || !data.session?.access_token || data.session.user.id !== user?.id) { setError('Your session has expired. Sign in again to continue.'); return; }
      const response = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify(body), signal: controller.signal, cache: 'no-store' });
      if (!isCurrent()) return;
      if (!response.ok) {
        setError(response.status === 401 ? 'Your session has expired. Sign in again to continue.' : response.status === 429 ? 'You’ve reached the assistant limit. Please try again later.' : response.status === 403 ? 'The assistant is not available for this discussion.' : 'The assistant could not complete this request. Please try again.');
        return;
      }
      const value = await response.json() as AssistantResult;
      if (!isCurrent()) return;
      if (!['answered', 'insufficient'].includes(value.status) || !Array.isArray(value.claims) || !Array.isArray(value.sources) || !Array.isArray(value.disagreements) || !Array.isArray(value.unanswered) || !value.coverage) throw new Error('Invalid response');
      setResult({ identity: actor, value });
      if (mode === 'ask') setPreviousQuestions((current) => [...current, submittedQuestion].slice(-3));
      // A partial digest cannot safely mark the whole interval as read. Only a
      // successful complete response advances this user's scope-specific cursor.
      if (mode === 'catchup' && value.status === 'answered' && !value.coverage.partial && value.coverage.until && Number.isFinite(Date.parse(value.coverage.until)) && Date.parse(value.coverage.until) <= Date.now() && (!checkpoint || Date.parse(value.coverage.until) > Date.parse(checkpoint))) {
        const until = new Date(value.coverage.until).toISOString();
        setCheckpoint(until);
        try { window.localStorage.setItem(storageKey, until); } catch { /* Optional local checkpoint only. */ }
      }
    } catch { if (isCurrent()) setError('The assistant could not complete this request. Please try again.'); }
    finally { clearTimeout(timeout); if (isCurrent()) { request.current = null; setBusy(false); } }
  }

  if (!productionSite) return null;
  return <section className="my-5 overflow-hidden rounded-xl border border-teal-200 bg-teal-50/40" aria-label="VisaThreads assistant">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 sm:p-5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-teal-100 text-teal-800"><Sparkles size={19} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-teal-950">{title ?? (scope.kind === 'post' ? 'Ask about this discussion' : scope.kind === 'community' ? 'Ask this community' : 'Ask VisaThreads')}</span><span className="mt-0.5 block text-xs leading-5 text-slate-600">Answers and summaries with links to the discussion.</span></span>
      <ChevronDown size={18} aria-hidden="true" className={`shrink-0 text-teal-700 ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div className="border-t border-teal-100 p-4 sm:p-5">
      <p className="mb-4 text-xs leading-5 text-slate-600">Uses community posts and replies, which may be outdated or disagree. Check official guidance before acting on visa rules. Keep personal documents and identifiers out of your question.</p>
      {demoMode ? <p className="text-sm text-slate-600">The assistant is unavailable in the local preview.</p> : checking || authLoading ? <p role="status" className="text-sm text-slate-600">Checking assistant availability…</p> : settingsError ? <p role="alert" className="text-sm text-slate-700">Assistant availability could not be checked. <button type="button" onClick={() => setRetry((value) => value + 1)} className="font-semibold text-teal-800 underline">Retry</button></p> : !available ? <p className="text-sm text-slate-600">{scope.kind === 'post' ? 'The discussion assistant is not available yet.' : 'Community search and catch-up are coming in a later rollout. You can ask about individual posts when their assistant is enabled.'}</p> : !user ? <p className="text-sm text-slate-700"><a href={`/login?next=${encodeURIComponent(pathname || '/assistant')}#sign-in`} className="font-semibold text-teal-800 underline">Sign in</a> to ask a question or summarize this discussion.</p> : <>
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Assistant task">
          <button type="button" aria-pressed={mode === 'ask'} onClick={() => { clearResponse(); setMode('ask'); }} className={`${controlClass} ${mode === 'ask' ? 'border-teal-500 text-teal-900' : ''}`}><MessageSquareText size={14} className="mr-1.5 inline" aria-hidden="true" />Ask a question</button>
          {scope.kind === 'post' && <button type="button" aria-pressed={mode === 'summary'} onClick={() => { clearResponse(); setMode('summary'); }} className={`${controlClass} ${mode === 'summary' ? 'border-teal-500 text-teal-900' : ''}`}>Summarize discussion</button>}
          {canCatchup && <button type="button" aria-pressed={mode === 'catchup'} onClick={() => { clearResponse(); setMode('catchup'); }} className={`${controlClass} ${mode === 'catchup' ? 'border-teal-500 text-teal-900' : ''}`}><Clock3 size={14} className="mr-1.5 inline" aria-hidden="true" />Catch me up</button>}
        </div>
        <form onSubmit={submit}>
          {mode === 'ask' ? <label className="block text-sm font-semibold text-slate-700">Your question<textarea value={question} onChange={(event) => { clearResponse(); setQuestion(event.target.value); }} required minLength={3} maxLength={1200} rows={3} placeholder={scope.kind === 'post' ? 'What did people report, and what is still unclear?' : 'Include your visa type, location, and relevant dates.'} className="mt-2 block w-full resize-y rounded-lg border border-slate-300 bg-white p-3 font-normal leading-6 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100" /></label> : mode === 'summary' ? <p className="text-sm leading-6 text-slate-600">Summarize the main points, different experiences, and unanswered questions in this post and its replies.</p> : <>
            <label className="block text-sm font-semibold text-slate-700">Time range<select value={period} onChange={(event) => { clearResponse(); setPeriod(event.target.value as Period); }} className={`ml-3 ${controlClass}`}><option value="hour">Past hour</option><option value="six-hours">Past 6 hours</option><option value="day">Past 24 hours</option><option value="week">Past 7 days</option><option value="last">Since last catch-up</option></select></label>
            <p className="mt-2 text-xs leading-5 text-slate-600">{period === 'last' ? staleCheckpoint ? 'Your previous catch-up is older than 31 days. Choose a recent time range to start a new catch-up.' : checkpoint ? `From ${dateLabel(checkpoint)}. Saved only on this browser after a complete catch-up.` : 'No previous catch-up on this browser. Choose a time range to start.' : 'Covers posts and replies in this time range. Try 1 or 6 hours in busy communities. A complete catch-up saves your checkpoint on this browser.'}</p>
          </>}
          <div className="mt-3 flex flex-wrap items-center gap-3"><button type="submit" disabled={!canSubmit} className="rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-teal-800 disabled:opacity-50">{busy ? 'Reading discussions…' : mode === 'ask' ? 'Get answer' : mode === 'summary' ? 'Create summary' : 'Create catch-up'}</button>
            {busy && <button type="button" onClick={clearResponse} className="text-sm font-semibold text-slate-600 underline">Cancel</button>}
            {!!previousQuestions.length && <button type="button" onClick={() => { clearResponse(); setQuestion(''); setPreviousQuestions([]); }} className="text-xs font-semibold text-slate-600 underline">Start a new question</button>}
          </div>
          {mode === 'ask' && !!previousQuestions.length && <p className="mt-2 text-xs text-slate-500">Follow-ups use your last {previousQuestions.length} question{previousQuestions.length === 1 ? '' : 's'} in this session. Your conversation is not saved on this browser.</p>}
        </form>
        {error && <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}{error.startsWith('Your session has expired') && <> <a href={`/login?next=${encodeURIComponent(pathname || '/assistant')}#sign-in`} className="font-semibold underline">Sign in</a></>}</p>}
        {result?.identity === identity && <Result result={result.value} catchup={mode === 'catchup'} />}
      </>}
    </div>}
  </section>;
}

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Inbox, RefreshCw } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES, feedbackError, getFeedbackHistory, getFeedbackInbox, reviewFeedback, type FeedbackAction, type FeedbackCursor, type FeedbackEvent, type FeedbackItem, type FeedbackStatus } from '@/lib/feedback';

const button = 'min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const sample: FeedbackItem = { id: 'local-preview', category: 'idea', message: 'Example only: make it easier to find recent H-1B experiences.', section: 'experiences', status: 'new', plan: '', plan_version: 0, approved_plan_version: null, approved_at: null, version: 1, created_at: '2026-10-13T12:00:00Z', updated_at: '2026-10-13T12:00:00Z' };

function FeedbackReviewCard({ item, disabled, demoMode, onReview }: { item: FeedbackItem; disabled: boolean; demoMode: boolean; onReview: (item: FeedbackItem, action: FeedbackAction, plan?: string) => Promise<void> }) {
  const [plan, setPlan] = useState(item.plan);
  const [history, setHistory] = useState<FeedbackEvent[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const edited = plan.trim() !== item.plan;
  async function loadHistory() {
    setHistoryBusy(true); setHistoryError('');
    try { setHistory(demoMode ? [] : await getFeedbackHistory(item.id)); }
    catch (error) { setHistory(null); setHistoryError(feedbackError(error)); }
    finally { setHistoryBusy(false); }
  }
  return <article className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">{FEEDBACK_CATEGORIES[item.category]}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.status === 'approved' || item.status === 'done' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{FEEDBACK_STATUSES[item.status]}</span></div>
    <p className="text-xs text-slate-500"><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time> · <span className="capitalize">{item.section}</span></p>
    <p className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm leading-6 [overflow-wrap:anywhere]">{item.message}</p>
    <details className="text-xs text-slate-500"><summary className="cursor-pointer">Feedback reference</summary><p className="mt-2 break-all">{item.id}</p></details>
    <div className="flex flex-wrap gap-2">
      {item.status === 'new' && <button className={button} disabled={disabled} onClick={() => void onReview(item, 'review')}>Start Review</button>}
      {item.status !== 'declined' && item.status !== 'done' && <button className={button} disabled={disabled} onClick={() => void onReview(item, 'decline')}>Not Planned</button>}
      {(item.status === 'declined' || item.status === 'done') && <button className={button} disabled={disabled} onClick={() => void onReview(item, 'reopen')}>Reopen</button>}
    </div>
    <form className="space-y-2 border-t border-slate-100 pt-4" onSubmit={event => { event.preventDefault(); void onReview(item, 'save_plan', plan); }}>
      <label htmlFor={`plan-${item.id}`} className="block text-sm font-semibold">Improvement Plan {item.plan_version > 0 ? `· v${item.plan_version}` : ''}</label>
      <p id={`plan-help-${item.id}`} className="text-xs leading-5 text-slate-500">Describe the change, alternatives, risks, effort, verification and rollback. Saving a revision clears any previous approval.</p>
      <textarea id={`plan-${item.id}`} aria-describedby={`plan-help-${item.id}`} minLength={20} maxLength={5000} required rows={4} value={plan} disabled={disabled} onChange={event => setPlan(event.target.value)} placeholder="Proposed change…\nAlternatives / effort…\nRisks, tests and rollback…" className="w-full rounded-lg border border-slate-300 p-3 text-sm"/>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={disabled || !edited || plan.trim().length < 20} type="submit">Save Plan for Review</button>
        {item.status === 'planned' && <button type="button" disabled={disabled || edited} className="min-h-10 rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => { if (window.confirm(`Approve plan v${item.plan_version} for implementation planning? This does not deploy a change.`)) void onReview(item, 'approve'); }}>Approve This Plan</button>}
        {item.status === 'approved' && <button type="button" disabled={disabled || edited} className={button} onClick={() => { if (window.confirm('Mark this plan completed only if the implementation has been separately reviewed, tested and released. Continue?')) void onReview(item, 'complete'); }}>Mark Completed</button>}
      </div>
      {edited && item.plan && <p className="text-xs text-amber-800">Unsaved revision. Save and review it before approval.</p>}
      {item.approved_at && <p className="text-xs text-emerald-800">Plan v{item.approved_plan_version} approved {new Date(item.approved_at).toLocaleString()}. Release remains a separate step.</p>}
    </form>
    <button type="button" disabled={historyBusy || disabled} onClick={() => void loadHistory()} className="text-sm text-blue-700 underline">{historyBusy ? 'Loading history…' : 'View Review History'}</button>
    {historyError && <p role="alert" className="text-sm text-rose-700">{historyError}</p>}
    {history && <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs"><p className="font-semibold">Review History · Latest 100 Events</p>{!history.length && <p>No review events yet.</p>}{history.map(event => <details key={event.id}><summary className="cursor-pointer">{new Date(event.created_at).toLocaleString()} · {event.action.replaceAll('_', ' ')} · Plan v{event.snapshot.plan_version}</summary><p className="mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{event.snapshot.plan || 'No plan saved.'}</p></details>)}</div>}
  </article>;
}

export function FeedbackInbox() {
  const { user, loading: authLoading, demoMode } = useAuth();
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [status, setStatus] = useState<FeedbackStatus | ''>('');
  const [cursor, setCursor] = useState<FeedbackCursor | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const writing = useRef(false);
  const load = useCallback(async (after: FeedbackCursor | null = null) => {
    if (!user) return;
    const request = ++generation.current;
    setBusy(true); setError('');
    try {
      const page = demoMode ? { items: !status || status === sample.status ? [sample] : [], more: false, cursor: null } : await getFeedbackInbox(status, after);
      if (request !== generation.current) return;
      setItems(previous => after ? [...previous, ...page.items.filter(item => !previous.some(old => old.id === item.id))] : page.items);
      setCursor(page.cursor); setMore(page.more); setAllowed(true);
    } catch (reason) {
      if (request === generation.current) { setItems([]); setCursor(null); setMore(false); setAllowed(false); setError(feedbackError(reason)); }
    } finally { if (request === generation.current) setBusy(false); }
  }, [user?.id, demoMode, status]);
  useEffect(() => {
    setItems([]); setAllowed(false); setNotice('');
    if (user) void load();
    return () => { generation.current++; };
  }, [load, user?.id]);
  async function review(item: FeedbackItem, action: FeedbackAction, plan = '') {
    if (writing.current) return;
    if (demoMode) { setNotice('Local preview only. No review decision was saved.'); return; }
    writing.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await reviewFeedback(item, action, plan);
      setNotice(action === 'approve' ? 'Plan approved. No code was changed or deployed.' : 'Review saved.');
      await load();
    } catch (reason) {
      if ((reason as { code?: string })?.code === '42501') { setItems([]); setAllowed(false); }
      setError(feedbackError(reason));
    } finally { writing.current = false; setBusy(false); }
  }
  return <main className="mx-auto max-w-4xl space-y-5 px-4 py-8">
    <div className="flex items-center gap-3"><span className="rounded-xl bg-slate-100 p-3 text-slate-700"><Inbox size={24} aria-hidden="true"/></span><div><h1 className="text-2xl font-bold">Feedback Inbox</h1><p className="mt-1 text-sm text-slate-500">Review suggestions and plan improvements.</p></div></div>
    {demoMode && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Local layout preview with sample feedback. No submissions are loaded and decisions are not saved.</p>}
    {authLoading ? <p role="status">Checking your account…</p> : !user ? <p className="text-sm">Sign in to continue. <Link href="/login?next=%2Fowner%2Ffeedback#sign-in" className="text-blue-700 underline">Log In</Link></p> : <>
      <div className="flex flex-wrap items-end gap-3"><div><label htmlFor="feedback-status" className="mb-1 block text-sm font-semibold">Review Status</label><select id="feedback-status" disabled={busy} value={status} onChange={event => setStatus(event.target.value as FeedbackStatus | '')} className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="">All Feedback</option>{Object.entries(FEEDBACK_STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><button disabled={busy} className={`${button} flex items-center gap-2`} onClick={() => void load()}><RefreshCw size={15} aria-hidden="true"/>Refresh Inbox</button></div>
      {notice && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">{notice}</p>}
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {busy && <p role="status" className="text-sm text-slate-500">Loading or saving feedback…</p>}
      {allowed && !items.length && !busy && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center"><h2 className="font-bold">{status ? 'Nothing in this review stage' : 'No Feedback Yet'}</h2><p className="mt-2 text-sm text-slate-500">Submissions from the Feedback button will arrive here.</p></div>}
      {allowed && items.map(item => <FeedbackReviewCard key={`${item.id}-${item.version}`} item={item} disabled={busy} demoMode={demoMode} onReview={review}/>)}
      {allowed && more && <button className={button} disabled={busy} onClick={() => void load(cursor)}>Load More Feedback</button>}
    </>}
  </main>;
}

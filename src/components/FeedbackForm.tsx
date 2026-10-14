'use client';

import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import { CheckCircle2, LockKeyhole } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { FEEDBACK_CATEGORIES, feedbackError, sendFeedback, type FeedbackCategory } from '@/lib/feedback';

export function FeedbackForm({ section = 'general' }: { section?: string }) {
  const { user, loading, demoMode } = useAuth();
  const id = useId();
  const [category, setCategory] = useState<FeedbackCategory>('idea');
  const [message, setMessage] = useState('');
  const [includeSection, setIncludeSection] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  const inFlight = useRef(false);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  async function submit() {
    if (!user || inFlight.current || message.trim().length < 10) return;
    inFlight.current = true; setBusy(true); setError('');
    const selectedSection = includeSection ? section : 'general';
    const fingerprint = JSON.stringify([category, message.trim(), selectedSection]);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    try {
      if (demoMode) setReceipt('local-preview');
      else setReceipt(await sendFeedback(request.current.id, category, message, selectedSection));
      setMessage('');
    } catch (reason) { setError(feedbackError(reason)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (loading) return <p role="status">Checking your account…</p>;
  if (receipt) return <div className="space-y-4 py-4" role="status">
    <CheckCircle2 className="text-emerald-700" size={30} aria-hidden="true" />
    <h2 className="text-xl font-bold">{demoMode ? 'Preview complete' : 'Thanks for helping us improve'}</h2>
    <p className="text-sm text-slate-600">{demoMode ? 'This is a local preview. Nothing was sent or stored.' : 'Your feedback was sent privately to the site owner. It will not appear in any public feed.'}</p>
    {!demoMode && <p className="break-all text-xs text-slate-500">Reference: {receipt}</p>}
    <button type="button" className="rounded-lg border px-4 py-2 text-sm font-semibold" onClick={() => { setReceipt(''); request.current = null; }}>Send another suggestion</button>
  </div>;
  return <div className="space-y-4">
    <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600"><LockKeyhole size={17} className="mt-0.5 shrink-0" aria-hidden="true" />Private to the site owner—not a public post or community message.</p>
    {!user ? <div className="space-y-4"><p className="text-sm text-slate-600">Please sign in to send feedback. This helps prevent spam.</p><Link href="/login?next=%2Ffeedback#sign-in" className="inline-flex rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white">Log In to Send Feedback</Link><p className="text-sm">Trouble signing in? <Link href="/contact" className="text-blue-700 underline">Contact us without an account</Link>.</p></div> : <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div><label htmlFor={`${id}-category`} className="mb-1 block text-sm font-semibold">What would you like to share?</label><select id={`${id}-category`} value={category} disabled={busy} onChange={event => setCategory(event.target.value as FeedbackCategory)} className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm">{Object.entries(FEEDBACK_CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div><label htmlFor={`${id}-message`} className="mb-1 block text-sm font-semibold">Your feedback</label><textarea id={`${id}-message`} required minLength={10} maxLength={3000} rows={5} value={message} disabled={busy} onChange={event => setMessage(event.target.value)} aria-describedby={`${id}-help ${id}-count`} placeholder="What happened, or what would make VisaThreads better?" className="w-full resize-y rounded-lg border border-slate-300 p-3 text-sm"/><div id={`${id}-count`} className="text-right text-xs text-slate-500">{message.length}/3,000 · at least 10 characters</div></div>
      <p id={`${id}-help`} className="text-xs leading-5 text-slate-500">We store your message, category, account ID and time so the owner can review it. Please do not include passwords, documents, case numbers or private conversations. No screenshots or browser logs are collected. <Link href="/feedback/privacy" target="_blank" rel="noopener" className="text-blue-700 underline">Feedback privacy details</Link>.</p>
      {section !== 'general' && <label className="flex items-start gap-2 text-sm text-slate-600"><input type="checkbox" checked={includeSection} disabled={busy} onChange={event => setIncludeSection(event.target.checked)} className="mt-1 accent-blue-700"/><span>Include section: <span className="font-semibold capitalize">{section}</span><span className="block text-xs text-slate-500">No page address, search text or conversation details.</span></span></label>}
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error} <Link href="/contact" className="underline">Contact us</Link></p>}
      {demoMode && <p className="text-xs text-amber-800">Local preview: this form does not send or save feedback.</p>}
      <button type="submit" disabled={busy || message.trim().length < 10} className="min-h-11 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">{busy ? 'Sending…' : 'Send Private Feedback'}</button>
    </form>}
  </div>;
}

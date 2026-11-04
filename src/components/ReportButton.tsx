'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase/client';
import { useAuth } from './AuthProvider';

export function ReportButton({ kind, target, username }: { kind: 'question' | 'answer' | 'imported_answer' | 'message' | 'member'; target: string; username?: string }) {
  const { user, demoMode } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);
  const scope = `${user?.id}:${kind}:${target}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const titleId = useId();
  useEffect(() => {
    currentScope.current = scope;
    setOpen(false); setStatus(''); setDetails(''); setReason('spam'); setBusy(false); lock.current = false;
    return () => { currentScope.current = ''; };
  }, [scope]);
  useEffect(() => {
    if (kind !== 'member' || !open) { dialog.current?.close(); return; }
    dialog.current?.showModal();
  }, [kind, open]);
  function close() { setOpen(false); dialog.current?.close(); trigger.current?.focus(); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !user || demoMode) return;
    lock.current = true; setBusy(true); setStatus('');
    const submittingScope = scope;
    try {
      const { error } = kind === 'member'
        ? await getSupabase().rpc('report_community_member', { conversation_id: target, report_reason: reason, report_details: details.trim() })
        : await getSupabase().rpc('report_community_content', { kind, target, report_reason: reason, report_details: details.trim() });
      if (error) throw error;
      if (currentScope.current === submittingScope) { setStatus('Report Submitted For Review.'); if (kind !== 'member') setOpen(false); }
    } catch { if (currentScope.current === submittingScope) setStatus('Could Not Submit The Report. Please Try Again Later.'); }
    finally { if (currentScope.current === submittingScope) { lock.current = false; setBusy(false); } }
  }
  if (demoMode) return null;
  if (kind === 'member') return <>
    <button ref={trigger} type="button" onClick={() => setOpen(true)} aria-label={`Report u/${username}`} className="shrink-0 rounded-full px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-rose-50 hover:text-rose-700">Report</button>
    <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }} onClose={() => setOpen(false)} className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl backdrop:bg-slate-950/45">
      <div className="flex items-start justify-between gap-3"><h2 id={titleId} className="min-w-0 break-words text-lg font-bold">Report u/{username}</h2><button type="button" onClick={close} className="rounded-lg border px-3 py-2 text-sm">Close</button></div>
      <p className="mt-3 text-sm leading-6 text-slate-600">This Shares The Account And Your Report Details With The Site Owner And Authorized Moderators. Your Conversation Is Not Included. Use Conversation Options To Report A Specific Message.</p>
      {open && <form onSubmit={submit} className="mt-4 space-y-4 text-sm">
        <label className="block font-semibold">Reason<select autoFocus value={reason} onChange={event => setReason(event.target.value)} className="mt-2 w-full rounded-lg border p-2.5"><option value="spam">Spam</option><option value="scam">Scam Or Impersonation</option><option value="harassment">Harassment</option><option value="personal-information">Exposed Personal Information</option><option value="other">Other</option></select></label>
        <label className="block font-semibold">Details (Optional)<textarea value={details} maxLength={1000} rows={3} onChange={event => setDetails(event.target.value)} className="mt-2 w-full rounded-lg border p-2.5"/></label>
        <button disabled={busy || status === 'Report Submitted For Review.'} className="rounded-full bg-teal-700 px-4 py-2.5 font-semibold text-white disabled:opacity-50">{busy ? 'Submitting…' : 'Submit Report'}</button>
        {status && <p role="status" className="rounded-lg bg-slate-50 p-3">{status}</p>}
      </form>}
    </dialog>
  </>;
  return <div className="text-xs text-slate-600">
    <button onClick={() => setOpen(!open)} aria-expanded={open} className="rounded px-1 py-1 underline hover:text-rose-700 capitalize">Report</button>
    {open && (!user ? <p className="capitalize"><Link href="/login" className="text-blue-700 underline capitalize">Log In to report content</Link></p> :
      <form onSubmit={submit} className="mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 text-slate-800 shadow-sm">
        <label className="block font-bold capitalize">Reason<select value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded border p-2">
          <option value="spam" className="capitalize">Spam</option><option value="harassment" className="capitalize">Harassment</option><option value="personal-information" className="capitalize">Exposed personal information</option><option value="scam" className="capitalize">Scam or impersonation</option><option value="other" className="capitalize">Other</option>
        </select></label>
        <label className="mt-2 block capitalize">Details (optional)<textarea value={details} maxLength={1000} onChange={(event) => setDetails(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
        {kind === 'message' && <p className="my-2 capitalize">Reporting shares this message with authorized moderators, not your entire conversation.</p>}
        <button disabled={busy} className="rounded bg-slate-900 px-3 py-2 font-bold text-white disabled:opacity-50 capitalize">{busy ? 'Submitting…' : 'Submit report'}</button>
      </form>)}
    {status && <p role="status" className="mt-1 max-w-64">{status}</p>}
  </div>;
}

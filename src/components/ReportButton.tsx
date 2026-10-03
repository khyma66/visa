'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase/client';
import { useAuth } from './AuthProvider';

export function ReportButton({ kind, target }: { kind: 'question' | 'answer' | 'imported_answer' | 'message'; target: string }) {
  const { user, demoMode } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setStatus('');
    try {
      const { error } = await getSupabase().rpc('report_community_content', { kind, target, report_reason: reason, report_details: details.trim() });
      if (error) throw error;
      setStatus('Report submitted for review.'); setOpen(false);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not submit the report.'); }
    finally { setBusy(false); }
  }
  if (demoMode) return null;
  return <div className="text-xs text-slate-600">
    <button onClick={() => setOpen(!open)} aria-expanded={open} className="rounded px-1 py-1 underline hover:text-rose-700">Report</button>
    {open && (!user ? <p><Link href="/login" className="text-teal-700 underline">Log in to report content</Link></p> :
      <form onSubmit={submit} className="mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 text-slate-800 shadow-sm">
        <label className="block font-bold">Reason<select value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded border p-2">
          <option value="spam">Spam</option><option value="harassment">Harassment</option><option value="personal-information">Exposed personal information</option><option value="scam">Scam or impersonation</option><option value="other">Other</option>
        </select></label>
        <label className="mt-2 block">Details (optional)<textarea value={details} maxLength={1000} onChange={(event) => setDetails(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
        {kind === 'message' && <p className="my-2">Reporting shares this message with authorized moderators, not your entire conversation.</p>}
        <button disabled={busy} className="rounded bg-slate-900 px-3 py-2 font-bold text-white disabled:opacity-50">{busy ? 'Submitting…' : 'Submit report'}</button>
      </form>)}
    {status && <p role="status" className="mt-1 max-w-64">{status}</p>}
  </div>;
}

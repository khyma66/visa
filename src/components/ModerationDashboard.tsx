'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthProvider';
import { getSupabase } from '@/lib/supabase/client';
import { SpamDomainControls } from './SpamDomainControls';

type Report = { id: string; target_kind: string; reason: string; details: string; source?: string; content: string | null; created_at: string };
const button = 'rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50';

function ReportQueue() {
  const [reports, setReports] = useState<Report[]>([]);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const generation = useRef(0);
  const lock = useRef(false);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setBusy(true); setError('');
    try {
      const { data, error } = await getSupabase().rpc('community_moderation_queue');
      if (error) throw error;
      if (request === generation.current) { setReports(data ?? []); setAllowed(true); }
    } catch {
      if (request === generation.current) { setReports([]); setAllowed(false); setError('Reports Could Not Be Loaded. Owner Or Approved Moderator Access Is Required.'); }
    } finally { if (request === generation.current) setBusy(false); }
  }, []);
  useEffect(() => { void load(); return () => { ++generation.current; }; }, [load]);
  async function resolve(report: Report, decision: 'dismissed' | 'removed' | 'suspended', suspend = false) {
    if (lock.current || busy) return;
    if ((suspend || decision === 'suspended') && !window.confirm(report.target_kind === 'member'
      ? `Suspend ${report.content ?? 'This Member'} From Posting And Sending Messages?`
      : 'Remove This Content And Suspend Its Author From Posting And Sending Messages?')) return;
    lock.current = true; setBusy(true); setError('');
    const request = generation.current;
    try {
      const { error } = await getSupabase().rpc('moderate_community_report', { report_id: report.id, decision, suspend_author: suspend });
      if (error) throw error;
      if (request === generation.current) await load();
    } catch {
      if (request === generation.current) setError('Could Not Resolve This Report. Refresh To Check Its Current Status.');
    } finally { lock.current = false; if (request === generation.current) setBusy(false); }
  }
  return <>
    <div className="my-6 flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-sm font-semibold text-slate-600">{busy ? 'Checking Access And Loading Reports…' : allowed ? `${reports.length}${reports.length === 50 ? '+' : ''} Pending Reports` : 'Restricted Access'}</p><button disabled={busy} onClick={() => void load()} className={button}>Refresh Reports</button></div>
    {error && <p role="alert" className="mb-5 rounded-lg bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
    {allowed && <>
      <SpamDomainControls />
      {!reports.length && <div className="rounded-xl border bg-white p-8 text-center text-slate-600">No Pending Reports.</div>}
      {reports.map(report => <article key={report.id} className="mb-5 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold capitalize">{report.target_kind === 'member' ? 'Member Report' : report.target_kind === 'imported_answer' ? 'Archive Reply Report' : `${report.target_kind.replaceAll('_', ' ')} Report`} · {report.reason.replaceAll('-', ' ')}</h2><time dateTime={report.created_at} className="text-xs text-slate-500">{new Date(report.created_at).toLocaleString()}</time></div>
        <p className="mt-2 text-xs text-slate-500">{report.source === 'automatic' ? 'Automatic Screening — Review The Context' : 'Member Report'}</p>
        <p className="my-4 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4">{report.content ?? 'Account Or Content No Longer Available.'}</p>
        {report.target_kind === 'member' && <p className="mb-3 text-xs text-slate-500">Account Report Only. Private Conversation History Is Not Included.</p>}
        <p className="mb-4 whitespace-pre-wrap break-words text-sm"><strong>Reporter Details: </strong>{report.details || 'None Provided.'}</p>
        <div className="flex flex-wrap gap-3">
          <button disabled={busy} onClick={() => void resolve(report, 'dismissed')} className={button}>Dismiss</button>
          {report.target_kind === 'member' ? <button disabled={busy || !report.content} onClick={() => void resolve(report, 'suspended')} className={`${button} border-rose-300 text-rose-800`}>Suspend Member</button> : <>
            <button disabled={busy} onClick={() => void resolve(report, 'removed')} className={`${button} bg-rose-700 text-white`}>Remove Content</button>
            <button disabled={busy} onClick={() => void resolve(report, 'removed', true)} className={`${button} border-rose-300 text-rose-800`}>Remove And Suspend Author</button>
          </>}
        </div>
      </article>)}
      {reports.length === 50 && <p className="text-sm text-slate-500">Showing The Oldest 50 Reports. Resolve These To See The Next Batch.</p>}
    </>}
  </>;
}

export function ModerationDashboard() {
  const { user, demoMode, loading } = useAuth();
  return <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold tracking-wide text-teal-800">Admin Workspace</p><h1 className="mt-2 text-3xl font-bold">Reports</h1></div><nav aria-label="Admin Dashboards" className="flex flex-wrap gap-2"><Link href="/admin/analytics" className={button}>Dashboard</Link><Link href="/admin/members" className={button}>Members</Link></nav></header>
    <p className="mt-4 rounded-xl border bg-slate-50 p-4 text-sm leading-6 text-slate-600">Private Review For The Site Owner And Approved Moderators. Reports Do Not Automatically Suspend Members Or Remove Content.</p>
    {loading ? <p role="status" className="mt-5">Checking Your Account…</p> : !user || demoMode ? <Link href="/login?next=%2Fadmin%2Freports#sign-in" className="mt-6 inline-block font-semibold text-teal-800 underline">Log In With An Approved Account</Link> : <ReportQueue key={user.id}/>}
  </main>;
}

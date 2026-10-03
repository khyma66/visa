'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase/client';

type Report = { id: string; target_kind: string; reason: string; details: string; content: string; created_at: string };
export default function ModerationPage() {
  const { user, demoMode, loading } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await getSupabase().rpc('community_moderation_queue');
    if (error) throw error;
    setReports(data ?? []); setAllowed(true);
  }, []);
  useEffect(() => {
    setAllowed(false); setReports([]);
    if (user && !demoMode) void load().catch(() => setError('Moderator access is required.'));
  }, [user?.id, demoMode, load]);
  async function resolve(id: string, decision: string, suspend = false) {
    if (suspend && !window.confirm('Remove this content and suspend its author from posting and sending messages?')) return;
    setBusy(true); setError('');
    try {
      const { error } = await getSupabase().rpc('moderate_community_report', { report_id: id, decision, suspend_author: suspend });
      if (error) throw error;
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not resolve report.'); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-4xl px-4 py-10">
    <h1 className="text-3xl font-black">Moderation queue</h1>
    <p className="mt-3 text-sm text-slate-600">Restricted to operator-approved moderators. Review reports individually; reporting does not automatically remove content.</p>
    {loading ? <p>Loading…</p> : !user || demoMode ? <p className="mt-5">Log in with an approved moderator account.</p> : allowed && <>
      <button disabled={busy} onClick={() => void load().catch(() => setError('Could not refresh reports.'))} className="my-5 rounded border px-4 py-2">Refresh reports</button>
      {!reports.length && <p>No pending reports.</p>}
      {reports.map((report) => <article key={report.id} className="mb-5 rounded-xl border bg-white p-5">
        <h2 className="font-bold">{report.target_kind} · {report.reason}</h2>
        <p className="mt-1 text-xs text-slate-500">{new Date(report.created_at).toLocaleString()}</p>
        <p className="my-4 whitespace-pre-wrap break-words rounded bg-slate-50 p-3">{report.content ?? 'Content no longer available.'}</p>
        <p className="mb-4 whitespace-pre-wrap text-sm">Reporter details: {report.details || 'None'}</p>
        <div className="flex flex-wrap gap-3">
          <button disabled={busy} onClick={() => void resolve(report.id,'dismissed')} className="rounded border px-3 py-2">Dismiss</button>
          <button disabled={busy} onClick={() => void resolve(report.id,'removed')} className="rounded bg-rose-700 px-3 py-2 text-white">Remove content</button>
          <button disabled={busy} onClick={() => void resolve(report.id,'removed',true)} className="rounded border border-rose-300 px-3 py-2 text-rose-800">Remove + suspend author</button>
        </div>
      </article>)}
      {reports.length === 50 && <p>Showing the oldest 50 reports. Resolve these to see the next batch.</p>}
    </>}
    {error && <p role="alert" className="mt-4 rounded bg-rose-50 p-3 text-rose-700">{error}</p>}
  </main>;
}

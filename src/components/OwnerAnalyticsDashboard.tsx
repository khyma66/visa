'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BarChart3, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { getSupabase } from '@/lib/supabase/client';
import type { AnalyticsPeriod, AnalyticsResponse } from '@/lib/analytics-types';

const tabs = ['Overview', 'Community', 'Imports', 'Operations'] as const;
const button = 'min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50';
const stamp = (value: string | null) => value ? new Date(value).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }) + ' UTC' : 'Not available';
function Card({ label, value, hint }: { label: string; value: number | string | null; hint: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-5"><dt className="text-sm font-semibold text-slate-600">{label}</dt><dd className="mt-3 text-3xl font-bold tabular-nums text-slate-950">{value === null ? '—' : typeof value === 'number' ? value.toLocaleString() : value}</dd><p className="mt-2 text-xs leading-5 text-slate-500">{hint}</p></div>;
}

export function OwnerAnalyticsDashboard() {
  const { user, loading: authLoading, demoMode } = useAuth();
  const [days, setDays] = useState<AnalyticsPeriod>(30);
  const [tab, setTab] = useState<typeof tabs[number]>('Overview');
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setData(null); setError('');
    if (!user || demoMode) return;
    const controller = new AbortController();
    setBusy(true);
    void (async () => {
      try {
        const { data: session, error: sessionError } = await getSupabase().auth.getSession();
        if (controller.signal.aborted) return;
        if (sessionError || !session.session?.access_token) throw new Error('Please sign in again.');
        const response = await fetch(`/api/admin/analytics?days=${days}`, { headers: { Authorization: `Bearer ${session.session.access_token}` }, cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(18000)]) });
        const result = await response.json() as AnalyticsResponse & { error?: unknown };
        if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Metrics are unavailable.');
        if (!controller.signal.aborted) setData(result as AnalyticsResponse);
      } catch (reason) {
        if (!controller.signal.aborted) { setData(null); setError(reason instanceof Error ? reason.message : 'Metrics are unavailable.'); }
      } finally { if (!controller.signal.aborted) setBusy(false); }
    })();
    return () => { controller.abort(); };
  }, [user?.id, demoMode, days, retry]);

  return <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-teal-800"><ShieldCheck size={16} aria-hidden="true"/>Owner workspace</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Community dashboard</h1><p className="mt-2 text-sm text-slate-600">Real activity, content freshness, and launch readiness.</p></div><Link href="/owner/feedback" className={button}>Feedback inbox</Link></header>
    <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">Private, aggregate-only reporting. No messages, email addresses, visitor tracking, or paid analytics services are collected by this dashboard.</p>
    {authLoading ? <p role="status">Checking your account…</p> : demoMode ? <p role="status">Connect a real owner account to view metrics. Sample activity is never presented as live data.</p> : !user ? <div className="rounded-xl border border-slate-200 p-6"><h2 className="font-bold">Owner sign-in required</h2><p className="mt-2 text-sm text-slate-600">Only the designated owner can access these reports.</p><Link href="/login?next=%2Fadmin%2Fanalytics#sign-in" className="mt-4 inline-block rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Log in</Link></div> : <>
      <div className="flex flex-wrap items-end justify-between gap-4"><div><label htmlFor="analytics-days" className="mb-1 block text-sm font-semibold">Reporting period</label><select id="analytics-days" value={days} onChange={event => setDays(Number(event.target.value) as AnalyticsPeriod)} className={button}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select><p className="mt-1 text-xs text-slate-500">UTC calendar days, including today so far</p></div><button className={`${button} flex items-center gap-2`} disabled={busy} onClick={() => setRetry(value => value + 1)}><RefreshCw size={15} aria-hidden="true"/>{busy ? 'Refreshing…' : 'Refresh'}</button></div>
      {busy && <p role="status" className="text-sm text-slate-500">Verifying access and loading current metrics…</p>}
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error} No stale or placeholder totals are shown.</p>}
      {data && <>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>Updated {stamp(data.metrics.generated_at)}</span><span>{stamp(data.metrics.window.start_inclusive)} → {stamp(data.metrics.window.end_exclusive)}</span></div>
        <nav aria-label="Dashboard sections" className="flex gap-1 overflow-x-auto border-b border-slate-200">{tabs.map(name => <button key={name} aria-current={tab === name ? 'page' : undefined} onClick={() => setTab(name)} className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold ${tab === name ? 'border-teal-700 text-teal-900' : 'border-transparent text-slate-500'}`}>{name}</button>)}</nav>
        {tab === 'Overview' && <section className="space-y-5" aria-label="Overview"><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card label="New members" value={data.metrics.overview.members_joined} hint="Eligible retained member accounts created in this period."/>
          <Card label="Distinct contributors" value={data.metrics.overview.distinct_contributors} hint="Unique members who posted or replied; not a sum of daily counts."/>
          <Card label="Questions" value={data.metrics.overview.questions_created} hint="Member-created questions, excluding imported source posts."/>
          <Card label="Experiences" value={data.metrics.overview.experiences_created} hint="Member-created visa experiences."/>
          <Card label="Native replies" value={data.metrics.overview.answers_created} hint="Member replies to native posts."/>
          <Card label="Replies to imported posts" value={data.metrics.overview.imported_replies_created} hint="Replies written here, not comments scraped elsewhere."/>
        </dl><div className="rounded-xl border border-slate-200 p-5"><h2 className="flex items-center gap-2 font-bold"><BarChart3 size={18} aria-hidden="true"/>Traffic analytics</h2><p className="mt-2 text-sm leading-6 text-slate-600">Visitor analytics is not integrated. Community totals come from Supabase, not page views. Use the existing provider dashboards for infrastructure usage; do not interpret missing traffic data as zero.</p><a href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-semibold text-teal-800 underline">Open Cloudflare dashboard</a></div></section>}
        {tab === 'Community' && <section className="space-y-5" aria-label="Community quality"><dl className="grid gap-4 sm:grid-cols-3"><Card label="Human answer rate" value={data.metrics.quality.answer_rate_percent === null ? null : `${data.metrics.quality.answer_rate_percent}%`} hint="Eligible questions created in this period with an eligible human reply by report time."/><Card label="First human answer" value={data.metrics.quality.median_first_answer_hours === null ? null : `${data.metrics.quality.median_first_answer_hours.toFixed(1)} hours`} hint="Median among answered questions; unanswered questions are not treated as zero."/><Card label="Currently unanswered" value={data.metrics.quality.unanswered_questions_current} hint="Current inventory across all time, not a historical event total."/></dl><div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-left text-sm"><caption className="p-4 text-left font-semibold">Daily retained activity · UTC</caption><thead className="bg-slate-50 text-slate-600"><tr>{['Date', 'Members', 'Questions', 'Experiences', 'Native replies', 'Imported replies', 'Contributors'].map(label => <th key={label} className="whitespace-nowrap px-4 py-3 font-semibold">{label}</th>)}</tr></thead><tbody>{data.metrics.daily.map(row => <tr key={row.date} className="border-t border-slate-100"><th scope="row" className="whitespace-nowrap px-4 py-3 font-medium">{row.date}</th>{[row.members_joined, row.questions_created, row.experiences_created, row.answers_created, row.imported_replies_created, row.distinct_contributors].map((value, index) => <td key={index} className="px-4 py-3 tabular-nums">{value}</td>)}</tr>)}</tbody></table></div></section>}
        {tab === 'Imports' && <section className="space-y-5" aria-label="Import health"><p className={`rounded-xl border p-4 text-sm leading-6 ${data.imports.stale ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-teal-200 bg-teal-50 text-teal-950'}`}>{data.imports.stale ? 'Freshness needs attention.' : 'The snapshot contains recent source posts.'} Warning threshold: newest post older than {data.imports.staleAfterHours} hours, missing dates, or invalid dates. This is a snapshot check—not confirmation of a new Apify run or database import.</p><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Card label="Source posts" value={data.imports.posts} hint={data.imports.mode}/><Card label="Newest original post" value={stamp(data.imports.newestPostAt)} hint="Original posting time is preserved; importing does not make an old post new."/><Card label="Snapshot captured" value={stamp(data.imports.capturedAt)} hint="Recorded capture time, not the current request time."/><Card label="Duplicate items" value={data.imports.duplicates} hint="As recorded by the snapshot importer."/><Card label="Empty items rejected" value={data.imports.rejected} hint="Not a complete moderation rejection count."/><Card label="Invalid or future dates" value={data.imports.invalidDates} hint="Require review before trusting freshness."/></dl><p className="text-sm leading-6 text-slate-600">Newest sorting cannot fetch missing posts. Import scheduling remains unchanged. Related-post relevance needs a labeled sample review; it is not inferred from shared tags alone.</p></section>}
        {tab === 'Operations' && <section className="space-y-5" aria-label="Operations"><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Card label="Reports received" value={data.metrics.operations.reports_received} hint="Retained reports submitted in the selected period."/><Card label="Reports pending" value={data.metrics.operations.reports_pending_current} hint="Current moderation workload."/><Card label="Feedback received" value={data.metrics.operations.feedback_received} hint="Retained submissions in the selected period."/><Card label="Feedback pending" value={data.metrics.operations.feedback_pending_current} hint="Current feedback awaiting completion or closure."/></dl><div className="rounded-xl border border-slate-200 p-5"><h2 className="font-bold">Launch evidence</h2><p className="mt-2 text-sm leading-6 text-slate-600">Environment: {data.release.environment}. Public launch approval: {data.release.publicLaunchApproved ? 'configured' : 'not granted'}. The checklist below is the saved release record, not a fresh audit or approval. Backup restoration, credential rotation, account recovery, legal review and human acceptance need current evidence.</p><ul className="mt-4 divide-y divide-slate-100">{data.release.checks.map(check => <li key={check.key} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span className="capitalize">{check.key.replaceAll('_', ' ')}</span><span className={`font-semibold ${check.status === 'verified' ? 'text-teal-800' : 'text-amber-800'}`}>{check.status}</span></li>)}</ul></div></section>}
        <details className="rounded-xl border border-slate-200 p-4 text-sm text-slate-600"><summary className="cursor-pointer font-semibold">Metric definitions and limitations</summary><ul className="mt-3 list-disc space-y-2 pl-5">{data.metrics.limitations.map(item => <li key={item}>{item}</li>)}<li>Owner, moderator and explicitly excluded accounts are not counted as member traction. Unknown test accounts must be designated before trusting totals.</li><li>No D7 retention, revenue, AI savings or visitor counts are fabricated from unavailable history.</li></ul></details>
      </>}
    </>}
  </main>;
}

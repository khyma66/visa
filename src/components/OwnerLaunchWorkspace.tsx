'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ClipboardList, Plus, RefreshCw, X } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { getLaunchHistory, getLaunchWorkspace, saveLaunchExperiment, updateLaunchTask } from '@/lib/launch-client';
import { EXPERIMENT_DECISIONS, LAUNCH_STATUSES, LAUNCH_TASK_DEFINITIONS, experimentEconomics, launchWorkspaceError, unmetTaskDependencies, type LaunchExperiment, type LaunchExperimentInput, type LaunchHistoryEvent, type LaunchStatus, type LaunchTask, type LaunchWorkspace } from '@/lib/launch-workspace';

const control = 'min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-50';
const button = `${control} font-semibold hover:bg-slate-50`;
const primary = 'min-h-11 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50';
const money = (value: number | null) => value === null ? 'Unknown' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const stamp = (value: string) => new Date(value).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }) + ' UTC';

function History({ kind, id, demo }: { kind: 'task' | 'experiment'; id: string; demo: boolean }) {
  const [events, setEvents] = useState<LaunchHistoryEvent[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function load() {
    setBusy(true); setError('');
    try { const result = demo ? [] : await getLaunchHistory(kind, id); if (active.current) setEvents(result); }
    catch (reason) { if (active.current) { setEvents(null); setError(launchWorkspaceError(reason)); } }
    finally { if (active.current) setBusy(false); }
  }
  return <div className="space-y-2"><button type="button" className="min-h-10 text-sm text-blue-700 underline" disabled={busy} onClick={() => void load()}>{busy ? 'Loading history…' : 'Review history'}</button>{error && <p role="alert" className="text-sm text-rose-700">{error}</p>}{events && <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm"><p className="font-semibold">Latest 100 saved revisions</p>{!events.length && <p>No revisions yet.</p>}{events.map(event => <details key={event.id}><summary className="cursor-pointer">{stamp(event.created_at)} · {event.action.replaceAll('_', ' ')} · v{event.snapshot.version}</summary><p className="mt-2 whitespace-pre-wrap break-words">{'evidence' in event.snapshot ? event.snapshot.evidence || 'No evidence recorded.' : event.snapshot.notes || event.snapshot.hypothesis}</p></details>)}</div>}</div>;
}

function TaskCard({ task, tasks, demo, onSaved }: { task: LaunchTask; tasks: LaunchTask[]; demo: boolean; onSaved: (saved: LaunchTask) => void }) {
  const [status, setStatus] = useState(task.status);
  const [evidence, setEvidence] = useState(task.evidence);
  const [assignee, setAssignee] = useState(task.assigned_to);
  const [due, setDue] = useState(task.due_on ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const missing = unmetTaskDependencies(task, tasks);
  const saving = useRef(false);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (saving.current || demo) return;
    saving.current = true; setBusy(true); setError('');
    try { const saved = await updateLaunchTask(task, { status, evidence, assigned_to: assignee, due_on: due || null }); onSaved(saved); }
    catch (reason) { setError(launchWorkspaceError(reason)); }
    finally { saving.current = false; setBusy(false); }
  }
  return <details id={`task-${task.id}`} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
    <summary className="cursor-pointer marker:text-slate-400"><span className="ml-1 inline-flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-2 align-middle"><span className={`rounded px-2 py-1 text-xs font-bold ${task.priority === 'P0' ? 'bg-orange-50 text-orange-900' : 'bg-slate-100 text-slate-600'}`}>{task.priority} · {task.id}</span><span className="font-semibold">{task.title}</span><span className={`text-sm ${task.status === 'done' ? 'text-teal-800' : 'text-slate-500'}`}>{LAUNCH_STATUSES[task.status]}</span></span></summary>
    <div className="mt-4 space-y-4"><p className="text-sm leading-6 text-slate-600">{task.acceptance}</p>
      {task.dependencies.length > 0 && <p className="text-sm text-slate-600">Prerequisites: {task.dependencies.map((id, index) => <span key={id}>{index > 0 && ', '}<a href={`#task-${id}`} className="text-blue-700 underline">{id}</a>{tasks.find(row => row.id === id)?.status === 'done' ? ' ✓' : ' · open'}</span>)}</p>}
      <form onSubmit={event => void save(event)} className="space-y-3"><fieldset disabled={busy || demo} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3"><label className="text-sm font-semibold">Status<select value={status} onChange={event => setStatus(event.target.value as LaunchStatus)} className={`${control} mt-1 block w-full`}>{Object.entries(LAUNCH_STATUSES).map(([key, label]) => <option key={key} value={key} disabled={key === 'done' && missing.length > 0}>{label}</option>)}</select></label><label className="text-sm font-semibold">Assigned to<input value={assignee} maxLength={80} placeholder="Owner / role" onChange={event => setAssignee(event.target.value)} className={`${control} mt-1 w-full`}/></label><label className="text-sm font-semibold">Due date<input type="date" min="2000-01-01" max="2100-12-31" value={due} onChange={event => setDue(event.target.value)} className={`${control} mt-1 w-full`}/></label></div>
        <label className="block text-sm font-semibold">Evidence and next action<textarea value={evidence} onChange={event => setEvidence(event.target.value)} rows={3} maxLength={5000} minLength={status === 'done' ? 20 : undefined} required={status === 'done'} className={`${control} mt-1 w-full`} placeholder="What was checked, when, result and an evidence reference. No credentials or private member information."/></label>
        {missing.length > 0 && <p className="text-xs text-slate-500">Complete {missing.join(', ')} before marking this done.</p>}
        <button className={primary} type="submit">{busy ? 'Saving…' : 'Save task'}</button>
      </fieldset>{error && <p role="alert" className="text-sm text-rose-700">{error}</p>}</form>
      <p className="text-xs text-slate-500">Revision {task.version}{task.updated_at && ` · Updated ${stamp(task.updated_at)}`}{task.completed_at && ` · Completed ${stamp(task.completed_at)}`}</p>
      <History kind="task" id={task.id} demo={demo}/>
    </div>
  </details>;
}

function ExperimentEditor({ item, onClose, onSaved }: { item: LaunchExperiment | null; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [id] = useState(() => item?.id ?? crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const [title, setTitle] = useState(item?.title ?? '');
  const [hypothesis, setHypothesis] = useState(item?.hypothesis ?? '');
  const [start, setStart] = useState(item?.start_on ?? '');
  const [end, setEnd] = useState(item?.end_on ?? '');
  const [cash, setCash] = useState(String(item?.cash_cost_usd ?? 0));
  const [hours, setHours] = useState(String(item?.founder_hours ?? 0));
  const [rate, setRate] = useState(String(item?.hour_value_usd ?? 0));
  const [benefit, setBenefit] = useState(item?.attributable_contribution_usd == null ? '' : String(item.attributable_contribution_usd));
  const [decision, setDecision] = useState(item?.decision ?? 'observe');
  const [notes, setNotes] = useState(item?.notes ?? '');
  useEffect(() => { dialog.current?.showModal(); return () => { dialog.current?.close(); }; }, []);
  const input: LaunchExperimentInput = { title, hypothesis, start_on: start, end_on: end, cash_cost_usd: Number(cash), founder_hours: Number(hours), hour_value_usd: Number(rate), attributable_contribution_usd: benefit.trim() === '' ? null : Number(benefit), decision, notes };
  let economics: ReturnType<typeof experimentEconomics> | null = null;
  try { economics = experimentEconomics(input); } catch { /* Form validation explains invalid input on submit. */ }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try { await saveLaunchExperiment(id, item?.version ?? 0, input); onSaved(); }
    catch (reason) { setError(launchWorkspaceError(reason)); }
    finally { saving.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} aria-labelledby="experiment-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl backdrop:bg-slate-950/45 sm:p-6">
    <div className="flex items-start justify-between gap-3"><h2 id="experiment-title" className="text-xl font-semibold">{item ? 'Review experiment' : 'New experiment'}</h2><button type="button" autoFocus onClick={onClose} disabled={busy} aria-label="Close experiment" className="grid h-11 w-11 place-items-center rounded-full hover:bg-slate-100"><X size={20}/></button></div>
    <p className="mt-2 text-sm leading-6 text-slate-600">Amounts are USD. Record observed costs and results. Leave attributable contribution blank when it is unknown; do not count forecast revenue as collected revenue.</p>
    <form onSubmit={event => void save(event)} className="mt-5 space-y-4"><fieldset disabled={busy} className="space-y-4">
      <label className="block text-sm font-semibold">Experiment title *<input required minLength={3} maxLength={160} value={title} onChange={event => setTitle(event.target.value)} className={`${control} mt-1 w-full`}/></label>
      <label className="block text-sm font-semibold">Hypothesis and success measure *<textarea required minLength={10} maxLength={2000} rows={3} value={hypothesis} onChange={event => setHypothesis(event.target.value)} className={`${control} mt-1 w-full`} placeholder="Audience, change, baseline and the result that would justify continuing…"/></label>
      <div className="grid grid-cols-2 gap-3"><label className="text-sm font-semibold">Start date *<input required type="date" value={start} min="2000-01-01" max={end || '2100-12-31'} onChange={event => setStart(event.target.value)} className={`${control} mt-1 w-full`}/></label><label className="text-sm font-semibold">Review date *<input required type="date" min={start || '2000-01-01'} max="2100-12-31" value={end} onChange={event => setEnd(event.target.value)} className={`${control} mt-1 w-full`}/></label></div>
      <div className="grid gap-3 sm:grid-cols-3">{[{label:'Experiment cash cost',value:cash,set:setCash,max:1000000000},{label:'Founder hours',value:hours,set:setHours,max:100000},{label:'Value per hour (USD)',value:rate,set:setRate,max:100000}].map(field => <label key={field.label} className="text-sm font-semibold">{field.label} *<input required type="number" min="0" step="0.01" max={field.max} value={field.value} onChange={event => field.set(event.target.value)} className={`${control} mt-1 w-full`}/></label>)}</div>
      <label className="block text-sm font-semibold">Realized attributable contribution (USD)<input type="number" step="0.01" min="-1000000000" max="1000000000" value={benefit} onChange={event => setBenefit(event.target.value)} placeholder="Unknown" className={`${control} mt-1 w-full`}/><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">Collected revenue minus customer-linked fees, AI, support and refunds. Do not count these same costs again in experiment cash cost. A negative amount is allowed.</span></label>
      {economics && <dl className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 text-sm"><div><dt>Cash contribution</dt><dd className="mt-1 font-bold tabular-nums">{money(economics.cash_contribution_usd)}</dd></div><div><dt>After founder time</dt><dd className="mt-1 font-bold tabular-nums">{money(economics.economic_contribution_usd)}</dd></div><div><dt>Total experiment cost</dt><dd className="mt-1 font-semibold">{money(economics.total_cost_usd)}</dd></div><div><dt>Economic ROI</dt><dd className="mt-1 font-semibold">{economics.economic_roi_percent === null ? 'Not measurable yet' : `${economics.economic_roi_percent}%`}</dd></div></dl>}
      <label className="block text-sm font-semibold">Decision<select value={decision} onChange={event => setDecision(event.target.value as LaunchExperimentInput['decision'])} className={`${control} mt-1 block w-full`}>{Object.entries(EXPERIMENT_DECISIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="block text-sm font-semibold">Observed results, evidence and uncertainty<textarea rows={3} maxLength={5000} value={notes} onChange={event => setNotes(event.target.value)} className={`${control} mt-1 w-full`} placeholder="What happened, attribution limits, evidence references and the next action. No member information or secrets."/></label>
      <button className={primary} type="submit">{busy ? 'Saving…' : 'Save experiment'}</button>
    </fieldset>{error && <p role="alert" className="text-sm text-rose-700">{error}</p>}</form>
  </dialog>;
}

function Workspace({ demo }: { demo: boolean }) {
  const params = useSearchParams();
  const [tab, setTab] = useState<'tasks' | 'experiments'>(params.get('tab') === 'experiments' ? 'experiments' : 'tasks');
  const [data, setData] = useState<LaunchWorkspace | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState<'all' | 'P0' | 'open'>('all');
  const [editor, setEditor] = useState<LaunchExperiment | 'new' | null>(null);
  const refresh = () => setRevision(value => value + 1);
  useEffect(() => {
    let active = true; setBusy(true); setError('');
    if (demo) { setData({ schema_version: 1, generated_at: '', tasks: LAUNCH_TASK_DEFINITIONS.map(task => ({ ...task, status: 'backlog', evidence: '', assigned_to: '', due_on: null, version: 1, completed_at: null, created_at: '', updated_at: '' })), experiments: [] }); setBusy(false); return; }
    void getLaunchWorkspace().then(result => { if (active) setData(result); }).catch(reason => { if (active) { setData(null); setError(launchWorkspaceError(reason)); } }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [demo, revision]);
  const critical = data?.tasks.filter(task => task.priority === 'P0') ?? [];
  return <>
    {demo && <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Local layout preview. These are blank task templates; no owner records are loaded or saved.</p>}
    {busy && <p role="status">Verifying owner access and loading the workspace…</p>}
    {error && <div role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-800">{error}<button className={`${button} ml-3`} onClick={refresh}>Retry</button></div>}
    {data && <>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">{critical.filter(task => task.status === 'done').length} of {critical.length} launch-critical tasks recorded complete{data.generated_at && <span className="mt-1 block text-xs">Loaded {stamp(data.generated_at)}</span>}</p><button className={`${button} flex items-center gap-2`} onClick={refresh} disabled={busy}><RefreshCw size={16} aria-hidden="true"/>Refresh</button></div>
      <nav aria-label="Launch workspace sections" className="flex gap-2 border-b border-slate-200">{(['tasks', 'experiments'] as const).map(name => <button key={name} onClick={() => setTab(name)} aria-current={tab === name ? 'page' : undefined} className={`border-b-2 px-4 py-3 text-sm font-semibold ${tab === name ? 'border-blue-700 text-blue-800' : 'border-transparent text-slate-500'}`}>{name === 'tasks' ? 'Launch tasks' : 'Experiments & ROI'}</button>)}</nav>
      {tab === 'tasks' ? <section aria-label="Launch tasks" className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-sm leading-6 text-slate-600">Complete dependencies and attach evidence before marking work done. These records support review; they do not enable public indexing, payments or a deployment.</p><label className="text-sm">Show<select value={filter} onChange={event => setFilter(event.target.value as typeof filter)} className={`${control} ml-2`}><option value="all">All tasks</option><option value="P0">Launch-critical</option><option value="open">Open tasks</option></select></label></div>{data.tasks.filter(task => filter === 'all' || (filter === 'P0' ? task.priority === 'P0' : task.status !== 'done')).map(task => <TaskCard key={`${task.id}-${task.version}`} task={task} tasks={data.tasks} demo={demo} onSaved={saved => setData(current => current ? { ...current, tasks: current.tasks.map(row => row.id === saved.id ? saved : row) } : null)}/>)}</section> : <section aria-label="Experiments and ROI" className="space-y-4"><div className="flex flex-wrap items-start justify-between gap-3"><p className="max-w-2xl text-sm leading-6 text-slate-600">Record one measurable hypothesis at a time. Review actual contribution, cash spend and founder time. Unknown attribution stays unknown.</p><button className={`${primary} flex items-center gap-2`} disabled={demo} onClick={() => setEditor('new')}><Plus size={16} aria-hidden="true"/>New experiment</button></div>{!data.experiments.length && <div className="rounded-xl border border-dashed border-slate-300 p-8"><h2 className="font-semibold">Start with a small, measurable experiment</h2><p className="mt-2 text-sm leading-6 text-slate-600">For example, test whether one useful F-1 guide brings contributors back to answer questions. Define a baseline, review date and evidence before recording a return.</p></div>}{data.experiments.map(item => { const value = experimentEconomics(item); return <article key={`${item.id}-${item.version}`} className="space-y-3 rounded-xl border border-slate-200 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{item.title}</h2><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{EXPERIMENT_DECISIONS[item.decision]}</span></div><p className="whitespace-pre-wrap text-sm leading-6 text-slate-600">{item.hypothesis}</p><p className="text-xs text-slate-500">{item.start_on} → {item.end_on} · USD · Revision {item.version}</p><dl className="grid gap-3 sm:grid-cols-3">{[['Cash contribution',value.cash_contribution_usd],['After founder time',value.economic_contribution_usd],['Total experiment cost',value.total_cost_usd]].map(([label, amount]) => <div key={String(label)} className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-600">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{money(amount as number | null)}</dd></div>)}</dl><button className={button} onClick={() => setEditor(item)}>Review & update</button><History kind="experiment" id={item.id} demo={demo}/></article>; })}</section>}
      {editor && <ExperimentEditor item={editor === 'new' ? null : editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); refresh(); }}/>}
    </>}
  </>;
}

export function OwnerLaunchWorkspace() {
  const { user, loading, demoMode } = useAuth();
  return <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6"><header className="flex flex-wrap items-start justify-between gap-4"><div><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-teal-800"><ClipboardList size={16} aria-hidden="true"/>Owner workspace</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Launch & experiments</h1><p className="mt-2 text-sm text-slate-600">Turn launch evidence and small experiments into clear next decisions.</p></div><Link href="/admin/analytics" className={button}>Community dashboard</Link></header><p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">Private to the designated owner. Keep credentials, recovery codes and member information out of notes. Saved changes retain a revision history.</p>{loading ? <p role="status">Checking your account…</p> : !user && !demoMode ? <div className="rounded-xl border border-slate-200 p-6"><h2 className="font-semibold">Owner sign-in required</h2><Link href="/login?next=%2Fadmin%2Flaunch#sign-in" className="mt-4 inline-block text-blue-700 underline">Log in to continue</Link></div> : <Workspace key={user?.id ?? 'demo'} demo={demoMode}/>}</main>;
}

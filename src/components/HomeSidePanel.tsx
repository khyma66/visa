'use client';

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ArrowUpRight, BookOpen, Plus, Users } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { VISA_TYPES } from '@/lib/post-categories';
import { GROUP_VISA_TYPES, createIntakeGroup, listIntakeGroups, normalizeUniversity, upcomingIntakes, visaTabLabel, type IntakeGroup } from '@/lib/intake-groups';
import styles from './HomeSidePanel.module.css';

const chip = 'inline-flex min-h-11 items-center justify-center rounded-full border px-3 py-1.5 text-sm font-medium lg:min-h-8 lg:px-2 lg:py-1 lg:text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700';
const chipState = (active: boolean) => active ? 'border-teal-700 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:bg-teal-50';

/** Home page right rail: Groups and Experiences stay on top; related posts take the rest. */
export function HomeSidePanel({ visaType = '', children }: { visaType?: string; children: ReactNode }) {
  return <div className={`${styles.panel} min-w-0`}>
    <VisaGroups visaType={visaType} />
    <VisaExperiences />
    <section aria-label="Related posts" className={`${styles.related} feed-discovery min-w-0`}>{children}</section>
  </div>;
}

export function VisaGroups({ visaType = '' }: { visaType?: string }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const intakes = useMemo(() => upcomingIntakes(), []);
  const [visa, setVisa] = useState<string>(() => GROUP_VISA_TYPES.includes(visaType as never) ? visaType : GROUP_VISA_TYPES[0]);
  const [intakeKey, setIntakeKey] = useState(intakes[0].key);
  const [groups, setGroups] = useState<IntakeGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [university, setUniversity] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState<{ slug: string; name: string; created: boolean } | null>(null);
  const intake = intakes.find(item => item.key === intakeKey) ?? intakes[0];
  const query = searchParams.toString();
  const loginHref = `/login?next=${encodeURIComponent(`${pathname || '/'}${query ? `?${query}` : ''}`)}#sign-in`;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true); setError('');
    listIntakeGroups(visa, intake, controller.signal)
      .then(rows => { if (active) setGroups(rows); })
      .catch((reason: unknown) => { if (active) { setGroups([]); setError(reason instanceof Error ? reason.message : 'Groups could not be loaded. Please retry.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intake is derived from intakeKey
  }, [visa, intakeKey, revision]);

  function choose(nextVisa: string, nextIntake: string) {
    if (nextVisa === visa && nextIntake === intakeKey) return;
    setVisa(nextVisa); setIntakeKey(nextIntake); setNotice(null); setFormError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating || !user) return;
    let name: string;
    try { name = normalizeUniversity(university); } catch (reason) { setFormError((reason as Error).message); return; }
    setCreating(true); setFormError('');
    try {
      const result = await createIntakeGroup({ visa, intake, university: name, expectedUser: user.id });
      setNotice({ slug: result.slug, name, created: result.created });
      setUniversity(''); setFormOpen(false); setRevision(value => value + 1);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'The group could not be created. Please retry.');
    } finally { setCreating(false); }
  }

  const panelId = 'visa-groups-list';
  const selection = `${visaTabLabel(visa)} · ${intake.label}`;
  return <section aria-labelledby="visa-groups-title" className={`${styles.groups} rounded-2xl border border-slate-200 bg-white p-4`}>
    <div className="flex items-center gap-2"><Users size={17} className="shrink-0 text-teal-800" aria-hidden="true" /><h2 id="visa-groups-title" className="text-thread-title font-semibold text-slate-900">Groups</h2></div>
    <p className="mt-1 text-sm leading-5 text-slate-600">Same visa, same intake, same university.</p>
    <div role="group" aria-label="Group visa type" className="mt-2 flex flex-wrap gap-1.5 lg:gap-1">
      {GROUP_VISA_TYPES.map(value => <button key={value} type="button" aria-pressed={visa === value} aria-controls={panelId} onClick={() => choose(value, intakeKey)} className={`${chip} ${chipState(visa === value)}`}>{visaTabLabel(value)}</button>)}
    </div>
    <div role="group" aria-label={`${visaTabLabel(visa)} intake`} className="mt-2 flex flex-wrap gap-1.5 lg:gap-1 border-t border-slate-100 pt-2">
      {intakes.map(item => <button key={item.key} type="button" aria-pressed={intakeKey === item.key} aria-controls={panelId} onClick={() => choose(visa, item.key)} className={`${chip} ${intakeKey === item.key ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{item.label}</button>)}
    </div>
    <div id={panelId} role="region" aria-busy={loading} aria-label={`${selection} groups`} className="mt-2 min-w-0">
      {notice && <p role="status" className="mb-2 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-900">{notice.created ? 'Group created: ' : 'This group already exists: '}<Link href={`/us/en/c/${notice.slug}`} className="font-semibold underline">Open {notice.name}</Link></p>}
      {loading ? <p className="py-2 text-sm text-slate-500">Loading {selection} groups…</p>
        : error ? <p className="py-2 text-sm text-slate-600">{error} <button type="button" onClick={() => setRevision(value => value + 1)} className="font-semibold text-teal-800 underline">Retry</button></p>
        : groups.length === 0 ? <p className="py-2 text-sm text-slate-600">No {selection} groups yet. Start one for your university.</p>
        : <ul className="divide-y divide-slate-100">{groups.map(group => <li key={group.id}><Link href={`/us/en/c/${group.slug}`} className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
          <span className="min-w-0"><span className="block break-words text-sm font-semibold text-slate-900">{group.university}</span><span className="block text-xs text-slate-500">{group.member_count} {group.member_count === 1 ? 'member' : 'members'}</span></span>
          <ArrowUpRight size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
        </Link></li>)}</ul>}
    </div>
    {!user ? <Link href={loginHref} className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-teal-800 hover:underline lg:min-h-9"><Plus size={16} aria-hidden="true" />Log in to create a group</Link>
      : error && !formOpen ? null
      : !formOpen ? <button type="button" onClick={() => { setFormOpen(true); setNotice(null); }} className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-left text-sm font-semibold text-teal-800 hover:underline lg:min-h-9"><Plus size={16} className="shrink-0" aria-hidden="true" />Create a {selection} group</button>
      : <form id="visa-group-form" onSubmit={submit} noValidate className="mt-2 space-y-2 border-t border-slate-100 pt-3">
        <label htmlFor="visa-group-university" className="block text-sm font-semibold text-slate-800">University</label>
        <input id="visa-group-university" autoFocus value={university} maxLength={60} autoComplete="off" required aria-invalid={Boolean(formError)} aria-describedby="visa-group-help visa-group-error"
          onChange={event => { setUniversity(event.target.value); setFormError(''); }} placeholder="e.g. Arizona State University"
          className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100" />
        <p id="visa-group-help" className="text-xs leading-5 text-slate-500">Creates a public {selection} group. If one exists for this university, you will be linked to it.</p>
        <p id="visa-group-error" role={formError ? 'alert' : undefined} className="text-sm text-rose-700">{formError}</p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={creating} className="inline-flex min-h-11 items-center rounded-full bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60">{creating ? 'Creating…' : 'Create group'}</button>
          <button type="button" disabled={creating} onClick={() => { setFormOpen(false); setFormError(''); setUniversity(''); }} className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
        </div>
      </form>}
  </section>;
}

export function VisaExperiences() {
  return <section aria-labelledby="visa-experiences-title" className={`${styles.experiences} rounded-2xl border border-slate-200 bg-white p-4`}>
    <div className="flex items-center gap-2"><BookOpen size={17} className="shrink-0 text-teal-800" aria-hidden="true" /><h2 id="visa-experiences-title" className="text-thread-title font-semibold text-slate-900">Experiences</h2></div>
    <p className="mt-1 text-sm leading-5 text-slate-600">First-hand stories, by visa.</p>
    <ul className="mt-2 flex flex-wrap gap-1.5 lg:gap-1">
      {VISA_TYPES.map(value => <li key={value}><Link href={`/us/en/experiences?${new URLSearchParams({ visa: value })}`} prefetch={false} aria-label={`${value} experiences`} className={`${chip} ${chipState(false)}`}>{visaTabLabel(value)}</Link></li>)}
    </ul>
  </section>;
}

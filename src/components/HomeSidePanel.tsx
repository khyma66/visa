'use client';

import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ArrowUpRight, Plus } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { VISA_TYPES } from '@/lib/post-categories';
import { GROUP_VISA_TYPES, createIntakeGroup, listIntakeGroups, normalizeUniversity, upcomingIntakes, visaTabLabel, type IntakeGroup } from '@/lib/intake-groups';
import styles from './HomeSidePanel.module.css';

// Only F-1 groups have intakes today; other visa types show a placeholder.
const INTAKE_VISA = 'F-1 / OPT';
const chip = 'inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border px-3 py-1.5 text-sm font-medium lg:min-h-8 lg:px-2.5 lg:py-1 lg:text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700';
const chipState = (active: boolean) => active ? 'border-teal-700 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:bg-teal-50';
type Segment = 'groups' | 'experiences';
const SEGMENTS: [Segment, string][] = [['groups', 'Groups'], ['experiences', 'Experiences']];

/**
 * Home page right rail. Groups and Experiences share one tab strip at the top
 * (about a fifth of the rail on desktop); related posts take the rest.
 */
export function HomeSidePanel({ visaType = '', children }: { visaType?: string; children: ReactNode }) {
  const [segment, setSegment] = useState<Segment>('groups');
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next: Segment = segment === 'groups' ? 'experiences' : 'groups';
    setSegment(next);
    document.getElementById(`home-tab-${next}`)?.focus();
  }
  return <div className={`${styles.panel} min-w-0`}>
    <section aria-label="Groups and experiences" className={`${styles.top} min-w-0`}>
      <div role="tablist" aria-label="Groups and experiences" onKeyDown={keys} className="flex gap-1 border-b border-slate-200 pb-1">
        {SEGMENTS.map(([value, label]) => <button key={value} id={`home-tab-${value}`} type="button" role="tab" aria-selected={segment === value} aria-controls={`home-panel-${value}`} tabIndex={segment === value ? 0 : -1} onClick={() => setSegment(value)}
          className={`min-h-9 rounded-lg px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${segment === value ? 'bg-teal-50 text-teal-900' : 'text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}
      </div>
      <div id="home-panel-groups" role="tabpanel" aria-labelledby="home-tab-groups" hidden={segment !== 'groups'} className={`${styles.body} min-h-0`}>
        <VisaGroups visaType={visaType} />
      </div>
      <div id="home-panel-experiences" role="tabpanel" aria-labelledby="home-tab-experiences" hidden={segment !== 'experiences'} className={`${styles.body} min-h-0`}>
        <VisaExperiences />
      </div>
    </section>
    <section aria-label="Related posts" className={`${styles.related} feed-discovery min-w-0`}>{children}</section>
  </div>;
}

export function VisaGroups({ visaType = '' }: { visaType?: string }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const intakes = useMemo(() => upcomingIntakes(new Date(), 3), []);
  const [visa, setVisa] = useState<string>(() => GROUP_VISA_TYPES.includes(visaType as never) ? visaType : GROUP_VISA_TYPES[0]);
  const [intakeKey, setIntakeKey] = useState(intakes[0].key);
  const [groups, setGroups] = useState<IntakeGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [university, setUniversity] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState<{ slug: string; name: string; created: boolean } | null>(null);
  const hasIntakes = visa === INTAKE_VISA;
  const intake = intakes.find(item => item.key === intakeKey) ?? intakes[0];
  const query = searchParams.toString();
  const loginHref = `/login?next=${encodeURIComponent(`${pathname || '/'}${query ? `?${query}` : ''}`)}#sign-in`;
  const selection = hasIntakes ? `${visaTabLabel(visa)} · ${intake.label}` : visaTabLabel(visa);

  useEffect(() => {
    if (!hasIntakes) { setGroups([]); setLoading(false); setError(''); return; }
    const controller = new AbortController();
    let active = true;
    setLoading(true); setError('');
    listIntakeGroups(visa, intake, controller.signal)
      .then(rows => { if (active) setGroups(rows); })
      .catch((reason: unknown) => { if (active) { setGroups([]); setError(reason instanceof Error ? reason.message : 'Groups could not be loaded. Please retry.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intake is derived from intakeKey
  }, [visa, intakeKey, revision, hasIntakes]);

  function choose(nextVisa: string, nextIntake = intakeKey) {
    if (nextVisa === visa && nextIntake === intakeKey) return;
    setVisa(nextVisa); setIntakeKey(nextIntake); setNotice(null); setFormError(''); setFormOpen(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating || !user || !hasIntakes) return;
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

  return <div className="flex min-h-0 flex-col gap-1.5">
    <h2 id="visa-groups-title" className="sr-only">Groups</h2>
    <div role="group" aria-label="Group visa type" className={`${styles.scrollRow} flex gap-1.5`}>
      {GROUP_VISA_TYPES.map(value => <button key={value} type="button" aria-pressed={visa === value} onClick={() => choose(value)} className={`${chip} ${chipState(visa === value)}`}>{visaTabLabel(value)}</button>)}
    </div>
    {hasIntakes && <div role="group" aria-label={`${visaTabLabel(visa)} intake`} className={`${styles.scrollRow} flex gap-1.5`}>
      {intakes.map(item => <button key={item.key} type="button" aria-pressed={intakeKey === item.key} onClick={() => choose(visa, item.key)} className={`${chip} ${intakeKey === item.key ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{item.label}</button>)}
    </div>}
    <div aria-live="polite" aria-busy={loading} aria-label={`${selection} groups`} className={`${styles.groupList} min-h-0`}>
      {notice && <p role="status" className="mb-1 rounded-lg bg-teal-50 px-3 py-1.5 text-sm text-teal-900">{notice.created ? 'Group created: ' : 'This group already exists: '}<Link href={`/us/en/c/${notice.slug}`} className="font-semibold underline">Open {notice.name}</Link></p>}
      {!hasIntakes ? <p className="py-1 text-sm leading-5 text-slate-600">{visaTabLabel(visa)} groups by university and intake are coming soon.</p>
        : loading ? <p className="py-1 text-sm text-slate-500">Loading {selection} groups…</p>
        : error ? <p className="py-1 text-sm text-slate-600">{error} <button type="button" onClick={() => setRevision(value => value + 1)} className="font-semibold text-teal-800 underline">Retry</button></p>
        : groups.length === 0 ? <p className="py-1 text-sm text-slate-600">No {selection} groups yet. Start one for your university.</p>
        : <ul className="divide-y divide-slate-100">{groups.map(group => <li key={group.id}><Link href={`/us/en/c/${group.slug}`} className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50 lg:min-h-9">
          <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-900">{group.university}</span><span className="block text-xs text-slate-500">{group.member_count} {group.member_count === 1 ? 'member' : 'members'}</span></span>
          <ArrowUpRight size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
        </Link></li>)}</ul>}
    </div>
    {!user ? <Link href={loginHref} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-teal-800 hover:underline"><Plus size={16} aria-hidden="true" />Log in to create a group</Link>
      : !hasIntakes ? <button type="button" disabled className="inline-flex min-h-9 w-fit cursor-not-allowed items-center gap-1.5 rounded-full border border-dashed border-slate-300 px-3 text-sm font-semibold text-slate-500"><Plus size={15} aria-hidden="true" />Create group · coming soon</button>
      : !formOpen ? <button type="button" onClick={() => { setFormOpen(true); setNotice(null); }} className="inline-flex min-h-9 w-fit items-center gap-1.5 rounded-full border border-teal-700 px-3 text-sm font-semibold text-teal-800 hover:bg-teal-50"><Plus size={15} aria-hidden="true" />Create {selection} group</button>
      : <form onSubmit={submit} noValidate className="flex flex-wrap items-start gap-2">
        <label htmlFor="visa-group-university" className="sr-only">University for the {selection} group</label>
        <input id="visa-group-university" autoFocus value={university} maxLength={60} autoComplete="off" required aria-invalid={Boolean(formError)} aria-describedby="visa-group-error"
          onChange={event => { setUniversity(event.target.value); setFormError(''); }} placeholder="University name"
          className="h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 lg:h-9" />
        <button type="submit" disabled={creating} className="inline-flex min-h-11 items-center rounded-full bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 lg:min-h-9">{creating ? 'Creating…' : 'Create'}</button>
        <button type="button" disabled={creating} onClick={() => { setFormOpen(false); setFormError(''); setUniversity(''); }} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 lg:min-h-9">Cancel</button>
        <p id="visa-group-error" role={formError ? 'alert' : undefined} className="w-full text-sm text-rose-700">{formError}</p>
      </form>}
  </div>;
}

export function VisaExperiences() {
  return <div className="flex flex-col gap-1.5">
    <h2 id="visa-experiences-title" className="sr-only">Experiences by visa</h2>
    <ul className={`${styles.scrollRow} flex flex-wrap gap-1.5`}>
      {VISA_TYPES.map(value => <li key={value}><Link href={`/us/en/experiences?${new URLSearchParams({ visa: value })}`} prefetch={false} aria-label={`${value} experiences`} className={`${chip} ${chipState(false)}`}>{visaTabLabel(value)}</Link></li>)}
    </ul>
  </div>;
}

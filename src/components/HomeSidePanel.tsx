'use client';

import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ArrowUpRight, Plus } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { VISA_TYPES } from '@/lib/post-categories';
import { GROUP_VISA_TYPES, createIntakeGroup, hasIntakes, listIntakeGroups, normalizeUniversity, upcomingIntakes, visaTabLabel, type IntakeGroup } from '@/lib/intake-groups';
import styles from './HomeSidePanel.module.css';

const chip = 'inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border px-3 py-1.5 text-sm font-medium lg:min-h-7 lg:px-2.5 lg:py-0.5 lg:text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700';
const chipState = (active: boolean) => active ? 'border-teal-700 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:bg-teal-50';
const createButton = 'inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full bg-teal-700 px-3 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700';
type Segment = 'groups' | 'experiences';
const SEGMENTS: [Segment, string][] = [['groups', 'Groups'], ['experiences', 'Experiences']];

function useLoginHref() {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  return `/login?next=${encodeURIComponent(`${pathname || '/'}${query ? `?${query}` : ''}`)}#sign-in`;
}

/**
 * Home page right rail. Groups and Experiences share one tab strip at the top
 * (sized to their content, at most a quarter of the rail on desktop); related
 * posts take the rest.
 */
export function HomeSidePanel({ visaType = '', children }: { visaType?: string; children: ReactNode }) {
  const { user } = useAuth();
  const loginHref = useLoginHref();
  const [segment, setSegment] = useState<Segment>('groups');
  const [formOpen, setFormOpen] = useState(false);
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next: Segment = segment === 'groups' ? 'experiences' : 'groups';
    setSegment(next);
    document.getElementById(`home-tab-${next}`)?.focus();
  }
  return <div className={`${styles.panel} min-w-0`}>
    <section aria-label="Groups and experiences" className={`${styles.top} min-w-0`}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-slate-200 pb-1">
        <div role="tablist" aria-label="Groups and experiences" onKeyDown={keys} className="flex shrink-0 gap-0.5">
          {SEGMENTS.map(([value, label]) => <button key={value} id={`home-tab-${value}`} type="button" role="tab" aria-selected={segment === value} aria-controls={`home-panel-${value}`} tabIndex={segment === value ? 0 : -1} onClick={() => setSegment(value)}
            className={`min-h-9 shrink-0 rounded-lg px-2.5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${segment === value ? 'bg-teal-50 text-teal-900' : 'text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}
        </div>
        {segment === 'groups' && (!user
          ? <Link href={loginHref} className={createButton}><Plus size={15} aria-hidden="true" />Create<span className="sr-only"> group</span></Link>
          : <button type="button" aria-expanded={formOpen} aria-controls="visa-group-form" onClick={() => { setFormOpen(true); setSegment('groups'); }} className={createButton}><Plus size={15} aria-hidden="true" />Create<span className="sr-only"> group</span></button>)}
      </div>
      <div id="home-panel-groups" role="tabpanel" aria-labelledby="home-tab-groups" hidden={segment !== 'groups'} className={`${styles.body} min-h-0`}>
        <VisaGroups visaType={visaType} formOpen={formOpen} onFormOpenChange={setFormOpen} />
      </div>
      <div id="home-panel-experiences" role="tabpanel" aria-labelledby="home-tab-experiences" hidden={segment !== 'experiences'} className={`${styles.body} min-h-0`}>
        <VisaExperiences />
      </div>
    </section>
    <section aria-label="Related posts" className={`${styles.related} feed-discovery min-w-0`}>{children}</section>
  </div>;
}

/**
 * Groups for one visa type. F-1 groups are per intake and university; other
 * visa groups are per university. When the rail controls the form, the Create
 * action lives in the rail's tab strip; on its own this component shows it.
 */
export function VisaGroups({ visaType = '', formOpen: controlledOpen, onFormOpenChange }: { visaType?: string; formOpen?: boolean; onFormOpenChange?: (open: boolean) => void }) {
  const { user } = useAuth();
  const loginHref = useLoginHref();
  const intakes = useMemo(() => upcomingIntakes(new Date(), 3), []);
  const [visa, setVisa] = useState<string>(() => GROUP_VISA_TYPES.includes(visaType as never) ? visaType : GROUP_VISA_TYPES[0]);
  const [intakeKey, setIntakeKey] = useState(intakes[0].key);
  const [groups, setGroups] = useState<IntakeGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [ownOpen, setOwnOpen] = useState(false);
  const [university, setUniversity] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState<{ slug: string; name: string; created: boolean } | null>(null);
  const controlled = onFormOpenChange !== undefined;
  const formOpen = controlled ? Boolean(controlledOpen) : ownOpen;
  const setFormOpen = (open: boolean) => { if (controlled) onFormOpenChange(open); else setOwnOpen(open); };
  const withIntake = hasIntakes(visa);
  const intake = intakes.find(item => item.key === intakeKey) ?? intakes[0];
  const selection = withIntake ? `${visaTabLabel(visa)} · ${intake.label}` : visaTabLabel(visa);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true); setError('');
    listIntakeGroups(visa, withIntake ? intake : null, controller.signal)
      .then(rows => { if (active) setGroups(rows); })
      .catch((reason: unknown) => { if (active) { setGroups([]); setError(reason instanceof Error ? reason.message : 'Groups could not be loaded. Please retry.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intake is derived from intakeKey
  }, [visa, intakeKey, revision]);

  // A newly opened form starts clean.
  useEffect(() => { if (formOpen) { setNotice(null); setFormError(''); } }, [formOpen]);

  function choose(nextVisa: string, nextIntake = intakeKey) {
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
      const result = await createIntakeGroup({ visa, intake: withIntake ? intake : null, university: name, expectedUser: user.id });
      setNotice({ slug: result.slug, name, created: result.created });
      setUniversity(''); setFormOpen(false); setRevision(value => value + 1);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'The group could not be created. Please retry.');
    } finally { setCreating(false); }
  }

  return <div className="flex min-h-0 flex-col gap-1.5 lg:gap-1">
    <h2 id="visa-groups-title" className="sr-only">Groups</h2>
    <div role="group" aria-label="Group visa type" className={`${styles.scrollRow} flex gap-1.5`}>
      {GROUP_VISA_TYPES.map(value => <button key={value} type="button" aria-pressed={visa === value} onClick={() => choose(value)} className={`${chip} ${chipState(visa === value)}`}>{visaTabLabel(value)}</button>)}
    </div>
    {withIntake && <div role="group" aria-label={`${visaTabLabel(visa)} intake`} className={`${styles.scrollRow} flex gap-1.5`}>
      {intakes.map(item => <button key={item.key} type="button" aria-pressed={intakeKey === item.key} onClick={() => choose(visa, item.key)} className={`${chip} ${intakeKey === item.key ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{item.label}</button>)}
    </div>}
    {formOpen && user && <form id="visa-group-form" onSubmit={submit} noValidate className="flex flex-wrap items-start gap-1.5 rounded-lg bg-slate-50 p-1.5">
      <label htmlFor="visa-group-university" className="sr-only">University for the {selection} group</label>
      <input id="visa-group-university" autoFocus value={university} maxLength={60} autoComplete="off" required aria-invalid={Boolean(formError)} aria-describedby="visa-group-error"
        onChange={event => { setUniversity(event.target.value); setFormError(''); }} placeholder={`University for ${selection}`}
        className="h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 lg:h-9" />
      <button type="submit" disabled={creating} className="inline-flex min-h-11 items-center rounded-full bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 lg:min-h-9">{creating ? 'Creating…' : 'Create'}</button>
      <button type="button" disabled={creating} onClick={() => { setFormOpen(false); setFormError(''); setUniversity(''); }} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 lg:min-h-9">Cancel</button>
      {formError && <p id="visa-group-error" role="alert" className="w-full text-sm text-rose-700">{formError}</p>}
    </form>}
    <div aria-live="polite" aria-busy={loading} aria-label={`${selection} groups`} className="min-h-0">
      {notice && <p role="status" className="mb-1 rounded-lg bg-teal-50 px-3 py-1.5 text-sm text-teal-900">{notice.created ? 'Group created: ' : 'This group already exists: '}<Link href={`/us/en/c/${notice.slug}`} className="font-semibold underline">Open {notice.name}</Link></p>}
      {loading ? <p className="py-1 text-sm text-slate-500">Loading {selection} groups…</p>
        : error ? <p className="py-1 text-sm text-slate-600">{error} <button type="button" onClick={() => setRevision(value => value + 1)} className="font-semibold text-teal-800 underline">Retry</button></p>
        : groups.length === 0 ? <p className="py-1 text-sm text-slate-600">No groups yet. Create the first one.</p>
        : <ul className="divide-y divide-slate-100">{groups.map(group => <li key={group.id}><Link href={`/us/en/c/${group.slug}`} className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50 lg:min-h-9">
          <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-900">{group.university}</span><span className="block text-xs text-slate-500">{group.member_count} {group.member_count === 1 ? 'member' : 'members'}</span></span>
          <ArrowUpRight size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
        </Link></li>)}</ul>}
    </div>
    {!controlled && (!user
      ? <Link href={loginHref} className={`${createButton} w-fit`}><Plus size={15} aria-hidden="true" />Create group</Link>
      : !formOpen && <button type="button" onClick={() => setFormOpen(true)} className={`${createButton} w-fit`}><Plus size={15} aria-hidden="true" />Create group</button>)}
  </div>;
}

export function VisaExperiences() {
  return <div className="flex flex-col gap-1.5">
    <h2 id="visa-experiences-title" className="sr-only">Experiences by visa</h2>
    <ul className="flex flex-wrap gap-1.5">
      {VISA_TYPES.map(value => <li key={value}><Link href={`/us/en/experiences?${new URLSearchParams({ visa: value })}`} prefetch={false} aria-label={`${value} experiences`} className={`${chip} ${chipState(false)}`}>{visaTabLabel(value)}</Link></li>)}
    </ul>
  </div>;
}

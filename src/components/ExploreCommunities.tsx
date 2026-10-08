'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BriefcaseBusiness, Compass, GraduationCap, Heart, House, MapPin, MessagesSquare, Plane, Plus, Search, Users, X } from 'lucide-react';
import { COMMUNITY_CATEGORIES, getCommunityById, getMembershipsForCommunities, joinCommunity, leaveCommunity, listCommunities, listMyCommunitiesPage, type Community, type CommunityMembership } from '@/lib/groups';
import { useAuth } from './AuthProvider';

const CATEGORY_ICONS = { 'Work visas': BriefcaseBusiness, Study: GraduationCap, Family: Heart, Travel: Plane, Settlement: House, General: MessagesSquare };

export function ExploreCommunities({ initialTab = 'all' }: { initialTab?: 'all' | 'mine' } = {}) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<'all' | 'mine'>(initialTab);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const country = 'United States';
  const [rows, setRows] = useState<Community[]>([]);
  const [after, setAfter] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const [pageNumber, setPageNumber] = useState(1);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [memberships, setMemberships] = useState<CommunityMembership[]>([]);
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [membershipError, setMembershipError] = useState('');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState('');
  const actionLocks = useRef(new Map<string, symbol>());
  const navigationLock = useRef(false);
  const alive = useRef(true);
  // Scope changes invalidate mutation results even when the account stays the
  // same and the user changes filters or moves to another page.
  const scope = JSON.stringify([user?.id, tab, search, category, country, after]);
  const currentScope = useRef(scope);
  currentScope.current = scope;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setAfter(null); setHistory([]); setPageNumber(1); navigationLock.current = false; }, [user?.id]);
  useEffect(() => {
    const controller = new AbortController();
    setRows([]); setNext(null); setMemberships([]); setError(''); setMembershipError(''); setActionError('');
    actionLocks.current.clear(); setBusy(new Set());
    if (tab === 'mine' && (!user || authLoading)) {
      setLoading(authLoading); setMembershipLoading(false); navigationLock.current = false;
      return () => controller.abort();
    }
    setLoading(true); setMembershipLoading(Boolean(user));
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const page = await (tab === 'mine' ? listMyCommunitiesPage : listCommunities)({ search, category, country, after, signal: controller.signal });
          if (controller.signal.aborted) return;
          setRows(page.communities); setNext(page.nextCursor);
          if (user && page.communities.length) {
            try {
              const value = await getMembershipsForCommunities(user.id, page.communities.map((row) => row.id), controller.signal);
              if (!controller.signal.aborted) setMemberships(value);
            } catch (reason) {
              if (!controller.signal.aborted) setMembershipError(reason instanceof Error ? reason.message : 'Could not load your memberships.');
            }
          }
        } catch (reason) {
          if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load communities.');
        } finally {
          if (!controller.signal.aborted) { setLoading(false); setMembershipLoading(false); navigationLock.current = false; }
        }
      })();
    }, search ? 250 : 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [user?.id, authLoading, tab, search, category, country, after, retry]);

  const memberMap = useMemo(() => new Map(memberships.map((row) => [row.community_id, row])), [memberships]);
  async function changeMembership(community: Community) {
    if (!user) { router.push(`/login?next=${encodeURIComponent(`/c/${community.slug}`)}`); return; }
    if (authLoading || loading || membershipLoading || membershipError || actionLocks.current.has(community.id)) return;
    const membership = memberMap.get(community.id);
    if (membership?.role === 'owner') return;
    const actionScope = scope;
    const operation = Symbol();
    actionLocks.current.set(community.id, operation); setBusy(new Set(actionLocks.current.keys())); setActionError('');
    try {
      if (membership) await leaveCommunity(community.id); else await joinCommunity(community.id);
      if (!alive.current || currentScope.current !== actionScope || actionLocks.current.get(community.id) !== operation) return;
      setMemberships((current) => membership ? current.filter((item) => item.community_id !== community.id) : [...current, { community_id: community.id, role: 'member', is_active: true }]);
      if (membership && tab === 'mine') setRows((current) => current.filter((item) => item.id !== community.id));
      const refreshed = await getCommunityById(community.id);
      if (alive.current && currentScope.current === actionScope && actionLocks.current.get(community.id) === operation && refreshed) setRows((current) => current.map((item) => item.id === refreshed.id ? refreshed : item));
    } catch (reason) {
      if (alive.current && currentScope.current === actionScope && actionLocks.current.get(community.id) === operation) setActionError(reason instanceof Error ? reason.message : 'Could not update membership. Please retry.');
    } finally {
      if (actionLocks.current.get(community.id) === operation) {
        actionLocks.current.delete(community.id); if (alive.current) setBusy(new Set(actionLocks.current.keys()));
      }
    }
  }

  function resetPage() { setAfter(null); setHistory([]); setPageNumber(1); }
  function changeTab(value: 'all' | 'mine') { setTab(value); resetPage(); }
  function nextPage() {
    if (!next || loading || navigationLock.current) return;
    navigationLock.current = true;
    setHistory((current) => [...current, after].slice(-50));
    setAfter(next); setPageNumber((value) => value + 1);
  }
  function previousPage() {
    if (!history.length || loading || navigationLock.current) return;
    navigationLock.current = true;
    setAfter(history[history.length - 1]); setHistory((current) => current.slice(0, -1)); setPageNumber((value) => Math.max(1, value - 1));
  }
  return <main className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="flex items-center gap-2"><Compass className="text-blue-700" size={23} aria-hidden="true" /><h1 className="text-2xl font-bold text-slate-950">Explore Communities</h1></div><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Find your people by U.S. visa type or next step.</p></div>
      <Link href={user ? '/communities/new' : '/login?next=%2Fcommunities%2Fnew'} className="inline-flex items-center gap-1.5 rounded-full bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"><Plus size={17} aria-hidden="true" />Start a Community</Link>
    </div>
    <nav aria-label="Explore sections" className="mt-5 flex flex-wrap items-center gap-1 border-b border-slate-200 pb-3">
      <button onClick={() => changeTab('all')} aria-pressed={tab === 'all'} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === 'all' ? 'bg-slate-200 text-slate-950' : 'text-slate-600 hover:bg-slate-100'}`}>All Communities</button>
      <button onClick={() => changeTab('mine')} aria-pressed={tab === 'mine'} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === 'mine' ? 'bg-slate-200 text-slate-950' : 'text-slate-600 hover:bg-slate-100'}`}>My Communities</button>
      <Link href="/news" className="ml-auto rounded-full px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">U.S. Visa News</Link>
      <Link href="/tags" className="rounded-full px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">Browse Tags</Link>
    </nav>
    <div aria-label="Browse community categories" className="mt-5 flex flex-wrap gap-2">
      {COMMUNITY_CATEGORIES.map((item) => { const Icon = CATEGORY_ICONS[item]; return <button key={item} onClick={() => { setCategory(category === item ? '' : item); resetPage(); }} aria-pressed={category === item} className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium ${category === item ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}><Icon size={16} aria-hidden="true" />{item === 'Work visas' ? 'Work Visas' : item}</button>; })}
    </div>
    <div className="my-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(180px,1fr)_160px_180px]">
      <label className="relative sm:col-span-2 lg:col-span-1"><span className="sr-only">Search communities</span><Search size={18} className="absolute left-3.5 top-3 text-slate-500" aria-hidden="true" /><input value={search} maxLength={80} onChange={(event) => { setSearch(event.target.value); resetPage(); }} placeholder="Search communities" className="h-11 w-full rounded-full border border-slate-200 bg-slate-100 pl-10 pr-3 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100" /></label>
      <select aria-label="Community category" value={category} onChange={(event) => { setCategory(event.target.value); resetPage(); }} className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="">All Categories</option>{COMMUNITY_CATEGORIES.map((item) => <option key={item} value={item}>{item === 'Work visas' ? 'Work Visas' : item}</option>)}</select>
      <label className="relative"><span className="sr-only">Community Country</span><MapPin size={16} className="absolute left-3 top-3.5 text-slate-500" aria-hidden="true" /><input aria-label="Community Country" value={country} maxLength={80} readOnly className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm" /></label>
    </div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><p aria-live="polite" className="text-xs text-slate-500">{loading ? 'Loading communities...' : `${rows.length} communities on this page`}<span className="ml-2">A-Z by community address</span></p>{(search || category) && <button onClick={() => { setSearch(''); setCategory(''); resetPage(); }} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"><X size={13} aria-hidden="true" />Clear Filters</button>}</div>
    {membershipError && <div role="alert" className="mb-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{membershipError} <button onClick={() => setRetry((n) => n + 1)} className="font-bold underline">Retry memberships</button></div>}
    {actionError && <p role="alert" className="mb-4 rounded-lg bg-rose-50 p-4 text-sm text-rose-800">{actionError}</p>}
    {tab === 'mine' && !user && !authLoading ? <div className="border-y border-slate-200 py-8 text-center"><Users size={28} className="mx-auto text-slate-400" aria-hidden="true" /><h2 className="mt-3 text-lg font-bold">Your Communities, together</h2><p className="mt-2 text-sm text-slate-600">Log In to join communities and find them here.</p><Link href="/login?next=%2Fmy-communities" className="mt-4 inline-block rounded-full bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800">Log In</Link></div> : <>
      {error && <div role="alert" className="mb-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{error} <button onClick={() => setRetry((n) => n + 1)} className="font-bold underline">Retry</button></div>}
      <div aria-busy={loading} className="grid gap-3 md:grid-cols-2">{rows.map((community) => {
        const membership = memberMap.get(community.id);
        const Icon = CATEGORY_ICONS[community.category] ?? MessagesSquare;
        return <article key={community.id} className="flex min-w-0 flex-col rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-300">
          <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-700"><Icon size={21} aria-hidden="true" /></span><div className="min-w-0 flex-1"><Link href={`/c/${community.slug}`} className="break-words text-base font-bold leading-6 text-slate-900 hover:text-blue-700">{community.display_name}</Link><p className="mt-0.5 break-all text-xs text-slate-500">c/{community.slug}</p></div><Link href={`/c/${community.slug}`} aria-label={`Open ${community.display_name}`} title={`Open ${community.display_name}`} className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-blue-700"><ArrowUpRight size={17} /></Link></div>
          <p className="mb-4 mt-3 line-clamp-2 break-words text-sm leading-6 text-slate-600">{community.description}</p>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span className="rounded bg-slate-100 px-2 py-1">{community.category === 'Work visas' ? 'Work Visas' : community.category}</span><span className="flex min-w-0 items-center gap-1 break-words"><MapPin size={13} className="shrink-0" aria-hidden="true" />{community.country}</span></div>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-3"><span className="flex items-center gap-1.5 text-xs text-slate-500"><Users size={14} aria-hidden="true" />{Number(community.member_count).toLocaleString()} {Number(community.member_count) === 1 ? 'member' : 'members'}</span><button disabled={authLoading || loading || membershipLoading || !!membershipError || busy.has(community.id) || membership?.role === 'owner'} onClick={() => void changeMembership(community)} aria-label={`${membership ? 'Leave' : 'Join'} ${community.display_name}`} className={`rounded-full border px-5 py-2 text-xs font-semibold disabled:cursor-default disabled:opacity-60 ${membership ? 'border-slate-300 text-slate-700 hover:bg-slate-50' : 'border-blue-700 bg-blue-700 text-white hover:bg-blue-800'}`}>{busy.has(community.id) ? 'Saving...' : membership?.role === 'owner' ? 'Owner' : membership ? 'Leave' : 'Join'}</button></div>
        </article>;
      })}</div>
      {loading && <div role="status" aria-label="Loading communities" className="grid gap-3 md:grid-cols-2">{[1, 2, 3, 4].map((item) => <div key={item} className="h-44 animate-pulse rounded-lg bg-slate-100" />)}</div>}
      {!loading && !rows.length && !error && !membershipError && <div className="border-y border-slate-200 py-10 text-center"><Search size={28} className="mx-auto text-slate-400" aria-hidden="true" /><h2 className="mt-3 text-lg font-bold">{tab === 'mine' && !search && !category && !after ? 'Find your first community' : 'No communities match yet'}</h2><p className="mt-2 text-sm text-slate-600">{tab === 'mine' ? 'Browse All Communities to join a conversation, or adjust the filters.' : 'Try a broader search or start a community for your topic.'}</p>{tab === 'mine' ? <button onClick={() => { changeTab('all'); setSearch(''); setCategory(''); }} className="mt-4 text-sm font-semibold text-blue-700 underline">Explore all communities</button> : <Link href="/communities/new" className="mt-4 inline-block text-sm font-semibold text-blue-700 underline">Create a Community</Link>}</div>}
      {(next || after) && <nav aria-label="Community pages" className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {after && <button disabled={loading} onClick={resetPage} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold disabled:opacity-50">First page</button>}
        <button disabled={loading || !history.length} onClick={previousPage} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold disabled:opacity-50">Previous communities</button>
        <span className="text-xs text-slate-500">Page {pageNumber}</span>
        <button disabled={loading || !next} onClick={nextPage} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold disabled:opacity-50">Next communities</button>
      </nav>}
    </>}
  </main>;
}

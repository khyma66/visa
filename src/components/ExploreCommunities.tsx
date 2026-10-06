'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Plus, Search, Users } from 'lucide-react';
import { COMMUNITY_CATEGORIES, communitiesForMemberships, getCommunityById, joinCommunity, leaveCommunity, listCommunities, listMyMemberships, type Community, type CommunityMembership } from '@/lib/groups';
import { useAuth } from './AuthProvider';

export function ExploreCommunities() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<'all' | 'mine'>('all');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [country, setCountry] = useState('');
  const [rows, setRows] = useState<Community[]>([]);
  const [after, setAfter] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [memberships, setMemberships] = useState<CommunityMembership[]>([]);
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [membershipError, setMembershipError] = useState('');
  const [membershipRetry, setMembershipRetry] = useState(0);
  const [myRows, setMyRows] = useState<Community[]>([]);
  const [mineLoading, setMineLoading] = useState(false);
  const [mineError, setMineError] = useState('');
  const [visibleMine, setVisibleMine] = useState(24);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState('');
  const actionLocks = useRef(new Map<string, symbol>());
  const alive = useRef(true);
  const currentActor = useRef(user?.id);
  currentActor.current = user?.id;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    if (!after) { setRows([]); setNext(null); }
    const timer = setTimeout(() => {
      void listCommunities({ search, category, country, after, signal: controller.signal }).then((page) => {
        if (controller.signal.aborted) return;
        setRows((current) => after ? [...current, ...page.communities.filter((row) => !current.some((item) => item.id === row.id))] : page.communities);
        setNext(page.nextCursor);
      }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load communities.'); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, search || country ? 250 : 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [search, category, country, after, retry]);

  useEffect(() => {
    const controller = new AbortController();
    setMemberships([]); setMembershipError(''); setActionError('');
    actionLocks.current.clear(); setBusy(new Set());
    if (!user || authLoading) { setMembershipLoading(false); return () => controller.abort(); }
    setMembershipLoading(true);
    void listMyMemberships(user.id, controller.signal).then((value) => { if (!controller.signal.aborted) setMemberships(value); })
      .catch((reason) => { if (!controller.signal.aborted) setMembershipError(reason instanceof Error ? reason.message : 'Could not load your memberships.'); })
      .finally(() => { if (!controller.signal.aborted) setMembershipLoading(false); });
    return () => controller.abort();
  }, [user?.id, authLoading, membershipRetry]);

  useEffect(() => {
    const controller = new AbortController();
    if (tab !== 'mine') return;
    setMyRows([]); setMineError(''); setVisibleMine(24);
    if (!user || membershipLoading || membershipError) return;
    setMineLoading(true);
    void communitiesForMemberships(memberships, controller.signal).then((value) => { if (!controller.signal.aborted) setMyRows(value); })
      .catch((reason) => { if (!controller.signal.aborted) setMineError(reason instanceof Error ? reason.message : 'Could not load your communities.'); })
      .finally(() => { if (!controller.signal.aborted) setMineLoading(false); });
    return () => controller.abort();
  }, [tab, user?.id, memberships, membershipLoading, membershipError]);

  const memberMap = useMemo(() => new Map(memberships.map((row) => [row.community_id, row])), [memberships]);
  const matchingMine = useMemo(() => myRows.filter((row) => (!category || row.category === category) && (!country.trim() || row.country.toLocaleLowerCase().includes(country.trim().toLocaleLowerCase())) && (!search.trim() || `${row.display_name} ${row.slug}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))), [myRows, category, country, search]);
  const displayed = tab === 'all' ? rows : matchingMine.slice(0, visibleMine);
  const pageLoading = tab === 'all' ? loading : membershipLoading || mineLoading;

  async function changeMembership(community: Community) {
    if (!user) { router.push(`/login?next=${encodeURIComponent(`/c/${community.slug}`)}`); return; }
    if (authLoading || membershipLoading || membershipError || actionLocks.current.has(community.id)) return;
    const membership = memberMap.get(community.id);
    if (membership?.role === 'owner') return;
    const actor = user.id;
    const operation = Symbol();
    actionLocks.current.set(community.id, operation); setBusy(new Set(actionLocks.current.keys())); setActionError('');
    try {
      if (membership) await leaveCommunity(community.id); else await joinCommunity(community.id);
      if (!alive.current || currentActor.current !== actor || actionLocks.current.get(community.id) !== operation) return;
      setMemberships((current) => membership ? current.filter((item) => item.community_id !== community.id) : [...current, { community_id: community.id, role: 'member', is_active: true }]);
      const refreshed = await getCommunityById(community.id);
      if (alive.current && currentActor.current === actor && actionLocks.current.get(community.id) === operation && refreshed) setRows((current) => current.map((item) => item.id === refreshed.id ? refreshed : item));
    } catch (reason) {
      if (alive.current && currentActor.current === actor && actionLocks.current.get(community.id) === operation) setActionError(reason instanceof Error ? reason.message : 'Could not update membership. Please retry.');
    } finally {
      if (actionLocks.current.get(community.id) === operation) {
        actionLocks.current.delete(community.id); if (alive.current) setBusy(new Set(actionLocks.current.keys()));
      }
    }
  }

  function resetPage() { setAfter(null); setVisibleMine(24); }
  return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
    <div className="flex flex-wrap items-start justify-between gap-5">
      <div><div className="flex items-center gap-3"><Compass className="text-teal-700" /><h1 className="text-3xl font-bold tracking-tight">Explore communities</h1></div><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Find people navigating the same visa, destination or next step. Join a community, ask a question, and share what helped.</p></div>
      <Link href={user ? '/communities/new' : '/login?next=%2Fcommunities%2Fnew'} className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-3 text-sm font-bold text-white hover:bg-teal-800"><Plus size={17} />Start a community</Link>
    </div>
    <nav aria-label="Explore sections" className="mt-7 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
      <button onClick={() => setTab('all')} aria-pressed={tab === 'all'} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === 'all' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'}`}>All communities</button>
      <button onClick={() => setTab('mine')} aria-pressed={tab === 'mine'} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === 'mine' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'}`}>My communities</button>
      <Link href="/news" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Visa news</Link>
      <Link href="/tags" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Browse tags</Link>
    </nav>
    <div className="my-6 grid gap-3 sm:grid-cols-[minmax(200px,1fr)_180px_180px]">
      <label className="relative"><span className="sr-only">Search communities</span><Search size={18} className="absolute left-3 top-3 text-slate-400" /><input value={search} maxLength={80} onChange={(event) => { setSearch(event.target.value); resetPage(); }} placeholder="Search communities" className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3" /></label>
      <select aria-label="Community category" value={category} onChange={(event) => { setCategory(event.target.value); resetPage(); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5"><option value="">All categories</option>{COMMUNITY_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select>
      <input aria-label="Filter by country" value={country} maxLength={80} onChange={(event) => { setCountry(event.target.value); resetPage(); }} placeholder="Country or Worldwide" className="rounded-lg border border-slate-300 bg-white px-3 py-2.5" />
    </div>
    {membershipError && <div role="alert" className="mb-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{membershipError} <button onClick={() => setMembershipRetry((n) => n + 1)} className="font-bold underline">Retry memberships</button></div>}
    {actionError && <p role="alert" className="mb-4 rounded-lg bg-rose-50 p-4 text-sm text-rose-800">{actionError}</p>}
    {tab === 'mine' && !user ? <div className="rounded-xl border bg-white p-8"><h2 className="text-lg font-bold">Your communities, together</h2><p className="mt-2 text-sm text-slate-600">Log in to join communities and find them here.</p><Link href="/login?next=%2Fexplore" className="mt-4 inline-block font-bold text-teal-700 underline">Log in</Link></div> : <>
      {(tab === 'all' ? error : mineError) && <div role="alert" className="mb-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{tab === 'all' ? error : mineError} <button onClick={() => tab === 'all' ? setRetry((n) => n + 1) : setMembershipRetry((n) => n + 1)} className="font-bold underline">Retry</button></div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{displayed.map((community) => {
        const membership = memberMap.get(community.id);
        return <article key={community.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-3"><span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800">{community.category}</span><span className="text-xs text-slate-500">{community.country}</span></div>
          <Link href={`/c/${community.slug}`} className="mt-4 text-lg font-bold text-slate-900 hover:text-teal-700">{community.display_name}</Link>
          <p className="mt-1 text-xs text-slate-500">c/{community.slug}</p><p className="mb-5 mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{community.description}</p>
          <div className="mt-auto flex items-center justify-between gap-3"><span className="flex items-center gap-1.5 text-xs text-slate-500"><Users size={15} />{Number(community.member_count).toLocaleString()} {Number(community.member_count) === 1 ? 'member' : 'members'}</span><button disabled={authLoading || membershipLoading || !!membershipError || busy.has(community.id) || membership?.role === 'owner'} onClick={() => void changeMembership(community)} aria-label={`${membership ? 'Leave' : 'Join'} ${community.display_name}`} className={`rounded-full border px-4 py-2 text-xs font-bold disabled:cursor-default disabled:opacity-60 ${membership ? 'border-slate-300 text-slate-700' : 'border-teal-700 bg-teal-700 text-white hover:bg-teal-800'}`}>{busy.has(community.id) ? 'Saving…' : membership?.role === 'owner' ? 'Owner' : membership ? 'Leave' : 'Join'}</button></div>
        </article>;
      })}</div>
      {pageLoading && <p role="status" className="py-8 text-sm text-slate-500">Loading communities…</p>}
      {!pageLoading && !displayed.length && !(tab === 'all' ? error : mineError || membershipError) && <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8"><h2 className="text-lg font-bold">{tab === 'mine' && !memberships.length ? 'Find your first community' : 'No communities match yet'}</h2><p className="mt-2 text-sm text-slate-600">{tab === 'mine' ? 'Browse all communities to join a conversation, or adjust the filters.' : 'Try a broader search or start a community for your topic.'}</p>{tab === 'mine' && <button onClick={() => { setTab('all'); setSearch(''); setCategory(''); setCountry(''); resetPage(); }} className="mt-4 font-bold text-teal-700 underline">Explore all communities</button>}</div>}
      {(tab === 'all' ? next : matchingMine.length > visibleMine) && <button disabled={pageLoading} onClick={() => tab === 'all' ? setAfter(next) : setVisibleMine((n) => n + 24)} className="mx-auto mt-6 block rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-bold disabled:opacity-50">Load more communities</button>}
    </>}
  </main>;
}

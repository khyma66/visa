'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { COMMUNITY_CATEGORIES, createCommunity, getCommunityBySlug, listCommunities, validateCommunity, type Community, type CommunityCategory } from '@/lib/groups';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { useAuth } from './AuthProvider';

export function CreateCommunity() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState('');
  const country = 'United States';
  const [category, setCategory] = useState<CommunityCategory>('General');
  const [rules, setRules] = useState('Be respectful and share relevant experiences.\nDo not share personal documents or identifying information.');
  const [similar, setSimilar] = useState<Community[]>([]);
  const [similarError, setSimilarError] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [retry, setRetry] = useState(0);
  const submitLock = useRef<symbol | null>(null);
  const alive = useRef(true);
  const currentActor = useRef(user?.id);
  currentActor.current = user?.id;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { submitLock.current = null; setSubmitting(false); setError(''); }, [user?.id]);
  useEffect(() => {
    const controller = new AbortController();
    setSimilar([]); setSimilarError('');
    if (!isSupabaseConfigured || name.trim().length < 3) { setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      const search = name.trim().replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').slice(0, 80);
      void listCommunities({ country, search, limit: 5, signal: controller.signal }).then((page) => { if (!controller.signal.aborted) setSimilar(page.communities); })
        .catch((reason) => { if (!controller.signal.aborted) setSimilarError(reason instanceof Error ? reason.message : 'Could not check similar communities.'); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 300);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [name, retry]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || loading) return;
    if (!user) { router.push('/login?next=%2Fcommunities%2Fnew'); return; }
    if (!isSupabaseConfigured) { setError('Shared communities are unavailable until the community service is connected.'); return; }
    const operation = Symbol();
    submitLock.current = operation; setSubmitting(true); setError('');
    const actor = user.id;
    try {
      const input = validateCommunity({ slug, display_name: name, description, country, category, rules: rules.split('\n') });
      const existing = await getCommunityBySlug(input.slug);
      if (!alive.current || currentActor.current !== actor || submitLock.current !== operation) return;
      if (existing) { setSimilar((current) => [existing, ...current.filter((row) => row.id !== existing.id)]); throw new Error('That community address already exists. Open it below to join, or choose a different address.'); }
      await createCommunity(input);
      if (alive.current && currentActor.current === actor && submitLock.current === operation) router.push(`/c/${input.slug}`);
    } catch (reason) {
      if (alive.current && currentActor.current === actor && submitLock.current === operation) setError(reason instanceof Error ? reason.message : 'Could not create the community. Please retry.');
      if (submitLock.current === operation) {
        submitLock.current = null;
        if (alive.current) setSubmitting(false);
      }
    }
  }

  const inputClass = 'mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100';
  return <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
    <Link href="/explore" className="text-sm font-semibold text-blue-700 hover:underline">← Explore Communities</Link>
    <h1 className="mt-5 text-3xl font-bold tracking-tight">Start a Community</h1>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Create a place for a specific U.S. visa or shared experience. Check for an existing community first so people can find each other.</p>
    {!isSupabaseConfigured && <p role="alert" className="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Shared communities are unavailable until the community service is connected. Community creation is disabled here.</p>}
    {!loading && !user && <p className="mt-5 rounded-lg border bg-white p-4 text-sm"><Link href="/login?next=%2Fcommunities%2Fnew" className="font-bold text-blue-700 underline">Log In</Link> to create a community and become its owner.</p>}
    <div className="mt-7 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <form onSubmit={submit} className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 sm:p-7">
        <fieldset disabled={submitting || loading || !isSupabaseConfigured} className="space-y-5 disabled:opacity-70">
          <label className="block text-sm font-semibold">Community Name<input required minLength={3} maxLength={80} value={name} onChange={(event) => { setName(event.target.value); if (!slugEdited) setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)); }} placeholder="Example: H-1B Visa Holders" className={inputClass} /></label>
          <label className="block text-sm font-semibold">Community Address<div className="mt-2 flex items-center rounded-lg border border-slate-300 bg-white pl-3"><span className="text-slate-500">c/</span><input required minLength={3} maxLength={40} pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" value={slug} onChange={(event) => { setSlugEdited(true); setSlug(event.target.value.toLowerCase()); }} aria-describedby="slug-help" className="w-full rounded-lg bg-white px-2 py-2.5 outline-none focus:ring-2 focus:ring-blue-100" /></div><span id="slug-help" className="mt-2 block text-xs font-normal leading-5 text-slate-500">Choose a unique address: 3–40 lowercase letters, numbers or single hyphens. Your community will be linked at /c/{slug || 'your-community'}.</span></label>
          <label className="block text-sm font-semibold">Description<textarea required minLength={20} maxLength={500} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Who is this community for, and what questions belong here?" className={inputClass} /><span className="mt-1 block text-xs font-normal text-slate-500">{description.length}/500 characters · minimum 20</span></label>
          <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold">Category<select value={category} onChange={(event) => setCategory(event.target.value as CommunityCategory)} className={inputClass}>{COMMUNITY_CATEGORIES.map((item) => <option key={item} value={item}>{item === 'Work visas' ? 'Work Visas' : item}</option>)}</select></label><label className="block text-sm font-semibold">Country<input required maxLength={80} value={country} readOnly aria-describedby="community-country-help" className={inputClass} /></label></div>
          <p id="community-country-help" className="text-xs text-slate-500">Communities currently cover U.S. visas only.</p><label className="block text-sm font-semibold">Community Rules<textarea maxLength={1004} rows={5} value={rules} onChange={(event) => setRules(event.target.value)} className={inputClass} /><span className="mt-2 block text-xs font-normal text-slate-500">One rule per line, up to five rules. Maximum 200 characters per rule. Sitewide community rules always apply.</span></label>
          <div className="rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-600"><strong className="text-slate-900">Public community.</strong> Anyone can read its questions. Signed-in members can join and post. You become the owner and remain responsible for its rules.</div>
          {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
          <button formNoValidate={!user} disabled={submitting || loading || !isSupabaseConfigured} className="rounded-lg bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">{submitting ? 'Creating…' : user ? 'Create Community' : 'Log In to create'}</button>
        </fieldset>
      </form>
      <aside className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Check Existing Communities</h2><p className="mt-2 text-sm leading-6 text-slate-600">As you name your community, close matches appear here. Joining an existing group keeps helpful answers together.</p>{searching && <p role="status" className="mt-4 text-sm text-slate-500">Searching communities…</p>}{similarError && <p role="alert" className="mt-4 text-sm text-amber-800">{similarError} <button onClick={() => setRetry((n) => n + 1)} className="font-bold underline">Retry</button></p>}<ul className="mt-4 space-y-4">{similar.map((row) => <li key={row.id}><Link href={`/c/${row.slug}`} className="font-semibold text-blue-700 hover:underline">{row.display_name}</Link><p className="mt-1 text-xs text-slate-500">c/{row.slug} · {Number(row.member_count).toLocaleString()} members</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{row.description}</p></li>)}</ul>{!searching && !similarError && name.trim().length >= 3 && !similar.length && isSupabaseConfigured && <p className="mt-4 text-sm text-slate-500">No close name matches found. The address is checked when you create.</p>}<Link href="/explore" className="mt-5 inline-block text-sm font-bold text-blue-700 underline">Browse All Communities</Link></aside>
    </div>
  </main>;
}

'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, CheckCircle2, Plus, Search, X } from 'lucide-react';
import { getCommunityById, getMembershipForCommunity, listMyCommunitiesPage, type Community } from '@/lib/groups';
import { createQuestion } from '@/lib/community';
import { normalizeTags, suggestTags } from '@/lib/tagging';
import { useAuth } from './AuthProvider';
import { RelatedQuestions } from './RelatedQuestions';

import { VISA_TYPES, EXPERIENCE_CATEGORIES } from '@/lib/post-categories';

export function AskQuestionForm({ experience = false }: { experience?: boolean } = {}) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const [category, setCategory] = useState(EXPERIENCE_CATEGORIES[0]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [country, setCountry] = useState('United States');
  const [visaType, setVisaType] = useState('H-1B');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [communities, setCommunities] = useState<Community[]>([]);
  const [communityId, setCommunityId] = useState('');
  const [communitiesLoading, setCommunitiesLoading] = useState(false);
  const [communityError, setCommunityError] = useState('');
  const [communityRevision, setCommunityRevision] = useState(0);
  const [communitySearch, setCommunitySearch] = useState('');
  const [communityAfter, setCommunityAfter] = useState<string | null>(null);
  const [communityNext, setCommunityNext] = useState<string | null>(null);
  const [communityHistory, setCommunityHistory] = useState<(string | null)[]>([]);
  const [communityPage, setCommunityPage] = useState(1);
  const communityNavigation = useRef(false);
  const [selection, setSelection] = useState<{ userId: string; id: string; community: Community | null; active: boolean } | null>(null);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [selectionError, setSelectionError] = useState('');
  const submitLock = useRef<symbol | null>(null);
  const alive = useRef(true);
  const currentActor = useRef(user?.id);
  currentActor.current = user?.id;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { submitLock.current = null; setSubmitting(false); setCommunityAfter(null); setCommunityHistory([]); setCommunityPage(1); communityNavigation.current = false; }, [user?.id]);
  useEffect(() => {
    setCommunityId(new URLSearchParams(window.location.search).get('community') ?? '');
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setCommunities([]); setCommunityNext(null); setCommunityError('');
    if (!user || loading) { setCommunitiesLoading(false); communityNavigation.current = false; return () => controller.abort(); }
    setCommunitiesLoading(true);
    const timer = setTimeout(() => {
      void listMyCommunitiesPage({ search: communitySearch, after: communityAfter, signal: controller.signal }).then((page) => {
        if (!controller.signal.aborted) { setCommunities(page.communities); setCommunityNext(page.nextCursor); }
      }).catch(() => { if (!controller.signal.aborted) setCommunityError('Your communities could not be loaded. Retry or change the search.'); })
        .finally(() => { if (!controller.signal.aborted) { setCommunitiesLoading(false); communityNavigation.current = false; } });
    }, communitySearch ? 250 : 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [user?.id, loading, communitySearch, communityAfter, communityRevision]);
  useEffect(() => {
    const controller = new AbortController();
    setSelection(null); setSelectionError('');
    if (!communityId || !user || loading) { setSelectionLoading(false); return () => controller.abort(); }
    setSelectionLoading(true);
    void Promise.all([getCommunityById(communityId, controller.signal), getMembershipForCommunity(user.id, communityId, controller.signal)])
      .then(([community, membership]) => {
        if (!controller.signal.aborted) setSelection({ userId: user.id, id: communityId, community, active: !!community && !!membership?.is_active });
      }).catch(() => { if (!controller.signal.aborted) setSelectionError('The selected community could not be checked. Retry before publishing.'); })
      .finally(() => { if (!controller.signal.aborted) setSelectionLoading(false); });
    return () => controller.abort();
  }, [user?.id, loading, communityId, communityRevision]);
  const selectedCommunity = selection?.userId === user?.id && selection?.id === communityId ? selection.community : null;
  const loginReturn = `/login?next=${encodeURIComponent(`${experience ? '/experiences/new' : '/ask'}${communityId ? `?community=${encodeURIComponent(communityId)}` : ''}`)}`;

  const suggestedTags = suggestTags(`${title}\n${body}`);

  function addTag(value: string) {
    const next = normalizeTags([...selectedTags, value]);
    if (next.length > selectedTags.length) setSelectedTags(next);
    setTagInput('');
  }


  function resetCommunityPage() { setCommunityAfter(null); setCommunityHistory([]); setCommunityPage(1); }
  function nextCommunityPage() {
    if (!communityNext || communitiesLoading || communityNavigation.current) return;
    communityNavigation.current = true;
    setCommunityHistory((history) => [...history, communityAfter].slice(-50)); setCommunityAfter(communityNext); setCommunityPage((page) => page + 1);
  }
  function previousCommunityPage() {
    if (!communityHistory.length || communitiesLoading || communityNavigation.current) return;
    communityNavigation.current = true;
    setCommunityAfter(communityHistory.at(-1) ?? null); setCommunityHistory((history) => history.slice(0, -1)); setCommunityPage((page) => Math.max(1, page - 1));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitLock.current || loading) return;
    if (!user) { router.push(loginReturn); return; }
    if (communityId && (selectionLoading || selectionError || selection?.id !== communityId || selection?.userId !== user.id || !selection.active)) {
      setError('Join this community before posting, or choose General questions.'); return;
    }
    const operation = Symbol();
    const actor = user.id;
    submitLock.current = operation;
    const normalizedTags = normalizeTags([...selectedTags, tagInput, ...suggestedTags]);
    setSubmitting(true);
    setError('');
    try {
      const id = await createQuestion(user.id, {
        title: title.trim(), body: body.trim(), destination_country: country.trim(), visa_type: visaType, tags: normalizedTags,
        ...(experience ? { post_kind: 'experience' as const, experience_category: category } : {}),
        ...(communityId ? { community_id: communityId } : {}),
      });
      if (alive.current && currentActor.current === actor && submitLock.current === operation) router.push(`/${experience ? 'experiences' : 'questions'}/${id}`);
    } catch (reason) {
      if (alive.current && currentActor.current === actor && submitLock.current === operation) {
        setError(reason instanceof Error ? reason.message : 'Could not publish the question.');
        setSubmitting(false); submitLock.current = null;
      }
    }
  }

  if (loading) return <div className="mx-auto max-w-4xl p-8">Loading your profile…</div>;

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section>
        <p className="text-sm font-bold uppercase tracking-wider text-teal-700">{experience ? 'Share a visa experience' : 'Ask the community'}</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{experience ? 'Help others learn from your visa journey' : 'Share the details that make your case different'}</h1>
        <p className="mt-3 text-slate-600">You will post publicly as <b>u/{profile?.username ?? 'your-random-handle'}</b>.</p>
        {!user && <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertTriangle className="mr-2 inline" size={17} /> <Link href={loginReturn} className="font-bold underline">Log in</Link> before publishing. Your email remains private.</div>}
        <form onSubmit={submit} className="mt-7 space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <label className="block"><span className="font-bold text-slate-900">Community</span>
            <select aria-label="Community" value={communityId} onChange={(event) => setCommunityId(event.target.value)} disabled={submitting} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3">
              <option value="">General questions</option>
              {communityId && !communities.some((community) => community.id === communityId) && <option value={communityId}>{selectedCommunity?.display_name ?? (selectionLoading ? 'Checking community…' : 'Join this community before posting')}</option>}
              {communities.map((community) => <option key={community.id} value={community.id}>{community.display_name}</option>)}
            </select>
            <span className="mt-2 block text-sm text-slate-500">Choose a community you joined, or ask the whole community. <Link href="/explore" className="font-bold text-teal-700 underline">Find a community</Link></span>
          </label>
          {user && <div className="space-y-3">
            <label className="block text-sm font-semibold">Search your communities<input maxLength={80} value={communitySearch} onChange={(event) => { setCommunitySearch(event.target.value); resetCommunityPage(); }} placeholder="Find a community you joined" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
            <div className="flex flex-wrap items-center gap-3 text-sm">{communityAfter && <button type="button" disabled={communitiesLoading} onClick={resetCommunityPage} className="rounded border px-3 py-2 disabled:opacity-40">First page</button>}<button type="button" disabled={communitiesLoading || !communityHistory.length} onClick={previousCommunityPage} className="rounded border px-3 py-2 disabled:opacity-40">Previous communities</button><button type="button" disabled={communitiesLoading || !communityNext} onClick={nextCommunityPage} className="rounded border px-3 py-2 disabled:opacity-40">Next communities</button><span className="text-xs text-slate-500">Page {communityPage} · up to 24 communities</span></div>
          </div>}
          {communitiesLoading && <p role="status">Loading your communities…</p>}
          {selectionLoading && <p role="status">Checking selected community…</p>}
          {selectionError && <div role="alert" className="text-sm text-rose-700">{selectionError} <button type="button" onClick={() => setCommunityRevision((value) => value + 1)} className="font-bold underline">Retry selection</button></div>}
          {communityError && <div role="alert" className="text-sm text-rose-700">{communityError} <button type="button" onClick={() => setCommunityRevision((value) => value + 1)} className="font-bold underline">Retry</button></div>}
          <label className="block">
            <span className="font-bold text-slate-900">{experience ? 'Experience title' : 'Question title'}</span>
            <span className="mt-1 block text-sm text-slate-500">Write the exact question another person might search.</span>
            <input required minLength={15} maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Can I… / How should I…"
              className="mt-3 w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-100" />
          </label>
          <div className="grid gap-5 sm:grid-cols-2">
            <label><span className="font-bold text-slate-900">Destination country</span><input required maxLength={80} value={country} onChange={(event) => setCountry(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:border-teal-600" /></label>
            <label><span className="font-bold text-slate-900">Visa type</span><select value={visaType} onChange={(event) => setVisaType(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 outline-none focus:border-teal-600">{VISA_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
          </div>
          {visaType === 'Other' && <p className="text-sm text-slate-600">Please mention your visa type in the title or details below.</p>}
          {experience && <label className="block"><span className="font-bold text-slate-900">Experience category</span><select required value={category} onChange={event => setCategory(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3">{EXPERIENCE_CATEGORIES.map(value => <option key={value}>{value}</option>)}</select></label>}
          <label className="block">
            <span className="font-bold text-slate-900">Situation and timeline</span>
            <span className="mt-1 block text-sm text-slate-500">Describe relevant dates, visa type and steps already taken. Do not paste documents or identifying numbers.</span>
            <textarea required minLength={30} maxLength={10000} rows={9} value={body} onChange={(event) => setBody(event.target.value)} className="mt-3 w-full resize-y rounded-lg border border-slate-300 px-4 py-3 leading-6 outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-100" />
          </label>
          <div className="block">
            <span className="font-bold text-slate-900">Tags</span>
            <span className="mt-1 block text-sm text-slate-500">Tags are suggested from your title and situation as you type. Add up to five.</span>
            <div className="mt-3 flex min-h-12 flex-wrap items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 focus-within:border-teal-600 focus-within:ring-4 focus-within:ring-teal-100">
              {selectedTags.map((tag) => <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2.5 py-1.5 text-sm font-bold text-blue-700">{tag}<button type="button" aria-label={`Remove ${tag}`} onClick={() => setSelectedTags((current) => current.filter((item) => item !== tag))} className="rounded p-0.5 hover:bg-blue-100"><X size={13} /></button></span>)}
              <input value={tagInput} onChange={(event) => setTagInput(event.target.value)} onKeyDown={(event) => { if (event.key === ',' || event.key === 'Enter' || event.key === 'Tab') { if (tagInput.trim()) { event.preventDefault(); addTag(tagInput); } } }} placeholder={selectedTags.length ? 'Add another tag' : 'h1b, transfer, premium-processing'} className="min-w-48 flex-1 border-0 p-1 outline-none" />
            </div>
            {suggestedTags.length > 0 && <div className="mt-3 rounded-lg bg-slate-50 p-3"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500"><Check size={14} /> Suggested from your post</div><div className="mt-2 flex flex-wrap gap-2">{suggestedTags.map((tag) => selectedTags.includes(tag) ? <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700"><Check size={12} /> {tag}</span> : <button key={tag} type="button" onClick={() => addTag(tag)} disabled={selectedTags.length >= 5} className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1.5 text-xs font-bold text-blue-700 shadow-sm ring-1 ring-slate-200 hover:bg-blue-50 disabled:opacity-40"><Plus size={12} /> {tag}</button>)}</div></div>}
            <p className="mt-2 text-xs text-slate-500">Your selected tags are saved. Suggested tags are added automatically when you publish.</p>
          </div>
          {error && <p className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p>}
          <button disabled={submitting} className="rounded-lg bg-teal-700 px-5 py-3 font-bold text-white hover:bg-teal-800 disabled:opacity-60">{submitting ? 'Publishing…' : experience ? 'Publish experience' : 'Publish question'}</button>
        </form>
      </section>
      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <RelatedQuestions drafting context={{ title, body, tags: normalizeTags([...selectedTags, tagInput, ...suggestedTags]), visa_type: visaType, destination_country: country }} />
        {['Search first and review close matches.', 'Use a specific title with the visa type.', 'Remove names, case numbers, emails, and addresses.', 'Return to accept the answer that solved your question.'].map((tip) => <div key={tip} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600"><CheckCircle2 className="mt-0.5 shrink-0 text-teal-600" size={18} />{tip}</div>)}
      </aside>
    </main>
  );
}

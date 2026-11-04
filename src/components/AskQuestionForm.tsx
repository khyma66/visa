'use client';

import { CompactTextarea } from './CompactTextarea';

import { ResizablePostLayout } from './ResizablePostLayout';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, CheckCircle2, Plus, X } from 'lucide-react';
import { getCommunityById, getMembershipForCommunity, listMyCommunitiesPage, type Community } from '@/lib/groups';
import { createQuestion } from '@/lib/community';
import { topicLabel } from '@/lib/post-presentation';
import { normalizeTags, POPULAR_POST_TAGS, suggestTags } from '@/lib/tagging';
import { useAuth } from './AuthProvider';
import { RelatedQuestions } from './RelatedQuestions';

import { VISA_TYPES, EXPERIENCE_CATEGORIES } from '@/lib/post-categories';

export function AskQuestionForm({ experience = false }: { experience?: boolean } = {}) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const [category, setCategory] = useState(EXPERIENCE_CATEGORIES[0]);
  const [sos, setSos] = useState(false);
  const [sharedPath, setSharedPath] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const country = 'United States';
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
  const [draftLoaded, setDraftLoaded] = useState(false);
  const currentActor = useRef(user?.id);
  currentActor.current = user?.id;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { submitLock.current = null; setSubmitting(false); setCommunityAfter(null); setCommunityHistory([]); setCommunityPage(1); communityNavigation.current = false; }, [user?.id]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setCommunityId(params.get('community') ?? '');
    setSos(!experience && params.get('sos') === '1');
    const shared = params.get('shared') ?? '';
    if (/^\/(?:us\/en\/)?(?:questions|experiences)\/(?:apify-[a-z0-9_-]{1,100}|[a-f0-9-]{36})$/i.test(shared)) setSharedPath(shared);
  }, []);
  const draftKey = `visathreads:${experience ? 'experience' : 'question'}-draft:v1`;
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) {
        const draft = JSON.parse(saved) as { title?: unknown; body?: unknown; visaType?: unknown; tags?: unknown; tagInput?: unknown; category?: unknown; communityId?: unknown };
        if (typeof draft.title === 'string') setTitle(draft.title.slice(0, 180));
        if (typeof draft.body === 'string') setBody(draft.body.slice(0, 10000));
        if (typeof draft.visaType === 'string' && VISA_TYPES.includes(draft.visaType)) setVisaType(draft.visaType);
        if (Array.isArray(draft.tags)) setSelectedTags(normalizeTags(draft.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 5)));
        if (typeof draft.tagInput === 'string') setTagInput(draft.tagInput.slice(0, 40));
        if (experience && typeof draft.category === 'string' && EXPERIENCE_CATEGORIES.includes(draft.category)) setCategory(draft.category);
        if (typeof draft.communityId === 'string') setCommunityId(draft.communityId.slice(0, 100));
      }
    } catch { /* Draft recovery is best-effort when browser storage is unavailable. */ }
    setDraftLoaded(true);
  }, [draftKey, experience]);
  useEffect(() => {
    if (!draftLoaded) return;
    try { sessionStorage.setItem(draftKey, JSON.stringify({ title, body, visaType, tags: selectedTags, tagInput, category, communityId })); }
    catch { /* Keep editing available when browser storage is unavailable or full. */ }
  }, [draftKey, draftLoaded, title, body, visaType, selectedTags, tagInput, category, communityId]);
  useEffect(() => {
    const controller = new AbortController();
    setCommunities([]); setCommunityNext(null); setCommunityError('');
    if (!user || loading) { setCommunitiesLoading(false); communityNavigation.current = false; return () => controller.abort(); }
    setCommunitiesLoading(true);
    const timer = setTimeout(() => {
      void listMyCommunitiesPage({ country, search: communitySearch, after: communityAfter, signal: controller.signal }).then((page) => {
        if (!controller.signal.aborted) { setCommunities(page.communities); setCommunityNext(page.nextCursor); }
      }).catch(() => { if (!controller.signal.aborted) setCommunityError('Your Communities could not be loaded. Retry or change the search.'); })
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
  const returnParams = new URLSearchParams();
  if (communityId) returnParams.set('community', communityId);
  if (sos && !experience) returnParams.set('sos', '1');
  if (sharedPath) returnParams.set('shared', sharedPath);
  const loginReturn = `/login?next=${encodeURIComponent(`${experience ? '/experiences/new' : '/ask'}${returnParams.size ? `?${returnParams}` : ''}`)}`;

  const suggestedTags = suggestTags(`${title}\n${body}`);

  function addTag(value: string) {
    setSelectedTags((current) => normalizeTags([...current, value]));
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
    if (sharedPath && !communityId) { setError('Choose a community you have joined before sharing this discussion.'); return; }
    if (communityId && (selectionLoading || selectionError || selection?.id !== communityId || selection?.userId !== user.id || !selection.active)) {
      setError('Join this community before posting, or choose General Questions.'); return;
    }
    if (sos && !experience && normalizeTags(selectedTags).filter(tag => tag !== 'sos').length >= 5) {
      setError('SOS uses one of the five tag slots. Remove a tag before posting.'); return;
    }
    const sourceUrl = sharedPath ? new URL(sharedPath, window.location.origin).href : '';
    const sharedBody = sourceUrl && !body.includes(sourceUrl) ? `${body.trim()}\n\nOriginal discussion: ${sourceUrl}` : body.trim();
    if (sharedBody.length > 10000) { setError('Shorten your post to make room for the original discussion link.'); return; }
    const operation = Symbol();
    const actor = user.id;
    submitLock.current = operation;
    const normalizedTags = normalizeTags([...(sos && !experience ? ['sos'] : []), ...selectedTags, tagInput, ...suggestedTags]);
    setSubmitting(true);
    setError('');
    try {
      const id = await createQuestion(user.id, {
        title: title.trim(), body: sharedBody, destination_country: country.trim(), visa_type: visaType, tags: normalizedTags,
        ...(experience ? { post_kind: 'experience' as const, experience_category: category } : {}),
        ...(communityId ? { community_id: communityId } : {}),
      });
      try { sessionStorage.removeItem(draftKey); } catch { /* Draft cleanup is best-effort. */ }
      if (alive.current && currentActor.current === actor && submitLock.current === operation) router.push(`/us/en/${experience ? 'experiences' : 'questions'}/${id}`);
    } catch (reason) {
      if (alive.current && currentActor.current === actor && submitLock.current === operation) {
        setError(reason instanceof Error ? reason.message : 'Could not publish the question.');
        setSubmitting(false); submitLock.current = null;
      }
    }
  }

  if (loading) return <div className="mx-auto max-w-4xl p-8 capitalize">Loading your profile…</div>;

  return (
    <main className="page-shell">
      <ResizablePostLayout mainLabel="Compose a post" relatedLabel="Related questions and posting guidance" related={<div className="space-y-4">
        <RelatedQuestions drafting context={{ title, body, tags: normalizeTags([...selectedTags, tagInput, ...suggestedTags]), visa_type: visaType, destination_country: country }} />
        {['Search first and review close matches.', 'Use a specific title with the visa type.', 'Return to accept the answer that solved your question.'].map((tip) => <div key={tip} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600"><CheckCircle2 className="mt-0.5 shrink-0 text-blue-600" size={18} />{tip}</div>)}
      </div>}>
      <section>
        <p className="text-sm font-bold tracking-wider text-blue-700 capitalize">{experience ? 'Share a Visa Experience' : 'Ask the Community'}</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 capitalize">{experience ? 'Help others learn from your visa journey' : 'Share the details that make your case different'}</h1>
        {user ? <p className="mt-3 text-slate-600">You will post publicly as <b>u/{profile?.username ?? 'your public username'}</b>.</p> : <p className="mt-3 text-sm text-slate-600 capitalize"><Link href={loginReturn} className="font-semibold text-blue-700 underline capitalize">Log in</Link> or <Link href={loginReturn.replace('/login?', '/signup?')} className="font-semibold text-blue-700 underline capitalize">create an account</Link> to publish. Your draft is kept in this browser tab while you sign in.</p>}
        <form onSubmit={submit} className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          {!experience && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={sos} onChange={event => setSos(event.target.checked)} /> Mark as SOS: urgent visa question</label>{sos && <p className="mt-2 leading-6">Community replies are not immediate or guaranteed. If someone is in immediate danger in the U.S., call 911.</p>}</div>}
          {sharedPath && <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950"><p>Choose a community you have joined and add your own title and context. A link to the original discussion will be added when you post. Check that sharing it is appropriate for the chosen audience.</p></div>}
          <p className="text-sm text-slate-500 capitalize"><span aria-hidden="true" className="font-semibold text-rose-700 capitalize">*</span> Required fields</p>
          <label className="block"><span className="font-bold text-slate-900 capitalize">Community <span className="text-sm font-normal text-slate-500 capitalize">(optional)</span></span>
            <select aria-label="Community" value={communityId} onChange={(event) => setCommunityId(event.target.value)} disabled={submitting} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3">
              <option value="" className="capitalize">General Questions</option>
              {communityId && !communities.some((community) => community.id === communityId) && <option value={communityId}>{selectedCommunity?.display_name ?? (selectionLoading ? 'Checking community…' : 'Join this community before posting')}</option>}
              {communities.map((community) => <option key={community.id} value={community.id}>{community.display_name}</option>)}
            </select>
            <span className="mt-2 block text-sm text-slate-500 capitalize">Choose a community you joined, or ask the whole community. <Link href="/us/en/explore" className="font-bold text-blue-700 underline capitalize">Find a community</Link></span>
          </label>
          {user && <div className="space-y-3">
            <label className="block text-sm font-semibold capitalize">Search your communities<input maxLength={80} value={communitySearch} onChange={(event) => { setCommunitySearch(event.target.value); resetCommunityPage(); }} placeholder="Find a community you joined" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
            <div className="flex flex-wrap items-center gap-3 text-sm">{communityAfter && <button type="button" disabled={communitiesLoading} onClick={resetCommunityPage} className="rounded border px-3 py-2 disabled:opacity-40 capitalize">First page</button>}<button type="button" disabled={communitiesLoading || !communityHistory.length} onClick={previousCommunityPage} className="rounded border px-3 py-2 disabled:opacity-40 capitalize">Previous communities</button><button type="button" disabled={communitiesLoading || !communityNext} onClick={nextCommunityPage} className="rounded border px-3 py-2 disabled:opacity-40 capitalize">Next communities</button><span className="text-xs text-slate-500">Page {communityPage} · up to 24 communities</span></div>
          </div>}
          {communitiesLoading && <p role="status" className="capitalize">Loading your communities…</p>}
          {selectionLoading && <p role="status" className="capitalize">Checking selected community…</p>}
          {selectionError && <div role="alert" className="text-sm text-rose-700">{selectionError} <button type="button" onClick={() => setCommunityRevision((value) => value + 1)} className="font-bold underline capitalize">Retry selection</button></div>}
          {communityError && <div role="alert" className="text-sm text-rose-700">{communityError} <button type="button" onClick={() => setCommunityRevision((value) => value + 1)} className="font-bold underline capitalize">Retry</button></div>}
          <label className="block capitalize">
            <span className="font-bold text-slate-900 capitalize">{experience ? 'Experience Title' : 'Question Title'} <span aria-hidden="true" className="text-rose-700 capitalize">*</span></span>
            <span id="post-title-help" className="mt-1 block text-sm text-slate-500 capitalize">Be specific. Use 15–180 characters.</span>
            <input aria-label={experience ? 'Experience Title' : 'Question Title'} aria-describedby="post-title-help" required minLength={15} maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Can I… / How should I…"
              className="mt-3 w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-100" />
          </label>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="capitalize"><span className="font-bold text-slate-900 capitalize">Destination Country</span><input readOnly value={country} className="mt-2 w-full rounded-lg border border-slate-200 bg-blue-50 px-4 py-3 text-blue-900" /><span className="mt-1 block text-xs text-slate-500 capitalize">U.S. visa topics only for now.</span></label>
            <label><span className="font-bold text-slate-900 capitalize">Visa Type <span aria-hidden="true" className="text-rose-700 capitalize">*</span></span><select aria-label="Visa Type" required value={visaType} onChange={(event) => setVisaType(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 outline-none focus:border-blue-600">{VISA_TYPES.map((type) => <option key={type} value={type}>{type === 'Family / spouse' ? 'Family / Spouse' : type}</option>)}</select></label>
          </div>
          {visaType === 'Other' && <p className="text-sm text-slate-600 capitalize">Please mention your visa type in the title or details below.</p>}
          {experience && <label className="block"><span className="font-bold text-slate-900 capitalize">Experience Category <span aria-hidden="true" className="text-rose-700 capitalize">*</span></span><select aria-label="Experience Category" required value={category} onChange={event => setCategory(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3">{EXPERIENCE_CATEGORIES.map(value => <option key={value}>{value}</option>)}</select></label>}
          <label className="block capitalize">
            <span className="font-bold text-slate-900 capitalize">Details <span aria-hidden="true" className="text-rose-700 capitalize">*</span></span>
            <span id="post-body-help" className="mt-1 block text-sm text-slate-500 capitalize">Share the relevant context in at least 30 characters. Dates and timelines are optional.</span>
            <CompactTextarea aria-label="Details" aria-describedby="post-body-help" required minLength={30} maxLength={10000} rows={3} value={body} onChange={(event) => setBody(event.target.value)} className="mt-3 w-full rounded-lg border border-slate-300 px-4 py-3 leading-6 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-100" />
          </label>
          <div className="block">
            <span className="font-bold text-slate-900 capitalize">Tags <span className="text-sm font-normal text-slate-500 capitalize">(optional)</span></span>
            <span id="post-tags-help" className="mt-1 block text-sm text-slate-500 capitalize">Pick popular tags below or type your own. Add up to five.</span>
            <div className="mt-3 flex min-h-12 flex-wrap items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 focus-within:border-blue-600 focus-within:ring-4 focus-within:ring-blue-100">
              {selectedTags.map((tag) => <span key={topicLabel(tag)} className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2.5 py-1.5 text-sm font-bold text-blue-700">{topicLabel(tag)}<button type="button" aria-label={`Remove ${topicLabel(tag)}`} onClick={() => setSelectedTags((current) => current.filter((item) => item !== tag))} className="rounded p-0.5 hover:bg-blue-100"><X size={13} /></button></span>)}
              <input aria-label="Add a tag" aria-describedby="post-tags-help post-tags-count" disabled={selectedTags.length >= 5 || submitting} maxLength={40} value={tagInput} onChange={(event) => setTagInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); if (event.key === ',' || event.key === 'Enter' || event.key === 'Tab') { if (tagInput.trim()) { event.preventDefault(); addTag(tagInput); } } }} placeholder={selectedTags.length >= 5 ? 'Remove a tag to add another' : selectedTags.length ? 'Add another tag' : 'Type a tag and press Enter'} className="min-w-0 basis-40 flex-1 border-0 p-1 outline-none disabled:bg-transparent" />
            </div>
            <p id="post-tags-count" role="status" className="mt-2 text-xs text-slate-500">{selectedTags.length}/5 tags selected{selectedTags.length >= 5 ? ' · Remove a tag to choose another.' : ''}</p>
            <div className="mt-3" role="group" aria-label="Popular tags">
              <p className="text-xs font-bold tracking-wide text-slate-500 capitalize">Popular Tags</p>
              <div className="mt-2 flex flex-wrap gap-2">{POPULAR_POST_TAGS.map((tag) => {
                const selected = selectedTags.includes(tag);
                return <button key={tag} type="button" aria-pressed={selected} disabled={submitting || (!selected && selectedTags.length >= 5)} onClick={() => selected ? setSelectedTags((current) => current.filter((item) => item !== tag)) : addTag(tag)} className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-40 ${selected ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-blue-700 hover:border-blue-300 hover:bg-blue-50'}`}>
                  {selected ? <Check size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}{topicLabel(tag)}
                </button>;
              })}</div>
            </div>
            {suggestedTags.length > 0 && <div className="mt-3 rounded-lg bg-slate-50 p-3"><div className="flex items-center gap-2 text-xs font-bold tracking-wide text-slate-500"><Check size={14} /> Suggested from Your Post</div><div className="mt-2 flex flex-wrap gap-2">{suggestedTags.map((tag) => selectedTags.includes(tag) ? <span key={topicLabel(tag)} className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700"><Check size={12} /> {topicLabel(tag)}</span> : <button key={topicLabel(tag)} type="button" onClick={() => addTag(tag)} disabled={selectedTags.length >= 5} className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1.5 text-xs font-bold text-blue-700 shadow-sm ring-1 ring-slate-200 hover:bg-blue-50 disabled:opacity-40"><Plus size={12} /> {topicLabel(tag)}</button>)}</div></div>}
            <p className="mt-2 text-xs text-slate-500 capitalize">Your selected tags are saved. Suggested tags are added automatically when you publish.</p>
          </div>
          {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p>}
          <button disabled={submitting} className="rounded-lg bg-blue-700 px-5 py-3 font-bold text-white hover:bg-blue-800 disabled:opacity-60 capitalize">{submitting ? 'Publishing…' : experience ? 'Publish Experience' : 'Publish Question'}</button>
        </form>
      </section>

      </ResizablePostLayout>
    </main>
  );
}

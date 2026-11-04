'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bell, Bookmark, CheckCircle2, CircleHelp, LockKeyhole, MessageCircle, Settings, UserRound } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { Avatar } from './Avatar';
import { SavedPosts } from './SavedPosts';
import { getSupabase } from '@/lib/supabase/client';
import { getAccountActivity, getAccountIdentity, hasAccountPolicyAcceptance, saveProfileBio, type AccountActivity, type AccountIdentity, type ActivityKind } from '@/lib/account';
import { POLICY_VERSION } from '@/lib/policy';

const control = 'rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const tabs = [
  { id: 'profile', label: 'Profile', Icon: UserRound },
  { id: 'saved', label: 'Saved posts', Icon: Bookmark },
  { id: 'following', label: 'Following', Icon: Bell },
  { id: 'activity', label: 'Activity', Icon: CircleHelp },
  { id: 'reputation', label: 'Reputation', Icon: CheckCircle2 },
  { id: 'settings', label: 'Settings', Icon: Settings },
] as const;

type ReputationEvent = { id: number; kind: string; delta: number; reason: string; created_at: string };
function Reputation() {
  const { user, demoMode, refreshProfile } = useAuth();
  const [data, setData] = useState<{ total: number; events: ReputationEvent[] } | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!user || demoMode) return;
    let active = true;
    setLoading(true); setError('');
    void Promise.resolve(getSupabase().rpc('my_reputation', { before_event: cursor }).abortSignal(AbortSignal.timeout(8000)))
      .then(({ data: result, error: failure }) => {
        if (!active) return;
        if (failure || !result || !Array.isArray(result.events)) { setError('Reputation history is unavailable. Please try again.'); return; }
        setData(result);
        void refreshProfile().catch(() => {});
      }).catch(() => { if (active) setError('Reputation history is unavailable. Please try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id, demoMode, cursor, retry]);
  return <section aria-label="Your reputation" className="p-5 sm:p-7">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">Your reputation</h2><button type="button" disabled={loading && !demoMode} className={control} onClick={() => { setCursor(null); setRetry(v => v + 1); }}>Refresh</button></div>
    <p className="mt-2 text-sm leading-6 text-slate-600">Earn recognition when other members find your contributions helpful. Posting itself does not earn points.</p>
    <dl className="mt-5 grid grid-cols-3 gap-3 text-center"><div className="rounded-xl bg-teal-50 p-3"><dt className="text-xs text-teal-900">Question upvote</dt><dd className="mt-1 text-xl font-bold text-teal-800">+2</dd></div><div className="rounded-xl bg-blue-50 p-3"><dt className="text-xs text-blue-900">Answer upvote</dt><dd className="mt-1 text-xl font-bold text-blue-800">+5</dd></div><div className="rounded-xl bg-amber-50 p-3"><dt className="text-xs text-amber-900">Accepted answer</dt><dd className="mt-1 text-xl font-bold text-amber-800">+10</dd></div></dl>
    <p className="mt-4 text-xs leading-5 text-slate-500">Qualifying votes and acceptances come from verified accounts at least 24 hours old. Up to 100 new points per UTC day, with at most 20 from one member. Self-votes do not count. Withdrawn votes, removed content and account moderation can reverse awards. Reputation does not certify legal expertise or have monetary value.</p>
    {demoMode ? <p className="mt-6 text-slate-500">Reputation history is available after signing in to the connected community.</p> : error ? <p role="alert" className="mt-6 text-rose-700">{error}</p> : loading ? <p role="status" className="mt-6 text-slate-500">Loading reputation…</p> : data && <>
      <p className="mt-6 text-lg font-semibold">{data.total} reputation <span className="text-sm font-normal text-slate-500">including your starting point</span></p>
      {data.events.length ? <ol className="mt-4 divide-y divide-slate-100">{data.events.slice(0,20).map(event => <li key={event.id} className="flex items-start gap-4 py-4"><span className={`min-w-10 font-bold ${event.delta > 0 ? 'text-teal-700' : 'text-slate-600'}`}>{event.delta > 0 ? '+' : ''}{event.delta}</span><div><p className="text-sm font-semibold">{event.kind === 'question_upvote' ? 'Helpful question' : event.kind === 'answer_upvote' ? 'Helpful answer' : 'Accepted answer'}</p><p className="mt-1 text-xs text-slate-500">{event.reason} · <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time></p></div></li>)}</ol> : <p className="mt-4 text-sm text-slate-500">No reputation changes yet. Your questions and answers are listed in Activity.</p>}
      {(cursor !== null || data.events.length > 20) && <div className="mt-4 flex justify-between gap-3"><button className={control} disabled={cursor === null} onClick={() => setCursor(null)}>Latest</button><button className={control} disabled={data.events.length <= 20} onClick={() => setCursor(data.events[19].id)}>Older activity</button></div>}
    </>}
  </section>;
}

function Activity({ userId }: { userId: string }) {
  const [kind, setKind] = useState<ActivityKind>('questions');
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<AccountActivity[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const loadedKey = useRef('');
  const key = `${userId}:${kind}:${page}`;
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void getAccountActivity(getSupabase(), userId, kind, page).then(result => {
      if (!active) return;
      setItems(result.items); setMore(result.more); loadedKey.current = key;
    }).catch(() => { if (active) setError('Your activity could not be loaded. Please try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, kind, page, retry, key]);
  const pending = loading || loadedKey.current !== key;
  return <section aria-label="Your activity">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 p-5">
      <div className="capitalize"><h2 className="text-xl font-bold capitalize">Your contributions</h2><p className="mt-1 text-sm text-slate-500 capitalize">Your published questions and answers, newest first.</p></div>
      <div className="flex gap-2" role="group" aria-label="Activity type">{(['questions', 'answers'] as const).map(value => <button key={value} type="button" aria-pressed={kind === value} onClick={() => { setKind(value); setPage(0); }} className={`${control} ${kind === value ? 'border-blue-700 bg-blue-50 text-blue-800' : ''} capitalize`}>{value === 'questions' ? 'Questions' : 'Answers'}</button>)}</div>
    </div>
    {error ? <div className="p-6"><p role="alert" className="text-rose-700">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className={`${control} mt-3 capitalize`}>Try again</button></div> : pending ? <p role="status" className="p-6 text-slate-500">Loading your {kind}…</p> : items.length ? <div className="divide-y divide-slate-100">{items.map(item => <article key={item.id} className="p-5">
      <Link href={`/us/en/questions/${kind === 'questions' ? item.id : item.question_id}`} className="text-lg font-semibold text-blue-700 hover:underline">{item.title ?? 'Your answer'}</Link>
      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{item.body}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500"><span>{item.vote_score} votes</span>{item.answer_count !== undefined && <span>{item.answer_count} answers</span>}{item.is_accepted && <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 capitalize"><CheckCircle2 size={14} />Accepted answer</span>}<time dateTime={item.created_at}>{new Date(item.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</time></div>
    </article>)}</div> : <div className="p-8 text-center"><h3 className="font-bold">{page ? 'No more contributions' : `No ${kind} yet`}</h3><p className="mt-2 text-sm text-slate-500 capitalize">{kind === 'questions' ? 'Your questions will appear here after you publish them.' : 'Share what you know in a discussion to get started.'}</p><Link href={kind === 'questions' ? '/ask' : '/'} className="mt-4 inline-block text-sm font-bold text-blue-700 underline capitalize">{kind === 'questions' ? 'Ask a Question' : 'Explore questions'}</Link></div>}
    <div className="flex items-center justify-between border-t border-slate-200 p-5"><button type="button" disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)} className={`${control} capitalize`}>Previous</button><span className="text-sm text-slate-500">Page {page + 1}</span><button type="button" disabled={pending || !more || Boolean(error)} onClick={() => setPage(value => value + 1)} className={`${control} capitalize`}>Next</button></div>
  </section>;
}

function AccountSettings() {
  const { user, profile, demoMode, refreshProfile } = useAuth();
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [identity, setIdentity] = useState<AccountIdentity | null>(null);
  const [identityError, setIdentityError] = useState('');
  const [policyStatus, setPolicyStatus] = useState<'loading' | 'accepted' | 'required' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  useEffect(() => { setBio(profile?.bio ?? ''); }, [profile?.id, profile?.bio]);
  useEffect(() => {
    if (!user || demoMode) return;
    let active = true;
    setIdentity(null); setIdentityError(''); setPolicyStatus('loading');
    void getAccountIdentity(getSupabase(), user.id).then(value => { if (active) setIdentity(value); })
      .catch(() => { if (active) setIdentityError('We could not verify your sign-in details.'); });
    void hasAccountPolicyAcceptance(getSupabase(), user.id, POLICY_VERSION)
      .then(accepted => { if (active) setPolicyStatus(accepted ? 'accepted' : 'required'); })
      .catch(() => { if (active) setPolicyStatus('error'); });
    return () => { active = false; };
  }, [user?.id, demoMode, retry]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!user || !profile || demoMode || policyStatus !== 'accepted' || inFlight.current) return;
    inFlight.current = true; setSaving(true); setMessage(''); setError('');
    try {
      await saveProfileBio(getSupabase(), user.id, bio);
      try { await refreshProfile(); setMessage('Your public bio has been updated.'); }
      catch { setMessage('Your bio was saved. Refresh the page to see the latest profile.'); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Your bio could not be saved.'); }
    finally { inFlight.current = false; setSaving(false); }
  }
  return <div className="divide-y divide-slate-200">
    <section className="p-5 sm:p-7"><h2 className="text-xl font-bold capitalize">Edit profile</h2><p className="mt-2 text-sm text-slate-500 capitalize">Your username and bio appear with your community profile.</p>
      <div className="mt-5"><p className="text-sm font-semibold capitalize">Username</p><p className="mt-2 rounded-lg bg-slate-100 px-4 py-3 text-slate-700">{profile?.username ?? 'Profile unavailable'}</p><p className="mt-2 text-xs text-slate-500 capitalize">Your community username is assigned when you join and cannot be changed here.</p></div>
      {!demoMode && policyStatus !== 'accepted' && <div className="mt-5 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 capitalize">{policyStatus === 'loading' ? <p role="status" className="capitalize">Checking profile editing access…</p> : policyStatus === 'required' ? <Link href="/us/en" className="font-semibold text-blue-700 underline capitalize">Review community terms to edit your profile</Link> : <><p role="alert" className="capitalize">We could not check whether profile editing is available.</p><button type="button" onClick={() => setRetry(value => value + 1)} className="mt-2 font-semibold text-blue-700 underline capitalize">Try again</button></>}</div>}
      <form onSubmit={event => void save(event)} className="mt-5"><label htmlFor="account-bio" className="text-sm font-semibold capitalize">About you</label><textarea id="account-bio" rows={4} maxLength={280} value={bio} onChange={event => { setBio(event.target.value); setMessage(''); setError(''); }} disabled={saving || !profile || demoMode || policyStatus !== 'accepted'} aria-describedby="account-bio-help" className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm leading-6 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /><div id="account-bio-help" className="mt-1 flex justify-between gap-4 text-xs text-slate-500"><span className="capitalize">This bio is public. Keep contact details and case numbers private.</span><span className="shrink-0">{[...bio].length}/280</span></div>
        <button type="submit" disabled={saving || !profile || demoMode || policyStatus !== 'accepted' || bio.trim() === (profile.bio ?? '')} className="mt-4 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50 capitalize">{saving ? 'Saving…' : 'Save profile'}</button>
        {message && <p role="status" className="mt-3 text-sm text-emerald-700">{message}</p>}{error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
      </form>
    </section>
    <section className="p-5 sm:p-7"><h2 className="flex items-center gap-2 text-xl font-bold capitalize"><LockKeyhole size={20} />Sign-in details</h2><p className="mt-2 text-sm text-slate-500 capitalize">Private to you. These details never appear in your public profile.</p>
      {demoMode ? <p className="mt-4 text-sm text-slate-500 capitalize">Sign-in settings are unavailable in the local preview.</p> : identityError ? <div className="mt-4"><p role="alert" className="text-sm text-rose-700">{identityError}</p><button type="button" onClick={() => setRetry(value => value + 1)} className={`${control} mt-3 capitalize`}>Try again</button></div> : !identity ? <p role="status" className="mt-4 text-sm text-slate-500 capitalize">Verifying your sign-in details…</p> : <>
        <dl className="mt-5 space-y-4 text-sm"><div><dt className="font-semibold text-slate-500 capitalize">Account email</dt><dd className="mt-1 break-all">{identity.email ?? 'No email linked'}{identity.email && <span className="ml-2 text-xs text-slate-500 capitalize">{identity.emailVerified ? 'Verified' : 'Not verified'}</span>}</dd></div><div><dt className="font-semibold text-slate-500 capitalize">Connected sign-in methods</dt><dd className="mt-1">{identity.providers.map(provider => provider === 'google' ? 'Google' : provider === 'email' ? 'Email' : provider === 'phone' ? 'Phone' : provider).join(', ') || 'Your current sign-in method'}</dd></div></dl>
        {identity.email && identity.emailVerified && <Link href="/account/update-password" className="mt-5 inline-block text-sm font-bold text-blue-700 underline capitalize">Set or change your password</Link>}
      </>}
    </section>
    <section className="p-5 sm:p-7"><h2 className="text-xl font-bold capitalize">Privacy and support</h2><div className="mt-4 flex flex-wrap gap-5 text-sm font-semibold text-blue-700 capitalize"><Link href="/privacy-choices" className="underline capitalize">Privacy choices</Link><Link href="/contact" className="underline capitalize">Request account help or deletion</Link></div></section>
  </div>;
}

export function AccountClient() {
  const { user, profile, loading, profileLoading, demoMode, refreshProfile } = useAuth();
  const search = useSearchParams();
  const requested = search.get('tab');
  const tab = tabs.some(item => item.id === requested) ? requested : 'profile';
  const [retrying, setRetrying] = useState(false);
  const [profileError, setProfileError] = useState('');
  if (loading && !user) return <main className="site-shell py-12" role="status">Loading your account…</main>;
  if (!user) return <main className="mx-auto max-w-xl px-4 py-16"><h1 className="text-3xl font-bold capitalize">Your Account</h1><p className="mt-3 text-slate-600 capitalize">Log In to see your profile, contributions and settings.</p><Link href={`/login?next=${encodeURIComponent(`/account?tab=${tab}`)}`} className="mt-6 inline-block rounded-lg bg-blue-700 px-5 py-3 font-bold text-white capitalize">Log In</Link></main>;
  async function retryProfile() {
    setRetrying(true); setProfileError('');
    try { await refreshProfile(); }
    catch { setProfileError('Your profile could not be loaded. Please try again.'); }
    finally { setRetrying(false); }
  }
  return <main className="page-shell">
    <header className="flex items-center gap-4"><Avatar seed={profile?.avatar_seed ?? user.id} size="lg" /><div><p className="text-xs font-semibold tracking-wider text-slate-500 capitalize">Your Account</p><h1 className="mt-1 break-all text-2xl font-bold text-slate-950">{profile ? profile.username : 'Your community profile'}</h1><p className="mt-1 text-sm text-slate-500 capitalize">Manage your profile, contributions and sign-in.</p></div></header>
    <nav aria-label="Account sections" className="mb-6 mt-8 flex gap-1 overflow-x-auto border-b border-slate-200 capitalize">{tabs.map(({ id, label, Icon }) => <Link key={id} href={`/account?tab=${id}`} aria-current={tab === id ? 'page' : undefined} className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-5 py-3 text-sm font-semibold ${tab === id ? 'border-orange-500 text-slate-950' : 'border-transparent text-slate-500 hover:text-slate-950'}`}><Icon size={17} className="shrink-0" />{label}</Link>)}</nav>
    {!profile && <div role="status" className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="capitalize">{profileLoading ? 'Loading your community profile…' : 'Your sign-in is active, but your community profile could not be loaded.'}</p>{!profileLoading && <button type="button" disabled={retrying} onClick={() => void retryProfile()} className={`${control} mt-3 capitalize`}>{retrying ? 'Loading…' : 'Retry profile'}</button>}{profileError && <p role="alert" className="mt-2">{profileError}</p>}</div>}
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {tab === 'saved' || tab === 'following' ? <SavedPosts key={`${user.id}:${tab}`} userId={user.id} demoMode={demoMode} selection={tab === 'saved' ? 'saved' : 'followed'} /> : tab === 'reputation' ? <Reputation /> : tab === 'settings' ? <AccountSettings /> : tab === 'activity' ? demoMode ? <div className="p-7 capitalize"><h2 className="text-xl font-bold capitalize">Your contributions</h2><p className="mt-3 text-sm text-slate-500 capitalize">Account activity is available when real sign-in is connected.</p></div> : <Activity userId={user.id} /> : <section className="p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-4 capitalize"><div className="capitalize"><h2 className="text-xl font-bold capitalize">Profile</h2><p className="mt-2 text-sm text-slate-500 capitalize">This is how other members recognize you. Your avatar uses your first-name initial. Your full name stays private.</p></div><Link href="/account?tab=settings" className={`${control} capitalize`}>Edit profile</Link></div><dl className="mt-7 grid gap-6 sm:grid-cols-2"><div><dt className="text-sm font-semibold text-slate-500 capitalize">Community username</dt><dd className="mt-2 font-semibold">{profile?.username ?? (profileLoading ? 'Loading…' : 'Unavailable')}</dd></div><div><dt className="text-sm font-semibold text-slate-500 capitalize">Reputation</dt><dd className="mt-2 font-semibold">{profile?.reputation ?? '—'}</dd></div></dl><h3 className="mt-7 text-sm font-semibold text-slate-500 capitalize">About you</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">{profile ? profile.bio || 'You have not added a bio yet.' : profileLoading ? 'Loading your bio…' : 'Your bio could not be loaded.'}</p><div className="mt-7 flex flex-wrap gap-5 border-t border-slate-100 pt-5 text-sm font-semibold text-blue-700"><Link href="/account?tab=activity" className="underline capitalize">View your activity</Link><Link href="/account?tab=saved" className="underline">Saved posts</Link><Link href="/account?tab=following" className="underline">Following</Link><Link href="/messages" className="inline-flex items-center gap-2 underline capitalize"><MessageCircle size={16} />Messages</Link></div></section>}
    </div>
  </main>;
}

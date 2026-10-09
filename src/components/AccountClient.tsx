'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, CircleHelp, LockKeyhole, MessageCircle, Settings, UserRound } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { Avatar } from './Avatar';
import { getSupabase } from '@/lib/supabase/client';
import { getAccountActivity, getAccountIdentity, hasAccountPolicyAcceptance, saveProfileBio, type AccountActivity, type AccountIdentity, type ActivityKind } from '@/lib/account';
import { POLICY_VERSION } from '@/lib/policy';

const control = 'rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const tabs = [
  { id: 'profile', label: 'Profile', Icon: UserRound },
  { id: 'activity', label: 'Activity', Icon: CircleHelp },
  { id: 'settings', label: 'Settings', Icon: Settings },
] as const;

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
      <div><h2 className="text-xl font-bold">Your contributions</h2><p className="mt-1 text-sm text-slate-500">Your published questions and answers, newest first.</p></div>
      <div className="flex gap-2" role="group" aria-label="Activity type">{(['questions', 'answers'] as const).map(value => <button key={value} type="button" aria-pressed={kind === value} onClick={() => { setKind(value); setPage(0); }} className={`${control} ${kind === value ? 'border-blue-700 bg-blue-50 text-blue-800' : ''}`}>{value === 'questions' ? 'Questions' : 'Answers'}</button>)}</div>
    </div>
    {error ? <div className="p-6"><p role="alert" className="text-rose-700">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className={`${control} mt-3`}>Try again</button></div> : pending ? <p role="status" className="p-6 text-slate-500">Loading your {kind}…</p> : items.length ? <div className="divide-y divide-slate-100">{items.map(item => <article key={item.id} className="p-5">
      <Link href={`/questions/${kind === 'questions' ? item.id : item.question_id}`} className="text-lg font-semibold text-blue-700 hover:underline">{item.title ?? 'Your answer'}</Link>
      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{item.body}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500"><span>{item.vote_score} votes</span>{item.answer_count !== undefined && <span>{item.answer_count} answers</span>}{item.is_accepted && <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><CheckCircle2 size={14} />Accepted answer</span>}<time dateTime={item.created_at}>{new Date(item.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</time></div>
    </article>)}</div> : <div className="p-8 text-center"><h3 className="font-bold">{page ? 'No more contributions' : `No ${kind} yet`}</h3><p className="mt-2 text-sm text-slate-500">{kind === 'questions' ? 'Your questions will appear here after you publish them.' : 'Share what you know in a discussion to get started.'}</p><Link href={kind === 'questions' ? '/ask' : '/'} className="mt-4 inline-block text-sm font-bold text-blue-700 underline">{kind === 'questions' ? 'Ask a Question' : 'Explore questions'}</Link></div>}
    <div className="flex items-center justify-between border-t border-slate-200 p-5"><button type="button" disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)} className={control}>Previous</button><span className="text-sm text-slate-500">Page {page + 1}</span><button type="button" disabled={pending || !more || Boolean(error)} onClick={() => setPage(value => value + 1)} className={control}>Next</button></div>
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
    <section className="p-5 sm:p-7"><h2 className="text-xl font-bold">Edit profile</h2><p className="mt-2 text-sm text-slate-500">Your username and bio appear with your community profile.</p>
      <div className="mt-5"><p className="text-sm font-semibold">Username</p><p className="mt-2 rounded-lg bg-slate-100 px-4 py-3 text-slate-700">{profile?.username ?? 'Profile unavailable'}</p><p className="mt-2 text-xs text-slate-500">Your community username is assigned when you join and cannot be changed here.</p></div>
      {!demoMode && policyStatus !== 'accepted' && <div className="mt-5 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{policyStatus === 'loading' ? <p role="status">Checking profile editing access…</p> : policyStatus === 'required' ? <Link href="/" className="font-semibold text-blue-700 underline">Review community terms to edit your profile</Link> : <><p role="alert">We could not check whether profile editing is available.</p><button type="button" onClick={() => setRetry(value => value + 1)} className="mt-2 font-semibold text-blue-700 underline">Try again</button></>}</div>}
      <form onSubmit={event => void save(event)} className="mt-5"><label htmlFor="account-bio" className="text-sm font-semibold">About you</label><textarea id="account-bio" rows={4} maxLength={280} value={bio} onChange={event => { setBio(event.target.value); setMessage(''); setError(''); }} disabled={saving || !profile || demoMode || policyStatus !== 'accepted'} aria-describedby="account-bio-help" className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm leading-6 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /><div id="account-bio-help" className="mt-1 flex justify-between gap-4 text-xs text-slate-500"><span>This bio is public. Keep contact details and case numbers private.</span><span className="shrink-0">{[...bio].length}/280</span></div>
        <button type="submit" disabled={saving || !profile || demoMode || policyStatus !== 'accepted' || bio.trim() === (profile.bio ?? '')} className="mt-4 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Saving…' : 'Save profile'}</button>
        {message && <p role="status" className="mt-3 text-sm text-emerald-700">{message}</p>}{error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
      </form>
    </section>
    <section className="p-5 sm:p-7"><h2 className="flex items-center gap-2 text-xl font-bold"><LockKeyhole size={20} />Sign-in details</h2><p className="mt-2 text-sm text-slate-500">Private to you. These details never appear in your public profile.</p>
      {demoMode ? <p className="mt-4 text-sm text-slate-500">Sign-in settings are unavailable in the local preview.</p> : identityError ? <div className="mt-4"><p role="alert" className="text-sm text-rose-700">{identityError}</p><button type="button" onClick={() => setRetry(value => value + 1)} className={`${control} mt-3`}>Try again</button></div> : !identity ? <p role="status" className="mt-4 text-sm text-slate-500">Verifying your sign-in details…</p> : <>
        <dl className="mt-5 space-y-4 text-sm"><div><dt className="font-semibold text-slate-500">Account email</dt><dd className="mt-1 break-all">{identity.email ?? 'No email linked'}{identity.email && <span className="ml-2 text-xs text-slate-500">{identity.emailVerified ? 'Verified' : 'Not verified'}</span>}</dd></div><div><dt className="font-semibold text-slate-500">Connected sign-in methods</dt><dd className="mt-1">{identity.providers.map(provider => provider === 'google' ? 'Google' : provider === 'email' ? 'Email' : provider === 'phone' ? 'Phone' : provider).join(', ') || 'Your current sign-in method'}</dd></div></dl>
        {identity.email && identity.emailVerified && <Link href="/account/update-password" className="mt-5 inline-block text-sm font-bold text-blue-700 underline">Set or change your password</Link>}
      </>}
    </section>
    <section className="p-5 sm:p-7"><h2 className="text-xl font-bold">Privacy and support</h2><div className="mt-4 flex flex-wrap gap-5 text-sm font-semibold text-blue-700"><Link href="/privacy-choices" className="underline">Privacy choices</Link><Link href="/contact" className="underline">Request account help or deletion</Link></div></section>
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
  if (!user) return <main className="mx-auto max-w-xl px-4 py-16"><h1 className="text-3xl font-bold">Your Account</h1><p className="mt-3 text-slate-600">Log In to see your profile, contributions and settings.</p><Link href={`/login?next=${encodeURIComponent(`/account?tab=${tab}`)}`} className="mt-6 inline-block rounded-lg bg-blue-700 px-5 py-3 font-bold text-white">Log In</Link></main>;
  async function retryProfile() {
    setRetrying(true); setProfileError('');
    try { await refreshProfile(); }
    catch { setProfileError('Your profile could not be loaded. Please try again.'); }
    finally { setRetrying(false); }
  }
  return <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
    <header className="flex items-center gap-4"><Avatar seed={profile?.avatar_seed ?? user.id} size="lg" /><div><p className="text-xs font-semibold tracking-wider text-slate-500">Your Account</p><h1 className="mt-1 break-all text-2xl font-bold text-slate-950">{profile ? profile.username : 'Your community profile'}</h1><p className="mt-1 text-sm text-slate-500">Manage your profile, contributions and sign-in.</p></div></header>
    <nav aria-label="Account sections" className="mb-6 mt-8 flex gap-1 overflow-x-auto border-b border-slate-200">{tabs.map(({ id, label, Icon }) => <Link key={id} href={`/account?tab=${id}`} aria-current={tab === id ? 'page' : undefined} className={`inline-flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-semibold ${tab === id ? 'border-orange-500 text-slate-950' : 'border-transparent text-slate-500 hover:text-slate-950'}`}><Icon size={17} />{label}</Link>)}</nav>
    {!profile && <div role="status" className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p>{profileLoading ? 'Loading your community profile…' : 'Your sign-in is active, but your community profile could not be loaded.'}</p>{!profileLoading && <button type="button" disabled={retrying} onClick={() => void retryProfile()} className={`${control} mt-3`}>{retrying ? 'Loading…' : 'Retry profile'}</button>}{profileError && <p role="alert" className="mt-2">{profileError}</p>}</div>}
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {tab === 'settings' ? <AccountSettings /> : tab === 'activity' ? demoMode ? <div className="p-7"><h2 className="text-xl font-bold">Your contributions</h2><p className="mt-3 text-sm text-slate-500">Account activity is available when real sign-in is connected.</p></div> : <Activity userId={user.id} /> : <section className="p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-bold">Profile</h2><p className="mt-2 text-sm text-slate-500">This is how other members recognize you. Your avatar uses your first-name initial. Your full name stays private.</p></div><Link href="/account?tab=settings" className={control}>Edit profile</Link></div><dl className="mt-7 grid gap-6 sm:grid-cols-2"><div><dt className="text-sm font-semibold text-slate-500">Community username</dt><dd className="mt-2 font-semibold">{profile?.username ?? (profileLoading ? 'Loading…' : 'Unavailable')}</dd></div><div><dt className="text-sm font-semibold text-slate-500">Reputation</dt><dd className="mt-2 font-semibold">{profile?.reputation ?? '—'}</dd></div></dl><h3 className="mt-7 text-sm font-semibold text-slate-500">About you</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">{profile ? profile.bio || 'You have not added a bio yet.' : profileLoading ? 'Loading your bio…' : 'Your bio could not be loaded.'}</p><div className="mt-7 flex flex-wrap gap-5 border-t border-slate-100 pt-5 text-sm font-semibold text-blue-700"><Link href="/account?tab=activity" className="underline">View your activity</Link><Link href="/messages" className="inline-flex items-center gap-2 underline"><MessageCircle size={16} />Messages</Link></div></section>}
    </div>
  </main>;
}

'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { getSupabase } from '@/lib/supabase/client';
import { acceptanceInput, POLICY_VERSION } from '@/lib/policy';

// Identity-keyed by AuthProvider. Legal/help pages stay available without assent.
export function PolicyAcceptance({ children }: { children: React.ReactNode }) {
  const { user, loading, demoMode } = useAuth();
  const path = usePathname();
  const [status, setStatus] = useState<'loading' | 'required' | 'accepted' | 'error'>('loading');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!user || demoMode) return;
    let active = true;
    setStatus('loading');
    void Promise.resolve(getSupabase().from('policy_acceptances').select('policy_version').eq('user_id', user.id).eq('policy_version', POLICY_VERSION).abortSignal(AbortSignal.timeout(8000)).maybeSingle())
      .then(({ data, error: failure }) => { if (active) setStatus(failure ? 'error' : data ? 'accepted' : 'required'); })
      .catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [user?.id, demoMode, retry]);
  const exempt = ['/login', '/signup', '/account', '/privacy', '/terms', '/cookies', '/privacy-choices', '/contact', '/community-safety', '/countries', '/us', '/account/recovery', '/account/update-password'].includes(path);
  if (!user || demoMode || exempt || status === 'accepted') return <>{children}</>;
  async function accept() {
    if (!user || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const input = acceptanceInput(user.id, acknowledged, acknowledged, acknowledged);
      const { error: failure } = await getSupabase().from('policy_acceptances').insert(input);
      // A concurrent tab may have already recorded the same version.
      if (failure && failure.code !== '23505') throw failure;
      setStatus('accepted');
    } catch { setError('We could not save your acknowledgement. Please try again.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <main className="mx-auto max-w-2xl space-y-5 px-4 py-12">
    <h1 className="text-3xl font-bold">Join the discussion</h1>
    {loading || status === 'loading' ? <p role="status">Checking your policy acknowledgement…</p> : status === 'error' ? <><p role="alert">We could not check your policy acknowledgement. Your account has not been deleted.</p><button className="rounded-lg border px-4 py-2" onClick={() => setRetry(value => value + 1)}>Try again</button></> : <>
      <p className="text-slate-600">One confirmation to start posting, replying and messaging. We’ll remember it for your account.</p>
      <form onSubmit={event => { event.preventDefault(); void accept(); }} className="space-y-4">
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4"><input className="mt-1 h-5 w-5 shrink-0 accent-teal-700" type="checkbox" required checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} /><span>I am at least 18 and legally able to agree where I live. I agree to the <Link href="/terms" target="_blank" rel="noopener" className="text-teal-700 underline">Terms and community rules</Link> and acknowledge the <Link href="/privacy" target="_blank" rel="noopener" className="text-teal-700 underline">Privacy notice</Link>.</span></label>
        <p className="text-xs leading-5 text-slate-500">Policy links open in a new tab. This does not include consent to advertising, marketing or payments, or waive privacy rights. <Link href="/cookies" target="_blank" rel="noopener" className="underline">Cookie and storage notice</Link>.</p>
        {error && <p role="alert" className="text-rose-700">{error}</p>}
        <button disabled={busy || !acknowledged} className="rounded-xl bg-teal-700 px-5 py-3 font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Agree and continue'}</button>
      </form>
      <p className="text-xs text-slate-500">You can leave without accepting by signing out from your account menu, or <Link className="text-teal-700 underline" href="/contact">request account help</Link>.</p>
    </>}
    <p><Link className="text-teal-700 underline" href="/privacy-choices">Privacy choices and requests</Link></p>
  </main>;
}

'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase/client';
import { authFieldError, getPrivateContactPhone, savePrivateContactPhone } from '@/lib/auth-flow';

export function PrivateContactPhone({ userId, demoMode }: { userId: string; demoMode: boolean }) {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [retry, setRetry] = useState(0);
  const active = useRef(false);
  const locked = useRef(false);
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    if (demoMode) { setLoading(false); return () => { active.current = false; }; }
    setLoading(true); setError('');
    void getPrivateContactPhone(getSupabase(), userId).then(value => {
      if (!cancelled) { setPhone(value); setLoading(false); }
    }).catch(() => { if (!cancelled) setError('Your phone number could not be loaded. Retry before editing.'); });
    return () => { cancelled = true; active.current = false; };
  }, [userId, demoMode, retry]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (locked.current || loading || demoMode) return;
    const feedback = authFieldError('contactPhone', phone, false);
    if (feedback) { setError(feedback); return; }
    locked.current = true; setBusy(true); setError(''); setStatus('');
    try {
      const saved = await savePrivateContactPhone(getSupabase(), userId, phone);
      if (active.current) { setPhone(saved); setStatus(saved ? 'Phone number saved.' : 'Phone number removed.'); }
    } catch { if (active.current) setError('Your phone number could not be saved. Please try again.'); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }
  return <section className="border-t border-slate-200 p-5 sm:p-7" aria-labelledby="private-phone-heading">
    <h2 id="private-phone-heading" className="text-lg font-bold text-slate-950">Private contact details</h2>
    <p id="private-phone-help" className="mt-2 text-sm leading-6 text-slate-500">Optional and not shown on your public profile. This number is not verified and does not enable SMS sign-in or marketing messages. Leave it blank to remove it.</p>
    <Link href="/privacy/contact-phone" className="text-sm text-teal-700 underline">How we handle your contact number</Link>
    <form onSubmit={save} className="mt-4 max-w-md space-y-3">
      <label className="block text-sm font-semibold">Phone number (optional)<input type="tel" name="contactPhone" autoComplete="tel" maxLength={30} placeholder="+1 555 123 4567" value={phone} disabled={loading || busy || demoMode} aria-describedby="private-phone-help" onChange={event => { setPhone(event.target.value); setError(''); setStatus(''); }} onBlur={() => setError(authFieldError('contactPhone', phone, false))} className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2 font-normal disabled:bg-slate-50" /></label>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {loading && error ? <button type="button" onClick={() => setRetry(value => value + 1)} className="text-sm font-semibold text-blue-700">Retry loading</button> : <button disabled={loading || busy || demoMode} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">{loading ? 'Loading…' : busy ? 'Saving…' : 'Save phone number'}</button>}
      {demoMode && <p className="text-sm text-slate-500">Contact editing requires a signed-in account.</p>}
      {status && <p role="status" className="text-sm text-teal-800">{status}</p>}
    </form>
  </section>;
}

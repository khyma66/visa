'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useAuth } from './AuthProvider';
import { getSupabase } from '@/lib/supabase/client';
import { authErrorMessage, normalizeEmail, setVerifiedPassword } from '@/lib/auth-flow';

export function PasswordRecovery({ update = false }: { update?: boolean }) {
  const { user, loading, demoMode } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    if (update && password !== confirmation) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      if (update) {
        await setVerifiedPassword(getSupabase(), password);
        setDone(true); setPassword(''); setConfirmation('');
        setMessage('Password updated.');
      } else {
        const { error } = await getSupabase().auth.resetPasswordForEmail(normalizeEmail(email), { redirectTo: `${window.location.origin}/account/update-password` });
        if (error) throw error;
        setDone(true); setMessage('If this address has an account, a recovery email will arrive shortly. Check your spam folder too.');
      }
    } catch (reason) { setError(authErrorMessage(reason)); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-lg px-4 py-12">
    <section className="rounded-2xl border bg-white p-7 shadow-sm">
      <h1 className="text-2xl font-black">{update ? 'Set a new password' : 'Recover your account'}</h1>
      {demoMode ? <p className="mt-4">Account recovery is unavailable in demo mode.</p> : loading ? <p className="mt-4">Checking your session…</p> : update && !user ?
        <p className="mt-4">Open the latest recovery link from your email. If it expired, <Link href="/account/recovery" className="underline">request another link</Link>.</p> : !done &&
        <form onSubmit={submit} className="mt-6 space-y-4">
          {update ? <>
            <label className="block text-sm font-bold">New password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 w-full rounded-lg border p-3" /></label>
            <label className="block text-sm font-bold">Confirm password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="mt-2 w-full rounded-lg border p-3" /></label>
          </> : <label className="block text-sm font-bold">Account email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 w-full rounded-lg border p-3" /></label>}
          <button disabled={busy} className="w-full rounded-lg bg-blue-700 p-3 font-bold text-white disabled:opacity-50">{busy ? 'Please wait…' : update ? 'Update password' : 'Send recovery email'}</button>
        </form>}
      {message && <p role="status" className="mt-4 rounded bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="mt-4 rounded bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <Link href={update && done ? '/' : '/login'} className="mt-5 inline-block text-sm font-bold text-blue-700 underline">{update && done ? 'Continue to community' : 'Back to login'}</Link>
    </section>
  </main>;
}

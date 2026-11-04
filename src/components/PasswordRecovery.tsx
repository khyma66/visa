'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useAuth } from './AuthProvider';
import { TurnstileCheck } from './TurnstileCheck';
import { getSupabase } from '@/lib/supabase/client';
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, PASSWORD_GUIDANCE, authErrorMessage, requestPasswordRecovery, setVerifiedPassword } from '@/lib/auth-flow';

export function PasswordRecovery({ update = false }: { update?: boolean }) {
  const { user, loading, demoMode } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaReset, setCaptchaReset] = useState(0);
  const captchaSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? '';
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || loading || demoMode) return;
    setError(''); setMessage('');
    if (update && password !== confirmation) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      if (update) {
        await setVerifiedPassword(getSupabase(), password);
        setDone(true); setPassword(''); setConfirmation('');
        setMessage('Password updated.');
      } else {
        await requestPasswordRecovery(getSupabase(), email, `${window.location.origin}/account/update-password`, captchaToken);
        setDone(true); setMessage('If this address has an account, a recovery email will arrive shortly. Check your spam folder too.');
      }
    } catch (reason) { setError(authErrorMessage(reason)); }
    finally { setBusy(false); if (!update) { setCaptchaToken(''); setCaptchaReset(value => value + 1); } }
  }
  return <main className="auth-page">
    <section className="auth-card">
      <h1 className="text-2xl font-black capitalize">{update ? 'Set a new password' : 'Recover your account'}</h1>
      {demoMode ? <p className="mt-4">Account recovery is unavailable in demo mode.</p> : loading ? <p className="mt-4">Checking your session…</p> : update && !user ?
        <p className="mt-4">Open the latest recovery link from your email. If it expired, <Link href="/account/recovery" className="underline capitalize">request another link</Link>.</p> : !done &&
        <form onSubmit={submit} className="mt-5 space-y-3">
          <p className="text-xs text-slate-500"><span aria-hidden="true" className="text-red-600">*</span> Required fields</p>
          {update ? <>
            <label className="block text-sm font-bold capitalize">New password <span aria-hidden="true" className="text-red-600">*</span><input type="password" aria-describedby="password-guidance" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} required value={password} onChange={(e) => setPassword(e.target.value)} className="auth-input mt-2 min-h-11 w-full rounded-xl border p-3 outline-none" /></label>
            <label className="block text-sm font-bold capitalize">Confirm password <span aria-hidden="true" className="text-red-600">*</span><input type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="auth-input mt-2 min-h-11 w-full rounded-xl border p-3 outline-none" /></label>
          </> : <label className="block text-sm font-bold capitalize">Account email <span aria-hidden="true" className="text-red-600">*</span><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="auth-input mt-2 min-h-11 w-full rounded-xl border p-3 outline-none" /></label>}
          {update && <p id="password-guidance" className="text-xs leading-5 text-slate-500">{PASSWORD_GUIDANCE}</p>}
          {!update && captchaSiteKey && <TurnstileCheck siteKey={captchaSiteKey} resetKey={captchaReset} onToken={setCaptchaToken} />}
          <button disabled={busy || (!update && Boolean(captchaSiteKey && !captchaToken))} className="auth-primary w-full rounded-xl p-3 font-semibold text-white disabled:opacity-50 capitalize">{busy ? 'Please wait…' : update ? 'Update password' : 'Send recovery email'}</button>
        </form>}
      {message && <p role="status" className="mt-4 rounded bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="mt-4 rounded bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <Link href={update && done ? '/' : '/login'} className="mt-5 inline-block text-sm font-bold text-violet-700 underline capitalize">{update && done ? 'Continue to community' : 'Back to Log In'}</Link>
    </section>
  </main>;
}

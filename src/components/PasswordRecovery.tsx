'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
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
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState<'checking' | 'ready' | 'invalid'>(update ? 'checking' : 'ready');
  const inFlight = useRef(false);
  const captchaSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? '';
  useEffect(() => {
    if (!update || loading || demoMode) return;
    let active = true;
    // Reuse the SDK's initialization promise; never exchange a one-use code twice.
    void (async () => {
      try {
        const { error: initializationError } = await getSupabase().auth.initialize();
        const params = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.slice(1));
        // A code left behind after initialization means its verifier is missing
        // or the exchange failed. An older stored session is not proof of success.
        const failed = initializationError || ['code', 'error', 'error_code', 'error_description', 'access_token'].some(key => params.has(key) || hash.has(key));
        if (!active) return;
        if (failed) {
          setRecoveryStatus('invalid');
          setError('This recovery link couldn’t be verified. Request a new link and open it in the same browser.');
          window.history.replaceState(null, '', '/account/update-password');
        } else setRecoveryStatus('ready');
      } catch {
        if (active) { setRecoveryStatus('invalid'); setError('Your recovery session couldn’t be checked. Request a new link and try again.'); }
      }
    })();
    return () => { active = false; };
  }, [update, loading, demoMode]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || busy || done || loading || demoMode || (update && (!user || recoveryStatus !== 'ready'))) return;
    setError(''); setMessage('');
    if (update && password !== confirmation) { setError('Passwords do not match.'); return; }
    inFlight.current = true; setBusy(true);
    try {
      if (update) {
        await setVerifiedPassword(getSupabase(), password);
        setDone(true); setPassword(''); setConfirmation('');
        setMessage('Password updated.');
      } else {
        await requestPasswordRecovery(getSupabase(), email, `${window.location.origin}/account/update-password`, captchaToken);
        setMessage('If an account exists, check your inbox or spam folder for a recovery link. Use the newest email and open its link in this browser.');
      }
    } catch (reason) { setError(authErrorMessage(reason, { action: update ? 'update-password' : 'request-recovery' })); }
    finally { inFlight.current = false; setBusy(false); if (!update) { setCaptchaToken(''); setCaptchaReset(value => value + 1); } }
  }
  return <main className="auth-page">
    <section className="auth-card">
      <h1 className="text-2xl font-black capitalize">{update ? 'Set a new password' : 'Recover your account'}</h1>
      {demoMode ? <p className="mt-4 capitalize">Account recovery is unavailable in demo mode.</p> : loading || (update && recoveryStatus === 'checking') ? <p role="status" className="mt-4 capitalize">Checking your session…</p> : update && (!user || recoveryStatus === 'invalid') ?
        <p className="mt-4">Open your latest recovery email or <Link href="/account/recovery" className="underline">request another link</Link>.</p> : !done &&
        <form onSubmit={submit} aria-busy={busy} className="mt-5 space-y-3">
          <p className="text-xs text-slate-500 capitalize"><span aria-hidden="true" className="text-red-600 capitalize">*</span> Required fields</p>
          {update ? <>
            <div className="relative">
              <label className="block text-sm font-bold capitalize">New password <span aria-hidden="true" className="text-red-600 capitalize">*</span><input name="password" type={passwordVisible ? 'text' : 'password'} aria-describedby="password-guidance" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} required disabled={busy} value={password} onChange={(e) => setPassword(e.target.value)} className="auth-input mt-2 min-h-11 w-full rounded-xl border p-3 pr-12 outline-none" /></label>
              <button type="button" disabled={busy} aria-label={passwordVisible ? 'Hide password' : 'Show password'} aria-pressed={passwordVisible} onClick={() => setPasswordVisible(value => !value)} className="absolute bottom-0 right-0 flex h-12 w-12 items-center justify-center rounded-xl text-slate-600 hover:text-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700">{passwordVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
            </div>
            <label className="block text-sm font-bold capitalize">Confirm password <span aria-hidden="true" className="text-red-600 capitalize">*</span><input name="passwordConfirmation" type={passwordVisible ? 'text' : 'password'} autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} required disabled={busy} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="auth-input mt-2 min-h-11 w-full rounded-xl border p-3 outline-none" /></label>
          </> : <label className="block text-sm font-bold capitalize">Account email <span aria-hidden="true" className="text-red-600 capitalize">*</span><input name="email" type="email" autoComplete="email" maxLength={254} required disabled={busy} value={email} onChange={(e) => setEmail(e.target.value)} className="auth-input mt-2 min-h-11 w-full rounded-xl border p-3 outline-none" /></label>}
          {update && <p id="password-guidance" className="text-xs leading-5 text-slate-500">{PASSWORD_GUIDANCE}</p>}
          {!update && captchaSiteKey && <TurnstileCheck siteKey={captchaSiteKey} resetKey={captchaReset} onToken={setCaptchaToken} />}
          <button disabled={busy || (!update && Boolean(captchaSiteKey && !captchaToken))} className="auth-primary w-full rounded-xl p-3 font-semibold text-white disabled:opacity-50 capitalize">{busy ? 'Please wait…' : update ? 'Update password' : 'Send recovery email'}</button>
        </form>}
      {message && <p role="status" className="mt-4 rounded bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="mt-4 rounded bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <Link href={update && done ? '/' : '/login'} className="mt-5 inline-block text-sm font-bold text-teal-700 underline capitalize">{update && done ? 'Continue to community' : 'Back to Log In'}</Link>
    </section>
  </main>;
}

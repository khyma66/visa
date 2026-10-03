'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Mail, MessagesSquare, Search, Tags } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from './AuthProvider';
import { getAuthMethods } from '@/lib/supabase/client';
import { authCallbackUrl, authErrorMessage, safeAuthNext, type AuthMethods, type SocialProvider } from '@/lib/auth-flow';

const inputClass = 'mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-100';
const buttonClass = 'flex w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-3 font-bold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50';

export function AuthForm({ signup = false }: { signup?: boolean }) {
  const { requestCode, verifyCode, login, signInWithProvider, user, loading, demoMode } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [useCode, setUseCode] = useState(signup);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [methods, setMethods] = useState<AuthMethods | null>(null);
  const [settingsError, setSettingsError] = useState(false);
  const [retry, setRetry] = useState(0);
  const inFlight = useRef(false);
  const callback = () => authCallbackUrl(window.location.origin, signup ? '/account/update-password?setup=1' : new URLSearchParams(window.location.search).get('next'));

  useEffect(() => {
    if (demoMode) return;
    const controller = new AbortController();
    setSettingsError(false);
    getAuthMethods(controller.signal).then(setMethods).catch(() => { if (!controller.signal.aborted) setSettingsError(true); });
    return () => controller.abort();
  }, [demoMode, retry]);

  useEffect(() => {
    if (loading || demoMode) return;
    const params = new URLSearchParams(window.location.search);
    if (user) { router.replace(signup ? '/account/update-password?setup=1' : safeAuthNext(params.get('next'))); return; }
    if (params.get('auth') === 'callback' || params.has('error') || window.location.hash.includes('error=')) {
      setError('Sign-in wasn’t completed. Please try again from this page.');
      // Never show raw provider errors or retain authorization codes in the URL.
      window.history.replaceState(null, '', `/login?next=${encodeURIComponent(safeAuthNext(params.get('next')))}`);
    }
  }, [user, loading, demoMode, router, signup]);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch (reason) { setError(authErrorMessage(reason)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function sendCode() {
    await requestCode(email, callback());
    setStep('code'); setCode(''); setCooldown(60);
    setMessage('Check your inbox and spam folder for your VisaFlow sign-in email.');
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (step === 'email' && !useCode) { await login(email, password); setPassword(''); }
      else if (step === 'email') await sendCode();
      else await verifyCode(email, code);
    });
  }

  function social(provider: SocialProvider) {
    if (methods) void run(() => signInWithProvider(provider, methods, authCallbackUrl(window.location.origin, new URLSearchParams(window.location.search).get('next'))));
  }

  return (
    <main className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-5xl items-center gap-10 px-4 py-12 sm:px-6 md:grid-cols-2">
      <section>
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-teal-700">Your next step starts here</p>
        <h1 className="mt-3 text-4xl font-black leading-tight tracking-tight text-slate-950 sm:text-5xl">Visa questions.<br /><span className="text-teal-700">Shared experiences.</span><br />A clearer way forward.</h1>
        <p className="mt-5 max-w-md text-base leading-7 text-slate-600">Find people navigating the same visa journey. Ask a question, compare experiences, and keep useful answers close.</p>
        <div className="mt-8 space-y-5">
          <div className="flex gap-3"><Search aria-hidden="true" className="mt-1 shrink-0 text-teal-700" /><div><b>Find similar cases</b><p className="mt-1 text-sm leading-6 text-slate-600">Explore past questions about appointments, processing times, and next steps.</p></div></div>
          <div className="flex gap-3"><Tags aria-hidden="true" className="mt-1 shrink-0 text-teal-700" /><div><b>Explore the topics that matter</b><p className="mt-1 text-sm leading-6 text-slate-600">Browse by visa type, country, or stage in your application.</p></div></div>
          <div className="flex gap-3"><MessagesSquare aria-hidden="true" className="mt-1 shrink-0 text-teal-700" /><div><b>Connect with the community</b><p className="mt-1 text-sm leading-6 text-slate-600">Join discussions and send message requests to other members.</p></div></div>
        </div>
        <Link href="/" className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-teal-700 hover:underline">Just browsing? Explore questions <ArrowRight size={16} /></Link>
      </section>
      <section aria-label="Sign in to VisaFlow" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50 sm:p-8">
        {demoMode ? <><h2 className="text-2xl font-black">Explore the preview</h2><p className="my-4 text-sm text-slate-600">This preview uses a sample account. Real sign-in is not connected here.</p><button onClick={() => router.push('/')} className={buttonClass}>Explore questions</button></> : loading || user ? <div role="status" className="py-12 text-center"><h2 className="text-xl font-bold">{user ? 'You’re signed in' : 'Getting your sign-in ready…'}</h2><p className="mt-3 text-sm text-slate-600">Taking you back to VisaFlow.</p></div> : <>
          <div className="mb-5 inline-flex rounded-xl bg-teal-50 p-3 text-teal-700"><Mail aria-hidden="true" size={24} /></div>
          <h2 className="text-2xl font-black text-slate-950">{step === 'code' ? 'Check your email' : signup ? 'Join VisaFlow' : 'Welcome back'}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{step === 'code' ? <>Enter the one-time code sent to <strong className="break-all">{email.trim()}</strong>.</> : signup ? 'Verify your email, then choose a password.' : 'Log in to join discussions and connect with the community.'}</p>
          {step === 'email' && <>
            <div className="mt-6 grid gap-3">
              {(['google'] as const).map(provider => <button key={provider} type="button" disabled={busy || !methods?.[provider]} onClick={() => social(provider)} className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                Continue with Google{methods && !methods[provider] && <span className="text-xs font-normal">Not available yet</span>}
              </button>)}
            </div>
            {settingsError ? <p className="mt-2 text-xs text-slate-600">Couldn’t check social sign-in. <button type="button" onClick={() => setRetry(value => value + 1)} className="underline">Retry</button> or use email below.</p> : !methods && <p className="mt-2 text-xs text-slate-500" role="status">Checking sign-in options…</p>}
            <div className="my-5 flex items-center gap-3 text-xs text-slate-500"><span className="h-px flex-1 bg-slate-200" />or continue with email<span className="h-px flex-1 bg-slate-200" /></div>
          </>}
          <form onSubmit={submit} className="mt-5 space-y-4">
            {step === 'email' ? <label className="block text-sm font-bold text-slate-700">Email address<input type="email" name="email" required autoComplete="email" maxLength={254} placeholder="you@example.com" disabled={busy} value={email} onChange={event => setEmail(event.target.value)} className={inputClass} /></label> : <label className="block text-sm font-bold text-slate-700">Sign-in code<input type="text" name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} autoFocus disabled={busy} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 10))} className={`${inputClass} text-center text-2xl tracking-[0.25em]`} /></label>}
            {step === 'email' && !useCode && <label className="block text-sm font-bold text-slate-700">Password<input type="password" name="password" required autoComplete="current-password" maxLength={128} disabled={busy} value={password} onChange={event => setPassword(event.target.value)} className={inputClass} /></label>}
            {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
            {message && <p role="status" className="rounded-lg bg-teal-50 p-3 text-sm text-teal-800">{message}</p>}
            <button disabled={busy || (step === 'email' && useCode && cooldown > 0)} className={buttonClass}>{busy ? 'Please wait…' : step === 'email' ? (!useCode ? 'Log in' : cooldown ? `Try again in ${cooldown}s` : 'Send verification code') : 'Verify & continue'}<ArrowRight aria-hidden="true" size={17} /></button>
          </form>
          {step === 'email' && !signup && <div className="mt-4 flex flex-wrap justify-between gap-3 text-sm text-teal-700"><button type="button" disabled={busy} onClick={() => { setUseCode(value => !value); setPassword(''); setError(''); }}>{useCode ? 'Use a password instead' : 'Use an email code instead'}</button><Link href="/account/recovery" className="underline">Forgot password?</Link></div>}
          <p className="mt-4 text-sm text-slate-600">{signup ? 'Already a member? ' : 'New to VisaFlow? '}<Link href={signup ? '/login' : '/signup'} className="font-bold text-teal-700 underline">{signup ? 'Log in' : 'Create account'}</Link></p>
          {step === 'code' && <div className="mt-4 flex flex-wrap justify-between gap-3 text-sm font-bold text-teal-700"><button type="button" disabled={busy || cooldown > 0} onClick={() => void run(sendCode)} className="disabled:text-slate-400">{cooldown ? `Resend in ${cooldown}s` : 'Resend code'}</button><button type="button" disabled={busy} onClick={() => { setStep('email'); setCode(''); setError(''); setMessage(''); }}>Use a different email</button></div>}
          {step === 'code' && process.env.NEXT_PUBLIC_APP_ENV !== 'production' && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">Code-only email setup is still pending for this preview. If your email contains a sign-in link instead, open it in this same browser.</p>}
          <p className="mt-5 text-xs leading-5 text-slate-500">Your email is not shown on your public profile. A community username is created for you.</p>
          <div className="mt-5 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500"><p>Development preview — not open for general public signup. Do not register a child or share sensitive case details.</p><p className="mt-2"><Link href="/privacy" className="underline">Preview privacy notice</Link> · <Link href="/terms" className="underline">Community rules</Link> · <Link href="/community-safety" className="underline">Safety</Link></p></div>
        </>}
      </section>
    </main>
  );
}

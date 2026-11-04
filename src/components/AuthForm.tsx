'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from './AuthProvider';
import { TurnstileCheck } from './TurnstileCheck';
import { getAuthMethods } from '@/lib/supabase/client';
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, PASSWORD_GUIDANCE, authCallbackUrl, authErrorMessage, authCaptchaOptions, safeAuthNext, type AuthErrorContext, type AuthMethods, type SocialProvider } from '@/lib/auth-flow';

const inputClass = 'auth-input mt-1.5 min-h-11 w-full rounded-xl border px-3 py-2.5 font-normal text-slate-950 outline-none disabled:bg-slate-50';
const buttonClass = 'auth-primary flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-white transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const accountTabClass = 'rounded-lg px-3 py-2.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2';
const selectedAccountTabClass = 'bg-white text-teal-900 shadow-sm ring-1 ring-inset ring-teal-200 hover:bg-white';
const alternateAccountTabClass = 'cursor-pointer text-slate-600 hover:bg-teal-100 hover:text-teal-950 active:bg-teal-200';
type CodeChannel = 'email' | 'phone';

export function AuthForm({ signup = false }: { signup?: boolean }) {
  const { requestCode, verifyCode, requestPhoneCode, verifyPhoneCode, login, register, signInWithProvider, signOut, user, loading, demoMode } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [useCode, setUseCode] = useState(false);
  const [codeChannel, setCodeChannel] = useState<CodeChannel>('email');
  const [step, setStep] = useState<'email' | 'code' | 'confirmation'>('email');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [methods, setMethods] = useState<AuthMethods | null>(null);
  const [settingsError, setSettingsError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [sessionSlow, setSessionSlow] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaReset, setCaptchaReset] = useState(0);
  const [returnTo, setReturnTo] = useState('/');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const captchaSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? '';
  const resetCaptcha = () => { setCaptchaToken(''); setCaptchaReset(value => value + 1); };
  useEffect(() => {
    if (!loading) { setSessionSlow(false); return; }
    const timer = window.setTimeout(() => setSessionSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, [loading]);
  const inFlight = useRef(false);
  const callback = () => authCallbackUrl(window.location.origin, new URLSearchParams(window.location.search).get('next'));

  useEffect(() => {
    if (demoMode) return;
    const controller = new AbortController();
    setSettingsError(false);
    getAuthMethods().then(value => { if (!controller.signal.aborted) setMethods(value); }).catch(() => { if (!controller.signal.aborted) setSettingsError(true); });
    return () => controller.abort();
  }, [demoMode, retry]);

  useEffect(() => {
    if (loading || demoMode) return;
    const params = new URLSearchParams(window.location.search);
    const failed = params.has('error') || params.has('error_description') || window.location.hash.includes('error=');
    if (failed || (params.get('auth') === 'callback' && (!user || params.has('code')))) {
      setError('Sign-in wasn’t completed. Please try again from this page.');
      // Never show raw provider errors or retain authorization codes in the URL.
      window.history.replaceState(null, '', `/login?next=${encodeURIComponent(safeAuthNext(params.get('next')))}#sign-in`);
      return;
    }
    // A stored session is shown explicitly on a manual visit to /login.
    // Only a completed OAuth callback automatically continues to the requested page.
    if (user && params.get('auth') === 'callback') router.replace(safeAuthNext(params.get('next')));
  }, [user, loading, demoMode, router, signup]);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    setReturnTo(safeAuthNext(new URLSearchParams(window.location.search).get('next')));
  }, []);
  const accountHref = (createAccount: boolean) => `${createAccount ? '/signup' : '/login'}${returnTo === '/' ? '' : `?next=${encodeURIComponent(returnTo)}`}#sign-in`;

  async function run(action: () => Promise<void>, context: AuthErrorContext = {}) {
    if (inFlight.current || loading) return;
    inFlight.current = true; setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch (reason) { setError(authErrorMessage(reason, context)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function sendCode() {
    const token = authCaptchaOptions(captchaToken).captchaToken;
    try {
      if (codeChannel === 'phone') {
        if (!methods) throw { code: 'phone_provider_disabled' };
        await requestPhoneCode(phone, methods, signup, token);
      } else {
        await requestCode(email, callback(), signup, signup ? { firstName, lastName } : undefined, token);
      }
    } finally { resetCaptcha(); }
    setStep('code'); setCode(''); setCooldown(60);
    setMessage(codeChannel === 'phone'
      ? (signup ? 'Check your text messages for your VisaThreads verification code.' : 'If this number has an account, a sign-in code is on its way. New here? Choose Sign Up.')
      : (signup ? 'Check your inbox and spam folder for your VisaThreads verification code.' : 'If this email has an account, a VisaThreads sign-in email is on its way. New here? Choose Sign Up.'));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (step === 'confirmation') {
        const token = authCaptchaOptions(captchaToken).captchaToken;
        try { await verifyCode(email, code, token); } finally { resetCaptcha(); }
        router.replace(safeAuthNext(new URLSearchParams(window.location.search).get('next')));
        return;
      }
      if (step === 'email' && signup && codeChannel === 'email') {
        if (password !== passwordConfirmation) throw { code: 'password_mismatch' };
        const token = authCaptchaOptions(captchaToken).captchaToken;
        try {
          const signedIn = await register(email, password, callback(), { firstName, lastName }, token);
          setPassword(''); setPasswordConfirmation('');
          if (signedIn) router.replace(safeAuthNext(new URLSearchParams(window.location.search).get('next')));
          else setStep('confirmation');
        } finally { resetCaptcha(); }
        return;
      }
      if (step === 'email' && !useCode) {
        const token = authCaptchaOptions(captchaToken).captchaToken;
        try { await login(email, password, token); setPassword(''); } finally { resetCaptcha(); }
      }
      else if (step === 'email') await sendCode();
      else {
        const token = authCaptchaOptions(captchaToken).captchaToken;
        try {
          if (codeChannel === 'phone') await verifyPhoneCode(phone, code, token);
          else await verifyCode(email, code, token);
        } finally { resetCaptcha(); }
      }
      if (step === 'code' || !useCode) router.replace(safeAuthNext(new URLSearchParams(window.location.search).get('next')));
    }, { action: step === 'code' || step === 'confirmation' ? 'verify-code' : signup && codeChannel === 'email' ? 'signup' : !useCode ? 'password' : 'request-code', createAccount: signup, channel: codeChannel });
  }

  function social(provider: SocialProvider) {
    if (methods) void run(() => signInWithProvider(provider, methods, authCallbackUrl(window.location.origin, new URLSearchParams(window.location.search).get('next'))), { action: 'oauth', createAccount: signup });
  }

  return (
    <main className="auth-page">
      <div className={`auth-layout${signup ? ' auth-layout-signup' : ''}`}>
      <section id="sign-in" tabIndex={-1} aria-label={signup ? 'Sign Up for VisaThreads' : 'Log In to VisaThreads'} className="auth-card">
        {demoMode ? <><h2 className="text-2xl font-black capitalize">Explore the preview</h2><p className="my-4 text-sm text-slate-600 capitalize">This preview uses a sample account. Real sign-in is not connected here.</p><button onClick={() => router.push('/')} className={`${buttonClass} capitalize`}>Explore questions</button></> : user ? <div className="space-y-5">
          <h2 className="text-2xl font-bold capitalize">You’re signed in</h2>
          <p className="text-slate-600">Your active account is <strong className="break-all text-slate-900 normal-case">{user.email ?? 'your phone account'}</strong>.</p>
          <p className="text-xs text-slate-500 capitalize">Only you can see your sign-in details here.</p>
          {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          <button className={`${buttonClass} capitalize`} onClick={() => router.replace(safeAuthNext(new URLSearchParams(window.location.search).get('next')))}>Continue to VisaThreads <ArrowRight size={17} /></button>
          <Link href="/account" className="block text-center font-bold text-teal-700 capitalize">View my profile</Link>
          <button type="button" disabled={busy || loading} onClick={() => void run(signOut, { action: 'sign-out' })} className="w-full rounded-xl border border-slate-300 p-3 font-bold disabled:opacity-50 capitalize">{busy ? 'Signing out…' : 'Use a different account'}</button>
        </div> : <>
          {loading && <p role="status" className="mb-4 text-sm text-slate-600 capitalize">Checking your session… {sessionSlow && <>This is taking longer than expected. <button type="button" onClick={() => window.location.reload()} className="underline capitalize">Reload sign-in</button></>}</p>}
          <nav aria-label="Account access" className="auth-account-tabs mb-5 grid grid-cols-2 gap-1 rounded-xl bg-teal-50 p-1 text-center text-sm font-semibold">
            <a href={accountHref(false)} aria-current={!signup ? 'page' : undefined} className={`${accountTabClass} ${!signup ? selectedAccountTabClass : alternateAccountTabClass} capitalize`}>Log In</a>
            <a href={accountHref(true)} aria-current={signup ? 'page' : undefined} className={`${accountTabClass} ${signup ? selectedAccountTabClass : alternateAccountTabClass} capitalize`}>Sign Up</a>
          </nav>
          <h1 className="auth-title text-2xl font-semibold text-slate-950 capitalize">{step === 'confirmation' ? 'Confirm your email' : step === 'code' ? `Check your ${codeChannel === 'phone' ? 'phone' : 'email'}` : signup ? 'Sign Up' : 'Log In'}</h1>
          <p className="mt-1 text-sm leading-6 text-slate-600">{step === 'confirmation' ? <>If this address is eligible, a confirmation email will arrive at <strong className="break-all normal-case">{email.trim()}</strong>. Follow its link, then log in with your password.</> : step === 'code' ? <>Enter the latest one-time code for <strong className="break-all normal-case">{codeChannel === 'phone' ? phone.trim() : email.trim()}</strong>.</> : signup ? 'Join the VisaThreads community.' : 'Welcome back to VisaThreads.'}</p>
          {step === 'confirmation' && <><form onSubmit={submit} className="mt-4 space-y-3"><label className="block text-sm font-semibold text-slate-700 capitalize">Confirmation code <span aria-hidden="true" className="text-red-600 capitalize">*</span> <span className="font-normal text-slate-500 capitalize">(if your email includes one)</span><input type="text" name="code" aria-label="Confirmation code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 10))} className={inputClass} /></label>{captchaSiteKey && <TurnstileCheck siteKey={captchaSiteKey} resetKey={captchaReset} onToken={setCaptchaToken} />}{error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<button disabled={busy || Boolean(captchaSiteKey && !captchaToken)} className={`${buttonClass} capitalize`}>{busy ? 'Please wait…' : 'Confirm email code'}<ArrowRight aria-hidden="true" size={17} /></button></form><Link href={accountHref(false)} className="mt-6 inline-flex rounded-xl border border-teal-700 px-5 py-3 font-bold text-teal-800 hover:bg-teal-50 capitalize">Go to Log In</Link></>}
          {step === 'email' && <>
            <div className="mt-4 grid gap-3">
              {(['google'] as const).map(provider => <button key={provider} type="button" disabled={busy || loading || !methods?.[provider]} onClick={() => social(provider)} className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 capitalize">
                <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.2 3-7.4Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4L15.4 17c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.8a6 6 0 0 1 0-3.6V7.6H3.1a10 10 0 0 0 0 8.8l3.3-2.6Z"/><path fill="#EA4335" d="M12 6.1c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.5 9.5 0 0 0 12 2a10 10 0 0 0-8.9 5.6l3.3 2.6C7.2 7.9 9.4 6.1 12 6.1Z"/></svg>
                Continue with Google{methods && !methods.google && <span className="text-xs font-normal capitalize">Not available yet</span>}
              </button>)}
            </div>
            {settingsError ? <p className="mt-2 text-xs text-slate-600 capitalize">Couldn’t check social sign-in. <button type="button" onClick={() => setRetry(value => value + 1)} className="underline capitalize">Retry</button> or use email below.</p> : !methods && <p className="mt-2 text-xs text-slate-500 capitalize" role="status">Checking sign-in options…</p>}
            <div className="my-4 flex items-center gap-3 text-xs text-slate-500 capitalize"><span className="h-px flex-1 bg-slate-200" />or use email<span className="h-px flex-1 bg-slate-200" /></div>
          </>}
          {step !== 'confirmation' && <p className="text-xs text-slate-500 capitalize"><span className="font-semibold text-red-600 capitalize" aria-hidden="true">*</span> Required fields</p>}
          {step !== 'confirmation' && <form onSubmit={submit} className={`mt-3 ${signup ? 'space-y-2.5' : 'space-y-3'}`}>
            {signup && step === 'email' && codeChannel === 'email' && <>
              <div className="grid grid-cols-2 gap-3 capitalize">
                <label className="block text-sm font-semibold text-slate-700 capitalize">First Name <span aria-hidden="true" className="text-red-600 capitalize">*</span><input type="text" name="firstName" aria-label="First Name" autoComplete="given-name" required maxLength={80} disabled={busy || loading} value={firstName} onChange={event => setFirstName(event.target.value)} className={inputClass} /></label>
                <label className="block text-sm font-semibold text-slate-700 capitalize">Last Name <span aria-hidden="true" className="text-red-600 capitalize">*</span><input type="text" name="lastName" aria-label="Last Name" autoComplete="family-name" required maxLength={80} disabled={busy || loading} value={lastName} onChange={event => setLastName(event.target.value)} className={inputClass} /></label>
              </div>
            </>}
            {step === 'email' ? codeChannel === 'phone' ? <label className="block text-sm font-semibold text-slate-700 capitalize">Phone number <span aria-hidden="true" className="text-red-600 capitalize">*</span><input type="tel" name="phone" aria-label="Phone number" required autoComplete="tel" maxLength={20} placeholder="+15551234567" disabled={busy || loading} value={phone} onChange={event => setPhone(event.target.value)} className={inputClass} /></label> : <label className="block text-sm font-semibold text-slate-700 capitalize">Email Address <span aria-hidden="true" className="text-red-600 capitalize">*</span><input type="email" name="email" aria-label="Email Address" required autoComplete="email" maxLength={254} placeholder="you@example.com" disabled={busy || loading} value={email} onChange={event => setEmail(event.target.value)} className={inputClass} /></label> : <label className="block text-sm font-semibold text-slate-700 capitalize">Sign-in code <span aria-hidden="true" className="text-red-600 capitalize">*</span><input type="text" name="code" aria-label="Sign-in code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} autoFocus disabled={busy || loading} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 10))} className={`${inputClass} text-center text-2xl tracking-[0.25em]`} /></label>}
            {step === 'email' && codeChannel === 'email' && (signup || !useCode) && <div>
              <div className="relative">
                <label className="block text-sm font-semibold text-slate-700 capitalize">Password <span aria-hidden="true" className="text-red-600 capitalize">*</span>
                  <input type={passwordVisible ? 'text' : 'password'} name="password" aria-label="Password" required autoComplete={signup ? 'new-password' : 'current-password'} minLength={signup ? MIN_PASSWORD_LENGTH : undefined} maxLength={MAX_PASSWORD_LENGTH} aria-describedby={signup ? 'password-guidance' : undefined} disabled={busy || loading} value={password} onChange={event => setPassword(event.target.value)} className={`${inputClass} pr-12`} />
                </label>
                <button type="button" aria-label={passwordVisible ? 'Hide password' : 'Show password'} aria-pressed={passwordVisible} onClick={() => setPasswordVisible(value => !value)} className="auth-password-toggle absolute bottom-0 right-0 grid h-11 w-11 place-items-center rounded-lg text-slate-500 hover:text-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700">{passwordVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
              </div>
              {signup && <p id="password-guidance" className="mt-1.5 text-xs leading-5 text-slate-500">{PASSWORD_GUIDANCE}</p>}
            </div>}
            {signup && step === 'email' && codeChannel === 'email' && <label className="block text-sm font-semibold text-slate-700 capitalize">Confirm password <span aria-hidden="true" className="text-red-600 capitalize">*</span><input type={passwordVisible ? 'text' : 'password'} name="passwordConfirmation" aria-label="Confirm password" required autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} disabled={busy || loading} value={passwordConfirmation} onChange={event => setPasswordConfirmation(event.target.value)} className={inputClass} /></label>}
            {captchaSiteKey && <TurnstileCheck siteKey={captchaSiteKey} resetKey={captchaReset} onToken={setCaptchaToken} />}
            {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
            {message && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">{message}</p>}
            <button disabled={busy || loading || (step === 'email' && useCode && cooldown > 0) || Boolean(captchaSiteKey && !captchaToken)} className={buttonClass}>{busy ? 'Please wait…' : step === 'email' ? (signup && codeChannel === 'email' ? 'Sign Up' : !useCode ? 'Log In' : cooldown ? `Try again in ${cooldown}s` : 'Send verification code') : 'Verify & continue'}<ArrowRight aria-hidden="true" size={17} /></button>
          </form>}
          {signup && step === 'email' && <p className="mt-3 text-xs leading-5 text-slate-500 capitalize">Before participating, you’ll confirm the <Link href="/terms" target="_blank" rel="noopener" className="underline capitalize">Terms</Link> and <Link href="/privacy" target="_blank" rel="noopener" className="underline capitalize">Privacy notice</Link>. Links open in a new tab.</p>}
          {step === 'email' && <div className="mt-4 flex flex-wrap justify-between gap-3 text-sm text-teal-700 capitalize"><span className="flex flex-wrap gap-3 capitalize">{methods?.phone && <button type="button" disabled={busy || loading} onClick={() => { setCodeChannel('phone'); setUseCode(true); setPassword(''); setError(''); }} className="capitalize">Use phone instead</button>}{codeChannel === 'phone' && <button type="button" disabled={busy || loading} onClick={() => { setCodeChannel('email'); setUseCode(true); setPassword(''); setError(''); }} className="capitalize">Use email instead</button>}{codeChannel === 'email' && !signup && <button type="button" disabled={busy || loading} onClick={() => { setUseCode(value => !value); setPassword(''); setError(''); }} className="capitalize">{useCode ? 'Use a password instead' : 'Use an email code instead'}</button>}</span>{!signup && <Link href="/account/recovery" className="underline capitalize">Forgot password?</Link>}</div>}
          {step === 'code' && <div className="mt-4 flex flex-wrap justify-between gap-3 text-sm font-bold text-teal-700"><button type="button" disabled={busy || cooldown > 0 || Boolean(captchaSiteKey && !captchaToken)} onClick={() => void run(sendCode, { action: 'request-code', createAccount: signup, channel: codeChannel })} className="disabled:text-slate-400">{cooldown ? `Resend in ${cooldown}s` : 'Resend code'}</button><button type="button" disabled={busy || loading} onClick={() => { setStep('email'); setCode(''); setError(''); setMessage(''); }} className="capitalize">Use a different {codeChannel === 'phone' ? 'phone' : 'email'}</button></div>}
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500 capitalize">Your email stays private. We’ll create a public username for you.</p>
        </>}
      </section>
      <aside className="auth-welcome" aria-label="VisaThreads community">
        <svg className="auth-welcome-art" viewBox="0 0 340 640" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path d="M0 0H340V155C275 210 220 70 140 120S45 140 0 70Z" fill="white" fillOpacity=".08" />
          <path d="M0 500C65 440 90 535 165 490S275 440 340 500V640H0Z" fill="white" fillOpacity=".09" />
          <path d="M0 565C60 510 140 610 220 550S300 545 340 530V640H0Z" fill="white" fillOpacity=".12" />
          <circle cx="285" cy="205" r="8" fill="white" fillOpacity=".18" />
          <circle cx="46" cy="417" r="5" fill="white" fillOpacity=".3" />
        </svg>
        <div className="auth-welcome-copy capitalize">
          <span className="auth-community-label capitalize">The VisaThreads Community</span>
          <h2 className="capitalize">{signup ? <>Your Next Chapter<br />Starts Here.</> : <>Welcome<br />Back.</>}</h2>
          <p className="capitalize">{signup ? 'Ask Questions, Share Experiences, And Find People On A Journey Like Yours.' : 'Pick Up Your Conversations And Find Fresh Perspectives For Your Visa Journey.'}</p>
        </div>
      </aside>
      </div>
      <Link href="/us/en" className="mt-5 rounded text-sm font-medium text-slate-600 underline underline-offset-4 hover:text-teal-800 capitalize">Back to discussions</Link>
    </main>
  );
}

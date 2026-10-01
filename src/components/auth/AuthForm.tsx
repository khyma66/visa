'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { getBrowserAuthClient, googleEnabled, captchaSiteKey } from '@/lib/auth/browser';
import { AuthFlowError, authErrorMessage, finishSignup, googleLogin, login, requestPasswordReset, requestSignupCode, safeReturnPath, updatePassword, verifySignupCode } from '@/lib/auth/flow';
import Turnstile from './Turnstile';

type Mode = 'login' | 'signup' | 'reset';
type Step = 'details' | 'code' | 'password' | 'update' | 'sent' | 'done';
const fieldClass = 'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100';
const buttonClass = 'w-full rounded-full bg-blue-700 px-5 py-3 font-semibold text-white transition hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300';

export default function AuthForm({ mode }: { mode: Mode }) {
  const [step, setStep] = useState<Step>('details');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [next, setNext] = useState('/');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaGeneration, setCaptchaGeneration] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const client = getBrowserAuthClient();
    setConfigured(Boolean(client));
    setNext(safeReturnPath(new URLSearchParams(window.location.search).get('next')));
    if (mode === 'reset' && new URLSearchParams(window.location.search).get('update') === '1' && client) {
      client.auth.getUser().then(({ data, error: sessionError }) => {
        if (sessionError || !data.user) setError('Your reset session expired. Request a new email.');
        else setStep('update');
      }).catch(() => setError('We could not verify your session. Request a new email.')).finally(() => setReady(true));
    } else setReady(true);
  }, [mode]);

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);

  const needsCaptcha = Boolean(captchaSiteKey) && (step === 'details' || step === 'code');
  const disabled = busy || !ready || !configured;
  const run = async (action: () => Promise<void>) => {
    if (disabled) return;
    setBusy(true); setError('');
    try { await action(); }
    catch (err) { setError(authErrorMessage(err)); }
    finally { setBusy(false); setCaptchaToken(''); setCaptchaGeneration(value => value + 1); }
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const client = getBrowserAuthClient();
      if (!client) throw new AuthFlowError('Sign in is unavailable. Please try again later.');
      if (step === 'details' && captchaSiteKey && !captchaToken) throw new AuthFlowError('Complete the security check to continue.');
      if (mode === 'login') {
        await login(client.auth, email, password, captchaToken || undefined);
        window.location.assign(next);
      } else if (mode === 'signup' && step === 'details') {
        await requestSignupCode(client.auth, email, captchaToken || undefined);
        setStep('code'); setResendAt(Date.now() + 60_000);
      } else if (mode === 'signup' && step === 'code') {
        await verifySignupCode(client.auth, email, code);
        setCode(''); setStep('password');
      } else if (mode === 'signup' && step === 'password') {
        if (password !== confirmation) throw new AuthFlowError('The passwords do not match.');
        await finishSignup(client.auth, password);
        setPassword(''); setConfirmation(''); window.location.assign(next);
      } else if (mode === 'reset' && step === 'details') {
        await requestPasswordReset(client.auth, email, window.location.origin, captchaToken || undefined);
        setStep('sent');
      } else if (mode === 'reset' && step === 'update') {
        if (password !== confirmation) throw new AuthFlowError('The passwords do not match.');
        await updatePassword(client.auth, password);
        setPassword(''); setConfirmation(''); setStep('done');
      }
    });
  }

  async function resend() {
    if (remaining > 0) return;
    await run(async () => {
      const client = getBrowserAuthClient();
      if (!client) return;
      if (captchaSiteKey && !captchaToken) throw new AuthFlowError('Complete the security check to resend your code.');
      await requestSignupCode(client.auth, email, captchaToken || undefined);
      setResendAt(Date.now() + 60_000);
    });
  }

  const title = mode === 'login' ? 'Log in to VisaFlow' : mode === 'reset' ? (step === 'update' ? 'Choose a new password' : 'Reset your password') : step === 'code' ? 'Check your email' : step === 'password' ? 'Secure your account' : 'Join VisaFlow';
  const nextQuery = next === '/' ? '' : `?next=${encodeURIComponent(next)}`;
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
    <section aria-labelledby="auth-title" className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
      <Link href="/" className="mb-8 inline-block text-xl font-bold tracking-tight text-blue-700">VisaFlow</Link>
      <h1 id="auth-title" className="text-2xl font-bold tracking-tight text-slate-950">{title}</h1>
      <p className="mb-7 mt-3 text-sm leading-6 text-slate-600">{mode === 'signup' ? 'Ask questions, share experiences, and find your community.' : mode === 'login' ? 'Welcome back to your visa community.' : 'We’ll help you get back into your account.'}</p>
      {ready && !configured && <p role="alert" className="mb-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Sign in is temporarily unavailable. Please try again later.</p>}
      {error && <p role="alert" className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {(mode === 'login' || mode === 'signup') && step === 'details' && googleEnabled && <>
        <button type="button" disabled={disabled} onClick={() => run(async () => { const client = getBrowserAuthClient(); if (client) await googleLogin(client.auth, window.location.origin, next); })} className="w-full rounded-full border border-slate-300 px-5 py-3 font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">Continue with Google</button>
        <div className="my-6 flex items-center gap-4 text-xs text-slate-500"><span className="h-px flex-1 bg-slate-200" />OR<span className="h-px flex-1 bg-slate-200" /></div>
      </>}
      {step === 'sent' ? <p role="status" className="rounded-xl bg-blue-50 p-4 text-sm leading-6 text-blue-950">If an account is associated with that email, you’ll receive a password reset link. Open it in this browser.</p> : step === 'done' ? <div role="status"><p className="mb-6 text-sm text-slate-700">Your password has been updated.</p><Link href="/" className={`${buttonClass} block text-center`}>Back to VisaFlow</Link></div> : <form onSubmit={submit} className="space-y-5" aria-busy={busy}>
        {step === 'details' && <div><label htmlFor="auth-email" className="mb-2 block text-sm font-medium text-slate-800">Email address</label><input id="auth-email" type="email" autoComplete="email" autoCapitalize="none" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} className={fieldClass} disabled={disabled} /></div>}
        {step === 'code' && <>
          <p className="text-sm leading-6 text-slate-600">Enter the six-digit code sent to <strong className="break-all text-slate-800">{email}</strong>.</p>
          <div><label htmlFor="auth-code" className="mb-2 block text-sm font-medium text-slate-800">Verification code</label><input id="auth-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} minLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} className={`${fieldClass} tracking-[0.4em]`} disabled={disabled} /></div>
        </>}
        {(mode === 'login' || step === 'password' || step === 'update') && <>
          {step === 'password' && <p className="text-sm leading-6 text-slate-600">Your email is verified. VisaFlow assigns your public profile a username automatically. Choose a unique password to finish.</p>}
          <div><label htmlFor="auth-password" className="mb-2 block text-sm font-medium text-slate-800">{mode === 'login' ? 'Password' : 'New password'}</label><input id="auth-password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? undefined : 12} maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} className={fieldClass} disabled={disabled} aria-describedby={mode === 'login' ? undefined : 'password-help'} />{mode !== 'login' && <p id="password-help" className="mt-2 text-xs text-slate-500">Use at least 12 characters. A unique passphrase works well.</p>}</div>
          {mode !== 'login' && <div><label htmlFor="auth-confirm-password" className="mb-2 block text-sm font-medium text-slate-800">Confirm password</label><input id="auth-confirm-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmation} onChange={event => setConfirmation(event.target.value)} className={fieldClass} disabled={disabled} /></div>}
        </>}
        {mode === 'login' && <Link href="/reset-password" className="block text-sm font-medium text-blue-700 hover:underline">Forgot password?</Link>}
        {needsCaptcha && <Turnstile key={captchaGeneration} siteKey={captchaSiteKey} onToken={setCaptchaToken} />}
        <button type="submit" className={buttonClass} disabled={disabled || (step === 'details' && needsCaptcha && !captchaToken)}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : step === 'code' ? 'Verify email' : step === 'password' ? 'Finish creating account' : step === 'update' ? 'Update password' : mode === 'reset' ? 'Send reset link' : 'Continue with email'}</button>
        {step === 'code' && <div className="flex flex-wrap justify-between gap-3 text-sm"><button type="button" onClick={resend} disabled={disabled || remaining > 0 || (needsCaptcha && !captchaToken)} className="font-medium text-blue-700 disabled:text-slate-400">{remaining > 0 ? `Resend in ${remaining}s` : 'Resend code'}</button><button type="button" disabled={busy} onClick={() => { setStep('details'); setCode(''); setError(''); }} className="font-medium text-blue-700">Change email</button></div>}
      </form>}
      <p className="mt-7 text-sm text-slate-600">{mode === 'signup' ? <>Already have an account? <Link href={`/login${nextQuery}`} className="font-semibold text-blue-700 hover:underline">Log in</Link></> : mode === 'login' ? <>New to VisaFlow? <Link href={`/signup${nextQuery}`} className="font-semibold text-blue-700 hover:underline">Sign up</Link></> : <Link href="/login" className="font-semibold text-blue-700 hover:underline">Back to log in</Link>}</p>
      <Link href="/" className="mt-5 inline-block text-xs text-slate-500 hover:underline">Keep browsing</Link>
    </section>
  </main>;
}

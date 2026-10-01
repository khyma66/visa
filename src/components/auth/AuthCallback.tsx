'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { getBrowserAuthClient } from '@/lib/auth/browser';
import { authErrorMessage, exchangeCallback } from '@/lib/auth/flow';

export default function AuthCallback() {
  const started = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const url = new URL(window.location.href);
    // Remove the one-time code from browser history before any navigation.
    window.history.replaceState(null, '', '/auth/callback');
    const client = getBrowserAuthClient();
    if (!client) { setError('Sign in is temporarily unavailable. Please try again later.'); return; }
    exchangeCallback(client.auth, url).then(path => window.location.replace(path)).catch(err => setError(authErrorMessage(err)));
  }, []);
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center"><h1 className="mb-4 text-2xl font-bold text-slate-950">{error ? 'Could not finish signing in' : 'Signing you in…'}</h1>{error ? <><p role="alert" className="mb-6 text-sm leading-6 text-slate-600">{error}</p><Link href="/login" className="font-semibold text-blue-700">Return to log in</Link></> : <p role="status" className="text-sm text-slate-600">Please keep this window open.</p>}</section></main>;
}

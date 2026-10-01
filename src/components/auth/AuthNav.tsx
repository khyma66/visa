'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getBrowserAuthClient } from '@/lib/auth/browser';
import { authErrorMessage, logout } from '@/lib/auth/flow';

/** Browser navigation state only. This is not server-side authorization. */
export default function AuthNav() {
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const client = getBrowserAuthClient();
    if (!client) return;
    let active = true;
    let generation = 0;
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    const verify = async () => {
      const current = ++generation;
      try {
        const { data, error } = await client.auth.getUser();
        if (active && current === generation) setSignedIn(!error && Boolean(data.user));
      } catch { if (active && current === generation) setSignedIn(false); }
    };
    const { data: { subscription } } = client.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') { generation++; setSignedIn(false); return; }
      // Do not await another auth call inside the auth-state callback's lock.
      clearTimeout(scheduled);
      scheduled = setTimeout(() => { void verify(); }, 0);
    });
    void verify();
    return () => { active = false; generation++; clearTimeout(scheduled); subscription.unsubscribe(); };
  }, []);

  async function signOut() {
    if (busy) return;
    const client = getBrowserAuthClient();
    if (!client) return;
    setBusy(true); setError('');
    try { await logout(client.auth); setSignedIn(false); }
    catch (err) { setError(authErrorMessage(err)); }
    finally { setBusy(false); }
  }

  return <nav aria-label="Account" className="flex flex-wrap items-center gap-3 text-sm">
    {signedIn ? <><span className="text-slate-600">Signed in</span><button type="button" onClick={signOut} disabled={busy} title="Log out of this browser" className="rounded-full border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{busy ? 'Logging out…' : 'Log out'}</button></> : <><Link href="/login" className="px-3 py-2 font-semibold text-blue-700">Log in</Link><Link href="/signup" className="rounded-full bg-blue-700 px-5 py-2 font-semibold text-white hover:bg-blue-800">Sign up</Link></>}
    {error && <span role="alert" className="w-full text-xs text-red-700">{error}</span>}
  </nav>;
}

'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { CircleHelp, LogOut, MessageCircle, Plus, ShieldCheck } from 'lucide-react';
import { Avatar } from './Avatar';
import { useAuth } from './AuthProvider';

export function SiteHeader() {
  const pathname = usePathname();
  const { profile, user, demoMode, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const accountRef = useRef<HTMLDivElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); }, [pathname, user?.id]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!accountRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); accountButton.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  async function logout() {
    if (busy) return;
    setBusy(true); setError('');
    try { await signOut(); setOpen(false); } catch { setError('Sign out failed. Please try again.'); }
    finally { setBusy(false); }
  }
  const active = (path: string) => pathname === path ? 'text-slate-950 bg-slate-100' : 'text-slate-600 hover:text-slate-950 hover:bg-slate-50';

  return (
    <header className="sticky top-0 z-50 border-b border-t-[3px] border-b-slate-200 border-t-orange-500 bg-white/95 backdrop-blur">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <div className="site-shell flex h-16 items-center gap-2 sm:gap-3">
        <Link href="/" className="mr-auto flex items-center gap-2 text-lg font-extrabold tracking-tight text-slate-950">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-teal-700 text-white"><CircleHelp size={21} /></span>
          <span>Visa<span className="text-teal-700">Flow</span></span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
          <Link href="/" className={`rounded-lg px-3 py-2 text-sm font-semibold ${active('/')}`}>Questions</Link>
          <Link href="/explore" className={`rounded-lg px-3 py-2 text-sm font-semibold ${active('/explore')}`}>Explore</Link>
          <Link href="/news" className={`rounded-lg px-3 py-2 text-sm font-semibold ${active('/news')}`}>News</Link>
          <Link href="/tags" className={`rounded-lg px-3 py-2 text-sm font-semibold ${active('/tags')}`}>Tags</Link>
          <Link href="/messages" className={`rounded-lg px-3 py-2 text-sm font-semibold ${active('/messages')}`}>Messages</Link>
        </nav>
        {demoMode && (
          <span className="hidden items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800 sm:flex">
            <ShieldCheck size={13} /> Local profile
          </span>
        )}
        <Link href="/ask" aria-label="Ask a question" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-2 text-sm font-bold text-white shadow-sm hover:bg-teal-800">
          <Plus size={16} /> <span className="hidden sm:inline">Ask</span>
        </Link>
        {user ? (
          <div ref={accountRef} className="relative">
            <button ref={accountButton} onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="account-panel" className="flex min-h-10 items-center gap-2 rounded-full p-1 hover:bg-slate-100" aria-label={`Account: ${profile?.username ?? 'Signed in'}`}>
              <Avatar seed={profile?.avatar_seed ?? user.id} />
            </button>
            {open && <div id="account-panel" className="absolute right-0 top-12 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Public pseudonym</p>
              <p className="mt-1 font-bold text-slate-900">{profile ? `u/${profile.username}` : 'Setting up your profile…'}</p>
              <p className="text-xs text-slate-500">{profile?.reputation ?? 0} reputation · email not displayed</p>
              <Link href="/communities/new" className="mt-3 block rounded-lg px-2 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Start a community</Link>
              <Link href="/messages" className="mt-1 flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><MessageCircle size={16} /> Messages</Link>
              {!demoMode && <button disabled={busy} onClick={() => void logout()} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><LogOut size={16} /> {busy ? 'Signing out…' : 'Sign out'}</button>}
              {error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
            </div>}
          </div>
        ) : (
          <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100">Log in</Link>
        )}
      </div>
      <nav aria-label="Mobile navigation" className="grid grid-cols-5 border-t border-slate-100 px-4 py-1 md:hidden">
        {[['/', 'Questions'], ['/explore', 'Explore'], ['/news', 'News'], ['/tags', 'Tags'], ['/messages', 'Messages']].map(([path, label]) => <Link key={path} href={path} aria-current={pathname === path ? 'page' : undefined} className={`rounded-lg px-2 py-3 text-center text-xs font-bold ${active(path)}`}>{label}</Link>)}
      </nav>
    </header>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { CircleHelp, LogOut, Menu, MessageCircle, Plus, Search, ShieldCheck } from 'lucide-react';
import { Avatar } from './Avatar';
import { useAuth } from './AuthProvider';
import { CommunityNavigation } from './CommunityNavigation';

export function SiteHeader() {
  const pathname = usePathname();
  const { profile, user, demoMode, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const accountRef = useRef<HTMLDivElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const mobileMenu = useRef<HTMLDetailsElement>(null);
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
  useEffect(() => { if (mobileMenu.current) mobileMenu.current.open = false; }, [pathname]);

  return (
    <header className="site-header">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <div className="header-content">
        <details ref={mobileMenu} className="mobile-menu" onKeyDown={(event) => {
          if (event.key === 'Escape' && mobileMenu.current) {
            mobileMenu.current.open = false;
            mobileMenu.current.querySelector('summary')?.focus();
          }
        }}>
          <summary className="icon-control" aria-label="Open navigation" title="Navigation"><Menu size={22}/></summary>
          <div className="mobile-menu-panel"><CommunityNavigation mobile onNavigate={() => { if (mobileMenu.current) mobileMenu.current.open = false; }}/></div>
        </details>
        <Link href="/" className="site-brand">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-teal-700 text-white"><CircleHelp size={21} /></span>
          <span>Visa<span className="text-teal-700">Flow</span></span>
        </Link>
        <form action="/" method="get" role="search" className="header-search">
          <Search size={19} aria-hidden="true"/>
          <label className="sr-only" htmlFor="site-search">Search VisaFlow</label>
          <input id="site-search" name="q" type="search" placeholder="Search visa questions" maxLength={200}/>
          <button type="submit" className="icon-control" aria-label="Search" title="Search"><Search size={18}/></button>
        </form>
        {demoMode && (
          <span className="hidden items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800 sm:flex">
            <ShieldCheck size={13} /> Local profile
          </span>
        )}
        <Link href="/ask" aria-label="Ask a question" title="Ask a question" className="header-ask">
          <Plus size={16} /> <span className="hidden sm:inline">Ask</span>
        </Link>
        {user ? (
          <div ref={accountRef} className="relative">
            <button ref={accountButton} onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="account-panel" className="flex min-h-10 items-center gap-2 rounded-full p-1 hover:bg-slate-100" aria-label={`Account: ${profile?.username ?? 'Signed in'}`}>
              <Avatar seed={profile?.avatar_seed ?? user.id} />
            </button>
            {open && <div id="account-panel" className="absolute right-0 top-12 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Public pseudonym</p>
              <p className="mt-1 font-bold text-slate-900">{profile ? `u/${profile.username}` : 'Setting up your profile…'}</p>
              <p className="text-xs text-slate-500">{profile?.reputation ?? 0} reputation · email not displayed</p>
              <Link href="/messages" className="mt-3 flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><MessageCircle size={16} /> Messages</Link>
              {!demoMode && <button disabled={busy} onClick={() => void logout()} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><LogOut size={16} /> {busy ? 'Signing out…' : 'Sign out'}</button>}
              {error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
            </div>}
          </div>
        ) : (
          <a href="/login#sign-in" className="header-login">Log in</a>
        )}
      </div>
    </header>
  );
}

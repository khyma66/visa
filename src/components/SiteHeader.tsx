'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, Search, Activity, ChevronDown, CircleHelp, LogOut, MessageCircle, Plus, Settings, ShieldCheck, UserRound, UsersRound } from 'lucide-react';
import { Avatar } from './Avatar';
import { useAuth } from './AuthProvider';
import { CommunityNavigation } from './CommunityNavigation';

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, user, loading, profileLoading, demoMode, signOut, refreshProfile } = useAuth();
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
  async function logout(switchAccount = false) {
    if (busy) return;
    setBusy(true); setError('');
    try { await signOut(); setOpen(false); router.replace(switchAccount ? '/login' : '/'); } catch { setError('Sign out failed. Please try again.'); }
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
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-orange-700 text-white"><CircleHelp size={21} /></span>
          <span className="brand-wordmark"><span className="text-orange-700">Visa</span><span className="text-blue-700">Threads</span></span>
        </Link>
        <form action="/" method="get" role="search" className="header-search">
          <Search size={19} aria-hidden="true"/>
          <label className="sr-only" htmlFor="site-search">Search VisaThreads</label>
          <input id="site-search" name="q" type="search" placeholder="Search visa questions" maxLength={200}/>
          <button type="submit" className="icon-control" aria-label="Search" title="Search"><Search size={18}/></button>
        </form>
        {demoMode && (
          <span className="hidden items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800 sm:flex">
            <ShieldCheck size={13} /> Local profile
          </span>
        )}
        <Link href="/ask" aria-label="Ask a Question" title="Ask a Question" className="header-ask">
          <Plus size={16} /> <span className="hidden sm:inline">Ask</span>
        </Link>
        {loading ? <span role="status" aria-label="Checking account" className="h-10 w-10 animate-pulse rounded-full bg-slate-100" /> : user ? (
          <div ref={accountRef} className="relative">
            <button ref={accountButton} onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="account-panel" className="flex min-h-10 items-center gap-2 rounded-full p-1 hover:bg-slate-100" aria-label={`Account: ${profile?.username ?? 'Signed in'}`}>
              <Avatar seed={profile?.avatar_seed ?? user.id} />
              <ChevronDown size={14} aria-hidden="true" className="mr-1 text-slate-500" />
            </button>
            {open && <div id="account-panel" className="absolute right-0 top-12 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
              <p className="text-xs font-semibold tracking-wide text-slate-500">Your Account</p>
              <p className="mt-1 break-words font-bold text-slate-900">{profile ? `u/${profile.username}` : 'Signed in'}</p>
              <p className="text-xs text-slate-500">{profile ? `${profile.reputation} reputation` : 'Private account menu'}</p>
              {user.email && <p className="mt-2 break-all text-xs text-slate-600">{user.email}<span className="mt-1 block text-slate-400">Sign-in email · visible only to you</span></p>}
              {!profile && (profileLoading ? <p role="status" className="mt-2 text-xs text-slate-500">Loading profile…</p> : <button className="mt-2 text-xs text-blue-700 underline" onClick={() => { void refreshProfile().catch(() => setError('Couldn’t load your profile. Try again.')); }}>Reload profile</button>)}
              <nav aria-label="Account options" className="mt-3 border-y border-slate-100 py-2" onClick={() => setOpen(false)}>
                {[
                  ['/account?tab=profile', 'My profile', UserRound],
                  ['/account?tab=activity', 'My activity', Activity],
                  ['/account?tab=settings', 'Edit profile & settings', Settings],
                  ['/messages', 'Messages', MessageCircle],
                  ['/privacy-choices', 'Privacy & account help', ShieldCheck],
                ].map(([href, label, Icon]) => { const ItemIcon = Icon as typeof UserRound; return <Link key={href as string} href={href as string} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><ItemIcon size={16} aria-hidden="true" />{label as string}</Link>; })}
              </nav>
              {!demoMode && <div className="mt-2">
                <button disabled={busy} onClick={() => void logout(true)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><UsersRound size={16} /> Use a different account</button>
                <button disabled={busy} onClick={() => void logout()} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><LogOut size={16} /> {busy ? 'Signing out…' : 'Sign out'}</button>
              </div>}
              {error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
            </div>}
          </div>
        ) : (
          <a href="/login#sign-in" className="header-login">Log In</a>
        )}
      </div>
    </header>
  );
}

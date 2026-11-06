'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BarChart3, ClipboardList, MessageSquarePlus, Inbox, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { FeedbackForm } from './FeedbackForm';
import { useAuth } from './AuthProvider';
import { feedbackSection, isFeedbackOwner } from '@/lib/feedback';

export function FeedbackLauncher({ mobileNavigation = false }: { mobileNavigation?: boolean } = {}) {
  const path = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = mobileNavigation ? 'mobile-feedback-title' : 'feedback-title';
  useEffect(() => { setOpen(false); dialog.current?.close(); }, [path]);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, [open]);
  function close() {
    dialog.current?.close(); setOpen(false);
    if (trigger.current?.getClientRects().length) trigger.current.focus();
    else document.querySelector<HTMLElement>('.site-brand')?.focus();
  }
  return <>
    <button ref={trigger} type="button" title="Send feedback" aria-label="Feedback" onClick={() => setOpen(true)} className={mobileNavigation ? 'nav-item w-full text-left font-semibold' : 'flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 capitalize'}><MessageSquarePlus size={19} aria-hidden="true"/><span className={mobileNavigation ? 'capitalize' : 'hidden lg:inline capitalize'}>Feedback</span></button>
    {/* Keep the modal outside responsive navigation containers: rotating the
        screen must not hide an open dialog while leaving the page locked. */}
    {open && createPortal(<dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }} onClose={() => setOpen(false)} className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl backdrop:bg-slate-950/45 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3"><h1 id={titleId} className="text-xl font-bold capitalize">Help Improve VisaThreads</h1><button type="button" autoFocus onClick={close} aria-label="Close feedback" className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-slate-100"><X size={20}/></button></div>
      {open && <FeedbackForm section={feedbackSection(path)}/>}
    </dialog>, document.body)}
  </>;
}

// This check only controls discovery. Every inbox/read/write RPC independently
// checks the server-maintained owner UUID, including calls made without this UI.
export function OwnerFeedbackLink() {
  const { user, demoMode } = useAuth();
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let active = true;
    setAllowed(false);
    if (user && !demoMode) void isFeedbackOwner().then(value => { if (active) setAllowed(value === true); }).catch(() => {});
    return () => { active = false; };
  }, [user?.id, demoMode]);
  return allowed ? <>
    <Link href="/admin/members" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 capitalize"><Inbox size={16} aria-hidden="true"/>Members</Link>
    <Link href="/admin/analytics" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 capitalize"><BarChart3 size={16} aria-hidden="true"/>Community Dashboard</Link>
    <Link href="/admin/reports" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 capitalize"><Inbox size={16} aria-hidden="true"/>Reports</Link>
    <Link href="/admin/launch" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 capitalize"><ClipboardList size={16} aria-hidden="true"/>Launch & Experiments</Link>
    <Link href="/owner/feedback" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 capitalize"><Inbox size={16} aria-hidden="true"/>Feedback Inbox</Link>
  </> : null;
}

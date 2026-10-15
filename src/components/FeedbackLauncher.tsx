'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { MessageSquarePlus, Inbox, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { FeedbackForm } from './FeedbackForm';
import { useAuth } from './AuthProvider';
import { feedbackSection, isFeedbackOwner } from '@/lib/feedback';

export function FeedbackLauncher() {
  const path = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); dialog.current?.close(); }, [path]);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, [open]);
  function close() { dialog.current?.close(); setOpen(false); trigger.current?.focus(); }
  return <>
    <button ref={trigger} type="button" title="Send feedback" aria-label="Feedback" onClick={() => setOpen(true)} className="flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-full px-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"><MessageSquarePlus size={19} aria-hidden="true"/><span className="hidden lg:inline">Feedback</span></button>
    <dialog ref={dialog} aria-labelledby="feedback-title" onCancel={event => { event.preventDefault(); close(); }} onClose={() => setOpen(false)} className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl backdrop:bg-slate-950/45 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3"><h1 id="feedback-title" className="text-xl font-bold">Help Improve VisaThreads</h1><button type="button" autoFocus onClick={close} aria-label="Close feedback" className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-slate-100"><X size={20}/></button></div>
      {open && <FeedbackForm section={feedbackSection(path)}/>}
    </dialog>
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
  return allowed ? <Link href="/owner/feedback" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Inbox size={16} aria-hidden="true"/>Feedback Inbox</Link> : null;
}

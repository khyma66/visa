'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bell, MessageCircle, MessageSquare, Settings } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { useNotifications } from './NotificationProvider';
import { getNotifications, readNotifications, type MemberNotification } from '@/lib/notifications';

export function NotificationsClient() {
  const { user, loading, demoMode } = useAuth();
  const { data, ready, error: loadError, refresh } = useNotifications();
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [older, setOlder] = useState<MemberNotification[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!page || !user || demoMode) return;
    let active = true; setOlder(null); setError('');
    void getNotifications(page).then(value => { if (active) setOlder(value.items); }).catch(() => { if (active) setError('Could Not Load Earlier Notifications. Return To The Latest Page And Try Again.'); });
    return () => { active = false; };
  }, [page, user?.id, demoMode, data]);
  const items = page ? older : data.items;
  async function mark(ids: string[], href?: string) {
    if (!user || busy) return;
    setBusy(true); setError('');
    try { await readNotifications(ids, user.id); refresh(); if (href) router.push(href); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could Not Update Notifications.'); }
    finally { setBusy(false); }
  }
  if (loading) return <main className="page-shell py-10" role="status">Loading Notifications…</main>;
  if (!user) return <main className="page-shell py-10"><h1 className="text-2xl font-bold">Notifications</h1><p className="mt-3 text-slate-600">Log In To See Replies To Your Posts And New Messages.</p><Link className="mt-5 inline-block font-semibold text-teal-800 underline" href="/login?next=%2Fnotifications">Log In</Link></main>;
  return <main className="page-shell py-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="flex items-center gap-2 text-2xl font-bold"><Bell size={25} />Notifications</h1><Link href="/account?tab=settings#notification-settings" className="flex min-h-11 items-center gap-2 text-sm font-semibold text-teal-800"><Settings size={17} />Preferences</Link></div>
    <p className="mt-2 text-sm text-slate-600">Replies To Your Posts And Direct Messages, All In One Place.</p>
    {demoMode ? <p className="mt-6 rounded-xl border border-slate-200 p-5 text-sm text-slate-600">Notifications Become Available When You Sign In With A Real Account.</p> : <>
      {(error || loadError) && <div className="mt-5 rounded-lg bg-rose-50 p-4"><p role="alert" className="text-sm text-rose-700">{error || loadError}</p><button onClick={() => { setPage(0); setError(''); refresh(); }} className="mt-2 text-sm font-semibold underline">Try Again</button></div>}
      {!ready || !items ? <p className="mt-6 text-sm text-slate-500" role="status">Loading Notifications…</p> : <>
        {items.some(item => !item.read_at) && <button disabled={busy} onClick={() => void mark(items.slice(0,20).filter(item => !item.read_at).map(item => item.id))} className="mt-5 min-h-11 text-sm font-semibold text-teal-800 disabled:opacity-50">Mark This Page Read</button>}
        <ul className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {items.slice(0,20).map(item => <li key={item.id} className={`flex gap-3 p-4 sm:p-5 ${!item.read_at ? 'bg-teal-50/60' : ''}`}>
            <span className="mt-1 text-teal-700" aria-hidden="true">{item.kind === 'reply' ? <MessageSquare size={20} /> : <MessageCircle size={20} />}</span>
            <div className="min-w-0 flex-1"><Link href={item.href} onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); void mark(item.read_at ? [] : [item.id], item.href); } }} className="block rounded-sm text-sm leading-6 text-slate-900 hover:underline focus-visible:outline focus-visible:outline-teal-700"><span className="font-semibold">u/{item.actor_username}</span>{item.kind === 'reply' ? ' Replied To Your Post' : ' Sent You A Message'}<span className="mt-1 block break-words text-slate-600">{item.title}</span></Link><time dateTime={item.created_at} className="mt-2 block text-xs text-slate-500">{new Date(item.created_at).toLocaleString()}</time></div>
            {!item.read_at && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-red-600"><span className="sr-only">Unread</span></span>}
          </li>)}
          {!items.length && !loadError && <li className="p-8 text-center"><Bell size={28} className="mx-auto text-slate-400" /><h2 className="mt-3 font-semibold">You’re All Caught Up</h2><p className="mt-2 text-sm text-slate-500">New Replies And Message Alerts Will Appear Here.</p></li>}
        </ul>
        <nav aria-label="Notification Pages" className="mt-4 flex justify-between gap-4"><button disabled={!page || busy} onClick={() => setPage(value => value-1)} className="min-h-11 text-sm font-semibold text-teal-800 disabled:opacity-40">Newer</button><button disabled={items.length<=20 || busy} onClick={() => setPage(value => value+1)} className="min-h-11 text-sm font-semibold text-teal-800 disabled:opacity-40">Older</button></nav>
      </>}
    </>}
  </main>;
}

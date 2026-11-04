'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from './AuthProvider';
import { useNotifications } from './NotificationProvider';
import { saveNotificationPreferences } from '@/lib/notifications';

export function NotificationSettings() {
  const { user, demoMode } = useAuth();
  const { data, ready, error: loadError, refresh } = useNotifications();
  const [preferences, setPreferences] = useState(data.preferences);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setPreferences(data.preferences); }, [data.preferences.reply_in_app, data.preferences.message_in_app, data.preferences.reply_email, data.preferences.message_email]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!user || busy || demoMode) return;
    setBusy(true); setStatus(''); setError('');
    try { await saveNotificationPreferences(preferences, user.id); setStatus('Notification Preferences Saved.'); refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save preferences.'); }
    finally { setBusy(false); }
  }
  return <section id="notification-settings" className="scroll-mt-24 p-5 sm:p-7">
    <h2 className="text-xl font-bold">Notification Preferences</h2>
    <p className="mt-2 text-sm leading-6 text-slate-600">Choose Alerts For New Replies And Direct Messages. Changes Apply To Future Alerts. Unread Messages Remain Visible In Your Inbox.</p>
    {demoMode ? <p className="mt-4 text-sm text-slate-500">Sign In With A Real Account To Save Notification Preferences.</p> : !ready ? <p className="mt-4" role="status">Loading Preferences…</p> : loadError ? <div className="mt-4"><p role="alert" className="text-sm text-rose-700">{loadError}</p><button onClick={refresh} className="mt-2 text-sm font-semibold text-teal-800 underline">Try Again</button></div> : <form onSubmit={event => void save(event)}>
      <div className="mt-5 divide-y divide-slate-100">
        {([{ key: 'reply', label: 'Replies To My Posts' }, { key: 'message', label: 'Direct Messages' }] as const).map(({ key, label }) => <fieldset key={key} className="py-4">
          <legend className="pt-3 text-sm font-semibold text-slate-900">{label}</legend>
          <div className="mt-2 flex flex-wrap gap-x-8 gap-y-3 text-sm">
            <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={preferences[`${key}_in_app`]} disabled={busy} onChange={event => { setPreferences(value => ({ ...value, [`${key}_in_app`]: event.target.checked })); setStatus(''); }} className="h-4 w-4 accent-teal-700" />In-App Notifications</label>
            <label className="flex min-h-10 items-center gap-2 text-slate-500"><input type="checkbox" checked={preferences[`${key}_email`]} disabled={!data.emailAvailable || busy} aria-describedby="notification-email-status" onChange={event => setPreferences(value => ({ ...value, [`${key}_email`]: event.target.checked }))} className="h-4 w-4 accent-teal-700" />Email</label>
          </div>
        </fieldset>)}
      </div>
      <p id="notification-email-status" className="mt-3 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-600">{data.emailAvailable ? 'Email Is Optional And Off By Default. Alerts Go To Your Verified Account Email.' : 'Email Notifications Are Not Available Yet. In-App Alerts Work Without Email.'}</p>
      <button disabled={busy} type="submit" className="mt-4 min-h-11 rounded-lg bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">{busy ? 'Saving…' : 'Save Preferences'}</button>
      {status && <p role="status" className="mt-3 text-sm text-emerald-700">{status}</p>}{error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
    </form>}
  </section>;
}

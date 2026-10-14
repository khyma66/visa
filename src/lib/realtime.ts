'use client';

import { getSupabase, isSupabaseConfigured } from './supabase/client';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'local' | 'signed-out';

type Listener = { refresh: () => void; status: (status: LiveStatus) => void };
type Channel = ReturnType<ReturnType<typeof getSupabase>['channel']>;
// One socket subscription per topic, shared by mounted consumers. Unmounting a
// sidebar must not disconnect another component listening to the same topic.
const shared = new Map<string, { channel: Channel; listeners: Set<Listener>; status: LiveStatus }>();
function acquire(topic: string, userId: string, listener: Listener) {
  const key = `${userId}:${topic}`;
  let entry = shared.get(key);
  if (!entry) {
    const channel = getSupabase().channel(topic, { config: { private: true } });
    entry = { channel, listeners: new Set(), status: 'connecting' };
    shared.set(key, entry);
    const current = entry;
    channel.on('broadcast', { event: 'changed' }, () => current.listeners.forEach((l) => l.refresh()));
    current.listeners.add(listener);
    channel.subscribe((status) => {
      current.status = status === 'SUBSCRIBED' ? 'live' : 'reconnecting';
      current.listeners.forEach((l) => {
        l.status(current.status);
        if (current.status === 'live') l.refresh();
      });
    });
  } else entry.listeners.add(listener);
  listener.status(entry.status);
  const current = entry;
  return () => {
    current.listeners.delete(listener);
    if (!current.listeners.size && shared.get(key) === current) {
      shared.delete(key);
      void getSupabase().removeChannel(current.channel);
    }
  };
}

/** Events are invalidations; durable data is always re-read under database RLS. */
export function subscribeLive(topics: string[], onChange: () => void, onStatus?: (status: LiveStatus) => void): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (active) onChange(); }, 100);
  };
  const storage = (event: StorageEvent) => { if (event.key === 'visaflow-demo-v4') refresh(); };
  const focus = () => { if (document.visibilityState === 'visible') refresh(); };
  window.addEventListener('visaflow-demo-change', refresh);
  window.addEventListener('storage', storage);
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', focus);
  const release: (() => void)[] = [];
  if (!isSupabaseConfigured) onStatus?.('local');
  else {
    onStatus?.('connecting');
    const supabase = getSupabase();
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session || !active) { if (active) onStatus?.('signed-out'); return; }
      await supabase.realtime.setAuth(data.session.access_token);
      if (!active) return;
      const selected = [...new Set(topics)].slice(0, 7);
      const statuses = new Map(selected.map((topic) => [topic, 'connecting' as LiveStatus]));
      for (const topic of selected) release.push(acquire(topic, data.session.user.id, {
        refresh,
        status: (status) => {
          if (!active) return;
          statuses.set(topic, status);
          onStatus?.([...statuses.values()].every((s) => s === 'live') ? 'live' : 'reconnecting');
        },
      }));
    }).catch(() => { if (active) onStatus?.('reconnecting'); });
  }
  return () => {
    active = false;
    clearTimeout(timer);
    window.removeEventListener('visaflow-demo-change', refresh);
    window.removeEventListener('storage', storage);
    window.removeEventListener('online', refresh);
    document.removeEventListener('visibilitychange', focus);
    release.forEach((stop) => stop());
  };
}

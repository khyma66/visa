'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthProvider';
import { EMPTY_NOTIFICATIONS, getNotifications, type NotificationData } from '@/lib/notifications';
import { subscribeLive } from '@/lib/realtime';

type State = { data: NotificationData; ready: boolean; error: string; refresh: () => void };
const NotificationContext = createContext<State>({ data: EMPTY_NOTIFICATIONS, ready: false, error: '', refresh: () => {} });
export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user, demoMode } = useAuth();
  const [data, setData] = useState(EMPTY_NOTIFICATIONS);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const reload = useRef<() => void>(() => {});
  const refresh = useCallback(() => reload.current(), []);
  useEffect(() => {
    setData(EMPTY_NOTIFICATIONS); setReady(false); setError('');
    if (!user || demoMode) { setReady(true); return; }
    let active = true, running = false, again = false;
    const load = async () => {
      if (running) { again = true; return; }
      running = true;
      do {
        again = false;
        try { const value = await getNotifications(); if (active) { setData(value); setError(''); } }
        catch (reason) { if (active) setError(reason instanceof Error ? reason.message : 'Notifications are unavailable.'); }
        finally { if (active) setReady(true); }
      } while (active && again);
      running = false;
    };
    reload.current = () => { void load(); };
    void load();
    const stop = subscribeLive([`inbox:${user.id}`], () => { void load(); });
    // Reconcile after missed socket events, without polling hidden tabs.
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60000);
    return () => { active = false; reload.current = () => {}; clearInterval(timer); stop(); };
  }, [user?.id, demoMode]);
  return <NotificationContext.Provider value={{ data, ready, error, refresh }}>{children}</NotificationContext.Provider>;
}
export const useNotifications = () => useContext(NotificationContext);

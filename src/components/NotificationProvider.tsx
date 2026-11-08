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
    let active = true, running = false, again = false, failures = 0;
    let timer:ReturnType<typeof setTimeout>;
    const schedule = () => { clearTimeout(timer); if(active)timer=setTimeout(()=>{if(document.visibilityState==='visible')void load();else schedule();},Math.min(300000,120000*2**Math.min(failures,2))+Math.random()*15000); };
    const load = async () => {
      if (running) { again = true; return; }
      running = true;
      do {
        again = false;
        try { const value = await getNotifications(); if (active) { setData(value); setError(''); failures=0; } }
        catch (reason) { failures++; if (active) setError(reason instanceof Error ? reason.message : 'Notifications are unavailable.'); }
        finally { if (active) setReady(true); }
      } while (active && again);
      running = false; schedule();
    };
    reload.current = () => { void load(); };
    void load();
    const stop = subscribeLive([`inbox:${user.id}`], () => { void load(); });
    // Reconcile after missed socket events, without polling hidden tabs.

    return () => { active = false; reload.current = () => {}; clearTimeout(timer); stop(); };
  }, [user?.id, demoMode]);
  return <NotificationContext.Provider value={{ data, ready, error, refresh }}>{children}</NotificationContext.Provider>;
}
export const useNotifications = () => useContext(NotificationContext);

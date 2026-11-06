'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import { isFeedbackOwner } from '@/lib/feedback';

type Access = 'checking' | 'owner' | 'denied' | 'error';
const OwnerAccess = createContext<{ status: Access; retry: () => void }>({ status: 'checking', retry: () => {} });

/** Navigation discovery only. Each dashboard API/RPC still authorizes its caller. */
export function OwnerAccessProvider({ children }: { children: React.ReactNode }) {
  const { user, loading, demoMode } = useAuth();
  const [result, setResult] = useState<{ id: string; status: Access } | null>(null);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!user || demoMode || loading) return;
    let active = true;
    // Background revalidation must not unmount a dashboard or discard its draft.
    setResult(current => current?.id === user.id && current.status === 'owner' ? current : { id: user.id, status: 'checking' });
    void isFeedbackOwner().then(allowed => {
      if (active) setResult({ id: user.id, status: allowed === true ? 'owner' : 'denied' });
    }).catch(() => { if (active) setResult({ id: user.id, status: 'error' }); });
    return () => { active = false; };
  }, [user?.id, loading, demoMode, revision]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') retry(); };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [retry]);
  const status = loading ? 'checking' : !user || demoMode ? 'denied' : result?.id === user.id ? result.status : 'checking';
  return <OwnerAccess.Provider value={{ status, retry }}>{children}</OwnerAccess.Provider>;
}

export const useOwnerAccess = () => useContext(OwnerAccess);

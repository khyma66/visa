'use client';

import { Fragment, createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { DEMO_USER } from '@/lib/demo-data';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import type { CommunityUser, Profile } from '@/lib/types';
import { createAuthSessionSync, type AuthState } from '@/lib/auth-session';
import { requestEmailCode, verifyEmailCode, startSocialSignIn, signInWithPassword, type AuthMethods, type SocialProvider } from '@/lib/auth-flow';

type AuthContextValue = {
  user: CommunityUser | null;
  profile: Profile | null;
  loading: boolean;
  demoMode: boolean;
  login: (email: string, password: string) => Promise<void>;
  requestCode: (email: string, redirectTo: string) => Promise<void>;
  verifyCode: (email: string, token: string) => Promise<void>;
  signInWithProvider: (provider: SocialProvider, methods: AuthMethods, redirectTo: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [{ user, profile, loading }, setAuth] = useState<AuthState>({
    user: isSupabaseConfigured ? null : { id: DEMO_USER.id, email: 'demo@local.invalid' },
    profile: isSupabaseConfigured ? null : DEMO_USER,
    loading: isSupabaseConfigured,
  });

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();
    const sessionUser = (session: Session | null): CommunityUser | null => session?.user
      ? { id: session.user.id, email: session.user.email ?? null } : null;
    const sync = createAuthSessionSync(setAuth, async (id) => {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session) => {
      sync.event(sessionUser(session));
    });
    void supabase.auth.getSession().then(({ data }) => sync.initial(sessionUser(data.session))).catch(() => sync.initial(null));
    return () => { sync.stop(); listener.subscription.unsubscribe(); };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    profile,
    loading,
    demoMode: !isSupabaseConfigured,
    login: async (email, password) => signInWithPassword(getSupabase(), email, password),
    requestCode: async (email, redirectTo) => requestEmailCode(getSupabase(), email, redirectTo),
    verifyCode: async (email, token) => verifyEmailCode(getSupabase(), email, token),
    signInWithProvider: async (provider, methods, redirectTo) => startSocialSignIn(getSupabase(), provider, methods, redirectTo),
    signOut: async () => {
      if (!isSupabaseConfigured) return;
      const { error } = await getSupabase().auth.signOut();
      if (error) throw error;
    },
  }), [loading, profile, user]);

  if (process.env.NEXT_PUBLIC_APP_ENV === 'production' && !isSupabaseConfigured) {
    return <main className="mx-auto max-w-xl p-10"><h1 className="text-2xl font-bold">Service temporarily unavailable</h1><p className="mt-3">The community configuration needs attention. Please try again later.</p></main>;
  }
  // Remount account-scoped UI so cached inboxes, messages and drafts cannot carry
  // across identities. Late results from the unmounted tree cannot display.
  return <AuthContext.Provider value={value}><Fragment key={user?.id ?? 'signed-out'}>{children}</Fragment></AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

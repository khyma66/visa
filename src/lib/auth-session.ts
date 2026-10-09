import type { CommunityUser, Profile } from './types';

export type AuthState = { user: CommunityUser | null; profile: Profile | null; loading: boolean; profileLoading?: boolean };

// Auth events are authoritative. A slow initial read or prior profile request must
// never restore the previous account after a sign-out/account switch.
export function createAuthSessionSync(
  publish: (state: AuthState) => void,
  readProfile: (id: string) => Promise<Profile | null>,
) {
  let active = true;
  let version = 0;
  let observedEvent = false;
  let state: AuthState = { user: null, profile: null, loading: true };
  const refresh = async () => {
    const user = state.user;
    if (!active || !user) return;
    const request = ++version;
    state = { ...state, profileLoading: true }; publish(state);
    try {
      const profile = await readProfile(user.id);
      if (!active || request !== version) return;
      state = { ...state, profile: profile?.id === user.id ? profile : null };
    } finally {
      if (active && request === version) { state = { ...state, profileLoading: false }; publish(state); }
    }
  };
  const accept = (user: CommunityUser | null) => {
    if (!active) return;
    // INITIAL_SESSION, SIGNED_IN on tab focus and TOKEN_REFRESHED can all
    // describe the same identity. They must not blank the UI or refetch profiles.
    if (!state.loading && user?.id === state.user?.id) {
      if (user?.email !== state.user?.email) { state = { ...state, user }; publish(state); }
      return;
    }
    const request = ++version;
    state = { user, profile: null, loading: false, profileLoading: Boolean(user) };
    publish(state);
    if (!user) return;
    // Supabase profile reads must run outside its auth-event session lock.
    setTimeout(() => {
      if (!active || request !== version) return;
      void readProfile(user.id).catch(() => null).then((profile) => {
        if (!active || request !== version) return;
        state = { ...state, profile: profile?.id === user.id ? profile : null, loading: false, profileLoading: false };
        publish(state);
      });
    }, 0);
  };
  return {
    initial: (user: CommunityUser | null) => { if (!observedEvent) accept(user); },
    event: (user: CommunityUser | null) => { observedEvent = true; accept(user); },
    refresh,
    stop: () => { active = false; version++; },
  };
}

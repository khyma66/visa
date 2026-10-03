import type { CommunityUser, Profile } from './types';

export type AuthState = { user: CommunityUser | null; profile: Profile | null; loading: boolean };

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
  const accept = (user: CommunityUser | null) => {
    if (!active) return;
    const request = ++version;
    state = { user, profile: user?.id === state.user?.id ? state.profile : null, loading: Boolean(user) };
    publish(state);
    if (!user) return;
    // Supabase profile reads must run outside its auth-event session lock.
    setTimeout(() => {
      if (!active || request !== version) return;
      void readProfile(user.id).catch(() => null).then((profile) => {
        if (!active || request !== version) return;
        state = { user, profile: profile?.id === user.id ? profile : null, loading: false };
        publish(state);
      });
    }, 0);
  };
  return {
    initial: (user: CommunityUser | null) => { if (!observedEvent) accept(user); },
    event: (user: CommunityUser | null) => { observedEvent = true; accept(user); },
    stop: () => { active = false; version++; },
  };
}

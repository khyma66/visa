import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AuthMethods } from '../auth-flow';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(
  url && key && !url.includes('your-project') && !key.includes('replace_me'),
);

let browserClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured || !url || !key) {
    throw new Error('Supabase is not configured. The app is running in demo mode.');
  }

  browserClient ??= createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  });
  return browserClient;
}

let methodsCache: { value: AuthMethods; expires: number } | null = null;
let methodsRequest: Promise<AuthMethods> | null = null;

export async function getAuthMethods(_signal?: AbortSignal): Promise<AuthMethods> {
  if (!url || !key) return { google: false, phone: false };
  if (methodsCache && methodsCache.expires > Date.now()) return methodsCache.value;
  // Public capabilities only: share concurrent reads, not sessions or user data.
  methodsRequest ??= (async () => {
    const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key }, signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!response.ok) throw new Error('Sign-in settings unavailable');
    const settings = await response.json() as { external?: { google?: boolean; phone?: boolean } };
    const value = { google: settings.external?.google === true, phone: settings.external?.phone === true };
    methodsCache = { value, expires: Date.now() + 60000 };
    return value;
  })().finally(() => { methodsRequest = null; });
  return methodsRequest;
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

export async function getAuthMethods(signal?: AbortSignal) {
  if (!url || !key) return { google: false };
  const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key }, signal });
  if (!response.ok) throw new Error('Sign-in settings unavailable');
  const settings = await response.json() as { external?: { google?: boolean; apple?: boolean } };
  return { google: settings.external?.google === true };
}

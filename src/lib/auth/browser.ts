'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readPublicAuthConfig } from './config';

let browserClient: SupabaseClient | null = null;

export function getBrowserAuthClient(): SupabaseClient | null {
  if (typeof window === 'undefined') return null;
  if (browserClient) return browserClient;
  const config = readPublicAuthConfig(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!config) return null;
  browserClient = createClient(config.url, config.key, {
    auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true, storageKey: 'visaflow-auth' },
  });
  return browserClient;
}

export const googleEnabled = process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED === 'true';
export const captchaSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';

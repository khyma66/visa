import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile } from './types';

export const ACCOUNT_PAGE_SIZE = 20;
export type ActivityKind = 'questions' | 'answers';
export type AccountActivity = {
  id: string;
  title?: string;
  body: string;
  question_id?: string;
  vote_score: number;
  answer_count?: number;
  is_accepted?: boolean;
  created_at: string;
};
export type ActivityPage = { items: AccountActivity[]; more: boolean };
export type AccountIdentity = { email: string | null; providers: string[]; emailVerified: boolean };

export async function getAccountActivity(client: SupabaseClient, userId: string, kind: ActivityKind, page = 0): Promise<ActivityPage> {
  if (!Number.isSafeInteger(page) || page < 0 || !userId || !['questions', 'answers'].includes(kind)) throw new Error('Invalid activity request.');
  const start = page * ACCOUNT_PAGE_SIZE;
  if (!Number.isSafeInteger(start + ACCOUNT_PAGE_SIZE)) throw new Error('Invalid activity page.');
  const fields = kind === 'questions'
    ? 'id,title,body,vote_score,answer_count,created_at'
    : 'id,question_id,body,vote_score,is_accepted,created_at';
  // RLS-backed public views retain moderation rules; author_id scopes every page.
  const { data, error } = await client.from(kind === 'questions' ? 'question_feed' : 'answer_feed')
    .select(fields).eq('author_id', userId)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(start, start + ACCOUNT_PAGE_SIZE).abortSignal(AbortSignal.timeout(8000));
  if (error) throw new Error('Your activity could not be loaded. Please try again.');
  const items = (data ?? []) as unknown as AccountActivity[];
  return { items: items.slice(0, ACCOUNT_PAGE_SIZE), more: items.length > ACCOUNT_PAGE_SIZE };
}

export async function saveProfileBio(client: SupabaseClient, userId: string, value: string): Promise<Profile> {
  const bio = value.trim();
  if (!userId || [...bio].length > 280) throw new Error('Your bio must be 280 characters or fewer.');
  // Only this granted column may be written. Ownership is enforced again by RLS.
  const { data, error } = await client.from('profiles').update({ bio: bio || null }).eq('id', userId)
    .select('id,username,avatar_seed,bio,reputation').abortSignal(AbortSignal.timeout(8000)).single();
  if (error || !data || data.id !== userId) throw new Error('Your bio could not be saved. Please try again.');
  return data as Profile;
}

export async function getAccountIdentity(client: SupabaseClient, userId: string): Promise<AccountIdentity> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user || data.user.id !== userId) throw new Error('Your sign-in details could not be verified. Please try again.');
  return {
    email: data.user.email ?? null,
    providers: [...new Set((data.user.identities ?? []).map(identity => identity.provider))],
    emailVerified: Boolean(data.user.email_confirmed_at),
  };
}

export async function hasAccountPolicyAcceptance(client: SupabaseClient, userId: string, policyVersion: string): Promise<boolean> {
  const { data, error } = await client.from('policy_acceptances').select('policy_version')
    .eq('user_id', userId).eq('policy_version', policyVersion)
    .abortSignal(AbortSignal.timeout(8000)).maybeSingle();
  if (error) throw new Error('We could not check whether profile editing is available.');
  return data?.policy_version === policyVersion;
}

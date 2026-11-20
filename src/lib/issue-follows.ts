'use client';

import { getSupabase } from './supabase/client';

export type IssueFollow = { id: string; anchor_id: string; title: string; topics: string[]; created_at: string };

/** Topics a post can be followed by: its own tags, minus the generic fallback tag. The database re-validates. */
export function followTopics(tags: readonly string[] | null | undefined): string[] {
  return [...new Set((tags ?? []).map(tag => tag.trim().toLowerCase()).filter(tag => tag && tag !== 'visa-question'))].slice(0, 5);
}

export function loginHref(path: string) {
  return `/login?next=${encodeURIComponent(path || '/')}#sign-in`;
}

export async function listIssueFollows(): Promise<IssueFollow[]> {
  const { data, error } = await getSupabase().rpc('member_issue_follows').abortSignal(AbortSignal.timeout(10000));
  if (error || !Array.isArray(data)) throw new Error('Followed issues could not be loaded. Please try again.');
  return data as IssueFollow[];
}

export async function followIssue(anchor: string, title: string, topics: string[], userId: string): Promise<IssueFollow> {
  const { data, error } = await getSupabase().rpc('follow_issue', { anchor, anchor_title: title, anchor_topics: topics, expected_user: userId })
    .abortSignal(AbortSignal.timeout(10000));
  if (error || !data) throw new Error(error?.message && /50 issues|no topics|no longer available/.test(error.message) ? error.message : 'Could not follow this issue. Please try again.');
  return data as IssueFollow;
}

export async function unfollowIssue(anchor: string, userId: string) {
  const { error } = await getSupabase().rpc('unfollow_issue', { anchor, expected_user: userId }).abortSignal(AbortSignal.timeout(10000));
  if (error) throw new Error('Could not unfollow this issue. Please try again.');
}

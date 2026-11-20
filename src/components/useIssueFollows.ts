'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import { followIssue, listIssueFollows, unfollowIssue, type IssueFollow } from '@/lib/issue-follows';

// One shared list per signed-in member, so every "Notify me" button on a page
// (post toolbar plus each Similar post) reflects the same state with one request.
type Store = { userId: string; follows: IssueFollow[] | null; error: string; pending: Promise<void> | null };
let store: Store | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

function load(userId: string, force = false) {
  if (!store || store.userId !== userId) store = { userId, follows: null, error: '', pending: null };
  if (store.pending || (store.follows && !force)) return;
  const current = store;
  current.pending = listIssueFollows()
    .then(follows => { if (store === current) { current.follows = follows; current.error = ''; } })
    .catch(reason => { if (store === current) current.error = reason instanceof Error ? reason.message : 'Followed issues could not be loaded.'; })
    .finally(() => { current.pending = null; emit(); });
}

export function useIssueFollows() {
  const { user, demoMode } = useAuth();
  const userId = !demoMode ? user?.id ?? null : null;
  const [, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion(value => value + 1);
    listeners.add(listener);
    if (userId) load(userId);
    return () => { listeners.delete(listener); };
  }, [userId]);
  const mine = userId && store?.userId === userId ? store : null;
  const follow = useCallback(async (anchor: string, title: string, topics: string[]) => {
    if (!userId) return;
    const saved = await followIssue(anchor, title, topics, userId);
    if (store?.userId === userId) store.follows = [saved, ...(store.follows ?? []).filter(item => item.anchor_id !== anchor)];
    emit();
  }, [userId]);
  const unfollow = useCallback(async (anchor: string) => {
    if (!userId) return;
    await unfollowIssue(anchor, userId);
    if (store?.userId === userId) store.follows = (store.follows ?? []).filter(item => item.anchor_id !== anchor);
    emit();
  }, [userId]);
  const refresh = useCallback(() => { if (userId) load(userId, true); }, [userId]);
  return { follows: mine?.follows ?? null, error: mine?.error ?? '', follow, unfollow, refresh };
}

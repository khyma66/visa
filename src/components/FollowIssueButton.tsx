'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { useIssueFollows } from './useIssueFollows';
import { followTopics, loginHref } from '@/lib/issue-follows';

type Props = { anchorId: string; title: string; tags: readonly string[]; path: string; variant?: 'toolbar' | 'panel' };

/**
 * "Notify me when others with this issue post": follows a post's topics, anchored on the post id.
 * Works for imported earlier discussions too, whose authors cannot be messaged.
 */
export function FollowIssueButton({ anchorId, title, tags, path, variant = 'panel' }: Props) {
  const { user, loading, demoMode } = useAuth();
  const { follows, follow, unfollow } = useIssueFollows();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const topics = followTopics(tags);
  if (demoMode || loading || !topics.length) return null;
  const className = variant === 'toolbar' ? 'post-related-action' : 'inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700';
  const description = `Get a notification when members post about ${title}`;
  if (!user) return <Link href={loginHref(path)} className={className} title={description} aria-label={`Log in to get notified when others post about ${title}`}><Bell size={16} aria-hidden="true" />Notify me</Link>;
  const following = Boolean(follows?.some(item => item.anchor_id === anchorId));
  async function toggle() {
    if (busy) return;
    setBusy(true); setError('');
    try { if (following) await unfollow(anchorId); else await follow(anchorId, title, topics); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update this follow.'); }
    finally { setBusy(false); }
  }
  return <span className="inline-flex flex-col items-start">
    <button type="button" onClick={() => void toggle()} disabled={busy || follows === null} aria-pressed={following} className={className}
      title={following ? 'Stop notifications for this issue' : description}
      aria-label={following ? `Following this issue. Unfollow ${title}` : `Notify me when others post about ${title}`}>
      {following ? <BellRing size={16} aria-hidden="true" /> : <Bell size={16} aria-hidden="true" />}{busy ? 'Saving…' : following ? 'Following' : 'Notify me'}
    </button>
    {error && <span role="alert" className="mt-1 max-w-56 text-xs text-rose-700">{error}</span>}
  </span>;
}

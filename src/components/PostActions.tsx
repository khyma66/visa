'use client';

import Link from 'next/link';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { Bell, Bookmark, MessageCircle, Mail } from 'lucide-react';
import { getMemberMessageHref } from '@/lib/messaging-state';
import { featureAccess } from '@/lib/feature-access';
import { useAuth } from './AuthProvider';
import { PostShare } from './PostShare';
import { ReportButton } from './ReportButton';
import { changeLibraryEntry, emptyLibraryEntry, libraryStore, retryLibrary, watchLibrary, type LibrarySelection } from '@/lib/post-library';

function MemberActions({ postId, userId }: { postId: string; userId: string }) {
  const store = libraryStore(userId);
  const subscribe = useCallback((listener: () => void) => watchLibrary(store, postId, listener), [store, postId]);
  const read = useCallback(() => store.values.get(postId) ?? emptyLibraryEntry(postId), [store, postId]);
  const state = useSyncExternalStore(subscribe, read, () => emptyLibraryEntry(postId));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const locked = useRef(false);
  async function change(selection: LibrarySelection) {
    if (locked.current) return;
    if (state.error) { retryLibrary(store, postId); return; }
    locked.current = true; setBusy(true); setStatus('');
    try {
      const enabled = !state.entry[selection];
      await changeLibraryEntry(store, postId, selection, enabled);
      setStatus(selection === 'saved' ? enabled ? 'Saved to your profile.' : 'Removed from Saved posts.' : enabled ? 'Added to Following in your profile.' : 'Unfollowed.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Please try again.'); }
    finally { locked.current = false; setBusy(false); }
  }
  return <>
    <button type="button" className="post-action" disabled={busy || state.loading} aria-pressed={state.entry.followed} title={state.error ? 'Retry loading your post library' : 'Keep this discussion in Following on your profile'} onClick={() => void change('followed')}><Bell size={16} aria-hidden="true"/>{state.entry.followed ? 'Following' : 'Follow'}</button>
    <button type="button" className="post-action" disabled={busy || state.loading} aria-pressed={state.entry.saved} title={state.error ? 'Retry loading your post library' : 'Save privately to your profile'} onClick={() => void change('saved')}><Bookmark size={16} fill={state.entry.saved ? 'currentColor' : 'none'} aria-hidden="true"/>{state.entry.saved ? 'Saved' : 'Save'}</button>
    {(status || state.error) && <span role="status" className="post-action-status">{status || 'Saved status unavailable. Select Save or Follow to retry.'}</span>}
  </>;
}

export function PostActions({ postId, path, imported = false, onReply, author, showReply = true }: { postId: string; path: string; imported?: boolean; onReply?: () => void; author?: { id: string; author_id: string | null; author_username: string; source?: string }; showReply?: boolean }) {
  const { user, demoMode } = useAuth();
  const messageHref = author && !imported ? getMemberMessageHref(author, user?.id) : null;
  const login = `/login?next=${encodeURIComponent(path)}`;
  // Changing accounts remounts all private state, including pending confirmations.
  return <div className="post-action-container relative pb-1">
    <div className="post-actions" aria-label="Post actions">
      {showReply && <Link className="post-action" href={`${path}#reply`} onClick={onReply}><MessageCircle size={16} aria-hidden="true"/>Reply</Link>}
      {featureAccess.directMessaging && messageHref && <Link className="post-action" href={messageHref}><Mail size={16} aria-hidden="true"/>Message user</Link>}
      {featureAccess.postSharing && <PostShare path={path}/>}
      {featureAccess.postLibrary && (user && !demoMode ? <MemberActions key={`${user.id}:${postId}`} userId={user.id} postId={postId}/> : <>
        <Link className="post-action" href={login}><Bell size={16} aria-hidden="true"/>Follow</Link>
        <Link className="post-action" href={login}><Bookmark size={16} aria-hidden="true"/>Save</Link>
      </>)}
      <ReportButton compact kind={imported ? 'source_question' : 'question'} target={postId}/>
    </div>
  </div>;
}

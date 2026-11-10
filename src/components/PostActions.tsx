'use client';

import Link from 'next/link';
import type {Question} from '@/lib/types';
import {OwnerContentActions} from './OwnerContentActions';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { Bell, Bookmark, Ellipsis } from 'lucide-react';
import { ActionPopover } from './ActionPopover';
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

export function PostActions({ postId, path, imported = false, content, onChanged }: { postId: string; path: string; imported?: boolean; content?:Question; onChanged?:(deleted:boolean)=>void }) {
  const { user, demoMode } = useAuth();
  const login = `/login?next=${encodeURIComponent(path)}`;
  return <ActionPopover label="More post options" trigger={<><Ellipsis size={20} aria-hidden="true"/><span className="mobile-action-label" aria-hidden="true">More</span></>}>
    {featureAccess.postSharing && <PostShare path={path} inline/>}
    {featureAccess.postLibrary && (user && !demoMode ? <MemberActions key={`${user.id}:${postId}`} userId={user.id} postId={postId}/> : <>
      <Link className="post-action" href={login}><Bell size={16} aria-hidden="true"/>Follow</Link>
      <Link className="post-action" href={login}><Bookmark size={16} aria-hidden="true"/>Save</Link>
    </>)}
    {content&&!imported&&<OwnerContentActions content={content} kind="question" canEdit={content.status==='open'} onChanged={onChanged}/>}
    <ReportButton compact kind={imported ? 'source_question' : 'question'} target={postId}/>
  </ActionPopover>;
}

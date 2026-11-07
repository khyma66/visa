'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getQuestion } from '@/lib/community';
import { changeLibraryEntry, libraryStore, listLibrary, subscribeLibraryChanges, type LibraryEntry, type LibrarySelection } from '@/lib/post-library';
import type { Question } from '@/lib/types';
import { QuestionCard } from './QuestionCard';

export function SavedPosts({ userId, demoMode, selection }: { userId: string; demoMode: boolean; selection: LibrarySelection }) {
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; items: { entry: LibraryEntry; question: Question | null }[]; more: boolean } | null>(null);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState('');
  useEffect(() => subscribeLibraryChanges(userId, () => { setPage(0); setRetry(value => value + 1); }), [userId]);
  const key = `${userId}:${selection}:${page}:${retry}`;
  useEffect(() => {
    let active = true;
    setError('');
    if (demoMode) return;
    void listLibrary(selection, page).then(async response => {
      const items = await Promise.all(response.entries.map(async entry => ({ entry, question: await getQuestion(entry.post_id) })));
      if (active) setResult({ key, items, more: response.more });
    }).catch(() => { if (active) setError('Your posts could not be loaded. Please try again.'); });
    return () => { active = false; };
  }, [key, userId, selection, page, demoMode]);
  async function remove(id: string) {
    setRemoving(id); setError('');
    try { await changeLibraryEntry(libraryStore(userId), id, selection, false); setRetry(value => value + 1); }
    catch { setError('Could not remove this post. Please try again.'); }
    finally { setRemoving(''); }
  }
  const ready = result?.key === key;
  return <section className="p-4 sm:p-6">
    <h2 className="text-xl font-bold">{selection === 'saved' ? 'Saved posts' : 'Following'}</h2>
    <p className="mt-2 text-sm leading-6 text-slate-500">{selection === 'saved' ? 'Posts you save appear here. Only you can see this list.' : 'Return to discussions you follow and see their latest replies. This list is private; following does not send email notifications.'}</p>
    {demoMode ? <p className="mt-5 text-sm">Saved posts are available when you sign in to the connected community.</p> : error ? <div className="mt-5"><p role="alert" className="text-sm text-rose-700">{error}</p><button onClick={() => setRetry(value => value + 1)} className="mt-3 rounded-lg border px-4 py-2 text-sm">Try again</button></div> : !ready ? <p role="status" className="mt-5 text-sm">Loading your posts…</p> : <>
      {result.items.length ? <div className="mt-5">{result.items.map(({ entry, question }) => <div key={entry.post_id}>
        {question ? <QuestionCard question={question}/> : <div className="border-b py-5"><p className="text-sm text-slate-600">This post is no longer available.</p><button disabled={Boolean(removing)} onClick={() => void remove(entry.post_id)} className="mt-2 text-sm font-semibold text-blue-700 underline">{removing === entry.post_id ? 'Removing…' : selection === 'saved' ? 'Remove from Saved posts' : 'Unfollow'}</button></div>}
      </div>)}</div> : <div className="py-8"><p className="text-sm text-slate-600">{selection === 'saved' ? 'No saved posts yet. Select Save on any post to keep it here.' : 'No followed posts yet. Select Follow on a discussion to add it here.'}</p><Link className="mt-4 inline-block text-sm font-semibold text-blue-700 underline" href="/us/en">Explore posts</Link></div>}
      {(page > 0 || result.more) && <nav aria-label="Library pages" className="tab-row mt-5 items-center justify-between"><button disabled={page === 0} onClick={() => setPage(value => value - 1)} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40">Previous</button><span className="text-sm">Page {page + 1}</span><button disabled={!result.more} onClick={() => setPage(value => value + 1)} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40">Next</button></nav>}
    </>}
  </section>;
}

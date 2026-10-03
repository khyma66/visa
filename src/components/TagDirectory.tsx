'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Search, Tags } from 'lucide-react';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { archiveDirectoryPage, directoryPage, type ArchiveTagSummary, type DirectoryTag } from '@/lib/tag-directory';

export function TagDirectory() {
  const [tags, setTags] = useState<DirectoryTag[]>([]);
  const [error, setError] = useState('');
  const [archiveWarning, setArchiveWarning] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('popular');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const generation = useRef(0);
  const archive = useRef<ArchiveTagSummary[]>([]);

  const loadPage = useCallback(async (cursor?: DirectoryTag, signal?: AbortSignal) => {
    if (!isSupabaseConfigured) return archiveDirectoryPage(archive.current, search, sort, cursor);
    let request = getSupabase().rpc('community_tag_page', {
      query_text: search, sort_mode: sort, after_tag: cursor?.tag ?? null,
      before_count: cursor?.question_count ?? null, archive_counts: archive.current,
    });
    if (signal) request = request.abortSignal(signal);
    const { data, error: readError } = await request;
    if (readError) throw new Error('Community tags are temporarily unavailable. Please refresh to retry.');
    return directoryPage((data ?? []) as DirectoryTag[]);
  }, [search, sort]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const current = ++generation.current;
    setLoading(true); setError('');
    try {
      try {
        const response = await fetch('/api/tags', { signal });
        if (!response.ok) throw new Error('Archive unavailable');
        const summary = await response.json() as { tags: ArchiveTagSummary[] };
        if (current !== generation.current || signal?.aborted) return;
        archive.current = summary.tags;
        setArchiveWarning('');
      } catch {
        if (current !== generation.current || signal?.aborted) return;
        archive.current = [];
        setArchiveWarning('Some topic counts are temporarily unavailable. Available discussions are still included.');
      }
      const result = await loadPage(undefined, signal);
      if (current !== generation.current || signal?.aborted) return;
      setTags(result.tags); setHasMore(result.hasMore);
    } catch (reason) {
      if (current === generation.current && !signal?.aborted) setError(reason instanceof Error ? reason.message : 'Tags are unavailable.');
    } finally {
      if (current === generation.current && !signal?.aborted) { setLoading(false); setLoadingMore(false); }
    }
  }, [loadPage]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void refresh(controller.signal), 200);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(controller.signal); };
    window.addEventListener('focus', visible);
    window.addEventListener('online', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      generation.current++; controller.abort(); clearTimeout(timer);
      window.removeEventListener('focus', visible); window.removeEventListener('online', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);

  async function more() {
    if (loading || loadingMore || !tags.length) return;
    const current = generation.current;
    setLoadingMore(true); setError('');
    try {
      const result = await loadPage(tags.at(-1));
      if (current !== generation.current) return;
      setTags((previous) => [...new Map([...previous, ...result.tags].map((row) => [row.tag, row])).values()]);
      setHasMore(result.hasMore);
    } catch (reason) { if (current === generation.current) setError(reason instanceof Error ? reason.message : 'Could not load more tags.'); }
    finally { if (current === generation.current) setLoadingMore(false); }
  }

  return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
    <Link href="/" className="text-sm text-blue-700 hover:underline">← All questions</Link>
    <div className="mt-5 flex items-center gap-3"><Tags className="text-orange-600" /><h1 className="text-3xl font-medium">Tags</h1></div>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Find your topic, explore similar experiences, and join the discussion. Choose a tag to see matching questions and posts.</p>
    <div className="my-6 flex flex-wrap items-center gap-3">
      <label className="relative"><Search size={17} className="absolute left-3 top-3 text-slate-400" /><input aria-label="Filter tags" maxLength={40} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter by tag name" className="rounded border bg-white py-2 pl-10 pr-3" /></label>
      <select aria-label="Sort tags" value={sort} onChange={(event) => setSort(event.target.value)} className="rounded border bg-white p-2"><option value="popular">Most used</option><option value="name">Name A–Z</option></select>
      <button onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded border bg-white px-3 py-2 text-sm disabled:opacity-50"><RefreshCw size={15} />Refresh counts</button>
      <p role="status" className="ml-auto text-sm text-slate-500">{loading ? 'Updating tags…' : `${tags.length} tags shown${hasMore ? ' · more available' : ''}`}</p>
    </div>
    {archiveWarning && <p className="mb-4 rounded bg-amber-50 p-3 text-sm text-amber-900">{archiveWarning}</p>}
    {error && <p role="alert" className="mb-4 rounded bg-amber-50 p-4 text-amber-900">{error}</p>}
    {loading ? <p>Loading community tags…</p> : <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{tags.map((row) => <Link key={row.tag} href={`/?tag=${encodeURIComponent(row.tag)}`} className="flex min-h-44 flex-col rounded border border-slate-200 bg-white p-5 hover:border-blue-400">
        <span className="w-fit rounded bg-blue-50 px-2 py-1 text-sm font-semibold text-blue-700">{row.tag}</span>
        <p className="my-3 line-clamp-3 text-xs leading-5 text-slate-600">{row.example_title}</p>
        <span className="mt-auto text-xs font-semibold text-slate-500">{row.question_count} {row.question_count === 1 ? 'post' : 'posts'}</span>
      </Link>)}</div>
      {!tags.length && !error && <p>No tags match “{search}”.</p>}
      {hasMore && <button onClick={() => void more()} disabled={loadingMore} className="mt-6 rounded border bg-white px-5 py-3 text-sm font-semibold text-blue-700">{loadingMore ? 'Loading…' : 'Load more tags'}</button>}
      <p className="mt-6 text-xs text-slate-500">Counts exclude archived questions. A post may have several tags. Counts refresh when you return to this page or select Refresh counts.</p>
    </>}
  </main>;
}

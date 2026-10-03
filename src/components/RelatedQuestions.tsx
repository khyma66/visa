'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, Radio } from 'lucide-react';
import { discoverQuestions } from '@/lib/community';
import { contextTags, type DiscoveryContext } from '@/lib/discovery';
import { subscribeLive } from '@/lib/realtime';
import type { RelatedQuestion } from '@/lib/types';
import { useAuth } from './AuthProvider';

export function RelatedQuestions({ context, drafting = false }: { context: DiscoveryContext; drafting?: boolean }) {
  const { user } = useAuth();
  const [items, setItems] = useState<RelatedQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify(context);
  const tags = contextTags(context);
  const topicKey = tags.slice(0, 5).join('|');
  const hasContext = Boolean(context.id || (context.title ?? '').length + (context.body ?? '').length >= 8 || tags.length);

  useEffect(() => subscribeLive(topicKey.split('|').filter(Boolean).map((tag) => `discovery:${tag}`),
    () => setRevision((value) => value + 1)), [topicKey, user?.id]);

  useEffect(() => {
    let current = true;
    if (!hasContext) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      void discoverQuestions(JSON.parse(key) as DiscoveryContext)
        .then((rows) => { if (current) { setItems(rows); setError(''); } })
        .catch(() => { if (current) setError('Matches could not be updated. Keep writing; we will retry.'); })
        .finally(() => { if (current) setLoading(false); });
    }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [key, revision, hasContext]);

  return <section aria-label="Related questions" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-200 p-5">
      <div className="flex items-center justify-between gap-2"><h2 className="font-black text-slate-900">{drafting ? 'Related to your draft' : 'Related questions'}</h2><Radio size={15} className="text-teal-600" /></div>
      <p className="mt-2 text-xs leading-5 text-slate-500">{drafting ? 'Suggestions update as you type. Your draft is not published.' : 'Matched to this question and the discussion.'}</p>
      {tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{tags.slice(0, 8).map((tag) => <span key={tag} className="rounded bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-800">{tag}</span>)}</div>}
      <p aria-live="polite" className="mt-2 text-xs text-slate-500">{loading ? 'Updating matches…' : error || `${items.length} related posts`}</p>
    </div>
    <div className="divide-y divide-slate-100">{items.map((item) => <Link key={item.id} href={`/questions/${item.id}`} className="block p-4 hover:bg-slate-50">
      <div className="flex gap-3"><span className="mt-0.5 h-fit min-w-7 rounded bg-emerald-50 p-1 text-center text-xs font-bold text-emerald-800">{item.answer_count}</span><p className="text-sm font-semibold leading-5 text-blue-800">{item.title}</p></div>
      <p className="mt-2 text-xs text-slate-500">{item.match_reason ?? (item.matched_tags?.length ? `Shared topics: ${item.matched_tags.slice(0, 3).join(', ')}` : 'Similar wording')}</p>
      <div className="mt-2 flex flex-wrap gap-1">{item.tags.slice(0, 3).map((tag) => <span key={tag} className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${item.matched_tags?.includes(tag) ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{tag}</span>)}</div>
    </Link>)}</div>
    {!items.length && !loading && <div className="p-5 text-sm leading-6 text-slate-500"><Search size={20} className="mb-2 text-slate-400" />{hasContext ? 'No close match yet. Add more detail or publish your question.' : 'Describe your situation to find previous discussions.'}</div>}
  </section>;
}

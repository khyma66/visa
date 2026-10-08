'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, GitFork } from 'lucide-react';
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
    if (!hasContext) { setItems([]); setLoading(false); setError(''); return; }
    setLoading(true); setError(''); setItems([]);
    const timer = setTimeout(() => {
      void discoverQuestions(JSON.parse(key) as DiscoveryContext)
        .then((rows) => { if (current) { setItems(rows); setError(''); } })
        .catch(() => { if (current) setError('Related questions could not be loaded.'); })
        .finally(() => { if (current) setLoading(false); });
    }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [key, revision, hasContext]);

  return <section aria-label="Related questions" aria-busy={loading} className="min-w-0 border-b border-slate-200 bg-white pb-3">
    <div className="px-2 pb-2">
      <div className="flex items-center gap-2"><GitFork size={17} className="text-slate-500" aria-hidden="true" /><h2 className="text-sm font-bold text-slate-900">{drafting ? 'Related to your draft' : 'Related questions'}</h2></div>
      {drafting && <p className="mt-2 text-xs leading-5 text-slate-500">Suggestions update as you type. Your draft is not published.</p>}
      <p aria-live="polite" className="mt-2 text-xs text-slate-500">{loading ? 'Finding related questions...' : error || `${items.length} related posts`}</p>
      {error && <button onClick={() => setRevision((value) => value + 1)} className="mt-2 text-xs font-semibold text-blue-700 underline">Retry related questions</button>}
    </div>
    <div>{items.map((item) => <Link key={item.id} href={`/questions/${item.id}`} className="block rounded-lg px-2 py-3 hover:bg-slate-50">
      <p className="break-words text-sm font-semibold leading-5 text-slate-800">{item.title}</p>
      <div className="mt-2 flex flex-wrap gap-1">{item.tags.slice(0, 3).map((tag) => <span key={tag} className={`max-w-full break-words rounded px-1.5 py-0.5 text-[11px] font-medium ${item.matched_tags?.includes(tag) ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{tag}</span>)}</div>
      <p className="mt-2 text-xs text-slate-500">{item.vote_score} score · {item.answer_count} replies</p>
    </Link>)}</div>
    {!items.length && !loading && !error && <div className="px-2 py-3 text-xs leading-5 text-slate-500"><Search size={18} className="mb-2 text-slate-400" aria-hidden="true" />{hasContext ? (drafting ? 'No close match yet. Add more detail or publish your question.' : 'No related questions found yet.') : 'Search a visa topic to find related discussions.'}</div>}
  </section>;
}

'use client';

import Link from 'next/link';
import { CheckCircle2, Eye, MessageCircle, Share2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Question } from '@/lib/types';
import { Avatar } from './Avatar';

function compact(value: number) {
  return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function QuestionCard({ question, onTagSelect, onRelated }: { question: Question; onTagSelect?: (tag: string) => void; onRelated?: (question: Question) => void }) {
  const imported = question.source === 'apify' || question.id.startsWith('apify-');
  return (
    <article className="group border-b border-slate-200 bg-white px-4 py-5 transition hover:bg-slate-50/70 sm:px-6">
      <div className="flex gap-4">
        <div className="hidden w-20 shrink-0 flex-col gap-2 pt-1 text-right text-xs text-slate-500 sm:flex">
          <span><strong className="text-sm text-slate-800">{question.vote_score}</strong> {imported ? 'reactions' : 'votes'}</span>
          <span className={question.accepted_answer_id ? 'rounded border border-emerald-600 px-1.5 py-1 font-bold text-emerald-700' : ''}>
            {question.answer_count} {imported ? 'comments' : 'answers'}
          </span>
          {(!imported || question.view_count > 0) && <span className="inline-flex items-center justify-end gap-1">
            {imported ? <Share2 size={12} /> : <Eye size={12} />} {compact(question.view_count)} {imported ? 'shares' : ''}
          </span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-teal-800">
            <span className="rounded-full bg-teal-50 px-2 py-1">{question.visa_type}</span>
            <span className="text-slate-400">{question.destination_country}</span>
            {(question.post_kind === 'promotion' || question.post_kind === 'discussion') && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-slate-600"><MessageCircle size={11} /> {question.post_kind === 'promotion' ? 'Promotional post' : 'Discussion'}</span>}
          </div>
          <Link href={`/questions/${question.id}`} className="text-[17px] font-medium leading-snug text-blue-700 decoration-1 underline-offset-4 hover:text-blue-900 hover:underline">
            {question.title}
          </Link>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{question.body}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {question.tags.map((tag) => <Link key={tag} href={`/?tag=${encodeURIComponent(tag)}`} onClick={onTagSelect ? (event) => { event.preventDefault(); onTagSelect(tag); } : undefined} className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100">{tag}</Link>)}
            {onRelated && <button onClick={() => onRelated(question)} className="rounded px-2 py-1 text-xs font-semibold text-slate-500 underline hover:text-blue-700">Related questions</button>}
            <span className="ml-auto flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {question.accepted_answer_id && <CheckCircle2 size={14} className="text-emerald-600" />}
              {!imported && <Avatar seed={question.author_avatar_seed} size="sm" />}
              <span className="font-semibold text-slate-700">{imported ? 'Community contributor' : `u/${question.author_username}`}</span>
              <span>posted {formatDistanceToNow(new Date(question.created_at), { addSuffix: true })}</span>
            </span>
          </div>
          <div className="mt-3 flex gap-4 text-xs text-slate-500 sm:hidden">
            <span><b className="text-slate-800">{question.vote_score}</b> {imported ? 'reactions' : 'votes'}</span>
            <span><b className="text-slate-800">{question.answer_count}</b> {imported ? 'comments' : 'answers'}</span>
            {(!imported || question.view_count > 0) && <span><b className="text-slate-800">{compact(question.view_count)}</b> {imported ? 'shares' : 'views'}</span>}
          </div>
        </div>
      </div>
    </article>
  );
}

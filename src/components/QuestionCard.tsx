'use client';

import Link from 'next/link';
import { ArrowUp, CheckCircle2, Eye, GitFork, MessageCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { isImportedPost, topicLabel } from '@/lib/post-presentation';
import type { Question } from '@/lib/types';
import { Avatar } from './Avatar';

function compact(value: number) {
  return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function QuestionCard({ question, onTagSelect, onRelated }: { question: Question; onTagSelect?: (tag: string) => void; onRelated?: (question: Question) => void }) {
  const path = `/${question.post_kind === 'experience' ? 'experiences' : 'questions'}/${question.id}`;
  const imported = isImportedPost(question);
  return (
    <article className="feed-card group min-w-0 border-b border-slate-200 bg-white px-3 py-4 transition hover:bg-slate-50/70 sm:px-4">
      <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            {!imported && <Avatar seed={question.author_avatar_seed} size="sm" />}
            <span className="break-all font-semibold text-slate-700">{imported ? 'Community Contributor' : `u/${question.author_username}`}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={question.created_at} title={new Date(question.created_at).toLocaleString()}>{formatDistanceToNow(new Date(question.created_at), { addSuffix: true })}</time>
            <span className="ml-auto rounded bg-blue-50 px-2 py-1 font-semibold text-blue-800">{question.visa_type}</span>
          </div>
          <Link href={path} className="block break-words text-lg font-semibold leading-6 text-slate-950 decoration-1 underline-offset-4 hover:text-blue-700 hover:underline">
            {question.title}
          </Link>
          {question.post_kind && question.post_kind !== 'question' && <p className="mt-2 text-xs font-semibold text-slate-600">{question.post_kind === 'experience' ? `Experience · ${question.experience_category}` : question.post_kind === 'promotion' ? 'Promotional post' : 'Discussion'}</p>}
          <p className="mt-2 line-clamp-2 break-words text-sm leading-6 text-slate-600">{question.body}</p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {question.tags.map((tag) => <Link key={tag} href={`/?tag=${encodeURIComponent(tag)}`} onClick={onTagSelect ? (event) => { event.preventDefault(); onTagSelect(tag); } : undefined} className="max-w-full break-words rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100">{topicLabel(tag)}</Link>)}
            {question.destination_country !== 'Global' && <span className="ml-auto text-xs text-slate-500">{question.destination_country}</span>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
            <span title={imported ? "reactions" : "votes"} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-2"><ArrowUp size={14} aria-hidden="true" />{compact(question.vote_score)}<span className="sr-only"> {imported ? "reactions" : "votes"}</span></span>
            <Link href={path} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 hover:bg-slate-200 ${question.accepted_answer_id ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100'}`}>
              {question.accepted_answer_id ? <CheckCircle2 size={14} aria-hidden="true" /> : <MessageCircle size={14} aria-hidden="true" />}
              {compact(question.answer_count)} replies{question.accepted_answer_id && <span className="sr-only">, accepted answer</span>}
            </Link>
            {onRelated && <button onClick={() => onRelated(question)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 hover:bg-slate-200"><GitFork size={14} aria-hidden="true" />Related</button>}
            {!imported && <span className="ml-auto inline-flex items-center gap-1 font-normal"><Eye size={14} aria-hidden="true" />{compact(question.view_count)} views</span>}
          </div>
      </div>
    </article>
  );
}

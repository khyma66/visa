'use client';

import Link from 'next/link';
import {EditedLabel} from './EditedLabel';
import { CheckCircle2, MessageCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { isImportedPost, topicLabel } from '@/lib/post-presentation';
import type { Question } from '@/lib/types';
import { Avatar } from './Avatar';
import { PostOriginBadge } from './PostOriginBadge';
import { PostActions } from './PostActions';
import { PostViews } from './PostViews';
import {VoteControls} from './VoteControls';
import { AuthorIdentity } from './AuthorIdentity';

export function QuestionCard({ question, onTagSelect, onSelect, selected = false }: { question: Question; onTagSelect?: (tag: string) => void; onSelect?: () => void; selected?: boolean }) {
  const imported = isImportedPost(question);
  const path = `/us/en/${question.post_kind === 'experience' && !imported ? 'experiences' : 'questions'}/${question.id}`;
  return (
    <article data-selected={selected || undefined} onClick={onSelect ? (event) => {
      if (!(event.target as HTMLElement).closest('a, button, input, textarea, select, [role="button"]') && !window.getSelection()?.toString()) onSelect();
    } : undefined} className="feed-card group min-w-0 border-b border-slate-200 bg-white px-3 py-4 transition hover:bg-slate-50/70 sm:px-4">
      <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            {!imported && <Avatar seed={question.author_avatar_seed} size="sm" />}
            <AuthorIdentity content={question}/>
            <PostOriginBadge post={question} />
            <span aria-hidden="true" className="capitalize">·</span>
            <time className="capitalize" dateTime={question.created_at} title={new Date(question.created_at).toLocaleString()}>{formatDistanceToNow(new Date(question.created_at), { addSuffix: true })}</time>
            <EditedLabel at={question.edited_at}/><PostViews postId={question.id}/>
          </div>
          <Link href={path} className="block break-words text-thread-title font-semibold text-slate-950 decoration-1 underline-offset-4 hover:text-blue-700 hover:underline">
            {question.title}
          </Link>
          {question.post_kind && question.post_kind !== 'question' && <p className="mt-2 text-xs font-semibold text-slate-600">{question.post_kind === 'experience' ? `Experience · ${question.experience_category}` : question.post_kind === 'promotion' ? 'Promotional post' : 'Discussion'}</p>}
          {onSelect ? <button type="button" onClick={onSelect} aria-pressed={selected} aria-controls="feed-related" aria-label={`Show related posts for ${question.title}`} className="post-preview-select mt-2 block w-full rounded text-left text-base leading-6 text-slate-600">
            <span className="line-clamp-2 break-words">{question.body}</span>
          </button> : <p className="mt-2 line-clamp-2 break-words text-base leading-6 text-slate-600">{question.body}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {question.tags.map((tag) => <Link key={tag} href={`/us/en?tag=${encodeURIComponent(tag)}`} onClick={onTagSelect ? (event) => { event.preventDefault(); onTagSelect(tag); } : undefined} className="max-w-full break-words rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100">{topicLabel(tag)}</Link>)}
          </div>
          <div className="feed-post-toolbar relative mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600 capitalize">
            <VoteControls key={`${question.id}:${question.author_id}`} id={question.id} kind={imported?'archive_question':'question'} score={imported?0:question.vote_score} authorId={question.author_id} path={path}/>
            <Link href={`${path}#reply`} title={`${question.answer_count} ${question.answer_count === 1 ? 'reply' : 'replies'}`} aria-label={`${question.answer_count} ${question.answer_count === 1 ? 'reply' : 'replies'}${question.accepted_answer_id ? ', accepted answer' : ''}`} className="post-reply-action" data-accepted={Boolean(question.accepted_answer_id) || undefined}>
              {question.accepted_answer_id ? <CheckCircle2 size={20} aria-hidden="true" /> : <MessageCircle size={20} aria-hidden="true" />}
              <span className="post-reply-count" aria-hidden="true">{Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(question.answer_count)}</span>
            </Link>
            <Link href={`${path}#related-posts`} title="Related posts" aria-label={`Related posts for ${question.title}`} className="post-related-action">
              Related
            </Link>

            <PostActions content={question} postId={question.id} path={path} imported={imported}/>
          </div>
      </div>
    </article>
  );
}

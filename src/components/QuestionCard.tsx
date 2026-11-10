'use client';

import Link from 'next/link';
import {EditedLabel} from './EditedLabel';
import { CheckCircle2, GitFork, MessageCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { isImportedPost, topicLabel } from '@/lib/post-presentation';
import type { Question } from '@/lib/types';
import { Avatar } from './Avatar';
import { PostOriginBadge } from './PostOriginBadge';
import { PostActions } from './PostActions';
import { PostViews } from './PostViews';
import {VoteControls} from './VoteControls';
import { AuthorIdentity } from './AuthorIdentity';

export function QuestionCard({ question, onTagSelect }: { question: Question; onTagSelect?: (tag: string) => void }) {
  const imported = isImportedPost(question);
  const path = `/us/en/${question.post_kind === 'experience' && !imported ? 'experiences' : 'questions'}/${question.id}`;
  return (
    <article className="feed-card group min-w-0 border-b border-slate-200 bg-white px-3 py-4 transition hover:bg-slate-50/70 sm:px-4">
      <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            {!imported && <Avatar seed={question.author_avatar_seed} size="sm" />}
            <AuthorIdentity content={question}/>
            <PostOriginBadge post={question} />
            <span aria-hidden="true" className="capitalize">·</span>
            <time className="capitalize" dateTime={question.created_at} title={new Date(question.created_at).toLocaleString()}>{formatDistanceToNow(new Date(question.created_at), { addSuffix: true })}</time>
            <EditedLabel at={question.edited_at}/><PostViews postId={question.id}/>
            {imported&&<span title="Original reactions on the source site">{question.vote_score} original reactions</span>}
          </div>
          <Link href={path} className="block break-words text-thread-title font-semibold text-slate-950 decoration-1 underline-offset-4 hover:text-blue-700 hover:underline">
            {question.title}
          </Link>
          {question.post_kind && question.post_kind !== 'question' && <p className="mt-2 text-xs font-semibold text-slate-600">{question.post_kind === 'experience' ? `Experience · ${question.experience_category}` : question.post_kind === 'promotion' ? 'Promotional post' : 'Discussion'}</p>}
          <p className="mt-2 line-clamp-2 break-words text-base leading-6 text-slate-600">{question.body}</p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {question.tags.map((tag) => <Link key={tag} href={`/us/en?tag=${encodeURIComponent(tag)}`} onClick={onTagSelect ? (event) => { event.preventDefault(); onTagSelect(tag); } : undefined} className="max-w-full break-words rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100">{topicLabel(tag)}</Link>)}
          </div>
          <div className="feed-post-toolbar relative mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600 capitalize">
            <VoteControls key={`${question.id}:${question.author_id}`} id={question.id} kind={imported?'archive_question':'question'} score={imported?0:question.vote_score} authorId={question.author_id} path={path}/>
            <Link href={`${path}#reply`} title="Reply to this post" aria-label={`${question.answer_count} ${question.answer_count === 1 ? 'reply' : 'replies'}`} className={`post-reply-action inline-flex items-center gap-1.5 rounded-full px-3 py-2 hover:bg-slate-200 ${question.accepted_answer_id ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100'}`}>
              {question.accepted_answer_id ? <CheckCircle2 size={14} aria-hidden="true" /> : <MessageCircle size={14} aria-hidden="true" />}
              <span className="post-reply-copy">{question.answer_count} {question.answer_count === 1 ? 'reply' : 'replies'}</span><span className="mobile-action-label" aria-hidden="true">{question.answer_count}</span>{question.accepted_answer_id && <span className="sr-only capitalize">, accepted answer</span>}
            </Link>
            <Link href={`${path}#related-posts`} title="Related posts" aria-label={`Related posts for ${question.title}`} className="post-related-action">
              <GitFork size={14} aria-hidden="true" /><span className="mobile-action-label" aria-hidden="true">Related</span>
            </Link>

            <PostActions content={question} postId={question.id} path={path} imported={imported}/>
          </div>
      </div>
    </article>
  );
}

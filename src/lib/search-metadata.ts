import type { Metadata } from 'next';
import type { Answer, Question } from './types';
import { publicSearchOrigin, type SearchEnvironment } from './search-visibility';
import { isImportedPost, usVisaPost } from './post-presentation';

export type SearchParameters = Record<string, string | string[] | undefined>;
const SITE_ORIGIN = 'https://visathreads.com';
export const NATIVE_THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function threadPath(question: Pick<Question, 'id' | 'post_kind'>): string {
  return `/${question.post_kind === 'experience' ? 'experiences' : 'questions'}/${encodeURIComponent(question.id)}`;
}

export function eligibleNativeThread(question: Question): boolean {
  return NATIVE_THREAD_ID.test(question.id) && !isImportedPost(question)
    && question.status !== 'archived' && question.post_kind !== 'promotion'
    && Boolean(question.title.trim() && question.body.trim() && usVisaPost(question));
}

/** Parameters select alternate views, not independent search landing pages. */
export function publicPageMetadata(path: string, title: string, description: string,
  searchParams: SearchParameters = {}, eligible = true, env: SearchEnvironment = process.env): Metadata {
  const canonical = new URL(path, SITE_ORIGIN).href;
  const approved = Boolean(publicSearchOrigin(env));
  const filtered = Object.values(searchParams).some(value => value !== undefined);
  return {
    title: path === '/' ? { absolute: `${title} · VisaThreads` } : title,
    description, alternates: { canonical },
    robots: { index: approved && eligible && !filtered, follow: approved },
    openGraph: { type: 'website', siteName: 'VisaThreads', title, description, url: canonical },
    twitter: { card: 'summary', title, description },
  };
}

export function threadMetadata(question: Question | null, id: string, searchParams: SearchParameters = {}, experience = false): Metadata {
  if (!question) return publicPageMetadata(`/${experience ? 'experiences' : 'questions'}/${encodeURIComponent(id)}`,
    experience ? 'Visa experience' : 'Community question', 'A U.S. visa community discussion on VisaThreads.', searchParams, false);
  return {
    ...publicPageMetadata(threadPath(question), question.title,
      question.body.replace(/\s+/g, ' ').trim().slice(0, 160), searchParams, eligibleNativeThread(question)),
    // A public pseudonym is the author. Archive labels are not author identities.
    authors: isImportedPost(question) || !question.author_username ? [] : [{ name: `u/${question.author_username}` }],
  };
}

function author(username: string, id: string | null) {
  return id && NATIVE_THREAD_ID.test(id) && username.trim()
    ? { '@type': 'Person', name: `u/${username}` } : null;
}
function validDate(value: string): boolean { return Boolean(value && Number.isFinite(Date.parse(value))); }

/** Describe only real native content visible in this page's server-rendered view. */
export function threadStructuredData(question: Question, answers: Answer[], env: SearchEnvironment = process.env): Record<string, unknown> | null {
  const origin = publicSearchOrigin(env);
  const creator = author(question.author_username, question.author_id);
  if (!origin || !eligibleNativeThread(question) || !creator || !validDate(question.created_at)) return null;
  const url = new URL(threadPath(question), origin).href;
  const visibleAnswers = answers.filter(answer => answer.question_id === question.id && answer.status === 'active'
    && answer.source !== 'apify' && NATIVE_THREAD_ID.test(answer.id)
    && answer.body.trim() && validDate(answer.created_at) && author(answer.author_username, answer.author_id));
  const replies = visibleAnswers.map(answer => ({
    '@type': question.post_kind === 'experience' ? 'Comment' : 'Answer',
    text: answer.body, url: `${url}#answer-${answer.id}`, datePublished: answer.created_at,
    author: author(answer.author_username, answer.author_id),
  }));
  if (question.post_kind === 'experience') return {
    '@context': 'https://schema.org', '@type': 'DiscussionForumPosting',
    url, mainEntityOfPage: url, headline: question.title, text: question.body,
    author: creator, datePublished: question.created_at, comment: replies,
  };
  // No synthetic accepted answer, rating, credentials or placeholder response.
  if (!replies.length || !Number.isInteger(question.answer_count) || question.answer_count < replies.length) return null;
  const acceptedIndex = visibleAnswers.findIndex(answer => answer.id === question.accepted_answer_id && answer.is_accepted);
  return {
    '@context': 'https://schema.org', '@type': 'QAPage', url,
    mainEntity: {
      '@type': 'Question', name: question.title, text: question.body,
      author: creator, datePublished: question.created_at, answerCount: question.answer_count,
      ...(acceptedIndex >= 0 ? { acceptedAnswer: replies[acceptedIndex] } : {}),
      suggestedAnswer: replies.filter((_, index) => index !== acceptedIndex),
    },
  };
}

export function serializeStructuredData(value: Record<string, unknown>): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

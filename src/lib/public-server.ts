import { cache } from 'react';
import type { Answer, CommunityFeed, Question } from './types';
import archive from '@visa/archive';
import { normalizeArchiveFeed } from './archive-presentation';
import { usVisaPost } from './post-presentation';
import { NATIVE_THREAD_ID } from './search-metadata';
import { publicSearchOrigin } from './search-visibility';

const IMPORTED_THREAD_ID = /^apify-[a-zA-Z0-9_-]{1,160}$/;

/** Match /api/community's snapshot gate. Server rendering never starts ingestion. */
function publicArchive() {
  if (process.env.COMMUNITY_SOURCE_MODE !== 'snapshot'
    || (process.env.APP_ENV === 'production' && process.env.IMPORTED_CONTENT_APPROVED !== 'true')) return null;
  return normalizeArchiveFeed(archive as unknown as CommunityFeed);
}

// Public, anonymous reads only. Never forward a browser session into shared HTML.
async function publicRows<T>(table: string, query: Record<string,string>): Promise<T[] | null> {
  const origin = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!origin || !key) return null;
  const url = new URL(`/rest/v1/${table}`, origin);
  for (const [name,value] of Object.entries(query)) url.searchParams.set(name,value);
  const response = await fetch(url, { headers: { apikey:key, Accept:'application/json' },
    cache:'no-store', redirect: 'manual', signal:AbortSignal.timeout(5000) });
  // Workers support manual/follow, not redirect:error. Reject without forwarding
  // the publishable key or following a changed upstream destination.
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Community data is temporarily unavailable.');
  }
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error('Community data is temporarily unavailable.');
  return rows as T[];
}

export const publicQuestion = cache(async (id: string): Promise<Question | null> => {
  if (IMPORTED_THREAD_ID.test(id)) {
    const question = publicArchive()?.questions.find(row => row.id === id && row.status !== 'archived');
    if (!question || !usVisaPost(question)) return null;
    const counts = await publicRows<{ question_id: string; answer_count: number | string }>('imported_reply_counts', {
      question_id: `eq.${id}`, select: 'question_id,answer_count', limit: '1',
    });
    const memberCount = Number(counts?.[0]?.answer_count ?? 0);
    if (!Number.isSafeInteger(memberCount) || memberCount < 0) throw new Error('Reply counts are temporarily unavailable.');
    return usVisaPost({ ...question, answer_count: question.answer_count + memberCount });
  }
  if (!NATIVE_THREAD_ID.test(id)) return null;
  const question = (await publicRows<Question>('question_feed',{id:`eq.${id}`,select:'*',limit:'1'}))?.[0];
  return question && question.status !== 'archived' ? usVisaPost(question) : null;
});
export async function publicAnswers(id: string): Promise<Answer[]> {
  if (IMPORTED_THREAD_ID.test(id)) {
    const snapshot = publicArchive();
    const question = snapshot?.questions.find(row => row.id === id && row.status !== 'archived');
    if (!snapshot || !question || !usVisaPost(question)) return [];
    const source = snapshot.answersByQuestionId[id] ?? [];
    const members = await publicRows<Answer>('imported_answer_feed', {
      question_id: `eq.${id}`, select: '*', order: 'is_accepted.desc,vote_score.desc,id.desc', limit: '50',
    }) ?? [];
    return [...new Map([...source, ...members].map(row => [row.id, row])).values()]
      .filter(row => row.question_id === id && row.status === 'active')
      .sort((a, b) => Number(b.is_accepted) - Number(a.is_accepted) || b.vote_score - a.vote_score
        || (a.id === b.id ? 0 : a.id < b.id ? 1 : -1));
  }
  if (!NATIVE_THREAD_ID.test(id)) return [];
  // Match the browser's ranked cursor order. Further pages are fetched on demand.
  return await publicRows<Answer>('answer_feed',{question_id:`eq.${id}`,select:'*',order:'is_accepted.desc,vote_score.desc,id.desc',limit:'50'}) ?? [];
}

/** Only anonymous, currently public native rows. No session or privileged key. */
export async function publicThreadSitemap() {
  const origin = publicSearchOrigin();
  if (!origin) return [];
  const rows = await publicRows<Pick<Question, 'id' | 'post_kind'>>('question_feed', {
    select: 'id,post_kind', status: 'in.(open,closed)', destination_country: 'eq.United States',
    order: 'created_at.desc,id.desc', limit: '1000',
  }) ?? [];
  return rows.filter(row => NATIVE_THREAD_ID.test(row.id) && ['question', 'experience'].includes(row.post_kind ?? 'question'))
    .map(row => ({ url: new URL(`/${row.post_kind === 'experience' ? 'experiences' : 'questions'}/${row.id}`, origin).href }));
}

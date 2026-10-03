import { cache } from 'react';
import type { Answer, Question } from './types';

// Public, anonymous reads only. Never forward a browser session into shared HTML.
async function publicRows<T>(table: string, query: Record<string,string>): Promise<T[] | null> {
  const origin = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!origin || !key) return null;
  const url = new URL(`/rest/v1/${table}`, origin);
  for (const [name,value] of Object.entries(query)) url.searchParams.set(name,value);
  const response = await fetch(url, { headers: { apikey:key, Accept:'application/json' },
    cache:'no-store', signal:AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Community data is temporarily unavailable.');
  return response.json() as Promise<T[]>;
}

export const publicQuestion = cache(async (id: string): Promise<Question | null> => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  return (await publicRows<Question>('question_feed',{id:`eq.${id}`,select:'*',limit:'1'}))?.[0] ?? null;
});
export async function publicAnswers(id: string): Promise<Answer[]> {
  return await publicRows<Answer>('answer_feed',{question_id:`eq.${id}`,select:'*',order:'is_accepted.desc,vote_score.desc,created_at.asc',limit:'100'}) ?? [];
}

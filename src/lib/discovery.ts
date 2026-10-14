import { normalizeTag, detectTopics } from './tagging';
import type { Question, RelatedQuestion } from './types';

export type DiscoveryContext = {
  id?: string;
  title?: string;
  body?: string;
  tags?: string[];
  visa_type?: string;
  destination_country?: string;
  commentText?: string;
  draftText?: string;
};

const STOP_WORDS = new Set('a an and are as at be been but by can could did do does for from had has have how i if in is it its me my of on or our please should so that the their there they this to us was we were what when where which who will with would you your visa question help thanks thank'.split(' '));
export function searchTerms(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [])
    .filter((word) => !STOP_WORDS.has(word)))].slice(0, 48);
}

export function contextTags(context: DiscoveryContext): string[] {
  // Comment topics stay separate from the author's curated question tags.
  return [...new Set([
    ...detectTopics(context.draftText ?? ''),
    ...detectTopics(context.commentText ?? ''),
    ...(context.tags ?? []).map(normalizeTag),
    ...detectTopics(`${context.title ?? ''}\n${context.body ?? ''}`),
  ])].filter((tag) => tag && tag !== 'visa-question').slice(0, 16);
}

/** Small development archive only. Production candidates are retrieved by indexed SQL. */
export function createDiscoveryIndex(questions: Question[], comments: Record<string, string> = {}) {
  const records = new Map(questions.filter((q) => q.status !== 'archived' && q.post_kind !== 'promotion')
    .map((q) => [q.id, { question: q, tags: contextTags({ ...q, commentText: comments[q.id] }), terms: new Set(searchTerms(`${q.title} ${q.body} ${comments[q.id] ?? ''}`)), title: new Set(searchTerms(q.title)) }]));
  const postings = new Map<string, Set<string>>();
  const add = (key: string, id: string) => { if (!postings.has(key)) postings.set(key, new Set()); postings.get(key)!.add(id); };
  records.forEach((record, id) => {
    record.tags.forEach((tag) => add(`tag:${tag}`, id));
    record.terms.forEach((term) => add(`word:${term}`, id));
  });
  return {
    search(context: DiscoveryContext, limit = 5, extraTopics: Record<string, string[]> = {}): RelatedQuestion[] {
      const tags = contextTags(context);
      const commentTags = new Set(detectTopics(context.commentText ?? ''));
      const draftTags = new Set(detectTopics(context.draftText ?? ''));
      const terms = searchTerms(`${context.draftText ?? ''} ${context.commentText ?? ''} ${context.title ?? ''} ${context.body ?? ''}`);
      const ids = new Set<string>();
      [...tags.map((tag) => `tag:${tag}`), ...terms.map((term) => `word:${term}`)]
        .forEach((key) => postings.get(key)?.forEach((id) => ids.add(id)));
      Object.entries(extraTopics).forEach(([id, topics]) => { if (topics.some((tag) => tags.includes(tag))) ids.add(id); });
      const rows: RelatedQuestion[] = [];
      for (const id of ids) {
        if (id === context.id) continue;
        const record = records.get(id);
        if (!record) continue;
        const matches = tags.filter((tag) => record.tags.includes(tag) || extraTopics[id]?.includes(tag));
        const words = terms.filter((term) => record.terms.has(term));
        const score = matches.reduce((sum, tag) => sum + (draftTags.has(tag) ? 10 : commentTags.has(tag) ? 6 : 2)
          * (1 + Math.log(1 + records.size / (postings.get(`tag:${tag}`)?.size ?? 1))), 0)
          + Math.min(4, words.reduce((sum, word) => sum + (record.title.has(word) ? 1 : 0.25), 0))
          + (record.question.visa_type === context.visa_type && context.visa_type !== 'General' ? 0.5 : 0)
          + (record.question.destination_country === context.destination_country ? 0.25 : 0);
        if (!matches.length && words.length < 2) continue;
        rows.push({ ...record.question, similarity_score: score, matched_tags: matches,
          match_reason: matches.length ? `Shared topics: ${matches.slice(0, 3).join(', ')}` : 'Similar wording' });
      }
      return rows.sort((a, b) => (b.similarity_score ?? 0) - (a.similarity_score ?? 0)
        || b.vote_score - a.vote_score || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
        .slice(0, Math.min(12, Math.max(1, limit)));
    },
  };
}

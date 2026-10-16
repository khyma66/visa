import type { AssistantPostReference, AssistantRequest, AssistantResult } from './assistant-contract';

/** Shared, bounded conversation hints. None of these values confer access. */
export function assistantStandaloneFollowUp(question: string): boolean {
  return /^(?:why|how|what happened next|how long|how much)[?!.]*$/i.test(question.trim().replace(/\s+/g, ' '));
}

export function assistantMorePosts(question: string): boolean {
  return /^(?:(?:please|can you|could you)\s+)*(?:(?:show|find|list|give|get)\s+(?:me\s+)?)?(?:more|other|additional)\s+(?:posts|threads|discussions|results)[?!.]*$/i.test(question.trim());
}

function startsNewTopic(question: string): boolean {
  return /^(?:new topic|different topic|switch(?:ing)? (?:topics?|to)|instead[, :]|forget (?:that|the previous))/i.test(question.trim());
}

export function assistantPostOrdinal(question: string): number | 'last' | null {
  if (startsNewTopic(question)) return null;
  const match = /\b(?:(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d+(?:st|nd|rd|th)?)\s+(?:post|thread|discussion|result)\b(?![-–—])|(?:post|thread|discussion|result)\s*(?:number\s*|#\s*)?(\d+)\b)/i.exec(question);
  if (!match) return null;
  const word = (match[1] ?? match[2]).toLowerCase();
  if (word === 'last') return 'last';
  const named = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'].indexOf(word);
  const index = named >= 0 ? named : Number.parseInt(word, 10) - 1;
  // Out-of-range ordinals still count as references, so retrieval returns
  // insufficient instead of searching unrelated posts for e.g. "post 50".
  return Number.isFinite(index) ? index : 48;
}

export function assistantRefersToEarlierTurn(question: string): boolean {
  const text = question.trim();
  if (startsNewTopic(text)) return false;
  return assistantStandaloneFollowUp(text) || assistantMorePosts(text) || assistantPostOrdinal(text) !== null
    || /\b(?:it|its|that|those|them|they|their|there|these|same)\b|\bthis (?:one|case|post|thread|question|appointment)\b|^(?:and|what about|how about)\b/i.test(text);
}

/** Keep the latest self-contained topic even after many tiny follow-ups. */
export function assistantBoundedHistory(previous: string[]): string[] {
  const clean = previous.map(value => value.trim().slice(0, 1200)).filter(Boolean);
  let start = clean.length - 1;
  while (start > 0 && assistantRefersToEarlierTurn(clean[start])) start--;
  const topic = clean.slice(Math.max(0, start));
  return topic.length <= 3 ? topic : [topic[0], ...topic.slice(-2)];
}

export function assistantPreviousPost(input: AssistantRequest): AssistantPostReference | null {
  const question = input.question ?? '';
  if (!assistantRefersToEarlierTurn(question) || assistantMorePosts(question)) return null;
  const ordinal = assistantPostOrdinal(question);
  if (ordinal === null) return input.focusedPost ?? null;
  return (ordinal === 'last' ? input.previousPosts?.at(-1) : input.previousPosts?.[ordinal]) ?? null;
}

/** Use only after the server has re-read and matched the selected source. */
export function assistantResolvedPostQuestion(question: string): string {
  if (assistantPostOrdinal(question) === null) return question;
  return question.replace(/\b(?:the\s+)?(?:(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d+(?:st|nd|rd|th)?)\s+(?:post|thread|discussion|result)\b(?![-–—])|(?:post|thread|discussion|result)\s*(?:number\s*|#\s*)?\d+\b)/i, 'the selected discussion');
}

export function assistantSeenPostIds(input: AssistantRequest): string[] {
  if (!assistantMorePosts(input.question ?? '')) return [];
  return [...new Set([...(input.seenPostIds ?? []), ...(input.previousPosts ?? []).map(post => post.questionId)])].slice(0, 48);
}

/** Preserve the same order the person saw; never send source bodies or claims. */
export function assistantDisplayedPosts(result?: AssistantResult): AssistantPostReference[] {
  if (!result) return [];
  const references = result.kind === 'posts' ? (result.posts ?? []) : (() => {
    const cited = new Set([...result.claims, ...result.disagreements].flatMap(claim => claim.evidence.map(item => item.sourceId)));
    return result.sources.filter(source => cited.has(source.id)).map(source => ({ questionId: source.questionId, sourceId: source.id }));
  })();
  return references.slice(0, 48).map(({ questionId, sourceId }) => ({ questionId, sourceId }));
}

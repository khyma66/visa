import type { AssistantCorpus, AssistantRequest, AssistantResult, AssistantSource } from './assistant-contract';
import { assistantSearchTerms, redactAssistantText } from './assistant-core';

export const ASSISTANT_POST_SEARCH_LIMIT = 48;
const POST_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|apify-[A-Za-z0-9_-]{1,160})$/i;
const SEARCH_WORDS = new Set('give show find list get search look looking want need all every some relevant related relate relating regarding matching recent latest available post thread discussion question link result mention mentioning contain containing from like'.split(' '));
const POST_REQUEST_PREFIX_WORDS = new Set('me us for all any some the relevant related matching recent latest available'.split(' '));
const STAMPING = /\bstamp(?:ing|ed|s)?\b|\bdrop[ -]?box\b|\b221[ ()-]*g\b|\badministrative processing\b|\bconsular processing\b|\bvisa (?:interview|issuance|issued|appointment)\b/i;
const DELAY = /\bdelay(?:ed|ing|s)?\b|\bpending\b|\bwait(?:ing|ed|s)?\b|\bstuck\b|\bbacklog\b|\b(?:no|without|awaiting) (?:an? )?(?:update|response|passport)\b|\bnot (?:yet )?(?:received|returned|issued)\b|\badministrative processing\b|\b221[ ()-]*g\b/i;

export type AssistantPostSearchQuery = { text: string; terms: string[]; stamping: boolean; delay: boolean };
const normalizeTerm = (word: string) => /^(?:h-?1-?b|h-?4|f-?1|l-?1|l-?2|b-?1|b-?2)$/.test(word) ? word.replaceAll('-', '')
  : /^(?:stamp|stamping|stamped)$/.test(word) ? 'stamping'
  : /^(?:delay|delayed|delaying)$/.test(word) ? 'delay'
  : /^(?:wait|waiting|waited)$/.test(word) ? 'wait' : word;
const termsFor = (text: string) => [...new Set(assistantSearchTerms(text).map(normalizeTerm))];

/** Only explicit requests for posts take the non-generative search path. */
export function assistantPostSearchQuery(input: AssistantRequest): AssistantPostSearchQuery | null {
  if (input.mode !== 'ask' || input.scope.kind === 'post') return null;
  const question = (input.question ?? '').trim();
  const noun = /\b(?:posts?|threads?|discussions?)\b/i.exec(question);
  if (!noun) return null;
  const selection = /^(?:(?:please|can you|could you|would you)\s+)*(?:give|show|find|list|get|search|look|i want|i need)\b/i.exec(question);
  const barePostPhrase = /^(?:all\s+)?(?:posts|threads|discussions)\s+(?:about|on|related to|regarding)\b/i.test(question);
  // Accept a positive post noun phrase, not every sentence containing a
  // selection verb: "show a synopsis of posts" still requires synthesis.
  if (!barePostPhrase) {
    if (!selection || selection[0].length > noun.index) return null;
    const prefixWords = question.slice(selection[0].length, noun.index).trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (prefixWords.some(word => !POST_REQUEST_PREFIX_WORDS.has(word))) return null;
  }
  const terms = termsFor(question).filter(term => !SEARCH_WORDS.has(term)).slice(0, 24);
  if (!terms.length) return null;
  const text = terms.join(' ');
  return { text, terms, stamping: STAMPING.test(question), delay: DELAY.test(question) };
}

function stampingContext(text: string) {
  return STAMPING.test(text) || (/\bpassport\b/i.test(text) && /\b(?:visa|consulate|embassy|ceac)\b/i.test(text));
}

/** Stamping delay is an intersection, not any mention of H-1B or pending. */
export function assistantPostSearchScore(source: AssistantSource, query: AssistantPostSearchQuery): number {
  const own = `${source.title}\n${source.body}`;
  const full = `${own}\n${source.parentContext ?? ''}`;
  if (query.stamping && !stampingContext(full)) return 0;
  if (query.delay && !DELAY.test(own)) return 0;
  const found = new Set(termsFor(full));
  const title = new Set(termsFor(source.title));
  const body = new Set(termsFor(source.body));
  // Specialized topic aliases satisfy their concept, while extra restrictions
  // such as Chennai, H-1B or Schengen still have to occur in the discussion.
  const conceptWords = new Set([
    ...(query.stamping ? ['stamping', 'dropbox', 'drop', 'box', 'visa', 'interview', 'issuance', 'issued', 'appointment', 'administrative', 'processing', '221g', 'consular'] : []),
    ...(query.delay ? ['delay', 'pending', 'wait', 'stuck', 'backlog', 'update', 'response', 'yet', 'received', 'returned', 'issued', 'administrative', 'processing', '221g'] : []),
  ]);
  const required = query.terms.filter(term => !conceptWords.has(term));
  if (required.some(term => !found.has(term))) return 0;
  const lexical = query.terms.reduce((score, term) => score + (body.has(term) ? 4 : 0) + (title.has(term) ? 3 : 0) + (found.has(term) ? 1 : 0), 0);
  return lexical + (query.stamping ? 8 : 0) + (query.delay ? 8 : 0);
}

/** Keep a continuous source passage. No generated or paraphrased evidence. */
function searchExcerpt(source: AssistantSource, query: AssistantPostSearchQuery): string {
  const body = redactAssistantText(source.body).trim();
  if (body.length <= 360) return body;
  const words = new Set(query.terms);
  let start = 0, best = -1;
  for (let offset = 0; offset < body.length; offset += 180) {
    const chunk = body.slice(offset, offset + 360);
    const score = termsFor(chunk).filter(term => words.has(term)).length * 4
      + (query.stamping && stampingContext(chunk) ? 3 : 0) + (query.delay && DELAY.test(chunk) ? 3 : 0);
    if (score > best) { start = offset; best = score; }
  }
  return body.slice(start, start + 360);
}

/** Authorized server sources are the answer to a post lookup; no model needed. */
export function buildAssistantPostSearchResult(input: AssistantRequest, corpus: AssistantCorpus, now = Date.now()): AssistantResult {
  const query = assistantPostSearchQuery(input);
  const ranked = query ? corpus.sources
    .filter(source => POST_ID.test(source.questionId) && ['question', 'reply'].includes(source.kind) && source.body?.trim() && Number.isFinite(Date.parse(source.createdAt)))
    .map(source => ({ source, score: assistantPostSearchScore(source, query) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || (a.source.kind === b.source.kind ? 0 : a.source.kind === 'question' ? -1 : 1)
      || b.source.createdAt.localeCompare(a.source.createdAt) || a.source.id.localeCompare(b.source.id)) : [];
  const unique = new Map<string, AssistantSource>();
  for (const { source } of ranked) if (!unique.has(source.questionId)) unique.set(source.questionId, source);
  const selected = [...unique.values()].slice(0, ASSISTANT_POST_SEARCH_LIMIT);
  const sources = selected.map(source => ({
    ...source, title: redactAssistantText(source.title).slice(0, 240), body: searchExcerpt(source, query!),
    parentContext: undefined, parentUpdatedAt: undefined, url: `/questions/${encodeURIComponent(source.questionId)}`,
  }));
  return {
    kind: 'posts', status: sources.length ? 'answered' : 'insufficient',
    posts: sources.map(source => ({ questionId: source.questionId, sourceId: source.id, title: source.title,
      url: source.url, excerpt: source.body, createdAt: source.createdAt })),
    claims: [], disagreements: [], unanswered: sources.length ? [] : ['No matching posts found. Try a broader topic.'], sources,
    coverage: { sourceCount: sources.length, partial: corpus.partial || unique.size > ASSISTANT_POST_SEARCH_LIMIT },
    generatedAt: new Date(now).toISOString(), cached: false, notice: 'Matching community posts. These are member reports, not verified immigration guidance.',
  };
}

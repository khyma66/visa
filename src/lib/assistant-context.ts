import type { AssistantPostReference, AssistantRequest, AssistantResult, AssistantSource } from './assistant-contract';

// This bounded vocabulary normalizes common location aliases, not legal facts.
// Unlisted place names still remain ordinary required terms in post lookups.
const LOCATIONS = [
  ['hyderabad', 'hyd'], ['chennai', 'madras'], ['mumbai', 'bombay'], ['delhi', 'new delhi'],
  ['kolkata', 'calcutta'], ['bengaluru', 'bangalore'], ['pune'], ['ahmedabad'],
  ['toronto'], ['ottawa'], ['vancouver'], ['montreal'], ['calgary'], ['quebec'],
  ['london'], ['belfast'], ['dublin'], ['paris'], ['berlin'], ['frankfurt'],
  ['dubai'], ['abu dhabi'], ['singapore'], ['hong kong'], ['bangkok'], ['tokyo'],
  ['sydney'], ['melbourne'], ['auckland'], ['mexico city'], ['tijuana'],
  ['dallas'], ['houston'], ['chicago'], ['new york', 'nyc'], ['san francisco'], ['los angeles'],
] as const;
const VISA = /\b(?:h[ -]?1[ -]?b|h[ -]?4|[flbj][ -]?[12]|o[ -]?1|e[ -]?3)\b/gi;
const wordText = (text: string) => ` ${text.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
export function assistantCanonicalText(text: string): string {
  let normalized = text.toLowerCase().normalize('NFKC').replace(VISA, value => value.replace(/[ -]/g, ''));
  for (const [canonical, ...aliases] of LOCATIONS) for (const alias of aliases) {
    normalized = normalized.replace(new RegExp(`\\b${alias}\\b`, 'g'), canonical);
  }
  return normalized;
}
function topicEntities(text: string) {
  const normalized = wordText(assistantCanonicalText(text));
  return {
    locations: LOCATIONS.filter(([name]) => normalized.includes(` ${name} `)).map(([name]) => name),
    visas: [...new Set((text.match(VISA) ?? []).map(value => value.toLowerCase().replace(/[ -]/g, '')))],
  };
}
export type AssistantSearchIntent = {
  task: 'lookup' | 'answer'; text: string; locations: string[]; locationTerms: string[]; visas: string[];
  event: 'stamping' | 'biometrics' | 'passport-delivery' | null;
  order: 'newest' | 'relevance'; softRecent: boolean; experience: boolean; overview: boolean; since?: string; until?: string; unsupportedWindow: boolean;
};
const LOOKUP_NOUN = /\b(?:posts?|threads?|discussions?|experiences?|stor(?:y|ies))\b/i;
const EXPERIENCE_NOUN = /\b(?:experiences?|stor(?:y|ies))\b/i;
function lookupRequest(question: string): boolean {
  const noun = LOOKUP_NOUN.exec(question);
  if (!noun || /\b(?:explain|explanation|answer|summari[sz]e|synopsis|overview|differences?|compare|comparison|advice|eligib\w*|rules?|polic(?:y|ies)|why|how|whether|should|guarantee\w*)\b/i.test(question)) return false;
  // "Give me experiences" asks what members said; "show/find experiences"
  // asks to browse records. Explicit posts/threads/links always stay browseable.
  if (EXPERIENCE_NOUN.test(question) && !/\b(?:posts?|threads?|discussions?|links?|results?)\b/i.test(question)
    && /^(?:(?:please|can you|could you|would you)\s+)*(?:(?:give|get|share|tell)(?:\s+me)?|i want|i need)\b/i.test(question)) return false;
  if (/^(?:all\s+)?(?:posts|threads|discussions|experiences|stories)\s+(?:about|on|related to|regarding|in|at|for)\b/i.test(question)) return true;
  if (/^(?:are there|do you have|any|recent|latest|newest)\b/i.test(question)) return true;
  const selection = /^(?:(?:please|can you|could you|would you)\s+)*(?:give|show|find|list|get|share|search|look|i want|i need)\b/i.exec(question);
  // Topic modifiers can occur before or after the noun ("find Chennai
  // stamping threads"). Analysis/policy wording above still takes generation.
  return !!selection && selection[0].length <= noun.index;
}

/** One deterministic interpretation, shared by all retrieval sources. */
export function assistantSearchIntent(input: AssistantRequest, now = Date.now()): AssistantSearchIntent {
  const current = (input.question ?? '').trim();
  // Conversational requests get a synthesis; explicit browsing stays cheap
  // and non-generative. Both use the same strict topic retrieval below.
  const overview = lookupRequest(current) && /^(?:(?:please|can you|could you|would you)\s+)*(?:give|get|share|tell|recent|latest|newest|i want|i need)\b/i.test(current)
    && !/\b(?:show|find|list|search|look|links?)\b|\ball (?:posts|threads|discussions)\b/i.test(current);
  const previous = assistantRefersToEarlierTurn(current)
    ? assistantBoundedHistory(input.previousQuestions ?? []).filter(value => !assistantStandaloneFollowUp(value) && !assistantMorePosts(value) && assistantPostOrdinal(value) === null).join(' ') : '';
  const question = assistantMorePosts(current) || assistantStandaloneFollowUp(current) ? previous || current : current;
  const own = topicEntities(question), prior = topicEntities(previous);
  const locations = own.locations.length ? own.locations : prior.locations;
  const visas = own.visas.length ? own.visas : prior.visas;
  const combined = question === previous ? question : `${question} ${previous}`.trim();
  const eventOf = (text: string): AssistantSearchIntent['event'] => /\bstamp(?:ing|ed|s)?\b|\bdrop[ -]?box\b|\bvisa interview\b/i.test(text) ? 'stamping'
    : /\bbiometric\w*\b|\bfingerprints?\b/i.test(text) ? 'biometrics'
      : /\bpassport (?:delivery|deliveries|arrival|arriv\w*|return\w*)\b/i.test(text) ? 'passport-delivery' : null;
  const temporal = /\b(?:last|past|previous)\s+(?:(\d{1,4}|one|two|three|four)\s+)?(days?|weeks?|months?|years?)\b/i;
  const explicit = temporal.exec(question);
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };
  const days = explicit ? (explicit[1] === undefined ? 1 : words[explicit[1].toLowerCase()] ?? Number(explicit[1])) * (/week/i.test(explicit[2]) ? 7 : /month/i.test(explicit[2]) ? 30 : /year/i.test(explicit[2]) ? 365 : 1) : null;
  // "Recent" asks for the newest available evidence, not an invented hard
  // window. Only a period supplied by the user may exclude older reports.
  const softRecent = /\brecent(?:ly)?\b/i.test(question) && days === null && !/\b(?:today|yesterday)\b/i.test(question);
  const unsupportedWindow = days !== null && (!Number.isFinite(days) || days < 1 || days > 366);
  let since: string | undefined, until: string | undefined;
  if (days !== null && !unsupportedWindow) { since = new Date(now - days * 86_400_000).toISOString(); until = new Date(now).toISOString(); }
  if (/\b(?:today|yesterday)\b/i.test(question)) {
    const midnight = new Date(now); midnight.setUTCHours(0, 0, 0, 0);
    const yesterday = /\byesterday\b/i.test(question);
    since = new Date(midnight.getTime() - (yesterday ? 86_400_000 : 0)).toISOString();
    until = new Date(yesterday ? midnight.getTime() : now).toISOString();
  }
  return {
    task: assistantMorePosts(current) && previous ? 'lookup' : lookupRequest(current) && !overview ? 'lookup' : 'answer',
    text: combined.replace(new RegExp(temporal.source, 'gi'), ' ').replace(/\b(?:recent(?:ly)?|latest|newest|today|yesterday)\b/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500),
    locations, locationTerms: LOCATIONS.filter(([name]) => locations.includes(name)).flatMap(group => [...group]), visas,
    event: eventOf(question) ?? eventOf(previous), order: days !== null || softRecent || /\b(?:latest|newest|today|yesterday)\b/i.test(question) ? 'newest' : 'relevance', softRecent,
    experience: EXPERIENCE_NOUN.test(question), overview,
    ...(since && until ? { since, until } : {}), unsupportedWindow,
  };
}

/** Eligibility precedes ranking and caps; metadata dates never become event dates. */
export function assistantSourceMatchesIntent(source: AssistantSource, intent: AssistantSearchIntent): boolean {
  if (intent.unsupportedWindow) return false;
  const text = assistantCanonicalText(`${source.title}\n${source.body}\n${source.parentContext ?? ''}`);
  const normalized = wordText(text);
  if (intent.locations.length && !intent.locations.some(value => normalized.includes(` ${value} `))) return false;
  if (intent.visas.length && !intent.visas.some(value => normalized.includes(` ${value} `))) return false;
  if (intent.event === 'stamping' && !/\bstamp(?:ing|ed|s)?\b|\bdrop[ -]?box\b|\b221[ ()-]*g\b|\badministrative processing\b|\bconsular processing\b|\bvisa (?:interview|issuance|issued|appointment)\b|\bpassport\b.{0,60}\b(?:visa|consulate|embassy|ceac)\b/i.test(text)) return false;
  // An expired stamp mentioned in a driving-license or travel question is not
  // a stamping experience. Keep actual interview, issuance and 221(g) reports.
  if (intent.event === 'stamping' && intent.experience
    && !/\bstamp(?:ing|ed)\b|\bdrop[ -]?box\b|\b221[ ()-]*g\b|\badministrative processing\b|\bconsular processing\b|\bvisa (?:interview|issuance|issued|appointment|approved|refused)\b|\bpassport\b.{0,60}\b(?:consulate|embassy|ceac)\b/i.test(text)) return false;
  if (intent.event === 'biometrics' && !/\bbiometric\w*\b|\bfingerprints?\b/i.test(text)) return false;
  if (intent.event === 'passport-delivery' && !/\bpassport\b/i.test(text)) return false;
  const created = Date.parse(source.createdAt);
  return Number.isFinite(created) && (!intent.since || created >= Date.parse(intent.since)) && (!intent.until || created < Date.parse(intent.until));
}

/** Shared, bounded conversation hints. None of these values confer access. */
export function assistantStandaloneFollowUp(question: string): boolean {
  return /^(?:why|how|what happened next|how long|how much)[?!.]*$/i.test(question.trim().replace(/\s+/g, ' '))
    || assistantSummaryFollowUp(question)
    || /^(?:(?:please|can you|could you)\s+)*(?:compare(?:\s+(?:them|these|those|the posts))?|what (?:are|were) the differences)[?!.]*$/i.test(question.trim());
}

/** Transform the last evidence set, not a new search for the word summary. */
export function assistantSummaryFollowUp(question: string): boolean {
  return /^(?:(?:please|can you|could you|would you)\s+)*(?:(?:summari[sz]e|sum up)(?:\s+(?:them|these|those|it|that|the above|all|all of them|these posts|those posts|the posts|the results))?|(?:give(?: me)?\s+)?(?:a\s+)?(?:brief\s+|short\s+)?(?:summary|overview|key takeaways)|tl;?dr|make (?:it|that) (?:shorter|simpler|concise))(?:\s+please)?[?!.]*$/i.test(question.trim());
}

export function assistantPluralReference(question: string): boolean {
  return /\b(?:these|those|all|posts|threads|results|discussions)\b|\b(?:summari[sz]e|compare|sum up) them\b/i.test(question);
}

/** The IDs remain locators only; retrieval rechecks visibility and content. */
export function assistantResultSetFollowUp(input: AssistantRequest): boolean {
  const question = input.question ?? '';
  const current = topicEntities(question), prior = topicEntities(assistantBoundedHistory(input.previousQuestions ?? []).join(' '));
  if (current.locations.length && !current.locations.some(value => prior.locations.includes(value))
    || current.visas.length && !current.visas.some(value => prior.visas.includes(value))) return false;
  return input.mode === 'ask' && input.scope.kind === 'public'
    && assistantRefersToEarlierTurn(question) && !assistantMorePosts(question)
    && assistantPostOrdinal(question) === null && !assistantPreviousPost(input)
    && (!!input.previousPosts?.length || assistantSummaryFollowUp(question));
}

export function assistantMorePosts(question: string): boolean {
  return /^(?:(?:please|can you|could you)\s+)*(?:(?:show|find|list|give|get)\s+(?:me\s+)?)?(?:more|other|additional)\s+(?:posts|threads|discussions|results|experiences|stories)[?!.]*$/i.test(question.trim());
}

function startsNewTopic(question: string): boolean {
  return /^(?:new topic|different topic|switch(?:ing)? (?:topics?|to)|instead[, :]|forget (?:that|the previous))/i.test(question.trim());
}

const explicitDiscussionReference = (text: string) => /\b(?:this|that|same|selected) (?:one|case|post|thread|discussion|appointment)\b/i.test(text);
const personalFollowUp = (text: string) => /^(?:how long|why|when|what happened)\b/i.test(text)
  && /\b(?:it|its|they|their|them)\b/i.test(text);

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
  if (assistantStandaloneFollowUp(text) || assistantMorePosts(text) || assistantPostOrdinal(text) !== null) return true;
  // A complete request naming its own place/category is not a reference just
  // because it contains existential "there" or an incidental pronoun.
  const entities = topicEntities(text);
  if ((entities.locations.length || entities.visas.length) && !explicitDiscussionReference(text)) return personalFollowUp(text);
  return /\b(?:it|its|that|those|them|they|their|these|same)\b|\bthis (?:one|case|post|thread|question|appointment)\b|^(?:and|what about|how about)\b/i.test(text)
    || /\b(?:happened|happen|go|went|take|took|wait|waiting) there\b/i.test(text);
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
  if (ordinal === null) {
    if (assistantPluralReference(question)) return null;
    if (!explicitDiscussionReference(question)) {
      const current = topicEntities(question);
      const prior = topicEntities(assistantBoundedHistory(input.previousQuestions ?? []).join(' '));
      // A personal pronoun can retain focus only when named constraints agree
      // with the preceding topic. Never attach a new city/class to an old post.
      if (current.locations.length && !current.locations.some(value => prior.locations.includes(value))
        || current.visas.length && !current.visas.some(value => prior.visas.includes(value))) return null;
    }
    return input.focusedPost ?? null;
  }
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

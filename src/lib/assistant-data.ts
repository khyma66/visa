// Server retrieval only. Every database read uses the caller's JWT client;
// never import the browser client or construct a service-role client here.
import type { SupabaseClient } from '@supabase/supabase-js';
import archive from '@visa/archive';
import type { AssistantCorpus, AssistantCoverageReason, AssistantRequest, AssistantSource } from './assistant-contract';
import type { Answer, CommunityFeed, Question } from './types';
import { detectTopics } from './tagging';
import { AssistantError, assistantPreviousQuestions, assistantRetrievalQuestion, assistantSearchTerms } from './assistant-core';
import { assistantPostSearchQuery, assistantPostSearchScore } from './assistant-search';
import { assistantCanonicalText, assistantMorePosts, assistantPostOrdinal, assistantPreviousPost, assistantRefersToEarlierTurn, assistantSearchIntent, assistantSeenPostIds, assistantSourceMatchesIntent } from './assistant-context';

export const ASSISTANT_SOURCE_LIMIT = 48;
const ASSISTANT_CONTEXT_THREAD_LIMIT = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARCHIVE_ID = /^apify-[a-zA-Z0-9_-]{1,160}$/;
const QUESTION_FIELDS = 'id,author_id,community_id,title,body,status,created_at,updated_at';
const ANSWER_FIELDS = 'id,author_id,question_id,body,status,is_accepted,vote_score,created_at,updated_at';
type SourceQuestion = Pick<Question, 'id' | 'community_id' | 'title' | 'body' | 'status' | 'created_at' | 'updated_at'> & Partial<Pick<Question, 'author_id'>>;
type SourceAnswer = Pick<Answer, 'id' | 'question_id' | 'body' | 'status' | 'is_accepted' | 'vote_score' | 'created_at' | 'updated_at'> & Partial<Pick<Answer, 'author_id'>>;
type SourceRow = {
  source_id: string; source_kind: 'question' | 'reply'; question_id: string; community_id: string | null;
  title: string; body: string; created_at: string; updated_at: string;
  parent_context: string | null; parent_updated_at: string | null;
};

function questionSource(question: SourceQuestion, provenance: AssistantSource['provenance']): AssistantSource {
  return {
    id: `q:${question.id}`, kind: 'question', questionId: question.id, communityId: question.community_id ?? null,
    title: question.title, body: question.body, createdAt: question.created_at, updatedAt: question.updated_at,
    url: `/questions/${encodeURIComponent(question.id)}`, provenance, speakerRole: 'original-poster',
  };
}
function replySource(answer: SourceAnswer, question: SourceQuestion, provenance: AssistantSource['provenance']): AssistantSource {
  return {
    id: `a:${answer.id}`, kind: 'reply', questionId: question.id, communityId: question.community_id ?? null,
    title: question.title, body: answer.body, createdAt: answer.created_at, updatedAt: answer.updated_at,
    parentContext: question.body.slice(0, 1000), parentUpdatedAt: question.updated_at,
    ...(answer.author_id?.trim() && question.author_id?.trim() ? { speakerRole: answer.author_id === question.author_id ? 'original-poster' as const : 'member' as const } : {}),
    url: `/questions/${encodeURIComponent(question.id)}#answer-${encodeURIComponent(answer.id)}`, provenance,
  };
}
function rowSource(row: SourceRow): AssistantSource {
  return {
    id: row.source_id, kind: row.source_kind, questionId: row.question_id, communityId: row.community_id,
    title: row.title, body: row.body, createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.parent_context ? { parentContext: row.parent_context, parentUpdatedAt: row.parent_updated_at ?? undefined } : {}),
    url: `/questions/${encodeURIComponent(row.question_id)}${row.source_kind === 'reply' ? `#answer-${encodeURIComponent(row.source_id.slice(2))}` : ''}`,
    provenance: 'member',
  };
}

function archiveEnabled(): boolean {
  return process.env.COMMUNITY_SOURCE_MODE === 'snapshot'
    && (process.env.APP_ENV !== 'production' || process.env.IMPORTED_CONTENT_APPROVED === 'true');
}
function sourceScorer(input: AssistantRequest, now = Date.now()): (source: AssistantSource) => number {
  const intent = assistantSearchIntent(input, now);
  const postSearch = assistantPostSearchQuery(input, now);
  if (postSearch) return source => assistantPostSearchScore(source, postSearch);
  const words = assistantSearchTerms(assistantCanonicalText(assistantSearchIntent({ ...input, previousQuestions: [] }, now).text)).slice(0, 24);
  const previous = assistantPreviousQuestions(input).join(' ');
  const historyWords = assistantSearchTerms(previous).filter(word => !words.includes(word)).slice(0, 24);
  const topics = detectTopics(input.question ?? ''), historyTopics = detectTopics(previous);
  return (source) => {
    if (!assistantSourceMatchesIntent(source, intent)) return 0;
    const title = new Set(assistantSearchTerms(assistantCanonicalText(source.title))), body = new Set(assistantSearchTerms(assistantCanonicalText(source.body)));
    const parent = new Set(assistantSearchTerms(assistantCanonicalText(source.parentContext ?? '')));
    const lexical = (terms: string[]) => terms.reduce((sum, word) => sum + (body.has(word) ? 4 : 0) + (title.has(word) ? 1 : 0) + (parent.has(word) ? 2 : 0), 0);
    const foundTopics = detectTopics(`${source.title} ${source.body} ${source.parentContext ?? ''}`);
    const current = lexical(words) + topics.filter(topic => foundTopics.includes(topic)).length * 2;
    const history = lexical(historyWords) + historyTopics.filter(topic => foundTopics.includes(topic)).length;
    // A new question dominates history; exact tokens prevent OPT/options and
    // H1B/H1B-like substring matches from filling the bounded evidence budget.
    return current * 8 + Math.min(history, 6);
  };
}

function publicArchiveMatches(input: AssistantRequest, now = Date.now()): AssistantCorpus {
  if (!archiveEnabled()) return { sources: [], partial: false };
  const snapshot = archive as unknown as CommunityFeed;
  const intent = assistantSearchIntent(input, now);
  const score = sourceScorer(input, now);
  const postSearch = assistantPostSearchQuery(input, now);
  const matches: Array<{ source: AssistantSource; score: number }> = [];
  const matchedQuestions = new Set<string>();
  const excluded = new Set(assistantSeenPostIds(input));
  let scanned = 0, partial = false;
  const consider = (source: AssistantSource) => {
    if (excluded.has(source.questionId)) return;
    if (!Number.isFinite(Date.parse(source.createdAt))) return;
    const rank = input.mode === 'ask' ? score(source) : 1;
    if (!rank) return;
    matchedQuestions.add(source.questionId);
    // Search candidates represent discussions, not a popularity contest among
    // replies. Expand their full context after ranking so one busy thread does
    // not consume every candidate slot before other discussions are considered.
    if (postSearch || input.mode === 'ask') {
      const existing = matches.findIndex(row => row.source.questionId === source.questionId);
      if (existing >= 0) {
        if (intent.order === 'newest' ? matches[existing].source.createdAt >= source.createdAt : matches[existing].score >= rank) return;
        matches.splice(existing, 1);
      }
    }
    matches.push({ source, score: rank });
    matches.sort((a, b) => (intent.order === 'newest' ? b.source.createdAt.localeCompare(a.source.createdAt) : 0) || b.score - a.score || b.source.createdAt.localeCompare(a.source.createdAt) || a.source.id.localeCompare(b.source.id));
    if (matches.length > ASSISTANT_SOURCE_LIMIT) matches.pop();
  };
  // The reviewed static snapshot is a bounded transitional retrieval source.
  // It is never assigned to a native community by guessing its source group.
  // A proper incremental search index replaces this scan as the corpus grows.
  outer: for (const question of snapshot.questions) {
    if (scanned++ >= 5000) { partial = true; break; }
    if (question.status === 'archived') continue;
    consider(questionSource(question, 'archive'));
    for (const reply of snapshot.answersByQuestionId[question.id] ?? []) {
      if (scanned++ >= 5000) { partial = true; break outer; }
      if (reply.status === 'active') consider(replySource(reply, question, 'archive'));
    }
  }
  const limited = partial || matchedQuestions.size > ASSISTANT_SOURCE_LIMIT;
  return { sources: matches.map(({ source }) => source), partial: limited,
    ...(limited ? { coverageReasons: ['retrieval-limit'] as AssistantCoverageReason[] } : {}) };
}

function searchText(input: AssistantRequest, now = Date.now()): string {
  const postSearch = assistantPostSearchQuery(input, now);
  return postSearch ? [postSearch.text,
    ...(postSearch.stamping ? ['stamping dropbox passport consulate administrative processing 221g'] : []),
    ...(postSearch.delay ? ['delay pending waiting stuck'] : []),
  ].join(' ') : input.mode === 'ask' ? assistantSearchIntent(input, now).text || assistantRetrievalQuestion(input) : '';
}

async function searchSources(client: SupabaseClient, input: AssistantRequest, now = Date.now()): Promise<AssistantCorpus> {
  const intent = assistantSearchIntent(input, now);
  const postSearch = assistantPostSearchQuery(input, now);
  const question = searchText(input, now);
  const constrained = input.mode === 'ask' && (intent.locations.length || intent.visas.length || intent.event || intent.order === 'newest');
  const { data, error } = await client.rpc(constrained ? 'assistant_sources_v2' : 'assistant_sources', {
    target_community_id: input.scope.kind === 'community' ? input.scope.id : null,
    target_question_id: input.scope.kind === 'post' ? input.scope.id : null,
    query_text: question,
    query_tags: detectTopics(question).slice(0, 16),
    since_time: input.mode === 'catchup' ? input.since : intent.since ?? null,
    until_time: input.mode === 'catchup' ? input.until : intent.until ?? null,
    result_limit: ASSISTANT_SOURCE_LIMIT,
    ...(constrained ? { required_locations: intent.locationTerms, required_visas: intent.visas, required_event: intent.event, sort_newest: intent.order === 'newest' } : {}),
  });
  if (error?.code === 'PT429') throw new AssistantError(429, 'Too many assistant requests. Please wait a minute.', 60);
  if (error?.code === '42501') throw new AssistantError(403, 'This account cannot use the assistant.');
  if (error || !Array.isArray(data)) throw new Error('Assistant sources are temporarily unavailable.');
  const rows = data as SourceRow[];
  const excluded = new Set(input.scope.kind === 'public' ? assistantSeenPostIds(input) : []);
  const sources = rows.map(rowSource).filter(source => !excluded.has(source.questionId) && (input.mode !== 'ask' || assistantSourceMatchesIntent(source, intent))).slice(0, ASSISTANT_SOURCE_LIMIT);
  return {
    sources: postSearch ? sources.filter(source => assistantPostSearchScore(source, postSearch) > 0) : sources,
    partial: rows.length > ASSISTANT_SOURCE_LIMIT,
    ...(rows.length > ASSISTANT_SOURCE_LIMIT ? { coverageReasons: ['retrieval-limit'] as AssistantCoverageReason[] } : {}),
    ...(input.mode === 'catchup' ? { since: input.since, until: input.until } : intent.since ? { since: intent.since, until: intent.until } : {}),
  };
}

/** Transitional indexed-RPC gap: query the existing caller-visible reply view. */
async function importedReplyMatches(client: SupabaseClient, input: AssistantRequest, now = Date.now()): Promise<AssistantCorpus> {
  if (!archiveEnabled()) return { sources: [], partial: false };
  const intent = assistantSearchIntent(input, now);
  const terms = [...new Set(assistantSearchTerms(searchText(input, now)).flatMap(term => {
    const visa = /^(h|f|l|b)-?([124])-?(b?)$/.exec(term);
    return visa ? [term, `${visa[1]}${visa[2]}${visa[3]}`, `${visa[1]}-${visa[2]}${visa[3]}`] : [term];
  }))].filter(term => /^[\p{L}\p{N}][\p{L}\p{M}\p{N}-]*$/u.test(term)).slice(0, 24);
  if (!terms.length) return { sources: [], partial: false };
  const incomplete = (): AssistantCorpus => ({ sources: [], partial: true, coverageReasons: ['unindexed-replies'] });
  try {
    const snapshot = archive as unknown as CommunityFeed;
    const parents = new Map(snapshot.questions.filter(question => question.status !== 'archived').map(question => [question.id, question]));
    let parentFilterLimited = false;
    const conditions = [`or(${terms.map(term => `body.ilike.%${term}%`).join(',')})`];
    const parentOrBody = (bodyTerms: string[], constraint: Partial<typeof intent>) => {
      let bytes = 0;
      const ids = [...parents.values()].filter(parent => ARCHIVE_ID.test(parent.id) && assistantSourceMatchesIntent(questionSource(parent, 'archive'), {
        ...intent, locations: [], locationTerms: [], visas: [], event: null, since: undefined, until: undefined, ...constraint,
      })).sort((a, b) => b.created_at.localeCompare(a.created_at)).flatMap(parent => {
        if ((bytes += parent.id.length + 1) > 3000) { parentFilterLimited = true; return []; }
        return [parent.id];
      });
      return `or(${[...bodyTerms.map(term => `body.ilike.%${term}%`), ...(ids.length ? [`question_id.in.(${ids.join(',')})`] : [])].join(',')})`;
    };
    if (intent.locations.length) conditions.push(parentOrBody(intent.locationTerms, { locations: intent.locations }));
    if (intent.visas.length) conditions.push(parentOrBody(intent.visas.flatMap(visa => [visa, visa.replace(/^(\w)(\d)/, '$1-$2'), visa.replace(/^(\w)(\d)/, '$1 $2')]), { visas: intent.visas }));
    if (intent.event) conditions.push(parentOrBody(intent.event === 'stamping' ? ['stamp', 'dropbox', 'drop box', 'visa interview', 'visa appointment', 'administrative processing', '221', 'passport']
      : intent.event === 'biometrics' ? ['biometric', 'fingerprint'] : ['passport'], { event: intent.event }));
    // Only generated lexical tokens enter PostgREST syntax. Punctuation,
    // wildcards, parentheses and arbitrary client filter strings cannot pass.
    let query = client.from('imported_answer_feed').select(ANSWER_FIELDS)
      .or(conditions.length === 1 ? terms.map(term => `body.ilike.%${term}%`).join(',') : `and(${conditions.join(',')})`);
    if (intent.since && intent.until) query = query.gte('created_at', intent.since).lt('created_at', intent.until);
    const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(ASSISTANT_SOURCE_LIMIT + 1);
    if (error?.code === '42501') throw new AssistantError(403, 'This account cannot use the assistant.');
    if (error?.code === 'PT429') throw new AssistantError(429, 'Too many assistant requests. Please wait a minute.', 60);
    if (error || !Array.isArray(data)) return incomplete();
    const excluded = new Set(assistantSeenPostIds(input));
    const score = sourceScorer(input, now);
    const sources = (data as SourceAnswer[]).flatMap(reply => {
      const parent = parents.get(reply.question_id);
      if (!parent || excluded.has(parent.id) || reply.status !== 'active') return [];
      const source = replySource(reply, parent, 'member');
      return Number.isFinite(Date.parse(source.createdAt)) && score(source) > 0 ? [source] : [];
    }).slice(0, ASSISTANT_SOURCE_LIMIT);
    const partial = parentFilterLimited || data.length > ASSISTANT_SOURCE_LIMIT;
    return { sources, partial, ...(partial ? { coverageReasons: ['retrieval-limit'] as AssistantCoverageReason[] } : {}) };
  } catch (error) {
    if (error instanceof AssistantError) throw error;
    return incomplete();
  }
}

async function postCorpus(client: SupabaseClient, input: AssistantRequest & { scope: { kind: 'post'; id: string } }, options: {
  allowUnavailableImportedReplies?: boolean;
  reuseRankedMatches?: boolean;
  now?: number;
} = {}): Promise<AssistantCorpus> {
  const id = input.scope.id;
  const imported = ARCHIVE_ID.test(id);
  let question: SourceQuestion | null;
  let archivedReplies: SourceAnswer[] = [];
  let archiveIncomplete = false;
  if (imported) {
    // Identical approval/mode boundary to /api/community; never fetch arbitrary
    // source URLs, trust browser-provided text, or initiate paid Apify reads.
    if (!archiveEnabled()) {
      throw new Error('This discussion is not available to the assistant.');
    }
    const snapshot = archive as unknown as CommunityFeed;
    const importedQuestion = snapshot.questions.find((row) => row.id === id && row.status !== 'archived') ?? null;
    question = importedQuestion;
    if (question) {
      archivedReplies = (snapshot.answersByQuestionId[id] ?? []).filter((row) => row.status === 'active');
      // Some upstream exports include only top comments. A low source count
      // must never be presented as a complete summary of the original thread.
      archiveIncomplete = (importedQuestion?.answer_count ?? 0) > archivedReplies.length;
    }
  } else {
    if (!UUID.test(id)) return { sources: [], partial: false };
    const { data, error } = await client.from('question_feed').select(QUESTION_FIELDS).eq('id', id).maybeSingle();
    if (error) throw new Error('Assistant sources are temporarily unavailable.');
    question = data as SourceQuestion | null;
  }
  if (!question) return { sources: [], partial: false };
  const { data, error } = await client.from(imported ? 'imported_answer_feed' : 'answer_feed')
    .select(ANSWER_FIELDS).eq('question_id', id)
    .order('is_accepted', { ascending: false }).order('vote_score', { ascending: false })
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .limit(ASSISTANT_SOURCE_LIMIT);
  if (error?.code === '42501') throw new AssistantError(403, 'This account cannot use the assistant.');
  if (error?.code === 'PT429') throw new AssistantError(429, 'Too many assistant requests. Please wait a minute.', 60);
  const unavailableImportedReplies = imported && options.allowUnavailableImportedReplies && (error || !Array.isArray(data));
  if ((error || !Array.isArray(data)) && !unavailableImportedReplies) throw new Error('Assistant sources are temporarily unavailable.');
  const replies = unavailableImportedReplies ? [] : data as SourceAnswer[];
  const sourceQuestion = questionSource(question, imported ? 'archive' : 'member');
  const replySources = [
    ...replies.map((reply) => replySource(reply, question, 'member')),
    ...archivedReplies.map((reply) => replySource(reply, question, 'archive')),
  ];
  const coverageReasons = new Set<AssistantCoverageReason>();
  if (unavailableImportedReplies) coverageReasons.add('unindexed-replies');
  if (archiveIncomplete) coverageReasons.add('missing-replies');
  if (replySources.length >= ASSISTANT_SOURCE_LIMIT) coverageReasons.add('retrieval-limit');
  let partial = coverageReasons.size > 0;
  let selected = replySources;
  // Small threads retain every visible reply. For long native threads, lexical
  // and tag relevance comes first, followed by accepted/popular context. Always
  // disclose the cap; never pretend the whole discussion was read.
  // Public expansion already has fresh global matches to merge below. Avoid
  // charging the database search-rate gate again for every expanded thread.
  if (partial && input.mode === 'ask' && !imported && !options.reuseRankedMatches) {
    const relevant = await searchSources(client, input, options.now);
    selected = [...relevant.sources.filter((source) => source.kind === 'reply'), ...replySources];
    partial ||= relevant.partial;
    relevant.coverageReasons?.forEach(reason => coverageReasons.add(reason));
  } else if (partial && input.mode === 'ask') {
    const score = sourceScorer(input, options.now);
    selected = [...replySources].sort((a, b) => score(b) - score(a) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }
  const deduplicated = [...new Map(selected.map((source) => [source.id, source])).values()];
  return { sources: [sourceQuestion, ...deduplicated.slice(0, ASSISTANT_SOURCE_LIMIT - 1)], partial,
    ...(coverageReasons.size ? { coverageReasons: [...coverageReasons] } : {}) };
}

/** Read bounded, current thread context under the same caller permissions. */
async function publicThreadContext(client: SupabaseClient, input: AssistantRequest, ranked: AssistantSource[], now = Date.now()): Promise<AssistantCorpus> {
  const ids = [...new Set(ranked.map(source => source.questionId))];
  const chosen = ids.slice(0, ASSISTANT_CONTEXT_THREAD_LIMIT);
  const threads = await Promise.all(chosen.map(id => postCorpus(client, { ...input, scope: { kind: 'post', id } }, {
    allowUnavailableImportedReplies: true, reuseRankedMatches: true, now,
  })));
  const coverageReasons = new Set<AssistantCoverageReason>(threads.flatMap(thread => thread.coverageReasons ?? []));
  if (ids.length > chosen.length) coverageReasons.add('retrieval-limit');
  const score = sourceScorer(input, now);
  const groups = threads.map(thread => {
    const parent = thread.sources.find(source => source.kind === 'question');
    if (!parent) return [];
    // A keyword hit can be older or less popular than the thread's bounded
    // context window. It was just read under caller permissions: retain it
    // after confirming its parent is still visible. Prefer the later context
    // read for duplicate IDs so an edit is not replaced with an older body.
    const matches = ranked.filter(source => source.kind === 'reply' && source.questionId === parent.questionId);
    const matchedIds = new Set(matches.map(source => source.id));
    const replies = [...new Map([...matches, ...thread.sources.filter(source => source.kind === 'reply')]
      .map(source => [source.id, source])).values()]
      .map(source => ({ ...source, title: parent.title, communityId: parent.communityId,
        parentContext: parent.body.slice(0, 1000), parentUpdatedAt: parent.updatedAt }))
      .sort((a, b) => Number(matchedIds.has(b.id)) - Number(matchedIds.has(a.id)) || score(b) - score(a)
        || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    return [parent, ...replies];
  });
  // The first 24 records include the parent and up to two replies per selected
  // discussion. Remaining slots are shared round-robin. Keep non-keyword
  // clarification/correction replies: they can change an apparent answer.
  const sources = groups.flatMap(group => group.slice(0, 3));
  for (let offset = 3; sources.length < ASSISTANT_SOURCE_LIMIT && groups.some(group => group.length > offset); offset++) {
    for (const group of groups) if (group[offset] && sources.length < ASSISTANT_SOURCE_LIMIT) sources.push(group[offset]);
  }
  if (groups.reduce((total, group) => total + group.length, 0) > sources.length) coverageReasons.add('retrieval-limit');
  return { sources, partial: coverageReasons.size > 0 || threads.some(thread => thread.partial),
    ...(coverageReasons.size ? { coverageReasons: [...coverageReasons] } : {}) };
}

/** All content is freshly read under current permissions on every invocation. */
export async function retrieveAssistantCorpus(client: SupabaseClient, input: AssistantRequest, now = Date.now()): Promise<AssistantCorpus> {
  if (input.mode === 'catchup' && input.scope.kind !== 'community') throw new AssistantError(400, 'Choose a community for catch-up.');
  if (input.scope.kind === 'post') {
    return postCorpus(client, { ...input, scope: input.scope }, { now });
  }
  if (input.mode === 'ask' && assistantSearchIntent(input, now).unsupportedWindow) return { sources: [], partial: false };
  if (input.mode === 'ask' && input.scope.kind === 'public' && assistantMorePosts(input.question ?? '')) {
    if (!assistantPreviousQuestions(input).length) return { sources: [], partial: false };
    if (assistantSeenPostIds(input).length >= ASSISTANT_SOURCE_LIMIT) return { sources: [], partial: true };
  }
  if (input.mode === 'ask' && input.scope.kind === 'public' && assistantRefersToEarlierTurn(input.question ?? '')
    && !assistantMorePosts(input.question ?? '') && (assistantPostOrdinal(input.question ?? '') !== null || assistantPreviousPost(input))) {
    const reference = assistantPreviousPost(input);
    if (!reference) return { sources: [], partial: false };
    // A browser-provided ID is only a locator. Fetch current parent and replies
    // through the caller's invoker views (or approved archive); no old text is
    // accepted, and a removed/hidden source cannot be resurrected by history.
    const corpus = await postCorpus(client, { ...input, scope: { kind: 'post', id: reference.questionId } }, { now });
    if (!corpus.sources.some(source => source.id === reference.sourceId && source.questionId === reference.questionId)) return { sources: [], partial: false };
    return corpus;
  }
  if (input.scope.kind === 'community') {
    if (!UUID.test(input.scope.id)) return { sources: [], partial: false };
    const { data, error } = await client.from('community_directory').select('id').eq('id', input.scope.id).maybeSingle();
    if (error) throw new Error('Assistant sources are temporarily unavailable.');
    if (!data) return { sources: [], partial: false, since: input.since, until: input.until };
  }
  const corpus = await searchSources(client, input, now);
  if (input.scope.kind === 'public') {
    const historical = publicArchiveMatches(input, now);
    const importedReplies = await importedReplyMatches(client, input, now);
    const score = sourceScorer(input, now);
    const intent = assistantSearchIntent(input, now);
    const combined = [...corpus.sources, ...historical.sources, ...importedReplies.sources]
      .filter(source => input.mode !== 'ask' || assistantSourceMatchesIntent(source, intent))
      .sort((a, b) => (intent.order === 'newest' ? b.createdAt.localeCompare(a.createdAt) : 0) || (input.mode === 'ask' ? score(b) - score(a) : 0) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    const seenQuestions = new Set<string>();
    const selected = assistantPostSearchQuery(input, now) ? combined.filter(source => {
      if (seenQuestions.has(source.questionId)) return false;
      seenQuestions.add(source.questionId); return true;
    }) : combined;
    const context = assistantPostSearchQuery(input, now) ? null : await publicThreadContext(client, input, selected, now);
    const coverageReasons = new Set<AssistantCoverageReason>([...corpus.coverageReasons ?? [], ...historical.coverageReasons ?? [], ...importedReplies.coverageReasons ?? [], ...context?.coverageReasons ?? []]);
    if (selected.length > ASSISTANT_SOURCE_LIMIT - assistantSeenPostIds(input).length) coverageReasons.add('retrieval-limit');
    return {
      ...corpus,
      sources: context?.sources ?? selected.slice(0, ASSISTANT_SOURCE_LIMIT - assistantSeenPostIds(input).length),
      // Keep actual scan, retrieval and imported-export gaps distinct from
      // routine evidence selection; never imply that a failed search was full.
      partial: corpus.partial || historical.partial || importedReplies.partial || !!context?.partial || coverageReasons.size > 0,
      ...(coverageReasons.size ? { coverageReasons: [...coverageReasons] } : {}),
    };
  }
  return corpus;
}

// Server retrieval only. Every database read uses the caller's JWT client;
// never import the browser client or construct a service-role client here.
import type { SupabaseClient } from '@supabase/supabase-js';
import archive from '@visa/archive';
import type { AssistantCorpus, AssistantRequest, AssistantSource } from './assistant-contract';
import type { Answer, CommunityFeed, Question } from './types';
import { detectTopics } from './tagging';
import { AssistantError } from './assistant-core';

export const ASSISTANT_SOURCE_LIMIT = 48;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARCHIVE_ID = /^apify-[a-zA-Z0-9_-]{1,160}$/;
const QUESTION_FIELDS = 'id,community_id,title,body,status,created_at,updated_at';
const ANSWER_FIELDS = 'id,question_id,body,status,is_accepted,vote_score,created_at,updated_at';
type SourceQuestion = Pick<Question, 'id' | 'community_id' | 'title' | 'body' | 'status' | 'created_at' | 'updated_at'>;
type SourceAnswer = Pick<Answer, 'id' | 'question_id' | 'body' | 'status' | 'is_accepted' | 'vote_score' | 'created_at' | 'updated_at'>;
type SourceRow = {
  source_id: string; source_kind: 'question' | 'reply'; question_id: string; community_id: string | null;
  title: string; body: string; created_at: string; updated_at: string;
  parent_context: string | null; parent_updated_at: string | null;
};

function questionSource(question: SourceQuestion, provenance: AssistantSource['provenance']): AssistantSource {
  return {
    id: `q:${question.id}`, kind: 'question', questionId: question.id, communityId: question.community_id ?? null,
    title: question.title, body: question.body, createdAt: question.created_at, updatedAt: question.updated_at,
    url: `/questions/${encodeURIComponent(question.id)}`, provenance,
  };
}
function replySource(answer: SourceAnswer, question: SourceQuestion, provenance: AssistantSource['provenance']): AssistantSource {
  return {
    id: `a:${answer.id}`, kind: 'reply', questionId: question.id, communityId: question.community_id ?? null,
    title: question.title, body: answer.body, createdAt: answer.created_at, updatedAt: answer.updated_at,
    parentContext: question.body.slice(0, 1000), parentUpdatedAt: question.updated_at,
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

function retrievalQuestion(input: AssistantRequest): string {
  // Include a small amount of user-authored history for follow-up references.
  // Generated assistant answers are never used as retrieval evidence.
  return [input.question ?? '', ...(input.previousQuestions ?? []).slice(-2).map((question) => question.slice(0, 300))]
    .join(' ').slice(0, 1500);
}
function archiveEnabled(): boolean {
  return process.env.COMMUNITY_SOURCE_MODE === 'snapshot'
    && (process.env.APP_ENV !== 'production' || process.env.IMPORTED_CONTENT_APPROVED === 'true');
}
const SEARCH_STOPWORDS = new Set('what which when where why how did does do can could should would will is are was were a an the and or of to in for with on about this that these those it they you me my we our us please tell explain summarize members people'.split(' '));
function sourceScorer(question: string): (source: AssistantSource) => number {
  const words = [...new Set((question.toLowerCase().match(/[\p{L}\p{N}-]{3,}/gu) ?? [])
    .filter((word) => !SEARCH_STOPWORDS.has(word)))].slice(0, 24);
  const topics = detectTopics(question);
  return (source) => {
    const title = source.title.toLowerCase(), body = source.body.toLowerCase();
    const lexical = words.reduce((sum, word) => sum + (body.includes(word) ? 3 : 0) + (title.includes(word) ? 1 : 0), 0);
    const foundTopics = detectTopics(`${source.title} ${source.body}`);
    return lexical + topics.filter((topic) => foundTopics.includes(topic)).length * 2;
  };
}

function publicArchiveMatches(input: AssistantRequest): AssistantCorpus {
  if (!archiveEnabled()) return { sources: [], partial: false };
  const snapshot = archive as unknown as CommunityFeed;
  const score = sourceScorer(retrievalQuestion(input));
  const matches: Array<{ source: AssistantSource; score: number }> = [];
  let scanned = 0, matched = 0, partial = false;
  const consider = (source: AssistantSource) => {
    if (!Number.isFinite(Date.parse(source.createdAt))) return;
    if (input.mode === 'catchup' && (!input.since || !input.until
      || Date.parse(source.createdAt) < Date.parse(input.since) || Date.parse(source.createdAt) >= Date.parse(input.until))) return;
    const rank = input.mode === 'ask' ? score(source) : 1;
    if (!rank) return;
    matched++;
    matches.push({ source, score: rank });
    matches.sort((a, b) => b.score - a.score || b.source.createdAt.localeCompare(a.source.createdAt) || a.source.id.localeCompare(b.source.id));
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
  return { sources: matches.map(({ source }) => source), partial: partial || matched > ASSISTANT_SOURCE_LIMIT };
}

async function publicImportedCatchup(client: SupabaseClient, input: AssistantRequest): Promise<AssistantCorpus> {
  if (!archiveEnabled()) return { sources: [], partial: false };
  const snapshot = archive as unknown as CommunityFeed;
  const { data, error } = await client.from('imported_answer_feed').select(ANSWER_FIELDS)
    .gte('created_at', input.since!).lt('created_at', input.until!)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(ASSISTANT_SOURCE_LIMIT + 1);
  if (error || !Array.isArray(data)) throw new Error('Assistant sources are temporarily unavailable.');
  const visibleParents = new Map(snapshot.questions.slice(0, 5000).filter((question) => question.status !== 'archived').map((question) => [question.id, question]));
  // A database imported_answer has no FK to the compiled snapshot. Prove that
  // its parent is still publicly distributed before disclosing its text.
  const sources = (data as SourceAnswer[]).slice(0, ASSISTANT_SOURCE_LIMIT).flatMap((reply) => {
    const question = visibleParents.get(reply.question_id);
    return question ? [replySource(reply, question, 'member')] : [];
  });
  return { sources, partial: data.length > ASSISTANT_SOURCE_LIMIT || snapshot.questions.length > 5000 };
}

async function searchSources(client: SupabaseClient, input: AssistantRequest): Promise<AssistantCorpus> {
  const question = input.mode === 'ask' ? retrievalQuestion(input) : '';
  const { data, error } = await client.rpc('assistant_sources', {
    target_community_id: input.scope.kind === 'community' ? input.scope.id : null,
    target_question_id: input.scope.kind === 'post' ? input.scope.id : null,
    query_text: question,
    query_tags: detectTopics(question).slice(0, 16),
    since_time: input.mode === 'catchup' ? input.since : null,
    until_time: input.mode === 'catchup' ? input.until : null,
    result_limit: ASSISTANT_SOURCE_LIMIT,
  });
  if (error?.code === 'PT429') throw new AssistantError(429, 'Too many assistant requests. Please wait a minute.', 60);
  if (error?.code === '42501') throw new AssistantError(403, 'This account cannot use the assistant.');
  if (error || !Array.isArray(data)) throw new Error('Assistant sources are temporarily unavailable.');
  const rows = data as SourceRow[];
  return {
    sources: rows.slice(0, ASSISTANT_SOURCE_LIMIT).map(rowSource),
    partial: rows.length > ASSISTANT_SOURCE_LIMIT,
    ...(input.mode === 'catchup' ? { since: input.since, until: input.until } : {}),
  };
}

async function postCorpus(client: SupabaseClient, input: AssistantRequest & { scope: { kind: 'post'; id: string } }): Promise<AssistantCorpus> {
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
  if (error || !Array.isArray(data)) throw new Error('Assistant sources are temporarily unavailable.');
  const replies = data as SourceAnswer[];
  const sourceQuestion = questionSource(question, imported ? 'archive' : 'member');
  const replySources = [
    ...replies.map((reply) => replySource(reply, question, 'member')),
    ...archivedReplies.map((reply) => replySource(reply, question, 'archive')),
  ];
  let partial = archiveIncomplete || replySources.length >= ASSISTANT_SOURCE_LIMIT;
  let selected = replySources;
  // Small threads retain every visible reply. For long native threads, lexical
  // and tag relevance comes first, followed by accepted/popular context. Always
  // disclose the cap; never pretend the whole discussion was read.
  if (partial && input.mode === 'ask' && !imported) {
    const relevant = await searchSources(client, input);
    selected = [...relevant.sources.filter((source) => source.kind === 'reply'), ...replySources];
    partial ||= relevant.partial;
  } else if (partial && input.mode === 'ask') {
    const score = sourceScorer(retrievalQuestion(input));
    selected = [...replySources].sort((a, b) => score(b) - score(a) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }
  const deduplicated = [...new Map(selected.map((source) => [source.id, source])).values()];
  return { sources: [sourceQuestion, ...deduplicated.slice(0, ASSISTANT_SOURCE_LIMIT - 1)], partial };
}

/** All content is freshly read under current permissions on every invocation. */
export async function retrieveAssistantCorpus(client: SupabaseClient, input: AssistantRequest): Promise<AssistantCorpus> {
  if (input.scope.kind === 'post') {
    if (input.mode === 'catchup') throw new Error('Choose a community or public feed for catch-up.');
    return postCorpus(client, { ...input, scope: input.scope });
  }
  if (input.scope.kind === 'community') {
    if (!UUID.test(input.scope.id)) return { sources: [], partial: false };
    const { data, error } = await client.from('community_directory').select('id').eq('id', input.scope.id).maybeSingle();
    if (error) throw new Error('Assistant sources are temporarily unavailable.');
    if (!data) return { sources: [], partial: false, since: input.since, until: input.until };
  }
  const corpus = await searchSources(client, input);
  if (input.scope.kind === 'public') {
    const historical = publicArchiveMatches(input);
    const memberReplies = input.mode === 'catchup' ? await publicImportedCatchup(client, input) : { sources: [], partial: false };
    const score = sourceScorer(retrievalQuestion(input));
    const combined = [...corpus.sources, ...historical.sources, ...memberReplies.sources]
      .sort((a, b) => (input.mode === 'ask' ? score(b) - score(a) : 0) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    return {
      ...corpus,
      sources: combined.slice(0, ASSISTANT_SOURCE_LIMIT),
      // Global keyword search has no indexed path for live imported_answers
      // yet. They are included in specific-post asks and public catch-up; do
      // not claim exhaustive global coverage until that index is deployed.
      partial: corpus.partial || historical.partial || memberReplies.partial || combined.length > ASSISTANT_SOURCE_LIMIT
        || (input.mode === 'ask' && archiveEnabled()),
    };
  }
  return corpus;
}

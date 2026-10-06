'use client';

import { canMessageAuthor } from './post-presentation';
import { DEMO_ANSWERS, DEMO_CONVERSATIONS, DEMO_MESSAGES, DEMO_QUESTIONS, DEMO_USER } from './demo-data';
import { getSupabase, isSupabaseConfigured } from './supabase/client';
import { inferTags, normalizeTags } from './tagging';
import { contextTags, createDiscoveryIndex, searchTerms, type DiscoveryContext } from './discovery';
import type {
  Answer, CommunityFeed, Conversation, DirectMessage, NewQuestion, Question, RelatedQuestion,
} from './types';

type DemoState = {
  questions: Question[];
  answers: Answer[];
  conversations: Conversation[];
  messages: DirectMessage[];
  externalQuestionVotes: Record<string, number>;
  externalAnswerVotes: Record<string, number>;
};

const DEMO_KEY = 'visaflow-demo-v4';
const DEMO_EVENT = 'visaflow-demo-change';
const DEMO_QUESTION_IDS = new Set(DEMO_QUESTIONS.map((question) => question.id));
let importedFeedPromise: Promise<CommunityFeed> | null = null;
let importedFeedExpiresAt = 0;
let discoveryCache: { feed: CommunityFeed | null; local: string; index: ReturnType<typeof createDiscoveryIndex> } | null = null;

function seedDemo(): DemoState {
  const answers = structuredClone(DEMO_ANSWERS);
  const questions = structuredClone(DEMO_QUESTIONS).map((question) => ({
    ...question,
    answer_count: answers.filter((answer) => answer.question_id === question.id && answer.status === 'active').length,
  }));

  return {
    questions,
    answers,
    conversations: structuredClone(DEMO_CONVERSATIONS),
    messages: structuredClone(DEMO_MESSAGES),
    externalQuestionVotes: {},
    externalAnswerVotes: {},
  };
}

function readDemo(): DemoState {
  if (typeof window === 'undefined') return seedDemo();
  const saved = window.localStorage.getItem(DEMO_KEY);
  if (!saved) return seedDemo();
  try {
    return JSON.parse(saved) as DemoState;
  } catch {
    return seedDemo();
  }
}

function writeDemo(state: DemoState) {
  window.localStorage.setItem(DEMO_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(DEMO_EVENT));
}

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

async function loadImportedFeed(): Promise<CommunityFeed> {
  if (Date.now() >= importedFeedExpiresAt) {
    importedFeedPromise = null;
    importedFeedExpiresAt = Date.now() + 300_000;
  }
  importedFeedPromise ??= fetch('/api/community', { headers: { Accept: 'application/json' } })
    .then(async (response) => {
      if (!response.ok) throw new Error('Live community data is unavailable.');
      return response.json() as Promise<CommunityFeed>;
    })
    .catch((error) => {
      importedFeedPromise = null;
      throw error;
    });
  return importedFeedPromise;
}

export async function getCommunitySource(): Promise<CommunityFeed['source'] | null> {
  return (await importedFeedOrNull())?.source ?? null;
}

function applyLocalActivity(feed: CommunityFeed, state: DemoState): CommunityFeed {
  const questions = feed.questions.map((question) => {
    const localAnswerCount = state.answers.filter((answer) => answer.question_id === question.id && answer.source !== 'apify').length;
    return {
      ...question,
      vote_score: question.vote_score + (state.externalQuestionVotes[question.id] ?? 0),
      answer_count: question.answer_count + localAnswerCount,
    };
  });
  const answersByQuestionId = Object.fromEntries(Object.entries(feed.answersByQuestionId).map(([questionId, answers]) => [
    questionId,
    answers.map((answer) => ({
      ...answer,
      vote_score: answer.vote_score + (state.externalAnswerVotes[answer.id] ?? 0),
    })),
  ]));
  return { ...feed, questions, answersByQuestionId };
}

async function importedFeedOrNull(): Promise<CommunityFeed | null> {
  try {
    const feed = await loadImportedFeed();
    return isSupabaseConfigured ? feed : applyLocalActivity(feed, readDemo());
  } catch {
    return null;
  }
}

function matchesQuestion(question: Question, search: string, visaType: string): boolean {
  const query = search.trim().toLowerCase();
  return (!visaType || question.visa_type === visaType)
    && (!query || [question.title, question.body, question.visa_type, question.destination_country, ...question.tags]
      .some((value) => value.toLowerCase().includes(query)));
}

export async function listQuestions(search = '', visaType = ''): Promise<Question[]> {
  if (!isSupabaseConfigured) {
    const state = readDemo();
    const imported = await importedFeedOrNull();
    const localQuestions = state.questions.filter((question) => !DEMO_QUESTION_IDS.has(question.id));
    const questions = imported ? [...localQuestions, ...imported.questions] : state.questions;
    return questions
      .filter((question) => matchesQuestion(question, search, visaType))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }

  const supabase = getSupabase();
  if (search.trim()) {
    const { data, error } = await supabase.rpc('search_questions', {
      search_text: search.trim(), filter_visa_type: visaType || null, result_limit: 30,
    });
    throwIfError(error);
    const imported = await importedFeedOrNull();
    return [...((data ?? []) as Question[]), ...(imported?.questions ?? [])]
      .filter((question) => matchesQuestion(question, search, visaType))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }

  let query = supabase.from('question_feed').select('*').order('created_at', { ascending: false }).limit(50);
  if (visaType) query = query.eq('visa_type', visaType);
  const { data, error } = await query;
  throwIfError(error);
  const imported = await importedFeedOrNull();
  return [...((data ?? []) as Question[]), ...(imported?.questions ?? [])]
    .filter((question) => matchesQuestion(question, search, visaType))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export async function getQuestion(id: string): Promise<Question | null> {
  if (id.startsWith('apify-')) {
    const imported = await importedFeedOrNull();
    const question = imported?.questions.find((question) => question.id === id) ?? null;
    if (!question || !isSupabaseConfigured) return question;
    const { count, error } = await getSupabase().from('imported_answers').select('id', { count: 'exact', head: true }).eq('question_id',id);
    throwIfError(error);
    return { ...question, answer_count: question.answer_count + (count ?? 0) };
  }
  if (!isSupabaseConfigured) return readDemo().questions.find((question) => question.id === id) ?? null;
  const { data, error } = await getSupabase().from('question_feed').select('*').eq('id', id).maybeSingle();
  throwIfError(error);
  return data as Question | null;
}

export type QuestionPageOptions = { search?: string; tag?: string; visaType?: string; sort?: string; before?: Question };
export async function getQuestionPage(options: QuestionPageOptions = {}): Promise<{ questions: Question[]; more: boolean; cursor?: Question }> {
  if (!isSupabaseConfigured) return { questions: await listQuestions(), more: false };
  const before = options.before;
  const { data, error } = await getSupabase().rpc('community_question_page', {
    query_text: options.search?.trim() ?? '', filter_tag: options.tag ?? '', filter_visa: options.visaType ?? '', sort_mode: options.sort ?? 'newest',
    before_time: before?.created_at ?? null, before_id: before?.id ?? null,
    before_score: before ? options.sort === 'score' ? before.vote_score : options.sort === 'activity' ? before.vote_score + before.answer_count * 2 : 0 : null,
  });
  throwIfError(error);
  const rows = (data ?? []) as Question[];
  const imported = before ? [] : (await importedFeedOrNull())?.questions ?? [];
  return { questions: [...rows, ...imported], more: rows.length === 50, cursor: rows.at(-1) };
}

export async function createQuestion(authorId: string, input: NewQuestion): Promise<string> {
  const tags = normalizeTags([...input.tags, ...inferTags(`${input.title}\n${input.body}`)]);
  const normalizedInput = { ...input, tags };
  if (!isSupabaseConfigured) {
    const state = readDemo();
    const id = `q-${crypto.randomUUID()}`;
    state.questions.unshift({
      id, author_id: authorId, author_username: DEMO_USER.username,
      author_avatar_seed: DEMO_USER.avatar_seed, ...normalizedInput, status: 'open', vote_score: 0,
      answer_count: 0, view_count: 0, accepted_answer_id: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    writeDemo(state);
    return id;
  }
  const { data, error } = await getSupabase().from('questions').insert({ author_id: authorId, ...normalizedInput }).select('id').single();
  throwIfError(error);
  if (!data) throw new Error('Question was not created.');
  return data.id as string;
}

export async function listAnswers(questionId: string): Promise<Answer[]> {
  if (questionId.startsWith('apify-')) {
    const state = readDemo();
    const imported = await importedFeedOrNull();
    const sourceAnswers = imported?.answersByQuestionId[questionId] ?? [];
    let localAnswers = state.answers.filter((answer) => answer.question_id === questionId && answer.source !== 'apify');
    if (isSupabaseConfigured) {
      const { data, error } = await getSupabase().from('imported_answer_feed').select('*').eq('question_id', questionId)
        .order('created_at', { ascending: false }).limit(100);
      throwIfError(error);
      localAnswers = (data ?? []) as Answer[];
    }
    return [...sourceAnswers, ...localAnswers]
      .sort((a, b) => Number(b.is_accepted) - Number(a.is_accepted) || b.vote_score - a.vote_score);
  }
  if (!isSupabaseConfigured) {
    return readDemo().answers.filter((answer) => answer.question_id === questionId)
      .sort((a, b) => Number(b.is_accepted) - Number(a.is_accepted) || b.vote_score - a.vote_score);
  }
  const { data, error } = await getSupabase().from('answer_feed').select('*').eq('question_id', questionId)
    .order('is_accepted', { ascending: false }).order('vote_score', { ascending: false }).limit(100);
  throwIfError(error);
  return (data ?? []) as Answer[];
}

export async function createAnswer(questionId: string, authorId: string, body: string): Promise<void> {
  if (body.trim().length < 20 || body.length > 10000) throw new Error('Use between 20 and 10,000 characters.');
  if (!isSupabaseConfigured) {
    const state = readDemo();
    state.answers.push({
      id: `a-${crypto.randomUUID()}`, question_id: questionId, author_id: authorId,
      author_username: DEMO_USER.username, author_avatar_seed: DEMO_USER.avatar_seed,
      body, vote_score: 0, is_accepted: false, status: 'active',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    const question = state.questions.find((item) => item.id === questionId);
    if (question) question.answer_count += 1;
    writeDemo(state);
    return;
  }
  const { error } = await getSupabase().from(questionId.startsWith('apify-') ? 'imported_answers' : 'answers')
    .insert({ question_id: questionId, author_id: authorId, body });
  throwIfError(error);
}

export async function discoverQuestions(context: DiscoveryContext): Promise<RelatedQuestion[]> {
  const feed = await loadImportedFeed().catch(() => null);
  const local = isSupabaseConfigured ? '' : window.localStorage.getItem(DEMO_KEY) ?? '';
  if (!discoveryCache || discoveryCache.feed !== feed || discoveryCache.local !== local) {
    const state = readDemo();
    const comments: Record<string, string> = {};
    for (const answer of [...Object.values(feed?.answersByQuestionId ?? {}).flat(), ...(!isSupabaseConfigured ? state.answers : [])]) {
      if (answer.status !== 'active') continue;
      comments[answer.question_id] = `${comments[answer.question_id] ?? ''}\n${answer.body}`.slice(-20000);
    }
    const localQuestions = isSupabaseConfigured ? [] : feed
      ? state.questions.filter((q) => !DEMO_QUESTION_IDS.has(q.id)) : state.questions;
    discoveryCache = { feed, local, index: createDiscoveryIndex([...localQuestions, ...(feed?.questions ?? [])], comments) };
  }
  const index = discoveryCache.index;
  let imported = index.search(context);
  if (!isSupabaseConfigured) return imported;
  const { data, error } = await getSupabase().rpc('discover_community', {
    source_id: context.id ?? null, query_tags: contextTags(context),
    comment_tags: contextTags({ commentText: context.commentText, draftText: context.draftText }),
    query_text: searchTerms(`${context.draftText ?? ''} ${context.commentText ?? ''} ${context.title ?? ''} ${context.body ?? ''}`).join(' '),
    filter_visa: context.visa_type ?? '', result_limit: 5,
  });
  throwIfError(error);
  imported = index.search(context,5,data?.imported_topics ?? {});
  const native = (data?.native ?? []) as RelatedQuestion[];
  // Combine the two ranked sources without comparing incompatible numeric scores.
  const merged: RelatedQuestion[] = [];
  for (let i = 0; i < 5; i++) {
    for (const row of [native[i], imported[i]]) {
      if (row && !merged.some((item) => item.id === row.id)) merged.push(row);
    }
  }
  return merged.slice(0, 5);
}

export async function relatedQuestions(question: Question, commentText = ''): Promise<RelatedQuestion[]> {
  return discoverQuestions({ ...question, commentText });
}

export async function voteQuestion(questionId: string, userId: string, value: -1 | 1): Promise<number> {
  if (questionId.startsWith('apify-')) {
    const state = readDemo();
    state.externalQuestionVotes[questionId] = (state.externalQuestionVotes[questionId] ?? 0) + value;
    writeDemo(state);
    const imported = await loadImportedFeed();
    const baseScore = imported.questions.find((question) => question.id === questionId)?.vote_score ?? 0;
    return baseScore + state.externalQuestionVotes[questionId];
  }
  if (!isSupabaseConfigured) {
    const state = readDemo();
    const question = state.questions.find((item) => item.id === questionId);
    if (!question) throw new Error('Question not found');
    question.vote_score += value;
    writeDemo(state);
    return question.vote_score;
  }
  const { error } = await getSupabase().from('question_votes').upsert({ question_id: questionId, user_id: userId, value });
  throwIfError(error);
  const question = await getQuestion(questionId);
  return question?.vote_score ?? 0;
}

export async function voteAnswer(answerId: string, userId: string, value: -1 | 1): Promise<number> {
  if (answerId.startsWith('apify-comment-')) {
    const state = readDemo();
    state.externalAnswerVotes[answerId] = (state.externalAnswerVotes[answerId] ?? 0) + value;
    writeDemo(state);
    const imported = await loadImportedFeed();
    const baseScore = Object.values(imported.answersByQuestionId).flat()
      .find((answer) => answer.id === answerId)?.vote_score ?? 0;
    return baseScore + state.externalAnswerVotes[answerId];
  }
  if (!isSupabaseConfigured) {
    const state = readDemo();
    const answer = state.answers.find((item) => item.id === answerId);
    if (!answer) throw new Error('Answer not found');
    answer.vote_score += value;
    writeDemo(state);
    return answer.vote_score;
  }
  const supabase = getSupabase();
  const { error } = await supabase.from('answer_votes').upsert({ answer_id: answerId, user_id: userId, value });
  throwIfError(error);
  const { data, error: readError } = await supabase.from('answers').select('vote_score').eq('id', answerId).single();
  throwIfError(readError);
  if (!data) throw new Error('Answer was not found after voting.');
  return data.vote_score as number;
}

export async function acceptAnswer(answerId: string, questionId: string): Promise<void> {
  if (!isSupabaseConfigured) {
    const state = readDemo();
    state.answers.filter((item) => item.question_id === questionId)
      .forEach((item) => { item.is_accepted = item.id === answerId; });
    const question = state.questions.find((item) => item.id === questionId);
    if (question) question.accepted_answer_id = answerId;
    writeDemo(state);
    return;
  }
  const { error } = await getSupabase().rpc('accept_answer', { target_answer_id: answerId });
  throwIfError(error);
}

export async function listConversations(): Promise<Conversation[]> {
  if (!isSupabaseConfigured) return readDemo().conversations.sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at));
  const { data, error } = await getSupabase().from('conversation_inbox').select('*').order('last_message_at', { ascending: false }).limit(50);
  throwIfError(error);
  return (data ?? []) as Conversation[];
}

export async function startConversation(username: string): Promise<string> {
  if (!isSupabaseConfigured) {
    const normalized = username.trim().toLowerCase();
    if (normalized === DEMO_USER.username) throw new Error('You cannot message yourself');
    const state = readDemo();
    const existing = state.conversations.find((item) => item.other_username === normalized);
    if (existing) return existing.id;
    const known = state.questions.find((item) => item.author_username === normalized);
    if (!known?.author_id || !canMessageAuthor(known, DEMO_USER.id)) throw new Error('Choose a registered member to message.');
    const id = `c-${crypto.randomUUID()}`;
    state.conversations.unshift({
      id, other_user_id: known.author_id, other_username: known.author_username,
      other_avatar_seed: known.author_avatar_seed, last_message: null, last_message_created_at: null,
      last_message_at: new Date().toISOString(), unread_count: 0,
      request_status: 'pending', requested_by: DEMO_USER.id,
    });
    writeDemo(state);
    return id;
  }
  const { data, error } = await getSupabase().rpc('start_direct_conversation', { other_username: username });
  throwIfError(error);
  return data as string;
}

export async function listMessages(conversationId: string, before?: DirectMessage): Promise<DirectMessage[]> {
  if (!isSupabaseConfigured) return readDemo().messages.filter((message) => message.conversation_id === conversationId
    && (!before || message.created_at < before.created_at || (message.created_at === before.created_at && message.id < before.id)))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).slice(-50);
  const { data, error } = await getSupabase().rpc('message_page', {
    target_conversation: conversationId, before_time: before?.created_at ?? null, before_id: before?.id ?? null,
  });
  throwIfError(error);
  return ((data ?? []) as DirectMessage[]).reverse();
}

export async function sendMessage(conversationId: string, senderId: string, body: string, messageId = crypto.randomUUID()): Promise<void> {
  if (!body.trim() || body.length > 4000) throw new Error('Use between 1 and 4,000 characters.');
  if (!isSupabaseConfigured) {
    const state = readDemo();
    const conversation = state.conversations.find((item) => item.id === conversationId);
    if (!conversation) throw new Error('Conversation not found.');
    if (state.messages.some((item) => item.id === messageId)) return;
    if (conversation.request_status === 'blocked' || conversation.request_status === 'declined') throw new Error('This conversation is closed.');
    if (conversation.request_status === 'pending' && (conversation.requested_by !== senderId || state.messages.some((m) => m.conversation_id === conversationId))) {
      throw new Error('Wait for your chat request to be accepted.');
    }
    const createdAt = new Date().toISOString();
    state.messages.push({ id: messageId, conversation_id: conversationId, sender_id: senderId, body, read_at: null, created_at: createdAt });
    if (conversation) {
      conversation.last_message = body;
      conversation.last_message_at = createdAt;
      conversation.last_message_created_at = createdAt;
    }
    writeDemo(state);
    return;
  }
  const { error } = await getSupabase().rpc('send_direct_message', { target_conversation: conversationId, message_body: body, message_id: messageId });
  throwIfError(error);
}

export async function respondToConversation(id: string, action: 'accepted' | 'declined' | 'blocked', userId: string): Promise<void> {
  if (!isSupabaseConfigured) {
    const state = readDemo();
    const row = state.conversations.find((item) => item.id === id);
    if (!row) throw new Error('Conversation not found.');
    if (action !== 'blocked' && (row.request_status !== 'pending' || row.requested_by === userId)) throw new Error('Only the recipient can respond to a request.');
    row.request_status = action;
    if (action === 'blocked') row.blocked_by = userId;
    writeDemo(state);
    return;
  }
  const { error } = await getSupabase().rpc('respond_to_conversation', { target_conversation: id, decision: action });
  throwIfError(error);
}

export async function markConversationRead(conversationId: string, userId: string): Promise<void> {
  if (!isSupabaseConfigured) {
    const state = readDemo();
    const conversation = state.conversations.find((item) => item.id === conversationId);
    if (!state.messages.some((item) => item.conversation_id === conversationId && item.sender_id !== userId && !item.read_at) && !conversation?.unread_count) return;
    if (conversation) conversation.unread_count = 0;
    state.messages.filter((item) => item.conversation_id === conversationId && item.sender_id !== userId)
      .forEach((item) => { item.read_at = new Date().toISOString(); });
    writeDemo(state);
    return;
  }
  const { error } = await getSupabase().from('direct_messages').update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId).neq('sender_id', userId).is('read_at', null);
  throwIfError(error);
}

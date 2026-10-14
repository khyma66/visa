import type { Conversation, DirectMessage } from './types';

export const MESSAGE_PAGE_SIZE = 50;
export type ConversationFolder = 'chats' | 'requests' | 'closed';
export type ConversationCounts = Record<ConversationFolder, number>;

const MEMBER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME = /^[a-z][a-z0-9-]{4,31}$/;

export function normalizeMessageUsername(username: string): string {
  const normalized = username.trim().toLowerCase().replace(/^u\//, '');
  if (!USERNAME.test(normalized)) throw new Error('Enter a registered public username, such as calm-raven-12345.');
  return normalized;
}

export function isMemberId(id: string): boolean { return MEMBER_ID.test(id); }

/** Presentation guard only. The profile lookup and database RPC remain authoritative. */
export function getMemberMessageHref(content: { id: string; author_id: string | null; author_username: string; source?: string }, currentUserId?: string): string | null {
  if (content.source === 'apify' || !isMemberId(content.id) || !content.author_id || !isMemberId(content.author_id)
    || content.author_id === currentUserId || !USERNAME.test(content.author_username)) return null;
  return `/messages?to=${encodeURIComponent(content.author_username)}&member=${encodeURIComponent(content.author_id)}`;
}

export function messageLoginHref(username = '', memberId = ''): string {
  let target = '/messages';
  try {
    if (username) {
      if (memberId && !isMemberId(memberId)) throw new Error('Invalid member identity');
      target += `?to=${encodeURIComponent(normalizeMessageUsername(username))}`;
      if (isMemberId(memberId)) target += `&member=${encodeURIComponent(memberId)}`;
    }
  } catch { target = '/messages'; /* Invalid links must not survive authentication as message targets. */ }
  return `/login?next=${encodeURIComponent(target)}`;
}

export function conversationFolder(conversation: Conversation, userId: string): ConversationFolder {
  if (conversation.request_status === 'blocked' || conversation.request_status === 'declined') return 'closed';
  return conversation.request_status === 'pending' && conversation.requested_by !== userId ? 'requests' : 'chats';
}

/** Shared predicates keep exact RLS-scoped counts and folder pages equivalent. */
export function conversationFolderFilter(folder: ConversationFolder, userId: string): string {
  if (!isMemberId(userId)) throw new Error('A signed-in account is required.');
  if (folder === 'closed') return 'request_status.in.(blocked,declined)';
  if (folder === 'requests') return `and(request_status.eq.pending,or(requested_by.is.null,requested_by.neq.${userId}))`;
  return `request_status.is.null,request_status.eq.accepted,and(request_status.eq.pending,requested_by.eq.${userId})`;
}

export function conversationCursorFilter(before: Conversation): string {
  const time = before.last_message_at;
  // Keep Postgres microseconds intact: Date#toISOString truncates them and can
  // skip rows sharing the original timestamp. Restrict raw filter syntax.
  if (!isMemberId(before.id) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(time)
    || !Number.isFinite(Date.parse(time))) throw new Error('Invalid conversation cursor.');
  return `last_message_at.lt.${time},and(last_message_at.eq.${time},id.lt.${before.id})`;
}

export function canSendToConversation(conversation: Conversation | null | undefined, userId: string, messages: DirectMessage[], loading: boolean): boolean {
  if (!conversation || loading || conversationFolder(conversation,userId) !== 'chats') return false;
  return !conversation.request_status || conversation.request_status === 'accepted'
    || (conversation.request_status === 'pending' && conversation.requested_by === userId && !messages.length);
}

export function sortMessages(messages: DirectMessage[]): DirectMessage[] {
  return [...new Map(messages.map((message) => [message.id, message])).values()]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

/** Never join two disconnected windows: otherwise "earlier" cannot fill the gap. */
export function hasMessageOverlap(previous: DirectMessage[], latest: DirectMessage[]): boolean {
  const ids = new Set(previous.map((message) => message.id));
  return latest.some((message) => ids.has(message.id));
}

export function displayedUnreadIds(messages: DirectMessage[], userId: string): string[] {
  return [...new Set(messages.filter((message) => message.sender_id !== userId && !message.read_at).map((message) => message.id))];
}

export function sortConversations(conversations: Conversation[]): Conversation[] {
  return [...new Map(conversations.map((conversation) => [conversation.id, conversation])).values()]
    .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at) || b.id.localeCompare(a.id));
}

import type { Conversation, DirectMessage } from './types';

export const MESSAGE_PAGE_SIZE = 50;

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

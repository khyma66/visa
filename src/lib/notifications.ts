'use client';

import { getSupabase } from './supabase/client';

export type MemberNotification = {
  id: string; kind: 'reply' | 'message'; created_at: string; read_at: string | null;
  actor_username: string; title: string; href: string;
};
export type NotificationPreferences = {
  reply_in_app: boolean; message_in_app: boolean; reply_email: boolean; message_email: boolean;
};
export type NotificationData = {
  items: MemberNotification[]; unreadNotifications: number; unreadMessages: number;
  preferences: NotificationPreferences; emailAvailable: boolean;
};
export const EMPTY_NOTIFICATIONS: NotificationData = {
  items: [], unreadNotifications: 0, unreadMessages: 0, emailAvailable: false,
  preferences: { reply_in_app: true, message_in_app: true, reply_email: false, message_email: false },
};
export async function getNotifications(page = 0): Promise<NotificationData> {
  const { data, error } = await getSupabase().rpc('member_notification_data', { page_number: page }).abortSignal(AbortSignal.timeout(10000));
  if (error || !data) throw new Error('Notifications could not be loaded. Please try again.');
  return data as NotificationData;
}
export async function readNotifications(ids: string[], userId: string) {
  if (!ids.length) return;
  const { error } = await getSupabase().rpc('read_member_notifications', { targets: ids, expected_user: userId }).abortSignal(AbortSignal.timeout(10000));
  if (error) throw new Error('Could not mark notifications as read. Please try again.');
}
export async function saveNotificationPreferences(preferences: NotificationPreferences, userId: string) {
  const { error } = await getSupabase().rpc('set_notification_preferences', { ...preferences, expected_user: userId }).abortSignal(AbortSignal.timeout(10000));
  if (error) throw new Error('Your preferences could not be saved. Please try again.');
}

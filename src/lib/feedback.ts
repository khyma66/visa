import { getSupabase } from './supabase/client';

export const FEEDBACK_CATEGORIES = { bug: 'Something is broken', idea: 'Suggest an improvement', other: 'Other feedback' } as const;
export const FEEDBACK_STATUSES = { new: 'New', reviewing: 'Under review', planned: 'Plan ready', approved: 'Approved', done: 'Completed', declined: 'Not planned' } as const;
export type FeedbackCategory = keyof typeof FEEDBACK_CATEGORIES;
export type FeedbackStatus = keyof typeof FEEDBACK_STATUSES;
export type FeedbackItem = {
  id: string; category: FeedbackCategory; message: string; section: string; status: FeedbackStatus;
  plan: string; plan_version: number; approved_plan_version: number | null; approved_at: string | null;
  version: number; created_at: string; updated_at: string;
};
export type FeedbackEvent = { id: number; action: string; created_at: string; snapshot: { status: FeedbackStatus; plan: string; plan_version: number } };
export type FeedbackAction = 'review' | 'save_plan' | 'approve' | 'complete' | 'decline' | 'reopen';
export type FeedbackCursor = { created_at: string; id: string };
export const FEEDBACK_PAGE_SIZE = 20;

// Send only a section label, never URLs, searches, conversation IDs, auth
// tokens, browser logs, email addresses, or the contents of a page.
export function feedbackSection(pathname: string): string {
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return 'general';
  const root = pathname.split(/[?#]/)[0].split('/')[1];
  if (!root) return 'home';
  if (['explore', 'communities', 'questions', 'experiences', 'news', 'tags', 'messages', 'account', 'login'].includes(root)) return root;
  if (['privacy', 'terms', 'cookies', 'privacy-choices', 'community-safety'].includes(root)) return 'policies';
  return 'general';
}

export function feedbackError(error: unknown): string {
  const value = error as { code?: string; message?: string } | null;
  if (value?.code === '40001') return 'This feedback changed in another tab. Refresh the inbox before saving again.';
  if (value?.code === '42501') return 'This action is not available for your account. Please check that you are signed in to the correct account.';
  if (value?.message?.includes('Too many requests')) return 'You have reached the feedback limit. Please try again in an hour.';
  if (value?.message === 'Feedback is not available yet') return 'Feedback collection is being set up. Please use the contact page for now.';
  if (value?.code === '22023') return 'Please check the form, or refresh the inbox and try again.';
  return 'We could not complete that request. Please try again. Your text is still here.';
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(name, args).abortSignal(AbortSignal.timeout(12000));
  if (error) throw error;
  return data as T;
}
export const isFeedbackOwner = () => rpc<boolean>('feedback_is_owner');
export const sendFeedback = (requestId: string, category: FeedbackCategory, message: string, section: string) => rpc<string>('feedback_submit', {
  client_request_id: requestId, feedback_category: category, feedback_message: message.trim(), page_section: section,
});
export async function getFeedbackInbox(status: FeedbackStatus | '', cursor: FeedbackCursor | null = null) {
  const data = await rpc<FeedbackItem[]>('feedback_inbox', { status_filter: status || null, before_created_at: cursor?.created_at ?? null, before_id: cursor?.id ?? null });
  const items = data.slice(0, FEEDBACK_PAGE_SIZE);
  return { items, more: data.length > FEEDBACK_PAGE_SIZE, cursor: items.at(-1) ?? null };
}
export const reviewFeedback = (item: FeedbackItem, action: FeedbackAction, plan = '') => rpc<void>('feedback_review', {
  target_id: item.id, expected_version: item.version, review_action: action, proposed_plan: plan,
});
export const getFeedbackHistory = (id: string) => rpc<FeedbackEvent[]>('feedback_history', { target_id: id });

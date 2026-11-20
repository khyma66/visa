import { isImportedPost } from '@/lib/post-presentation';

/** Earlier public discussions are shown with a neutral pseudonym. Their authors
 * are not VisaThreads members, so they cannot be messaged; say so plainly rather
 * than leaving a missing Message option unexplained. Ingestion terms stay internal. */
export const EARLIER_DISCUSSION_NOTE = 'Shared publicly before VisaThreads. The author is not a member here, so they cannot be messaged. You can still reply to the post.';

export function PostOriginBadge({ post }: { post: { id: string; source?: string } }) {
  if (!isImportedPost(post)) return null;
  return <span title={EARLIER_DISCUSSION_NOTE} className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium normal-case text-slate-600">Earlier discussion</span>;
}

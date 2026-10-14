import { COMMUNITY_ARCHIVE_DESCRIPTION, COMMUNITY_ARCHIVE_LABEL, isImportedPost } from '@/lib/post-presentation';

/** Non-interactive origin metadata, intentionally separate from searchable topic tags. */
export function PostOriginBadge({ post }: { post: { id: string; source?: string } }) {
  if (!isImportedPost(post)) return null;
  return <span role="note" title={COMMUNITY_ARCHIVE_DESCRIPTION}
    aria-label={`${COMMUNITY_ARCHIVE_LABEL}. ${COMMUNITY_ARCHIVE_DESCRIPTION}`}
    className="inline-flex max-w-full items-center rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-amber-900">
    {COMMUNITY_ARCHIVE_LABEL}
  </span>;
}

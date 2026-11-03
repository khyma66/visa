/** Source provenance remains internal. Public cards use a neutral, stable
 * pseudonym and do not expose ingestion terminology as a member-facing badge. */
export function PostOriginBadge({ post: _post }: { post: { id: string; source?: string } }) {
  return null;
}

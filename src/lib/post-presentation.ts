/** Provenance stays in the data layer; never infer account ownership from a display name. */
type PostAuthor = { id: string; source?: string; author_id?: string | null; author_username: string };

export function isImportedPost(post: Pick<PostAuthor, 'id' | 'source'>): boolean {
  return post.source === 'apify' || post.id.startsWith('apify-');
}

export function canMessageAuthor(post: PostAuthor, viewerId?: string | null): boolean {
  return !isImportedPost(post) && Boolean(post.author_id?.trim())
    && post.author_id !== '00000000-0000-0000-0000-000000000000'
    && Boolean(post.author_username.trim()) && post.author_id !== viewerId;
}

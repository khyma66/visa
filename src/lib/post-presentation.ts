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

type MarketPost = { destination_country?: string; visa_type?: string; title?: string; body?: string };
/** Display scope only, not an authorization boundary. Original archive stays intact. */
export function usVisaPost<T extends MarketPost>(post: T): T | null {
  const country = post.destination_country?.trim().toLowerCase();
  const visa = post.visa_type ?? '';
  if (/^(?:schengen|study permit|work permit|canada work permit)$/i.test(visa)) return null;
  if (country && !['united states', 'us', 'usa', 'u.s.', 'global'].includes(country)) {
    // The old importer classified some U.S. re-entry questions by the country
    // mentioned in their itinerary. Require an explicit U.S. visa/status marker.
    const text = `${post.title ?? ''}\n${post.body ?? ''}`;
    if (!/\b(?:h[ -]?1[ -]?b|h[ -]?4|i[ -]?94|uscis|u\.s\. visa)\b/i.test(text)) return null;
    return { ...post, destination_country: 'United States', visa_type: /\bh[ -]?1[ -]?b\b/i.test(text) ? 'H-1B' : 'General' };
  }
  return visa === 'Visa discussion' ? { ...post, visa_type: 'General' } : post;
}

export function topicLabel(tag: string): string {
  const labels: Record<string, string> = { h1b: 'H-1B', h4: 'H-4', f1: 'F-1', opt: 'OPT', cpt: 'CPT', ead: 'EAD', uscis: 'USCIS', rfe: 'RFE', 'i-140': 'I-140', 'ds-160': 'DS-160', 'b1-b2': 'B1/B2' };
  return labels[tag] ?? tag.split('-').map(word => word ? word[0].toUpperCase() + word.slice(1) : '').join(' ');
}

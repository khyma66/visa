/** Origin is metadata, not a topic tag. Never infer ownership from a display name. */
import type { Question } from './types';
type PostAuthor = { id: string; source?: string; author_id?: string | null; author_username: string };

export function isImportedPost(post: Pick<PostAuthor, 'id' | 'source'>): boolean {
  return post.source === 'apify' || post.id.startsWith('apify-');
}

/** Stable public alias for previously published items. It intentionally uses
 * only the item ID, never a source handle or account field. */
export function publicImportedUsername(post: Pick<PostAuthor, 'id'>): string {
  let hash = 2166136261;
  for (const character of post.id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `user-${String((hash >>> 0) % 9000 + 1000)}`;
}

export function canMessageAuthor(post: PostAuthor, viewerId?: string | null): boolean {
  return !isImportedPost(post) && Boolean(post.author_id?.trim())
    && post.author_id !== '00000000-0000-0000-0000-000000000000'
    && Boolean(post.author_username.trim()) && post.author_id !== viewerId;
}

type MarketPost = { id?: string; source?: string; destination_country?: string; visa_type?: string; title?: string; body?: string };

const GREETING = /^(?:hi|hello|hey|dear|greetings|good (?:morning|evening)|admin|folks|guys|all)\b/i;
/** Imported text arrives with source formatting: markdown emphasis, Telegram
 * @handles and #hashtags. Handles name third parties, so they are not shown. */
export function cleanImportedText(text: string): string {
  return text.replace(/\*\*|__/g, '')
    .replace(/(^|[\s(])@[A-Za-z][A-Za-z0-9_]{2,31}\b/g, '$1a member')
    .replace(/(^|\s)#([A-Za-z][\w-]*)/g, '$1$2');
}
function tidyTitle(text: string): string {
  return cleanImportedText(text).replace(/\*+/g, '').replace(/^#{1,6}\s+/, '')
    .replace(/^\[(.+)\]$/, '$1').replace(/[-_=~]{3,}$/, '').replace(/\s+/g, ' ').trim();
}
/** Earlier imports stored a sentence from the post as its title. When the post
 * opens with its own short heading line, that line is the thread's real title. */
export function importedTitle(title: string, body: string, id = ''): string {
  let stored = tidyTitle(title).replace(/^\s*(?:\d+[.)]|[*•-])\s+/, '').trim();
  // Stored titles were cut at a fixed length; end a cut-off title at its last
  // complete sentence (not at abbreviations such as "U.S.").
  if (stored.length >= 80 && !/[.?!]$/.test(stored)) {
    const ends = [...stored.matchAll(/(?<![A-Z]\.[A-Z])[.?!](?=\s)/g)].map(match => match.index! + 1).filter(end => end >= 15);
    if (ends.length) stored = stored.slice(0, ends.at(-1)).trim();
  }
  if (id.startsWith('apify-telegram-')) return stored || title;
  const lines = body.split('\n');
  const first = tidyTitle(lines[0] ?? '');
  // A heading line is followed by a blank line or a greeting, not by more of the same paragraph.
  const next = lines[1] ?? '';
  const standalone = !next.trim() || GREETING.test(cleanImportedText(next).trim());
  const words = first.split(/\s+/).filter(Boolean).length;
  const heading = lines.length > 1 && standalone && first.length >= 15 && first.length <= 140 && words >= 3
    && !GREETING.test(first) && !/[.,;:]$/.test(first) && first !== stored;
  return heading ? first : stored || title;
}
function presentImported<T extends MarketPost>(post: T): T {
  if (post.source !== 'apify' && !post.id?.startsWith('apify-')) return post;
  return { ...post,
    ...(typeof post.title === 'string' ? { title: importedTitle(post.title, post.body ?? '', post.id) } : {}),
    ...(typeof post.body === 'string' ? { body: cleanImportedText(post.body) } : {}) };
}

/** Display scope only, not an authorization boundary. Original archive stays intact. */
export function usVisaPost<T extends MarketPost>(post: T): T | null {
  const scoped = usVisaScope(post);
  return scoped && presentImported(scoped);
}
function usVisaScope<T extends MarketPost>(post: T): T | null {
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

/** Reviewed first-person accounts, not a keyword classifier. View-only selection:
 * preserve the archive, original dates, replies, ownership, and canonical links.
 * Inclusion is not verification of a contributor's claims or legal advice. */
export function selectedExperiences(questions: Question[]): Question[] {
  const selections: Record<string, { category: string; title?: string; visa?: string }> = {
    'apify-2284772032337912': { category: 'Visa interview', title: 'First H-1B Stamping in Karachi and Arrival at JFK', visa: 'H-1B' },
    'apify-2270233223791793': { category: 'Travel & arrival' },
    'apify-2258283714986744': { category: 'Visa interview', title: 'H-1B Interview in Hyderabad: 221(g), Approval, and Issuance', visa: 'H-1B' },
    'apify-2257123705102745': { category: 'Approval & timeline' },
  };
  return questions.flatMap(question => {
    const selection = selections[question.id];
    if (!selection || !isImportedPost(question) || question.status === 'archived' || !usVisaPost(question)) return [];
    return [{ ...question, title: selection.title ?? question.title, visa_type: selection.visa ?? question.visa_type,
      post_kind: 'experience' as const, experience_category: selection.category }];
  });
}

/** Rolling two calendar months in UTC, clamped for shorter target months. */
export function recentPostCutoff(now = new Date()): number {
  const cutoff = new Date(now);
  const day = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 2);
  const lastDay = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
  cutoff.setUTCDate(Math.min(day, lastDay));
  return cutoff.getTime();
}
export function recentPosts<T extends { created_at: string }>(posts: T[], now = new Date()): T[] {
  const cutoff = recentPostCutoff(now);
  return posts.filter(post => Date.parse(post.created_at) >= cutoff);
}

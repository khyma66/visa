import { getSupabase, isSupabaseConfigured } from './supabase/client';
import type { Question } from './types';

export const COMMUNITY_CATEGORIES = ['Work visas', 'Study', 'Family', 'Travel', 'Settlement', 'General'] as const;
export type CommunityCategory = typeof COMMUNITY_CATEGORIES[number];
export type Community = {
  id: string;
  slug: string;
  display_name: string;
  description: string;
  country: string;
  category: CommunityCategory;
  rules: string[];
  member_count: number;
  created_at: string;
  created_by: string | null;
};
export type NewCommunity = Pick<Community, 'slug' | 'display_name' | 'description' | 'country' | 'category' | 'rules'>;
export type CommunityMembership = { community_id: string; role: string; is_active: boolean };
export type CommunityPageOptions = { search?: string; category?: string; country?: string; after?: string | null; limit?: number; signal?: AbortSignal };
export type CommunityPageResult = { communities: Community[]; nextCursor: string | null };
export type QuestionCursor = { created_at: string; id: string };
export type CommunityQuestionPage = { questions: Question[]; nextCursor: QuestionCursor | null };

const FIELDS = 'id,slug,display_name,description,country,category,rules,member_count,created_at,created_by';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

function client() {
  if (!isSupabaseConfigured) throw new Error('Shared communities are unavailable until the community service is connected.');
  return getSupabase();
}

function requireId(id: string) {
  if (!UUID.test(id)) throw new Error('Invalid community identifier.');
}

function apiError(error: { code?: string; message?: string }, fallback: string): Error {
  if (error.code === '23505') return new Error('That community address is already taken. Join the existing community or choose another address.');
  if (error.code === '42501' || error.code === 'PGRST301') return new Error('Your account cannot perform this action. Log in again and check your community membership.');
  if (error.message?.includes('owner')) return new Error('Community owners cannot leave their community.');
  if (error.code === 'PGRST202' || error.code === 'PGRST205' || error.code === '42P01') return new Error('Communities are not available on this environment yet. Please try again later.');
  return new Error(fallback);
}

export function validateCommunity(input: NewCommunity): NewCommunity {
  const value = { ...input, slug: input.slug.trim().toLowerCase(), display_name: input.display_name.trim(), description: input.description.trim(), country: input.country.trim(), rules: input.rules.map((rule) => rule.trim()).filter(Boolean) };
  if (!SLUG.test(value.slug) || value.slug.includes('--')) throw new Error('Use 3–40 lowercase letters, numbers or single hyphens for the community address.');
  if (value.display_name.length < 3 || value.display_name.length > 80) throw new Error('The community name must be 3–80 characters.');
  if (value.description.length < 20 || value.description.length > 500) throw new Error('The description must be 20–500 characters.');
  if (!value.country.length || value.country.length > 80) throw new Error('Enter a country or Worldwide, using 80 characters or fewer.');
  if (!COMMUNITY_CATEGORIES.includes(value.category)) throw new Error('Choose a community category.');
  if (value.rules.length > 5 || value.rules.some((rule) => rule.length > 200)) throw new Error('Add up to five rules, with 200 characters or fewer per rule.');
  return value;
}

export function normalizeCommunitySearch(search = '') {
  const value = search.trim().slice(0, 80);
  // Only plain text enters the raw PostgREST OR expression; no filter operators,
  // commas, wildcards or quotes supplied by a user can change the query.
  if (!/^[\p{L}\p{N}\s-]*$/u.test(value)) throw new Error('Search using letters, numbers, spaces or hyphens.');
  return value.replace(/\s+/g, ' ');
}

export async function listCommunities(options: CommunityPageOptions = {}): Promise<CommunityPageResult> {
  const search = normalizeCommunitySearch(options.search);
  const limit = boundedLimit(options.limit);
  let query = client().from('community_directory').select(FIELDS).order('slug', { ascending: true }).limit(limit + 1);
  if (search) query = query.or(`display_name.ilike.%${search}%,slug.ilike.%${search}%`);
  if (options.category) {
    if (!COMMUNITY_CATEGORIES.includes(options.category as CommunityCategory)) throw new Error('Choose a community category.');
    query = query.eq('category', options.category);
  }
  if (options.country?.trim()) query = query.ilike('country', `%${options.country.trim().slice(0, 80).replace(/[\\%_]/g, '\\$&')}%`);
  if (options.after) {
    if (!SLUG.test(options.after)) throw new Error('Invalid community page.');
    query = query.gt('slug', options.after);
  }
  if (options.signal) query = query.abortSignal(options.signal);
  const { data, error } = await query;
  if (error) throw apiError(error, 'Could not load communities. Please retry.');
  const rows = (data ?? []) as Community[];
  return { communities: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].slug : null };
}

function boundedLimit(value = 24) {
  if (!Number.isFinite(value)) throw new Error('Invalid community page size.');
  return Math.max(1, Math.min(24, Math.floor(value)));
}

/** Read only memberships for the current page, never a member's entire history. */
export async function getMembershipsForCommunities(userId: string, communityIds: string[], signal?: AbortSignal): Promise<CommunityMembership[]> {
  requireId(userId);
  const ids = [...new Set(communityIds)];
  if (ids.length > 24) throw new Error('Membership lookups are limited to one page of communities.');
  ids.forEach(requireId);
  if (!ids.length) return [];
  let query = client().from('community_members').select('community_id,role,is_active')
    .eq('user_id', userId).eq('is_active', true).in('community_id', ids).limit(24);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw apiError(error, 'Could not load your memberships. Please retry.');
  return (data ?? []) as CommunityMembership[];
}

export async function getMembershipForCommunity(userId: string, communityId: string, signal?: AbortSignal): Promise<CommunityMembership | null> {
  return (await getMembershipsForCommunities(userId, [communityId], signal))[0] ?? null;
}

/** Authentication and ownership come from the database session, not an input ID. */
export async function listMyCommunitiesPage(options: CommunityPageOptions = {}): Promise<CommunityPageResult> {
  const search = normalizeCommunitySearch(options.search);
  const limit = boundedLimit(options.limit);
  if (options.category && !COMMUNITY_CATEGORIES.includes(options.category as CommunityCategory)) throw new Error('Choose a community category.');
  if (options.after && !SLUG.test(options.after)) throw new Error('Invalid community page.');
  let query = client().rpc('my_community_directory_page', {
    query_text: search, filter_category: options.category ?? '', filter_country: options.country?.trim().slice(0, 80) ?? '',
    after_slug: options.after ?? null, result_limit: limit,
  });
  if (options.signal) query = query.abortSignal(options.signal);
  const { data, error } = await query;
  if (error) throw apiError(error, 'Could not load your communities. Please retry.');
  const rows = (data ?? []) as Community[];
  return { communities: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].slug : null };
}

export async function getCommunityBySlug(slug: string, signal?: AbortSignal): Promise<Community | null> {
  if (!SLUG.test(slug)) return null;
  let query = client().from('community_directory').select(FIELDS).eq('slug', slug);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  if (error) throw apiError(error, 'Could not load this community. Please retry.');
  return data as Community | null;
}

export async function getCommunityById(id: string, signal?: AbortSignal): Promise<Community | null> {
  requireId(id);
  let query = client().from('community_directory').select(FIELDS).eq('id', id);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  if (error) throw apiError(error, 'Could not load this community. Please retry.');
  return data as Community | null;
}

export async function createCommunity(input: NewCommunity): Promise<string> {
  const value = validateCommunity(input);
  const { data, error } = await client().rpc('create_public_community', { community_slug: value.slug, community_name: value.display_name, community_description: value.description, community_country: value.country, community_category: value.category, community_rules: value.rules });
  if (error) throw apiError(error, 'Could not create the community. Check the details and retry.');
  if (typeof data !== 'string' || !UUID.test(data)) throw new Error('The community service returned an invalid result. Check your communities before retrying.');
  return data;
}

export async function joinCommunity(id: string): Promise<void> {
  requireId(id);
  const { error } = await client().rpc('join_public_community', { target_community: id });
  if (error) throw apiError(error, 'Could not join this community. Please retry.');
}

export async function leaveCommunity(id: string): Promise<void> {
  requireId(id);
  const { error } = await client().rpc('leave_public_community', { target_community: id });
  if (error) throw apiError(error, 'Could not leave this community. Please retry.');
}

export async function listCommunityQuestions(id: string, options: { after?: QuestionCursor | null; tag?: string; signal?: AbortSignal } = {}): Promise<CommunityQuestionPage> {
  requireId(id);
  if (options.tag && options.tag.length > 60) throw new Error('That tag is too long.');
  if (options.after) {
    requireId(options.after.id);
    if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(options.after.created_at) || !Number.isFinite(Date.parse(options.after.created_at))) throw new Error('Invalid question page.');
  }
  let query = client().rpc('community_group_question_page', {
    target_community: id, before_time: options.after?.created_at ?? null,
    before_id: options.after?.id ?? null, filter_tag: options.tag ?? '',
  });
  if (options.signal) query = query.abortSignal(options.signal);
  const { data, error } = await query;
  if (error) throw apiError(error, 'Could not load community questions. Please retry.');
  const rows = (data ?? []) as Question[];
  const questions = rows.slice(0, 20);
  const last = questions[questions.length - 1];
  return { questions, nextCursor: rows.length > 20 ? { id: last.id, created_at: last.created_at } : null };
}

import { NextResponse } from 'next/server';
import type { Answer, CommunityFeed, Question } from '@/lib/types';
import { inferTags } from '@/lib/tagging';
import archive from '@visa/archive';

export const runtime = 'edge';

const DEFAULT_RUN_ID = '9iVj9RajtVcIVkzgZ';
const DEFAULT_ACTOR_ID = '2chN8UQcH1CfxLRNE';
const DATASET_PAGE_SIZE = 100;
const MAX_DATASET_ITEMS = 5_000;
const MAX_TEXT_LENGTH = 12_000;
const MAX_COMMENT_LENGTH = 6_000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_BYTES = 12 * 1024 * 1024;
const PROMOTIONAL_CONTENT = /\b(?:book your|discount|free consultation|limited spots|partnered with|referrals? appreciated|watch (?:the )?video|looking for opportunities|open to .{0,40} opportunities)\b/i;
const QUESTION_SIGNAL = /\?|\b(?:any(?:one|body)|can someone|could someone|does anyone|has anyone|need (?:advice|help|guidance)|please (?:advise|suggest|share)|share (?:your )?(?:experience|timeline)|what (?:should|can|would)|how (?:can|do|long)|is it|would it|which|why|when)\b/i;

type UnknownRecord = Record<string, unknown>;

async function boundedJson(response: Response, budget: { remaining: number }, maximum = MAX_PAGE_BYTES): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error('Upstream response unavailable');
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error('Unexpected upstream content type');
  const declared = Number(response.headers.get('content-length'));
  const limit = Math.min(maximum, budget.remaining);
  if (declared > limit) { await response.body.cancel(); throw new Error('Upstream response too large'); }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error('Upstream response too large');
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    budget.remaining -= bytes;
    return JSON.parse(body);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

type ApifyComment = {
  commentId?: unknown;
  id?: unknown;
  commentUrl?: unknown;
  date?: unknown;
  text?: unknown;
  profileId?: unknown;
  profileName?: unknown;
  likesCount?: unknown;
  author?: unknown;
};

type ApifyPost = {
  id?: unknown;
  legacyId?: unknown;
  url?: unknown;
  time?: unknown;
  text?: unknown;
  user?: unknown;
  topComments?: unknown;
  likesCount?: unknown;
  topReactionsCount?: unknown;
  commentsCount?: unknown;
  sharesCount?: unknown;
  groupTitle?: unknown;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, limit = MAX_TEXT_LENGTH): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function sanitizeCommunityText(value: unknown, limit = MAX_TEXT_LENGTH): string {
  return text(value, limit)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email removed]')
    .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, '[phone removed]')
    .replace(/\b(?:EAC|WAC|LIN|SRC|NBC|MSC|IOE|YSC)\d{10}\b/gi, '[receipt number removed]')
    .replace(/\bN\d{10}\b/gi, '[SEVIS number removed]')
    .replace(/\bA[- ]?\d{8,9}\b/gi, '[A-number removed]')
    .replace(/\b(passport|case)\s*(?:number|no\.?|#)?\s*[:=-]\s*[A-Z0-9-]{6,}\b/gi, '$1 [number removed]');
}

function count(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? '0'), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function safeDate(value: unknown, fallback: string): string {
  const candidate = text(value, 64);
  return candidate && Number.isFinite(Date.parse(candidate)) ? new Date(candidate).toISOString() : fallback;
}

function safeUrl(value: unknown): string | null {
  const candidate = text(value, 2_048);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function stableSuffix(value: unknown): string {
  const normalized = text(value, 128).replace(/[^a-zA-Z0-9_-]/g, '');
  return normalized || crypto.randomUUID();
}

function pseudonymousId(value: unknown): string {
  const input = text(value, 256) || 'anonymous';
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function anonymousHandle(_value: unknown, suffix: string): string {
  return `community-member-${suffix.slice(-4)}`;
}

function makeTitle(body: string): string {
  const blocks = body.split(/\n{2,}/).map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const nonGreeting = blocks.filter((part) => !/^(hi|hello|hey|thanks|thank you|hi everyone)[!,.\s]*$/i.test(part));
  const candidate = nonGreeting.find((part) => part.includes('?')) ?? nonGreeting[0] ?? body;
  const questionEnd = candidate.indexOf('?');
  const sentenceEnd = candidate.search(/[.!](?:\s|$)/);
  const naturalEnd = questionEnd >= 24 ? questionEnd + 1 : sentenceEnd >= 24 ? sentenceEnd + 1 : 240;
  const clipped = candidate.slice(0, Math.min(naturalEnd, 240)).trim();
  return clipped.length < candidate.length && !/[?!.]$/.test(clipped) ? `${clipped.replace(/[,:;\s]+$/, '')}…` : clipped;
}

function inferCategory(body: string, tags: string[]): Pick<Question, 'destination_country' | 'visa_type'> {
  if (tags.includes('canada') && (tags.includes('work-permit') || tags.includes('study-permit'))) {
    return { destination_country: 'Canada', visa_type: tags.includes('study-permit') ? 'Study permit' : 'Canada work permit' };
  }
  if (tags.includes('schengen')) return { destination_country: 'Schengen Area', visa_type: 'Schengen' };
  if (tags.includes('h4')) return { destination_country: 'United States', visa_type: tags.includes('ead') ? 'H-4 / EAD' : 'H-4' };
  if (tags.includes('opt') || tags.includes('f1') || tags.includes('cpt')) return { destination_country: 'United States', visa_type: 'F-1 / OPT' };
  if (tags.includes('b1-b2')) return { destination_country: 'United States', visa_type: 'B1/B2' };
  if (tags.includes('h1b') || /\bi[ -]?140\b|\buscis\b/i.test(body)) return { destination_country: 'United States', visa_type: 'H-1B' };
  if (tags.includes('ds-160')) return { destination_country: 'United States', visa_type: 'B1/B2' };
  if (tags.includes('canada')) return { destination_country: 'Canada', visa_type: 'Canada visa' };
  return { destination_country: 'Global', visa_type: 'Visa discussion' };
}

function normalizeComment(comment: ApifyComment, questionId: string, createdAt: string, index: number): Answer | null {
  const body = sanitizeCommunityText(comment.text, MAX_COMMENT_LENGTH);
  if (!body) return null;
  const suffix = stableSuffix(comment.commentId ?? comment.id ?? `${questionId}-${index}`);
  const authorRecord = isRecord(comment.author) ? comment.author : {};
  const authorName = comment.profileName ?? authorRecord.name;
  const username = anonymousHandle(authorName, suffix);

  return {
    id: `apify-comment-${suffix}`,
    question_id: questionId,
    author_id: `apify-user-${pseudonymousId(comment.profileId ?? suffix)}`,
    author_username: username,
    author_avatar_seed: username,
    body,
    vote_score: count(comment.likesCount),
    is_accepted: false,
    status: 'active',
    created_at: safeDate(comment.date, createdAt),
    updated_at: safeDate(comment.date, createdAt),
    source: 'apify',
    source_url: safeUrl(comment.commentUrl),
  };
}

function normalizePost(post: ApifyPost, now: string): { question: Question; answers: Answer[] } | null {
  const body = sanitizeCommunityText(post.text);
  if (!body) return null;
  const suffix = stableSuffix(post.legacyId ?? post.id ?? body);
  const id = `apify-${suffix}`;
  const createdAt = safeDate(post.time, now);
  const tags = inferTags(body);
  const category = inferCategory(body, tags);
  const user = isRecord(post.user) ? post.user : {};
  const username = anonymousHandle(user.name, suffix);
  const rawComments = Array.isArray(post.topComments) ? post.topComments : [];
  const answers = rawComments
    .filter(isRecord)
    .map((comment, index) => normalizeComment(comment as ApifyComment, id, createdAt, index))
    .filter((answer): answer is Answer => answer !== null);

  return {
    question: {
      id,
      author_id: `apify-user-${pseudonymousId(user.id ?? suffix)}`,
      author_username: username,
      author_avatar_seed: username,
      title: makeTitle(body),
      body,
      ...category,
      tags,
      status: 'open',
      vote_score: Math.max(count(post.likesCount), count(post.topReactionsCount)),
      answer_count: Math.max(count(post.commentsCount), answers.length),
      view_count: count(post.sharesCount),
      accepted_answer_id: null,
      created_at: createdAt,
      updated_at: createdAt,
      source: 'apify',
      post_kind: PROMOTIONAL_CONTENT.test(body) ? 'promotion' : QUESTION_SIGNAL.test(body) ? 'question' : 'discussion',
      source_url: safeUrl(post.url),
      source_label: 'Facebook group',
      source_group: text(post.groupTitle, 120) || 'Visa community group',
    },
    answers,
  };
}

export async function GET() {
  if (process.env.APP_ENV === 'production' && process.env.IMPORTED_CONTENT_APPROVED !== 'true') {
    return NextResponse.json({ error: 'Imported content is not enabled for public distribution.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    });
  }
  if (process.env.COMMUNITY_SOURCE_MODE === 'snapshot') {
    return NextResponse.json(archive, { headers: {
      'Cache-Control': 'public, max-age=60, s-maxage=300',
      'X-Community-Source': 'collected-api-snapshot',
    } });
  }
  // Snapshot ingestion is the public-serving path. Never let public visits
  // trigger credentialed bulk upstream reads in production.
  if (process.env.APP_ENV === 'production' || process.env.APIFY_LIVE_FETCH_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Use the reviewed community snapshot.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    });
  }
  const token = process.env.APIFY_TOKEN;
  const configuredRunId = process.env.APIFY_RUN_ID || DEFAULT_RUN_ID;
  const actorId = process.env.APIFY_ACTOR_ID || DEFAULT_ACTOR_ID;
  const apiBase = process.env.APIFY_API_BASE_URL || 'https://api.apify.com/v2';
  let runId = configuredRunId;

  if (!token) {
    return NextResponse.json(
      { error: 'Community source is not configured.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    if (apiBase !== 'https://api.apify.com/v2') throw new Error('Unapproved upstream origin');
    const budget = { remaining: MAX_IMPORT_BYTES };
    if (process.env.APIFY_USE_LATEST_RUN !== 'false') {
      const latestResponse = await fetch(`${apiBase}/acts/${encodeURIComponent(actorId)}/runs/last?status=SUCCEEDED`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
        redirect: 'error',
        cache: 'no-store',
      });
      if (!latestResponse.ok) throw new Error(`Apify latest-run HTTP ${latestResponse.status}`);
      const latestPayload = await boundedJson(latestResponse, budget, 64 * 1024);
      const latest = isRecord(latestPayload) && isRecord(latestPayload.data) ? latestPayload.data : null;
      const latestId = latest ? text(latest.id, 128) : '';
      const latestStatus = latest ? text(latest.status, 32) : '';
      if (!latestId || latestStatus !== 'SUCCEEDED') throw new Error('Apify latest run is not ready.');
      runId = latestId;
    }

    const url = new URL(`${apiBase}/actor-runs/${encodeURIComponent(runId)}/dataset/items`);
    url.searchParams.set('limit', String(DATASET_PAGE_SIZE));
    url.searchParams.set('fields', [
      'id', 'legacyId', 'url', 'time', 'text', 'user', 'topComments', 'likesCount',
      'topReactionsCount', 'commentsCount', 'sharesCount', 'groupTitle',
    ].join(','));
    const payload: unknown[] = [];
    let sourceTotal: number | null = null;
    const signal = AbortSignal.timeout(30_000);
    for (let offset = 0; offset < MAX_DATASET_ITEMS; offset += DATASET_PAGE_SIZE) {
      url.searchParams.set('offset', String(offset));
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal,
        redirect: 'error',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`Apify dataset HTTP ${response.status}`);
      const page = await boundedJson(response, budget);
      if (!Array.isArray(page) || page.length > DATASET_PAGE_SIZE) throw new Error('Unexpected Apify dataset response.');
      const totalHeader = response.headers.get('x-apify-pagination-total');
      if (totalHeader !== null && /^\d+$/.test(totalHeader)) sourceTotal = Number(totalHeader);
      if (sourceTotal !== null && sourceTotal > MAX_DATASET_ITEMS) throw new Error('Dataset exceeds supported import size.');
      payload.push(...page);
      if (sourceTotal !== null ? payload.length >= sourceTotal : page.length < DATASET_PAGE_SIZE) break;
      if (offset + DATASET_PAGE_SIZE >= MAX_DATASET_ITEMS) throw new Error('Dataset completeness could not be verified');
    }
    if (sourceTotal !== null && payload.length !== sourceTotal) throw new Error('Incomplete dataset import.');

    const now = new Date().toISOString();
    const records = payload
      .filter(isRecord)
      .map((item) => normalizePost(item as ApifyPost, now))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    const normalized = [...new Map(records.map((item) => [item.question.id, item])).values()];
    const answersByQuestionId = Object.fromEntries(normalized.map(({ question, answers }) => [question.id, answers]));
    const feed: CommunityFeed = {
      questions: normalized.map(({ question }) => question),
      answersByQuestionId,
      fetchedAt: now,
      source: { name: 'Apify', runId, status: 'live', totalItems: sourceTotal ?? payload.length,
        importedItems: normalized.length, emptyItems: payload.length - records.length,
        duplicateItems: records.length - normalized.length },
    };

    return NextResponse.json(feed, {
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    // Do not log provider response bodies, URLs, content, or credentials.
    console.error(JSON.stringify({ event: 'apify_fetch_error' }));
    return NextResponse.json(
      { error: 'The community source is temporarily unavailable.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

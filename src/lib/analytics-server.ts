import type { ActivityTotals, AnalyticsPeriod, ImportHealth, OwnerAnalytics } from './analytics-types';

const headers = { 'Cache-Control': 'private, no-store', 'Vary': 'Authorization', 'X-Robots-Tag': 'noindex, nofollow' };
export function analyticsJson(value: unknown, status = 200) { return Response.json(value, { status, headers }); }

// No text, URLs, source-author identifiers or source credentials enter this summary.
export function summarizeImport(feed: { fetchedAt?: string; source?: { name?: string; capturedAt?: string; duplicateItems?: number; emptyItems?: number }; questions?: { created_at?: string }[] }, now = Date.now()): ImportHealth {
  if (feed.source?.name !== 'Apify') return {
    available: false, mode: 'No live import inventory (fixture or unavailable source)',
    capturedAt: null, newestPostAt: null, oldestPostAt: null, posts: null, duplicates: null,
    rejected: null, invalidDates: null, newestPostAgeHours: null, stale: true, staleAfterHours: 48,
  };
  const rows = feed.questions ?? [];
  const dates = rows.map(row => Date.parse(row.created_at ?? ''));
  const valid = dates.filter(date => Number.isFinite(date) && date <= now);
  const newest = valid.length ? Math.max(...valid) : null;
  const captured = Date.parse(feed.source?.capturedAt ?? feed.fetchedAt ?? '');
  const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
  const age = newest === null ? null : Math.max(0, (now - newest) / 3_600_000);
  return {
    available: true,
    mode: 'bundled snapshot (not a Supabase import)',
    capturedAt: Number.isFinite(captured) && captured <= now ? new Date(captured).toISOString() : null,
    newestPostAt: newest === null ? null : new Date(newest).toISOString(),
    oldestPostAt: valid.length ? new Date(Math.min(...valid)).toISOString() : null,
    posts: rows.length, duplicates: count(feed.source?.duplicateItems), rejected: count(feed.source?.emptyItems),
    invalidDates: dates.length - valid.length, newestPostAgeHours: age,
    stale: age === null || age > 48 || dates.length !== valid.length, staleAfterHours: 48,
  };
}

function invalidMetrics(): never { throw new Error('Invalid analytics contract'); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidMetrics();
  return value as Record<string, unknown>;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalidMetrics();
  return value;
}
function nullableMeasurement(value: unknown, maximum = Number.MAX_VALUE): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) return invalidMetrics();
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value)
    || !Number.isFinite(Date.parse(value))) return invalidMetrics();
  const normalized = new Date(value).toISOString();
  if (normalized.slice(0, 19) !== value.slice(0, 19)) return invalidMetrics();
  return normalized;
}
function activity(value: unknown): ActivityTotals {
  const row = record(value);
  return {
    members_joined: count(row.members_joined), questions_created: count(row.questions_created),
    experiences_created: count(row.experiences_created), answers_created: count(row.answers_created),
    imported_replies_created: count(row.imported_replies_created), distinct_contributors: count(row.distinct_contributors),
  };
}

/** Validate the entire v1 contract and copy only approved aggregate fields. */
export function sanitizeOwnerAnalytics(value: unknown, requestedDays: AnalyticsPeriod): OwnerAnalytics {
  const input = record(value), window = record(input.window), quality = record(input.quality), operations = record(input.operations);
  if (input.schema_version !== 1 || ![7, 30, 90].includes(requestedDays) || window.days !== requestedDays
    || window.timezone !== 'UTC' || window.includes_partial_today !== true) return invalidMetrics();
  const generatedAt = timestamp(input.generated_at), start = timestamp(window.start_inclusive), end = timestamp(window.end_exclusive);
  const startMs = Date.parse(start), endMs = Date.parse(end), dayMs = 86_400_000;
  if (!start.endsWith('T00:00:00.000Z') || generatedAt !== end || endMs <= startMs
    || Math.floor((endMs - startMs) / dayMs) !== requestedDays - 1) return invalidMetrics();
  const overview = activity(input.overview);
  const sanitizedQuality = {
    questions_in_window: count(quality.questions_in_window),
    questions_with_human_answer: count(quality.questions_with_human_answer),
    answer_rate_percent: nullableMeasurement(quality.answer_rate_percent, 100),
    median_first_answer_hours: nullableMeasurement(quality.median_first_answer_hours),
    unanswered_questions_current: count(quality.unanswered_questions_current),
  };
  if (sanitizedQuality.questions_in_window !== overview.questions_created
    || sanitizedQuality.questions_with_human_answer > sanitizedQuality.questions_in_window
    || (sanitizedQuality.questions_in_window === 0) !== (sanitizedQuality.answer_rate_percent === null)
    || (sanitizedQuality.questions_with_human_answer === 0) !== (sanitizedQuality.median_first_answer_hours === null)) return invalidMetrics();
  if (!Array.isArray(input.daily) || input.daily.length !== requestedDays) return invalidMetrics();
  const daily = input.daily.map((value, index) => {
    const row = record(value), expectedDate = new Date(startMs + index * dayMs).toISOString().slice(0, 10);
    if (row.date !== expectedDate) return invalidMetrics();
    return { date: expectedDate, ...activity(row) };
  });
  for (const field of ['members_joined', 'questions_created', 'experiences_created', 'answers_created', 'imported_replies_created'] as const) {
    if (daily.reduce((total, row) => total + row[field], 0) !== overview[field]) return invalidMetrics();
  }
  if (!Array.isArray(input.limitations) || input.limitations.length < 1 || input.limitations.length > 20) return invalidMetrics();
  const limitations = input.limitations.map(value => {
    if (typeof value !== 'string' || value.length < 1 || value.length > 1000) return invalidMetrics();
    return value;
  });
  return {
    schema_version: 1, generated_at: generatedAt,
    window: { days: requestedDays, start_inclusive: start, end_exclusive: end, timezone: 'UTC', includes_partial_today: true },
    overview, quality: sanitizedQuality,
    operations: {
      reports_received: count(operations.reports_received), reports_pending_current: count(operations.reports_pending_current),
      feedback_received: count(operations.feedback_received), feedback_pending_current: count(operations.feedback_pending_current),
    },
    daily, limitations,
  };
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error('Invalid analytics response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '', bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 262144) throw new Error('Analytics response too large');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function authorizedAnalytics(request: Request, config: { url?: string; key?: string }, fetcher: typeof fetch = fetch): Promise<{ response: Response } | { metrics: OwnerAnalytics }> {
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(authorization)) return { response: analyticsJson({ error: 'Sign in with the designated owner account.' }, 401) };
  const params = new URL(request.url).searchParams;
  const period = params.get('days') ?? '30';
  if (![...params.keys()].every(key => key === 'days') || params.getAll('days').length > 1 || !['7', '30', '90'].includes(period)) return { response: analyticsJson({ error: 'Choose 7, 30 or 90 days.' }, 400) };
  let origin: string;
  try {
    const url = new URL(config.url ?? '');
    if (url.protocol !== 'https:' || url.username || url.password || !config.key) throw new Error('Unavailable');
    origin = url.origin;
  } catch { return { response: analyticsJson({ error: 'Dashboard configuration is unavailable.' }, 503) }; }
  try {
    const options = { headers: { apikey: config.key!, Authorization: authorization }, cache: 'no-store' as const, redirect: 'error' as const, signal: AbortSignal.timeout(12000) };
    // Verify with Auth, then forward the caller JWT; never use service-role access.
    const identity = await fetcher(`${origin}/auth/v1/user`, options);
    if (!identity.ok) { await identity.body?.cancel(); return { response: analyticsJson({ error: identity.status >= 500 ? 'Account verification is temporarily unavailable.' : 'Your session expired. Please sign in again.' }, identity.status >= 500 ? 503 : 401) }; }
    const user = await boundedJson(identity) as { id?: unknown; is_anonymous?: boolean };
    if (typeof user.id !== 'string' || user.is_anonymous) return { response: analyticsJson({ error: 'Owner access required.' }, 403) };
    const result = await fetcher(`${origin}/rest/v1/rpc/owner_analytics`, { ...options, method: 'POST', headers: { ...options.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ period_days: Number(period) }) });
    if (!result.ok) {
      await result.body?.cancel();
      return { response: analyticsJson({ error: result.status === 401 || result.status === 403 ? 'Owner access required.' : 'Metrics are unavailable. No zero values have been substituted.' }, result.status === 401 || result.status === 403 ? 403 : 503) };
    }
    const metrics = sanitizeOwnerAnalytics(await boundedJson(result), Number(period) as AnalyticsPeriod);
    return { metrics };
  } catch { return { response: analyticsJson({ error: 'Metrics are unavailable. Please retry; no zero values have been substituted.' }, 503) }; }
}

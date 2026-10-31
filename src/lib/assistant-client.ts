// Browser-safe wire validation only. Do not import provider, retrieval or server auth code.
import type { AssistantClaim, AssistantCoverageReason, AssistantPostMatch, AssistantResult, AssistantSource } from './assistant-contract';

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, maximum: number, minimum = 1): value is string => typeof value === 'string' && value.length >= minimum && value.length <= maximum;
const id = (value: unknown): value is string => text(value, 200) && /^[A-Za-z0-9_:-]+$/.test(value);
const reference = (value: unknown): value is { questionId: string; sourceId: string } => object(value) && id(value.questionId) && id(value.sourceId);
const date = (value: unknown): value is string => text(value, 40) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const integer = (value: unknown, maximum: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const list = (value: unknown, maximum: number): value is unknown[] => Array.isArray(value) && value.length <= maximum;
const coverageReasons = new Set<AssistantCoverageReason>(['retrieval-limit', 'context-limit', 'missing-replies', 'unindexed-replies']);
export const safeAssistantHref = (value: unknown): value is string => typeof value === 'string' && /^\/(?:questions|experiences)\/[a-zA-Z0-9_-]+(?:#answer-[a-zA-Z0-9_-]+)?$/.test(value);

function source(value: unknown): AssistantSource | null {
  // Match the server's 24k summary context budget; the response byte cap remains separate.
  if (!object(value) || !id(value.id) || (value.kind !== 'question' && value.kind !== 'reply') || !id(value.questionId)
    || !(value.communityId === null || id(value.communityId)) || !text(value.title, 1000) || !text(value.body, 24_000, 0)
    || !date(value.createdAt) || !date(value.updatedAt) || !text(value.url, 500) || (value.provenance !== 'member' && value.provenance !== 'archive')
    || (value.parentContext !== undefined && !text(value.parentContext, 2000, 0))
    || (value.parentUpdatedAt !== undefined && !date(value.parentUpdatedAt))
    || (value.speakerRole !== undefined && value.speakerRole !== 'original-poster' && value.speakerRole !== 'member')) return null;
  return {
    id: value.id, kind: value.kind as AssistantSource['kind'], questionId: value.questionId, communityId: value.communityId,
    title: value.title, body: value.body, createdAt: value.createdAt, updatedAt: value.updatedAt,
    // Unsafe links remain non-navigable; the whole reply is not lost because a
    // single supplied URL is invalid. Never preserve an external/script URL.
    url: safeAssistantHref(value.url) ? value.url : '', provenance: value.provenance as AssistantSource['provenance'],
    ...(value.parentContext !== undefined ? { parentContext: value.parentContext as string } : {}),
    ...(value.parentUpdatedAt !== undefined ? { parentUpdatedAt: value.parentUpdatedAt as string } : {}),
    ...(value.speakerRole !== undefined ? { speakerRole: value.speakerRole as AssistantSource['speakerRole'] } : {}),
  };
}

function claims(value: unknown, maximum: number, sources: Set<string>, minimumEvidence = 1): AssistantClaim[] | null {
  if (!list(value, maximum)) return null;
  const result: AssistantClaim[] = [];
  for (const item of value) {
    if (!object(item) || !text(item.text, 700) || !item.text.trim() || !list(item.evidence, 4) || item.evidence.length < minimumEvidence) return null;
    const evidence: AssistantClaim['evidence'] = [];
    for (const citation of item.evidence) {
      if (!object(citation) || !id(citation.sourceId) || !sources.has(citation.sourceId) || !text(citation.quote, 400, 12)) return null;
      evidence.push({ sourceId: citation.sourceId, quote: citation.quote });
    }
    if (new Set(evidence.map(citation => citation.sourceId)).size < minimumEvidence) return null;
    result.push({ text: item.text, evidence });
  }
  return result;
}

/** Return a fresh allowlisted object, never an unchecked cast of response JSON. */
export function parseAssistantResult(value: unknown): AssistantResult | null {
  if (!object(value) || (value.status !== 'answered' && value.status !== 'insufficient')
    || (value.kind !== undefined && value.kind !== 'posts') || !list(value.sources, 48) || !list(value.unanswered, 4)
    || value.unanswered.some(item => !text(item, 400)) || !date(value.generatedAt) || typeof value.cached !== 'boolean' || !text(value.notice, 1000)
    || !object(value.coverage) || !integer(value.coverage.sourceCount, 48) || typeof value.coverage.partial !== 'boolean'
    || (value.resolvedQuestion !== undefined && !text(value.resolvedQuestion, 1200, 3))
    || (value.resolvedReferences !== undefined && (!list(value.resolvedReferences, 48) || !value.resolvedReferences.every(reference)))
    || (value.resolvedFocus !== undefined && !reference(value.resolvedFocus))) return null;
  const rawSources = value.sources.map(source);
  if (rawSources.some(item => item === null)) return null;
  const sources = rawSources as AssistantSource[];
  const sourceIds = new Set(sources.map(item => item.id));
  if (sourceIds.size !== sources.length || sources.length > value.coverage.sourceCount) return null;
  const parsedClaims = claims(value.claims, 6, sourceIds), disagreements = claims(value.disagreements, 3, sourceIds, 2);
  if (!parsedClaims || !disagreements) return null;
  const coverage = value.coverage;
  if (coverage.reasons !== undefined && (!list(coverage.reasons, 4) || coverage.reasons.some(reason => !coverageReasons.has(reason as AssistantCoverageReason)))) return null;
  if ((coverage.since !== undefined && !date(coverage.since)) || (coverage.until !== undefined && !date(coverage.until))
    || ((coverage.since === undefined) !== (coverage.until === undefined))
    || (typeof coverage.since === 'string' && typeof coverage.until === 'string' && Date.parse(coverage.since) >= Date.parse(coverage.until))) return null;
  const posts: AssistantPostMatch[] = [];
  if (value.kind === 'posts') {
    if (!list(value.posts, 48) || parsedClaims.length || disagreements.length || (value.postsIntro !== undefined && !text(value.postsIntro, 400))) return null;
    const seen = new Set<string>();
    for (const post of value.posts) {
      if (!object(post) || !id(post.questionId) || !id(post.sourceId) || !text(post.title, 1000) || !text(post.excerpt, 2000, 0)
        || !text(post.url, 500) || !date(post.createdAt)) return null;
      if (!safeAssistantHref(post.url) || seen.has(post.questionId)) continue;
      seen.add(post.questionId);
      posts.push({ questionId: post.questionId, sourceId: post.sourceId, title: post.title, excerpt: post.excerpt, url: post.url, createdAt: post.createdAt });
    }
  } else if (value.posts !== undefined || value.postsIntro !== undefined || (value.status === 'answered' && !parsedClaims.length && !disagreements.length)) return null;
  return {
    ...(typeof value.resolvedQuestion === 'string' ? { resolvedQuestion: value.resolvedQuestion } : {}),
    ...(Array.isArray(value.resolvedReferences) ? { resolvedReferences: value.resolvedReferences.map(item => ({ questionId: item.questionId as string, sourceId: item.sourceId as string })) } : {}),
    ...(reference(value.resolvedFocus) ? { resolvedFocus: { questionId: value.resolvedFocus.questionId, sourceId: value.resolvedFocus.sourceId } } : {}),
    ...(value.kind === 'posts' ? { kind: 'posts' as const, posts, ...(value.postsIntro !== undefined ? { postsIntro: value.postsIntro as string } : {}) } : {}), status: value.status as AssistantResult['status'],
    // A malformed insufficient result must never display unsupported claims.
    claims: value.status === 'insufficient' ? [] : parsedClaims, disagreements: value.status === 'insufficient' ? [] : disagreements,
    unanswered: value.unanswered as string[], sources,
    coverage: { sourceCount: value.coverage.sourceCount, partial: value.coverage.partial,
      ...(coverage.reasons !== undefined ? { reasons: [...new Set(coverage.reasons as AssistantCoverageReason[])] } : {}),
      ...(coverage.since !== undefined ? { since: coverage.since as string, until: coverage.until as string } : {}),
    }, generatedAt: value.generatedAt, cached: value.cached, notice: value.notice,
  };
}

export type AssistantFailureCode = 'invalid_request' | 'authentication' | 'permission' | 'rate_limit' | 'quota' | 'source_changed' | 'source_verification' | 'answer_length' | 'timeout' | 'cancelled' | 'unavailable';
export type AssistantClientFailure = { code: AssistantFailureCode; requestId?: string; retryAfterSeconds?: number; resetAt?: string };
const failureStatuses: Record<AssistantFailureCode, number[]> = {
  invalid_request: [400, 405, 413, 415, 422], authentication: [401], permission: [403], rate_limit: [429], quota: [429],
  source_changed: [409], source_verification: [502], answer_length: [502], timeout: [504], cancelled: [499], unavailable: [500, 502, 503],
};

export function parseAssistantFailure(status: number, value: unknown, retryAfter: string | null = null, now = Date.now()): AssistantClientFailure {
  const body = object(value) ? value : {};
  const candidate = typeof body.code === 'string' && Object.hasOwn(failureStatuses, body.code) ? body.code as AssistantFailureCode : undefined;
  const fallback = (Object.entries(failureStatuses) as [AssistantFailureCode, number[]][]).find(([, statuses]) => statuses.includes(status))?.[0] ?? 'unavailable';
  const code = candidate && failureStatuses[candidate].includes(status) ? candidate : fallback;
  const result: AssistantClientFailure = { code };
  if (typeof body.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId)) result.requestId = body.requestId;
  if (['quota', 'rate_limit', 'unavailable', 'timeout'].includes(code)) {
    const headerSeconds = retryAfter && /^\d{1,5}$/.test(retryAfter) ? Number(retryAfter) : undefined;
    const seconds = integer(body.retryAfterSeconds, 86400) && body.retryAfterSeconds > 0 ? body.retryAfterSeconds : headerSeconds;
    if (integer(seconds, 86400) && seconds > 0) result.retryAfterSeconds = seconds;
    if (date(body.resetAt) && new Date(body.resetAt).toISOString() === body.resetAt && Date.parse(body.resetAt) > now && Date.parse(body.resetAt) <= now + 86400000) result.resetAt = body.resetAt;
  }
  return result;
}

/** Fixed messages only: never render provider, database or proxy error text. */
export function assistantFailureMessage(failure: AssistantClientFailure): string {
  const messages: Record<AssistantFailureCode, string> = {
    invalid_request: 'Check your question and try again. Start a new chat if the conversation is too long.',
    authentication: 'Your session has expired. Sign in again.',
    permission: 'You don’t have access to this discussion.',
    rate_limit: 'You’ve reached the assistant limit.',
    quota: 'You’ve reached the assistant usage limit.',
    source_changed: 'This discussion changed. Try again for the latest answer.',
    source_verification: 'I couldn’t verify the sources for that answer. Try again.',
    answer_length: 'I couldn’t finish a concise answer. Your question is saved; try again.',
    timeout: 'That took too long. Your question is saved; try again.',
    cancelled: 'The response was stopped. You can retry or ask another question.',
    unavailable: 'The assistant is temporarily unavailable. Your question is saved.',
  };
  let message = messages[failure.code];
  if (failure.resetAt && failure.code === 'quota') return `${message} Available again after ${new Date(failure.resetAt).toISOString().slice(0, 16).replace('T', ' ')} UTC.`;
  if (failure.retryAfterSeconds) {
    const seconds = failure.retryAfterSeconds;
    const quantity = seconds < 60 ? seconds : seconds < 3600 ? Math.ceil(seconds / 60) : Math.ceil(seconds / 3600);
    const unit = seconds < 60 ? 'second' : seconds < 3600 ? 'minute' : 'hour';
    message += ` Try again in ${quantity} ${unit}${quantity === 1 ? '' : 's'}.`;
  } else if (['rate_limit', 'quota', 'unavailable'].includes(failure.code)) message += ' Please try again later.';
  return message;
}

/** Bound the entire JSON response before parsing, including malformed failures. */
export async function readAssistantJson(response: Response): Promise<unknown> {
  const maximum = 256000;
  if (Number(response.headers?.get('content-length')) > maximum) throw new Error('Assistant response exceeds limit');
  // The fallback also permits non-streaming fetch implementations and test doubles.
  if (!response.body) return response.json();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, content = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) throw new Error('Assistant response exceeds limit');
      content += decoder.decode(value, { stream: true });
    }
    return JSON.parse(content + decoder.decode());
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export const assistantProgressLabels: Record<string, string> = {
  request: 'Connecting…', authentication: 'Checking access…', quota: 'Preparing…',
  planning: 'Understanding your follow-up…', retrieval: 'Finding relevant discussions…',
  generation: 'Writing a source-backed answer…', validation: 'Checking citations…',
  review: 'Checking the answer against sources…', revalidation: 'Confirming sources are still available…',
};

/** Bounded framing, UTF-8 boundaries, and explicit completion prevent a dropped stream becoming a successful answer. */
export async function readAssistantResponse(response: Response, progress: (label: string) => void): Promise<{ status: number; value: unknown; retryAfter: string | null }> {
  if (!response.headers?.get('content-type')?.startsWith('application/x-ndjson')) {
    return { status: response.status, value: await readAssistantJson(response), retryAfter: response.headers?.get('retry-after') ?? null };
  }
  if (!response.body) throw new Error('Missing assistant stream');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '', bytes = 0, frames = 0;
  let completed: { status: number; value: unknown; retryAfter: string | null } | undefined;
  const frame = (line: string) => {
    if (!line.trim()) return;
    if (++frames > 64 || completed) throw new Error('Invalid assistant stream lifecycle');
    const event: unknown = JSON.parse(line);
    if (!object(event)) throw new Error('Invalid assistant stream');
    if (event.type === 'progress' && typeof event.stage === 'string' && Object.hasOwn(assistantProgressLabels, event.stage)) {
      progress(assistantProgressLabels[event.stage]);
    } else if (event.type === 'complete' && Number.isInteger(event.status) && Number(event.status) >= 200 && Number(event.status) <= 599) {
      completed = { status: Number(event.status), value: event.value, retryAfter: typeof event.retryAfter === 'string' && /^\d{1,5}$/.test(event.retryAfter) ? event.retryAfter : null };
    } else throw new Error('Unknown assistant event');
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 256000) throw new Error('Assistant response exceeds limit');
      pending += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) { frame(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
    }
    pending += decoder.decode();
    if (pending.trim()) frame(pending);
    if (!completed) throw new Error('Interrupted assistant stream');
    return completed;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

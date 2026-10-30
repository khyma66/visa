import type { AssistantAvailability, AssistantCorpus, AssistantRequest, AssistantResult } from './assistant-contract';
import { ASSISTANT_VERSION, AssistantError, assistantAvailability, assistantFingerprint, assistantPrompt, emptyAssistantResult, parseAssistantRequest, prepareAssistantCorpus, readBoundedJson, requireAssistantMode, validateAssistantOutput, type AssistantValidationCode } from './assistant-core';
import type { AssistantPrompt } from './assistant-provider';
import { assistantPostSearchQuery, buildAssistantPostSearchResult } from './assistant-search';
import { assistantReviewCorpus, assistantReviewPrompt, validateAssistantReview } from './assistant-review';
import { applyAssistantPlan, assistantPlanPrompt, parseAssistantPlan } from './assistant-planner';

type ReviewedCacheEntry = { result: AssistantResult; digest: string };
export type AssistantCache = { get(key: string): Promise<ReviewedCacheEntry | null>; put(key: string, value: ReviewedCacheEntry): Promise<void> };
export type AssistantFailureStage = 'request' | 'authentication' | 'planning' | 'retrieval' | 'quota' | 'generation' | 'validation' | 'review' | 'revalidation';
export type AssistantFailureCategory = 'invalid_request' | 'authentication' | 'permission' | 'rate_limit' | 'quota'
  | 'source_changed' | 'source_verification' | 'timeout' | 'cancelled' | 'unavailable';
type AssistantQuotaReason = 'user_daily_limit' | 'global_daily_limit' | 'user_minute_limit';
export type AssistantOperationContext = { signal: AbortSignal; requestId: string; startedAt: number };
export const ASSISTANT_REQUEST_BUDGET_MS = 45_000;
const failureMessages: Record<AssistantFailureCategory, string> = {
  invalid_request: 'Check your question and try again.', authentication: 'Your session has expired. Sign in again.',
  permission: 'You do not have access to this discussion.', rate_limit: 'Too many assistant requests. Please wait before trying again.',
  quota: 'The assistant usage limit has been reached. Please try again after it resets.',
  source_changed: 'The discussion changed while answering. Please ask again.',
  source_verification: 'The assistant could not verify this answer. Please try again.',
  timeout: 'The assistant took too long. Please try again.', cancelled: 'This assistant request was cancelled.',
  unavailable: 'The assistant is temporarily unavailable. Please try again shortly.',
};
export class AssistantRequestError extends AssistantError {
  constructor(public status: number, public category: AssistantFailureCategory,
    public metadata: { retryAfterSeconds?: number; resetAt?: string; quotaReason?: AssistantQuotaReason } = {}) {
    super(status, failureMessages[category], metadata.retryAfterSeconds);
  }
}
/** Keep only fixed denial reasons and a bounded future reset; never echo RPC text. */
export function assistantLimitError(value: unknown, fallback: 'rate_limit' | 'quota', now = Date.now()) {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const quotaReason = ['user_daily_limit', 'global_daily_limit', 'user_minute_limit'].includes(String(row.reason))
    ? row.reason as AssistantQuotaReason : undefined;
  const reset = typeof row.reset_at === 'string' ? Date.parse(row.reset_at) : NaN;
  const validReset = Number.isFinite(reset) && reset > now && reset <= now + 86_400_000;
  return new AssistantRequestError(429, quotaReason === 'user_minute_limit' ? 'rate_limit' : fallback, {
    ...(validReset ? { resetAt: new Date(reset).toISOString(), retryAfterSeconds: Math.ceil((reset - now) / 1000) }
      : fallback === 'rate_limit' || quotaReason === 'user_minute_limit' ? { retryAfterSeconds: 60 } : {}),
    ...(quotaReason ? { quotaReason } : {}),
  });
}
/** Every caller-JWT database/auth request observes both budgets and never redirects credentials. */
export function assistantDatabaseFetch(context: AssistantOperationContext, fetcher: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    context.signal.throwIfAborted();
    const supplied = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(8000), ...(supplied ? [supplied] : [])]);
    const response = await fetcher(input, { ...init, cache: 'no-store', redirect: 'manual', signal });
    context.signal.throwIfAborted();
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new AssistantRequestError(503, 'unavailable');
    }
    return response;
  };
}
export type AssistantDependencies = {
  availability(): AssistantAvailability;
  authenticate(token: string, context: AssistantOperationContext): Promise<{
    actor: string; corpus(input: AssistantRequest, signal: AbortSignal): Promise<AssistantCorpus>; reserve(signal: AbortSignal): Promise<boolean>;
  }>;
  generate(prompt: AssistantPrompt, signal: AbortSignal, context: AssistantOperationContext): Promise<string>;
  model: string;
  cache?: AssistantCache;
  /** Tests may shorten, never extend, the production budget. Not request-controlled. */
  deadlineMs?: number;
  reportFailure?(event: { stage: AssistantFailureStage; status: number; code?: AssistantValidationCode;
    category: AssistantFailureCategory; requestId: string; durationMs: number }): void;
  reportTiming?(event: { stage: AssistantFailureStage; status: number; requestId: string; durationMs: number }): void;
  reportStage?(event: { stage: AssistantFailureStage; requestId: string; durationMs: number }): void;
  /** Validated verdict counts only; never candidate text, sources or reviewer prose. */
  reportReview?(event: { requestId: string; recovery: boolean; fulfillsTask: boolean; supported: number; rejected: number; total: number }): void;
};
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Authorization' };
const semanticRepairInstruction = [
  'SEMANTIC REPAIR: Regenerate conservatively from the original supplied evidence. Use short, atomic facts explicitly attributed to the member who reported them. Preserve the requested task, relevant conflicting reports, uncertainty and qualifications.',
  'Select the supporting spans BEFORE writing each statement. Prefer a separate claim for each material event, outcome and qualification; do not compress a whole timeline into one plural sentence. When records repeat the same facts, use one representative report with singular attribution and its own event, outcome and qualification spans. Other reports remain necessary for distinct material facts, corrections or relevant differences. Never infer a count of people or corroboration from repeated records.',
  'For a multi-report statement, each described report needs supporting evidence. If its facts require more than four spans, split it into atomic claims or narrow attribution; do not omit outcome or qualification spans to fit. Citing only an opening event cannot represent the later outcomes or qualifications in the answer.',
  'For relevant different reports on the same issue, give a complete comparison explicitly stating both attributed positions and citing both sources. Prefer disagreements, but a supported comparison in claims is also valid; do not duplicate statements just to populate both sections. A substantive comparison alone may answer with unused claim slots null. Different individual timelines or outcomes alone do not prove a contradiction; preserve those personal experiences without inventing a conflict.',
  'State explicit limitations in the claim itself: an individual experience is not a standard or guaranteed timeline. Preserve explicit unknown outcomes, decision dates, durations or next steps that materially qualify the report; state that uncertainty in cited claim text beside the known status. Use an extra claim if needed: concision must not erase an important stated unknown.',
  'Do not add unstated durations, event dates, venues, roles, causes or outcomes. Keep each event attached to its own person and stated timing; an undated outcome stays undated. Do not infer relative timing such as the following day or week. Keep historical and current document versions and trips separate: a renewal validity or a current interview cannot be attached to earlier travel without an explicit source relationship. Omit nonessential background rather than constructing a connection between separately stated facts.',
  'Select only the supplied evidence span IDs; the server supplies the exact quotations. If the evidence cannot support a useful answer, return insufficient. No earlier draft or reviewer feedback is evidence.',
].join(' ');

/** Formatting/order changes alone must not buy another chance at reviewer approval. */
export function assistantCandidateIdentity(result: Pick<AssistantResult, 'status' | 'claims' | 'disagreements'>): string {
  const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
  const claims = (items: AssistantResult['claims']) => [...new Set(items.map(claim => JSON.stringify({
    text: normalize(claim.text),
    evidence: [...new Set(claim.evidence.map(item => JSON.stringify({ sourceId: item.sourceId, quote: normalize(item.quote) })))].sort(),
  })))].sort();
  // Moving an unchanged statement between presentation sections is not a
  // semantic correction and must not purchase another reviewer attempt.
  return JSON.stringify({ status: result.status, statements: claims([...result.claims, ...result.disagreements]) });
}

export function assistantResponse(value: unknown, status = 200, retryAfter?: number) {
  return Response.json(value, { status, headers: { ...headers, ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}) } });
}

/** Use the request URL, never caller-controlled Origin/forwarding headers. */
export function assistantProductionRequest(request: Request) {
  const { origin } = new URL(request.url);
  return origin === 'https://visathreads.com' || origin === 'https://www.visathreads.com';
}

export function createAssistantHandler(deps: AssistantDependencies) {
  // A pending operation belongs to exactly one request. Sharing its promise
  // also shares the owner's cancellation/lifetime. Durable quota still limits
  // concurrent requests; only completed, verified data may cross requests.
  return async function handle(request: Request, onProgress?: (stage: AssistantFailureStage) => void): Promise<Response> {
    const started = Date.now(), requestId = crypto.randomUUID();
    const controller = new AbortController();
    const cancel = () => controller.abort(new AssistantRequestError(499, 'cancelled'));
    if (request.signal.aborted) cancel();
    else request.signal.addEventListener('abort', cancel, { once: true });
    const configuredBudget = deps.deadlineMs;
    const budget = typeof configuredBudget === 'number' && Number.isFinite(configuredBudget)
      ? Math.max(1, Math.min(ASSISTANT_REQUEST_BUDGET_MS, Math.floor(configuredBudget))) : ASSISTANT_REQUEST_BUDGET_MS;
    const timer = setTimeout(() => controller.abort(new AssistantRequestError(504, 'timeout')), budget);
    // Relative date windows must remain identical across retrieval, rendering
    // and final source verification, even when a request crosses midnight.
    const signal = controller.signal, context = { signal, requestId, startedAt: started };
    let stage: AssistantFailureStage = 'request';
    let resolvedQuestion: string | undefined;
    let stageStarted = started;
    const transition = (next: AssistantFailureStage) => {
      const now = Date.now();
      try { deps.reportStage?.({ stage, requestId, durationMs: Math.max(0, now - stageStarted) }); } catch { /* Metrics are optional. */ }
      stage = next; stageStarted = now;
      try { onProgress?.(next); } catch { /* UI progress cannot change authorization or acceptance. */ }
    };
    // Race each boundary, not just fetch: SDK/cache implementations may ignore
    // abort. A late completion must never continue into quota/model/cache work.
    const bounded = async <T>(work: () => Promise<T>): Promise<T> => {
      signal.throwIfAborted();
      let stop: (() => void) | undefined;
      const aborted = new Promise<never>((_, reject) => {
        stop = () => reject(signal.reason);
        signal.addEventListener('abort', stop, { once: true });
      });
      try {
        // Attach both rejection handlers before invoking a dependency. It may
        // synchronously abort and throw, or reject after the race has settled.
        const pending = Promise.resolve().then(() => { signal.throwIfAborted(); return work(); });
        const result = await Promise.race([pending, aborted]);
        signal.throwIfAborted();
        return result;
      } finally { if (stop) signal.removeEventListener('abort', stop); }
    };
    const respond = (value: unknown, status = 200, retryAfter?: number) => {
      const durationMs = Math.max(0, Math.min(86_400_000, Date.now() - started));
      const response = assistantResponse(resolvedQuestion && status === 200 && value && typeof value === 'object'
        ? { ...value, resolvedQuestion } : value, status, retryAfter);
      response.headers.set('X-VisaThreads-Request-Id', requestId);
      response.headers.set('Server-Timing', `assistant;dur=${durationMs}`);
      try { deps.reportStage?.({ stage, requestId, durationMs: Math.max(0, Date.now() - stageStarted) }); } catch { /* Optional metrics. */ }
      try { deps.reportTiming?.({ stage, status, requestId, durationMs }); } catch { /* Optional, fixed metadata only. */ }
      return response;
    };
    try {
      signal.throwIfAborted();
      if (request.method !== 'POST') throw new AssistantError(405, 'Use POST for assistant requests.');
      if (!assistantProductionRequest(request) || !deps.availability().posts) throw new AssistantError(503, 'The assistant is not available yet.');
      const origin = request.headers.get('origin');
      if (origin && origin !== new URL(request.url).origin) throw new AssistantError(403, 'Open the assistant on VisaThreads to continue.');
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new AssistantError(415, 'Send a JSON request.');
      const token = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9._-]{20,8192})$/)?.[1];
      if (!token) throw new AssistantError(401, 'Log in to use the assistant.');
      let input = parseAssistantRequest(await bounded(() => readBoundedJson(request, 24_000)), started);
      requireAssistantMode(input, deps.availability());
      transition('authentication');
      const session = await bounded(() => deps.authenticate(token, context));
      let reserved = false;
      if (input.mode === 'ask' && input.scope.kind === 'public' && input.conversation?.length) {
        input = { ...input, previousPosts: input.previousPosts ?? input.conversationReferences };
        transition('quota');
        if (!await bounded(() => session.reserve(signal))) throw new AssistantRequestError(429, 'quota');
        reserved = true;
        transition('planning');
        const rawPlan = await bounded(() => deps.generate(assistantPlanPrompt(input), signal, context));
        const plan = parseAssistantPlan(rawPlan, input);
        if (plan.action === 'clarify') return respond({ ...emptyAssistantResult({ sources: [], partial: false }), unanswered: [plan.clarification!] });
        input = applyAssistantPlan(input, plan);
        resolvedQuestion = plan.query;
      }
      transition('retrieval');
      const original = await bounded(() => session.corpus(input, signal));
      if (assistantPostSearchQuery(input, started)) {
        // Finding existing posts does not require text generation or model quota.
        // Still authenticate, rate-limit and recheck the caller-visible corpus.
        const fingerprint = await bounded(() => assistantFingerprint(original));
        const result = buildAssistantPostSearchResult(input, original, started);
        signal.throwIfAborted();
        transition('revalidation');
        if (await bounded(async () => assistantFingerprint(await bounded(() => session.corpus(input, signal)))) !== fingerprint) {
          throw new AssistantError(409, 'The discussion changed while answering. Please ask again.');
        }
        signal.throwIfAborted();
        return respond(result);
      }
      const corpus = prepareAssistantCorpus(original, input);
      if (!corpus.sources.length) return respond(emptyAssistantResult(corpus, input));
      const fingerprint = await bounded(() => assistantFingerprint(original));
      // Include identity, full untruncated source contents, scope, prompt version and model.
      // Retrieval happens BEFORE every cache read, so removed/hidden data cannot return from cache.
      const key = await bounded(() => assistantFingerprint({ actor: session.actor, input, fingerprint, version: ASSISTANT_VERSION, model: deps.model }));
      const revalidate = async () => {
        transition('revalidation');
        const current = await bounded(() => session.corpus(input, signal));
        if (await bounded(() => assistantFingerprint(current)) !== fingerprint) throw new AssistantError(409, 'The discussion changed while answering. Please ask again.');
      };
      let verifiedCache: AssistantResult | undefined;
      try {
        const cached = deps.cache ? await bounded(() => deps.cache!.get(key)) : null;
        if (cached?.result && cached.digest === await bounded(() => assistantFingerprint({ key, result: cached.result }))) {
          const cachedTime = Date.parse(cached.result.generatedAt);
          if (cachedTime <= Date.now() && Date.now() - cachedTime < 300_000) {
            // Revalidate model structure and source quotes rather than blindly trusting stored JSON.
            verifiedCache = validateAssistantOutput(JSON.stringify(cached.result), corpus, cachedTime, input);
          }
        }
      } catch { signal.throwIfAborted(); /* Only cache storage/structure failures are misses. */ }
      if (verifiedCache) {
        // Permission, rate-limit and availability failures here must propagate:
        // never treat a failed live access check as a cache miss and regenerate.
        await revalidate();
        return respond({ ...verifiedCache, cached: true });
      }
      const originalPrompt = assistantPrompt(input, corpus, original);
      if (!originalPrompt.evidenceSpans.length) {
        // A clipped, overlong, interrogative or instruction-only passage is
        // not made quotable merely by asking a model to rewrite it.
        await revalidate();
        const empty = emptyAssistantResult(corpus);
        return respond({ ...empty, coverage: { ...empty.coverage, sourceCount: corpus.sources.length },
          unanswered: ['I couldn’t find enough complete, verifiable details in these discussions to answer accurately. Try a more specific question or a different post.'] });
      }
      transition('quota');
      if (!reserved && !await bounded(() => session.reserve(signal))) throw new AssistantRequestError(429, 'quota');
      const generateCandidate = async (recovery = false) => {
        transition('generation');
        const raw = await bounded(() => deps.generate({ ...originalPrompt,
          ...(recovery ? { system: `${originalPrompt.system}\n${semanticRepairInstruction}`, maxAttempts: 1 as const } : {}),
          validateOutput: (candidate: string) => { validateAssistantOutput(candidate, corpus, Date.now(), input); },
        }, signal, context));
        transition('validation');
        return validateAssistantOutput(raw, corpus, Date.now(), input);
      };
      const reviewCandidate = async (candidate: AssistantResult, recovery = false) => {
        signal.throwIfAborted();
        transition('review');
        const reviewCorpus = assistantReviewCorpus(original, corpus, candidate);
        if (!reviewCorpus) {
          return { result: { ...candidate, status: 'insufficient' as const, claims: [], disagreements: [], sources: [],
            unanswered: ['I couldn’t check enough of the original discussion to answer that accurately. Try a more specific question.'] }, rejected: false };
        }
        const review = await bounded(() => deps.generate({ ...assistantReviewPrompt(input, reviewCorpus, candidate),
          ...(recovery ? { maxAttempts: 1 as const } : {}),
        }, signal, context));
        // Malformed reviews and transport failures throw, never trigger recovery.
        const result = validateAssistantReview(review, candidate);
        const verdict = JSON.parse(review) as { fulfillsTask: boolean; checks: { supported: boolean }[] };
        try { deps.reportReview?.({ requestId, recovery, fulfillsTask: verdict.fulfillsTask,
          supported: verdict.checks.filter(check => check.supported).length,
          rejected: verdict.checks.filter(check => !check.supported).length, total: verdict.checks.length });
        } catch { /* Observability must never change acceptance or the response. */ }
        return { result, rejected: result.status === 'insufficient' };
      };
      let result = await generateCandidate();
      if (result.claims.length || result.disagreements.length) {
        const rejectedCandidate = result;
        const checked = await reviewCandidate(result);
        result = checked.result;
        if (checked.rejected) {
          // One regeneration only after a valid negative semantic verdict.
          // Reuse ORIGINAL evidence, never the rejected draft or review text.
          // Each recovery inference has one transport attempt: maximum 6
          // requests including the initial answer/review format repairs,
          // plus at most one contextual planning request on conversational turns.
          const replacement = await generateCandidate(true);
          if (!replacement.claims.length && !replacement.disagreements.length) result = replacement;
          else if (assistantCandidateIdentity(replacement) !== assistantCandidateIdentity(rejectedCandidate)) {
            result = (await reviewCandidate(replacement, true)).result;
          }
          // Identical/reordered facts retain the first insufficient result;
          // never rerun review until a random verdict happens to approve it.
        }
      }
      // Exactly one post-generation, caller-scoped fingerprint/access check.
      await revalidate();
      try {
        if (deps.cache) await bounded(async () => deps.cache!.put(key, { result, digest: await bounded(() => assistantFingerprint({ key, result })) }));
      } catch { signal.throwIfAborted(); /* Caching is optional. */ }
      signal.throwIfAborted();
      return respond(result);
    } catch (failure) {
      const error = signal.aborted ? signal.reason : failure;
      const status = error instanceof AssistantError ? error.status : 503;
      const category: AssistantFailureCategory = error instanceof AssistantRequestError ? error.category
        : status === 401 ? 'authentication' : status === 403 ? 'permission' : status === 409 ? 'source_changed'
        : status === 429 ? ((stage as AssistantFailureStage) === 'quota' ? 'quota' : 'rate_limit') : status === 502 ? 'source_verification'
        : status >= 400 && status < 500 ? 'invalid_request' : 'unavailable';
      const durationMs = Math.max(0, Math.min(86_400_000, Date.now() - started));
      if (status >= 500) {
        // Fixed metadata only: never expose prompts, source contents, tokens or provider errors.
        try { deps.reportFailure?.({ stage, status, category, requestId, durationMs,
          ...(error instanceof AssistantError && error.code ? { code: error.code } : {}) }); } catch { /* telemetry cannot change the response */ }
      }
      const retry = error instanceof AssistantError ? error.retryAfter : undefined;
      const retryAfterSeconds = typeof retry === 'number' && Number.isInteger(retry) && retry >= 1 && retry <= 86_400 ? retry : undefined;
      const metadata = error instanceof AssistantRequestError ? error.metadata : {};
      const reset = metadata.resetAt ? Date.parse(metadata.resetAt) : NaN;
      const resetAt = Number.isFinite(reset) && reset > Date.now() && reset <= Date.now() + 86_400_000 ? new Date(reset).toISOString() : undefined;
      const quotaReason = ['user_daily_limit', 'global_daily_limit', 'user_minute_limit'].includes(metadata.quotaReason ?? '') ? metadata.quotaReason : undefined;
      return respond({ error: failureMessages[category], code: category, requestId,
        ...(retryAfterSeconds ? { retryAfterSeconds } : {}), ...(resetAt ? { resetAt } : {}), ...(quotaReason ? { quotaReason } : {}) }, status, retryAfterSeconds);
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', cancel);
    }
  };
}

/** Internal cache only. Browser responses always remain private/no-store. */
export function cloudflareAssistantCache(): AssistantCache {
  type EdgeCache = { match(key: Request): Promise<Response | undefined>; put(key: Request, value: Response): Promise<void> };
  const cache = typeof caches === 'undefined' ? undefined : (caches as unknown as { default?: EdgeCache }).default;
  const key = (hash: string) => new Request(`https://assistant-cache.invalid/v1/${hash}`);
  return {
    async get(hash) { const response = await cache?.match(key(hash)); return response?.ok ? await readBoundedJson(response, 140_000) as ReviewedCacheEntry : null; },
    async put(hash, value) { await cache?.put(key(hash), Response.json(value, { headers: { 'Cache-Control': 'public, max-age=300' } })); },
  };
}

export function configuredAvailability(env: Record<string, string | undefined>) {
  let valid = false;
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    valid = env.NEXT_PUBLIC_SITE_URL === 'https://visathreads.com' && env.ASSISTANT_PROJECT_REF === 'cycnichledvqbxevrwnt' && url.origin === `https://${env.ASSISTANT_PROJECT_REF}.supabase.co`
      && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash && !!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  } catch { /* Fail closed until this deployment explicitly selects a project. */ }
  if (!valid || !['workers-ai', 'openai', 'groq'].includes(env.ASSISTANT_PROVIDER ?? '') || (env.ASSISTANT_PROVIDER === 'openai' && !env.OPENAI_API_KEY) || (env.ASSISTANT_PROVIDER === 'groq' && !env.GROQ_API_KEY)) return { posts: false, communities: false, catchup: false };
  return assistantAvailability(env);
}

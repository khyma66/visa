import type { AssistantAvailability, AssistantCorpus, AssistantRequest, AssistantResult } from './assistant-contract';
import { ASSISTANT_VERSION, AssistantError, assistantAvailability, assistantFingerprint, assistantPrompt, emptyAssistantResult, parseAssistantRequest, prepareAssistantCorpus, readBoundedJson, requireAssistantMode, validateAssistantOutput } from './assistant-core';
import type { AssistantPrompt } from './assistant-provider';

export type AssistantCache = { get(key: string): Promise<AssistantResult | null>; put(key: string, value: AssistantResult): Promise<void> };
export type AssistantDependencies = {
  availability(): AssistantAvailability;
  authenticate(token: string): Promise<{ actor: string; corpus(input: AssistantRequest): Promise<AssistantCorpus>; reserve(): Promise<boolean> }>;
  generate(prompt: AssistantPrompt, signal: AbortSignal): Promise<string>;
  model: string;
  cache?: AssistantCache;
};
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Authorization' };
export function assistantResponse(value: unknown, status = 200, retryAfter?: number) {
  return Response.json(value, { status, headers: { ...headers, ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}) } });
}

/** Use the request URL, never caller-controlled Origin/forwarding headers. */
export function assistantProductionRequest(request: Request) {
  const { origin } = new URL(request.url);
  return origin === 'https://visathreads.com' || origin === 'https://www.visathreads.com';
}

export function createAssistantHandler(deps: AssistantDependencies) {
  // Coalesce duplicate clicks within an isolate; durable quota remains authoritative across instances.
  const inflight = new Map<string, Promise<AssistantResult>>();
  return async function handle(request: Request): Promise<Response> {
    try {
      if (request.method !== 'POST') throw new AssistantError(405, 'Use POST for assistant requests.');
      if (!assistantProductionRequest(request) || !deps.availability().posts) throw new AssistantError(503, 'The assistant is not available yet.');
      const origin = request.headers.get('origin');
      if (origin && origin !== new URL(request.url).origin) throw new AssistantError(403, 'Open the assistant on VisaThreads to continue.');
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new AssistantError(415, 'Send a JSON request.');
      const token = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9._-]{20,8192})$/)?.[1];
      if (!token) throw new AssistantError(401, 'Log in to use the assistant.');
      const input = parseAssistantRequest(await readBoundedJson(request, 12_000));
      requireAssistantMode(input, deps.availability());
      const session = await deps.authenticate(token);
      request.signal.throwIfAborted();
      const original = await session.corpus(input);
      const corpus = prepareAssistantCorpus(original);
      if (!corpus.sources.length) return assistantResponse(emptyAssistantResult(corpus));
      const fingerprint = await assistantFingerprint(original);
      // Include identity, full untruncated source contents, scope, prompt version and model.
      // Retrieval happens BEFORE every cache read, so removed/hidden data cannot return from cache.
      const key = await assistantFingerprint({ actor: session.actor, input, fingerprint, version: ASSISTANT_VERSION, model: deps.model });
      const revalidate = async () => {
        const current = await session.corpus(input);
        if (await assistantFingerprint(current) !== fingerprint) throw new AssistantError(409, 'The discussion changed while answering. Please ask again.');
      };
      try {
        const cached = await deps.cache?.get(key);
        if (cached) {
          const cachedTime = Date.parse(cached.generatedAt);
          if (cachedTime <= Date.now() && Date.now() - cachedTime < 300_000) {
            // Revalidate model structure and source quotes rather than blindly trusting stored JSON.
            const verified = validateAssistantOutput(JSON.stringify(cached), corpus, cachedTime);
            await revalidate();
            return assistantResponse({ ...verified, cached: true });
          }
        }
      } catch (error) { if (error instanceof AssistantError && error.status === 409) throw error; /* cache failures are misses */ }
      let operation = inflight.get(key);
      if (!operation) {
        if (inflight.size >= 100) throw new AssistantError(429, 'The assistant is busy. Please retry shortly.', 30);
        operation = (async () => {
          if (!await session.reserve()) throw new AssistantError(429, 'The assistant usage limit has been reached. Please try again later.', 60);
          const raw = await deps.generate(assistantPrompt(input, corpus), request.signal);
          const result = validateAssistantOutput(raw, corpus);
          await revalidate();
          try { await deps.cache?.put(key, result); } catch { /* caching is optional */ }
          return result;
        })();
        inflight.set(key, operation);
        void operation.finally(() => inflight.delete(key)).catch(() => {});
      }
      const result = await operation;
      await revalidate();
      request.signal.throwIfAborted();
      return assistantResponse(result);
    } catch (error) {
      if (error instanceof AssistantError) return assistantResponse({ error: error.message }, error.status, error.retryAfter);
      return assistantResponse({ error: 'The assistant could not complete this request. Please try again shortly.' }, 503);
    }
  };
}

/** Internal cache only. Browser responses always remain private/no-store. */
export function cloudflareAssistantCache(): AssistantCache {
  type EdgeCache = { match(key: Request): Promise<Response | undefined>; put(key: Request, value: Response): Promise<void> };
  const cache = typeof caches === 'undefined' ? undefined : (caches as unknown as { default?: EdgeCache }).default;
  const key = (hash: string) => new Request(`https://assistant-cache.invalid/v1/${hash}`);
  return {
    async get(hash) { const response = await cache?.match(key(hash)); return response?.ok ? await readBoundedJson(response, 140_000) as AssistantResult : null; },
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
  if (!valid || !['workers-ai', 'openai'].includes(env.ASSISTANT_PROVIDER ?? '') || (env.ASSISTANT_PROVIDER === 'openai' && !env.OPENAI_API_KEY)) return { posts: false, communities: false, catchup: false };
  return assistantAvailability(env);
}

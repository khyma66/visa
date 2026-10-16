import { AssistantError, readBoundedJson } from './assistant-core';
import models from './assistant-models.json';

export type AssistantPrompt = { system: string; user: string; sourceIds?: string[]; outputKind?: 'review'; reviewIds?: string[] };
export type WorkersAiBinding = { run(model: string, input: Record<string, unknown>): Promise<unknown> };
export type AssistantProviderFailure = 'missing_binding' | 'missing_key' | 'invalid_key_format' | 'network_error' | 'unsupported_redirect' | 'illegal_invocation' | 'timeout' | 'cancelled' | 'provider_error' | 'rate_limited' | 'authentication_failed' | 'invalid_request' | 'incomplete_output' | 'empty_output' | 'oversized_output';
export const WORKERS_ASSISTANT_MODEL = models.answer;
export const WORKERS_ASSISTANT_PROFILE = JSON.stringify(models);
export const GROQ_ASSISTANT_MODEL = models.groq.answer;
export const GROQ_ASSISTANT_PROFILE = JSON.stringify(models.groq);
export type AssistantTransport = { status: number; tokenLimit?: number; remainingTokens?: number; retryAfterSeconds?: number };
export type AssistantUsage = { model: string; stage: 'answer' | 'review'; inputTokens?: number; outputTokens?: number; durationMs: number };
export const OPENAI_ASSISTANT_MODEL = 'gpt-6-luna';
const evidence = { type: 'object', additionalProperties: false, required: ['sourceId', 'quote'], properties: { sourceId: { type: 'string', minLength: 1 }, quote: { type: 'string', minLength: 12, maxLength: 400 } } };
const claim = { type: 'object', additionalProperties: false, required: ['text', 'evidence'], properties: { text: { type: 'string', minLength: 1, maxLength: 700 }, evidence: { type: 'array', minItems: 1, maxItems: 4, items: evidence } } };
export const ASSISTANT_OUTPUT_SCHEMA = { type: 'object', additionalProperties: false, required: ['status', 'disagreements', 'claims', 'unanswered'], properties: {
  status: { type: 'string', enum: ['answered', 'insufficient'] },
  disagreements: { type: 'array', maxItems: 3, description: 'Populate this FIRST. Every comparison of contradictory or conflicting reports belongs here, with exact quotes and source IDs from at least two disagreeing sources. An empty array means no relevant conflicting reports were found. Do not move such comparisons into claims instead.', items: { ...claim, properties: { ...claim.properties, evidence: { ...claim.properties.evidence, minItems: 2 } } } },
  claims: { type: 'array', maxItems: 6, description: 'Individual attributed factual reports supported by source quotes. When reports conflict, state each side individually here and put the comparison in disagreements. Do not use a conflict-comparison claim as a substitute for filling disagreements.', items: claim },
  unanswered: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 400 } },
} };

/** Constrain citations to the server-selected corpus before generation. */
export function assistantOutputSchema(prompt: AssistantPrompt) {
  if (prompt.outputKind === 'review') {
    const ids = [...new Set(prompt.reviewIds ?? [])];
    if (!ids.length || ids.length > 9) throw new AssistantError(502, 'The assistant could not verify this answer. Please try again.');
    return { type: 'object', additionalProperties: false, required: ['checks', 'fulfillsTask'], properties: {
      checks: { type: 'array', minItems: ids.length, maxItems: ids.length, items: {
        type: 'object', additionalProperties: false, required: ['id', 'supported'],
        properties: { id: { type: 'string', enum: ids }, supported: { type: 'boolean' } },
      } },
      fulfillsTask: { type: 'boolean', description: 'Whether the candidate satisfies the supplied task: answer, discussion summary, or interval catch-up. Summary and catch-up do not require a user question.' },
    } };
  }
  if (!prompt.sourceIds?.length) return ASSISTANT_OUTPUT_SCHEMA;
  const sourceId = { ...evidence.properties.sourceId, enum: [...new Set(prompt.sourceIds)] };
  const boundedEvidence = { ...evidence, properties: { ...evidence.properties, sourceId } };
  const boundedClaim = (minimum: number) => ({ ...claim, properties: { ...claim.properties, evidence: { ...claim.properties.evidence, minItems: minimum, items: boundedEvidence } } });
  return { ...ASSISTANT_OUTPUT_SCHEMA, properties: { ...ASSISTANT_OUTPUT_SCHEMA.properties,
    claims: { ...ASSISTANT_OUTPUT_SCHEMA.properties.claims, items: boundedClaim(1) },
    disagreements: { ...ASSISTANT_OUTPUT_SCHEMA.properties.disagreements, items: boundedClaim(2) },
  } };
}

export function providerModel(provider: string | undefined): string {
  if (provider === 'workers-ai') return WORKERS_ASSISTANT_MODEL;
  if (provider === 'groq') return GROQ_ASSISTANT_MODEL;
  if (provider === 'openai') return OPENAI_ASSISTANT_MODEL;
  throw new AssistantError(503, 'The assistant is not configured yet.');
}

export function providerCacheKey(provider: string | undefined): string {
  if (provider === 'groq') return `groq:${GROQ_ASSISTANT_PROFILE}`;
  return provider === 'workers-ai' ? WORKERS_ASSISTANT_PROFILE : providerModel(provider);
}

/** Route complete large/multilingual inputs before inference, never truncate evidence or retry. */
export function workersAssistantRequest(prompt: AssistantPrompt) {
  const review = prompt.outputKind === 'review';
  const schema = assistantOutputSchema(prompt);
  const schemaName = review ? 'discussion_answer_review' : 'discussion_answer';
  const selected = review ? models.review : models.answer;
  const response_format = { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } };
  const messages = [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }];
  // UTF-8 bytes conservatively bound byte-pair input tokens, including the
  // schema. Leave room in Qwen's 32K window for output and template overhead.
  const inputBytes = new TextEncoder().encode(JSON.stringify({ messages, response_format })).byteLength;
  const model = selected === '@cf/qwen/qwen3-30b-a3b-fp8' && inputBytes > models.qwenInputByteLimit ? models.longContext : selected;
  const qwen = model === '@cf/qwen/qwen3-30b-a3b-fp8';
  if (qwen) messages[0].content += '\n/no_think';
  return { model, input: {
    messages, response_format,
    max_tokens: review ? models.reviewMaxTokens : models.answerMaxTokens,
    ...(qwen ? {} : { reasoning_effort: 'low', store: false }),
    temperature: 0, seed: 39173,
  } };
}

export async function runAssistantModel(prompt: AssistantPrompt, options: {
  provider: string | undefined; apiKey?: string; binding?: WorkersAiBinding; signal?: AbortSignal;
  fetcher?: typeof fetch;
  reportFailure?(reason: AssistantProviderFailure): void;
  reportUsage?(usage: AssistantUsage): void;
  reportTransport?(value: AssistantTransport): void;
}): Promise<string> {
  const model = providerModel(options.provider);
  const schema = assistantOutputSchema(prompt);
  const review = prompt.outputKind === 'review';
  const schemaName = review ? 'discussion_answer_review' : 'discussion_answer';
  const timeout = AbortSignal.timeout(25_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const unavailable = () => new AssistantError(503, 'The assistant is temporarily unavailable. Please try again shortly.');
  let reason: AssistantProviderFailure = 'provider_error';
  const fail = (value: AssistantProviderFailure): never => { reason = value; throw unavailable(); };
  try {
    signal.throwIfAborted();
    if (options.provider === 'workers-ai') {
      if (!options.binding) return fail('missing_binding');
      const request = workersAssistantRequest(prompt);
      const started = Date.now();
      // Bounded single inference. No retries or automatic escalation multiplying costs.
      let stop: (() => void) | undefined;
      const aborted = new Promise<never>((_, reject) => { stop = () => reject(unavailable()); signal.addEventListener('abort', stop, { once: true }); });
      try {
        const value = await Promise.race([options.binding.run(request.model, request.input), aborted]);
        if (value && typeof value === 'object') {
          const payload = value as { response?: unknown; choices?: { finish_reason?: string; message?: { content?: unknown } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
          const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : undefined;
          // Numbers and fixed labels only: no questions, evidence, identities or model reasoning.
          try { options.reportUsage?.({ model: request.model, stage: review ? 'review' : 'answer', inputTokens: count(payload.usage?.prompt_tokens), outputTokens: count(payload.usage?.completion_tokens), durationMs: Date.now() - started }); } catch { /* metrics cannot change the answer */ }
          const first = payload.choices?.[0];
          if (first && first.finish_reason !== 'stop') fail('incomplete_output');
          const content = first?.message?.content ?? payload.response;
          const result = typeof content === 'string' ? content : content ? JSON.stringify(content) : '';
          if (result && result.length <= 24_000) return result;
          if (result.length > 24_000) fail('oversized_output');
        }
        fail('empty_output');
      } finally { if (stop) signal.removeEventListener('abort', stop); }
    }
    if (!options.apiKey) fail('missing_key');
    if (options.provider === 'groq') {
      if (options.apiKey !== options.apiKey.trim() || /[^\x21-\x7e]/.test(options.apiKey)) return fail('invalid_key_format');
      const selected = review ? models.groq.review : models.groq.answer;
      const started = Date.now();
      reason = 'network_error';
      const response = await (options.fetcher ?? fetch)('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selected,
          messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
          response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
          reasoning_effort: models.groq.reasoningEffort, include_reasoning: false,
          max_completion_tokens: review ? models.groq.reviewMaxTokens : models.groq.answerMaxTokens,
          temperature: 0, seed: 39173,
        }),
      });
      reason = 'provider_error';
      const numberHeader = (name: string) => {
        const raw = response.headers.get(name);
        const value = raw === null ? NaN : Number(raw);
        return Number.isFinite(value) && value >= 0 && value <= 1_000_000_000 ? value : undefined;
      };
      // Fixed numeric telemetry only. Never retain provider error bodies or credentials.
      try { options.reportTransport?.({ status: response.status, tokenLimit: numberHeader('x-ratelimit-limit-tokens'), remainingTokens: numberHeader('x-ratelimit-remaining-tokens'), retryAfterSeconds: numberHeader('retry-after') }); } catch { /* optional metrics */ }
      if (!response.ok) {
        await response.body?.cancel();
        return fail(response.status === 429 ? 'rate_limited' : response.status === 401 || response.status === 403 ? 'authentication_failed' : response.status === 400 ? 'invalid_request' : 'provider_error');
      }
      const data = await readBoundedJson(response, 100_000) as { choices?: { finish_reason?: string; message?: { content?: unknown } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
      const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : undefined;
      try { options.reportUsage?.({ model: selected, stage: review ? 'review' : 'answer', inputTokens: count(data.usage?.prompt_tokens), outputTokens: count(data.usage?.completion_tokens), durationMs: Date.now() - started }); } catch { /* optional metrics */ }
      const first = data.choices?.[0];
      if (first?.finish_reason !== 'stop') return fail('incomplete_output');
      const content = first.message?.content;
      if (typeof content !== 'string' || !content.trim()) return fail('empty_output');
      if (content.length > 24_000) return fail('oversized_output');
      return content;
    }
    const response = await (options.fetcher ?? fetch)('https://api.openai.com/v1/responses', {
      method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, store: false, reasoning: { effort: 'none' }, max_output_tokens: review ? 1200 : 1600,
        input: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
        text: { format: { type: 'json_schema', name: schemaName, strict: true, schema } },
      }),
    });
    if (!response.ok) { await response.body?.cancel(); throw unavailable(); }
    const data = await readBoundedJson(response, 100_000) as { status?: string; output?: { type?: string; content?: { type?: string; text?: string }[] }[] };
    if (data.status !== 'completed' || !Array.isArray(data.output)) return fail('incomplete_output');
    const output = data.output.filter(item => item.type === 'message').flatMap(item => item.content ?? []).filter(part => part.type === 'output_text').map(part => part.text ?? '').join('');
    if (!output) fail('empty_output');
    if (output.length > 24_000) fail('oversized_output');
    return output;
  } catch (error) {
    // Allowlisted runtime categories only; never retain an exception message,
    // URL, authorization header, or provider response body.
    if (reason === 'network_error' && error instanceof Error) {
      if (/unsupported redirect/i.test(error.message)) reason = 'unsupported_redirect';
      else if (/illegal invocation|incorrect.*this.*reference/i.test(error.message)) reason = 'illegal_invocation';
    }
    if (options.signal?.aborted) reason = 'cancelled';
    else if (timeout.aborted) reason = 'timeout';
    try { options.reportFailure?.(reason); } catch { /* telemetry cannot change the response */ }
    throw unavailable();
  }
}

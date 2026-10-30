import { AssistantError, readBoundedJson, type AssistantEvidenceSpan, type AssistantValidationCode } from './assistant-core';
import models from './assistant-models.json';
import { ASSISTANT_PLAN_SCHEMA } from './assistant-planner';

export type AssistantPrompt = { system: string; user: string; sourceIds?: string[]; outputKind?: 'review' | 'plan'; reviewIds?: string[];
  /** Server-selected exact excerpts. An absent catalog alone permits legacy prompts. */
  evidenceSpans?: AssistantEvidenceSpan[];
  /** In-process validation only; never serialized or supplied by the caller. */
  validateOutput?(raw: string): void;
  /** Server-only cap; recovery cannot multiply transport/schema retries. */
  maxAttempts?: 1 | 2;
  /** Application-selected brief-summary budget, never an extra retry allowance. */
  maxAnswerWords?: number;
  /** Summaries place unresolved reports in cited claims, never uncited prose. */
  summaryTask?: boolean;
};
export type WorkersAiBinding = { run(model: string, input: Record<string, unknown>): Promise<unknown> };
export type AssistantProviderFailure = 'missing_binding' | 'missing_key' | 'invalid_key_format' | 'network_error' | 'unsupported_redirect' | 'illegal_invocation' | 'timeout' | 'cancelled' | 'provider_error' | 'rate_limited' | 'authentication_failed' | 'permission_denied' | 'invalid_request' | 'incomplete_output' | 'empty_output' | 'oversized_output';
export const WORKERS_ASSISTANT_MODEL = models.answer;
export const WORKERS_ASSISTANT_PROFILE = JSON.stringify(models);
export const GROQ_ASSISTANT_MODEL = models.groq.answer;
export const GROQ_ASSISTANT_PROFILE = JSON.stringify(models.groq);
export type AssistantTransport = { status: number; attempt?: number; errorCode?: 'json_validate_failed' | 'json_generation_failed' | 'context_length_exceeded' | 'other'; constraint?: 'maxItems' | 'minItems' | 'maxLength' | 'minLength' | 'enum' | 'required' | 'other'; tokenLimit?: number; remainingTokens?: number; retryAfterSeconds?: number; denial?: 'model-org' | 'model-project' | 'permission' | 'other'; responseFormat?: 'json' | 'html' | 'other' };
export type AssistantUsage = { model: string; stage: 'answer' | 'review' | 'plan'; inputTokens?: number; outputTokens?: number; durationMs: number };
export const OPENAI_ASSISTANT_MODEL = 'gpt-6-luna';
const evidence = { type: 'object', additionalProperties: false, required: ['sourceId', 'quote'], description: 'An exact source-body passage supporting the specific event, outcome or qualification stated, not merely identifying a report that contains other facts.', properties: { sourceId: { type: 'string', minLength: 1 }, quote: { type: 'string', minLength: 12, maxLength: 400 } } };
const claim = { type: 'object', additionalProperties: false, required: ['text', 'evidence'], description: 'Choose supporting passages before composing one short, attributed statement. Every stated event, outcome, date and material qualification must be covered by its evidence; a passage about an opening event does not cover later outcomes.', properties: { text: { type: 'string', minLength: 1, maxLength: 700 }, evidence: { type: 'array', minItems: 1, maxItems: 4, description: 'Use exact passages covering every stated fact and qualification from each report being compared. If a compound or multi-report statement needs more than four passages, split it into atomic claims or narrow its attribution to one supported report when repeated content permits; never drop necessary citations or material qualifications to fit. Preserve every relevant side of a required comparison.', items: evidence } } };
export const ASSISTANT_OUTPUT_SCHEMA = { type: 'object', additionalProperties: false, required: ['status', 'disagreements', 'claims', 'unanswered'], properties: {
  status: { type: 'string', enum: ['answered', 'insufficient'], description: 'Answered requires at least one cited claim or comparison across claims and disagreements. Insufficient requires both arrays to be empty.' },
  disagreements: { type: 'array', maxItems: 3, description: 'Prefer this section for relevant conflicting reports. Preserve both attributed positions with exact quotes and source IDs from at least two disagreeing sources. A supported comparison can answer without duplicating its reports in claims.', items: { ...claim, properties: { ...claim.properties, evidence: { ...claim.properties.evidence, minItems: 2 } } } },
  claims: { type: 'array', maxItems: 6, description: 'Attributed factual reports supported by source quotes. When material content repeats, summarize one cited report with singular wording, not several members or a frequency claim. Preserve distinct material facts, corrections, qualifications and conflicts from other reports. Prefer disagreements for conflicting comparisons, but a supported comparison may appear here if it preserves both attributed positions and citations from at least two different sources. Do not repeat reports already conveyed in a comparison.', items: claim },
  unanswered: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 400 } },
} };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const evidenceFailure = (code: AssistantValidationCode): never => {
  throw new AssistantError(502, 'The assistant could not verify its source references. Please try a more specific question.', undefined, code);
};
const slotNames = (count: number) => Array.from({ length: count }, (_, index) => `slot${index + 1}`);

/** Fixed object cardinality avoids relying on provider-enforced array maxItems. */
function slotSchema(count: number, item: Record<string, unknown>, description?: string) {
  const names = slotNames(count);
  return { type: 'object', additionalProperties: false, required: names,
    ...(description ? { description } : {}),
    properties: Object.fromEntries(names.map(name => [name, { anyOf: [item, { type: 'null' }] }])),
  };
}

/** Only explicit null is absent. Missing, extra or malformed slots reject the whole candidate. */
function readSlots(value: unknown, count: number, code: AssistantValidationCode): unknown[] {
  const names = slotNames(count);
  if (!record(value) || Object.keys(value).length !== count || names.some(name => !Object.hasOwn(value, name))) return evidenceFailure(code);
  return names.map(name => value[name]).filter(item => item !== null);
}

/** Presence is intentional: invalid or empty catalogs must never enable free-text fallback. */
function evidenceCatalog(prompt: AssistantPrompt): Map<string, AssistantEvidenceSpan> | null {
  if (prompt.outputKind === 'review' || !Object.hasOwn(prompt, 'evidenceSpans')) return null;
  const spans: unknown = prompt.evidenceSpans;
  if (!Array.isArray(spans) || !spans.length || spans.length > 256) return evidenceFailure('citation_schema');
  const catalog = new Map<string, AssistantEvidenceSpan>();
  for (const span of spans) {
    if (!record(span) || Object.keys(span).length !== 3 || typeof span.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(span.id)
      || typeof span.sourceId !== 'string' || !span.sourceId || span.sourceId.length > 256
      || typeof span.quote !== 'string' || span.quote.trim().length < 12 || span.quote.length > 400
      || catalog.has(span.id) || (prompt.sourceIds && !prompt.sourceIds.includes(span.sourceId))) return evidenceFailure('citation_schema');
    catalog.set(span.id, { id: span.id, sourceId: span.sourceId, quote: span.quote });
  }
  return catalog;
}

/** Restore only exact server-selected excerpts; never salvage, fuzzy-match or echo model quotations. */
export function resolveAssistantEvidence(raw: string, prompt: AssistantPrompt): string {
  const catalog = evidenceCatalog(prompt);
  if (!catalog) return raw;
  if (raw.length > 24_000) return evidenceFailure('output_schema');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return evidenceFailure('output_json'); }
  if (!record(value) || Object.keys(value).length !== 4 || !['status', 'claims', 'disagreements', 'unanswered'].every(key => Object.hasOwn(value, key))
    || typeof value.status !== 'string' || !['answered', 'insufficient'].includes(value.status)) return evidenceFailure('output_schema');
  const resolveClaims = (slots: unknown, maximum: number, minimumEvidence: number) => {
    return readSlots(slots, maximum, 'claim_limit').map(item => {
      if (!record(item) || Object.keys(item).length !== 2 || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 700) return evidenceFailure('claim_text');
      const entries = readSlots(item.evidence, 4, 'citation_schema');
      if (entries.length < minimumEvidence) return evidenceFailure('citation_missing');
      const selected = new Set<string>();
      return { text: item.text, evidence: entries.map(entry => {
        if (!record(entry) || Object.keys(entry).length !== 1 || typeof entry.spanId !== 'string' || selected.has(entry.spanId)) return evidenceFailure('citation_schema');
        const span = catalog.get(entry.spanId);
        if (!span) return evidenceFailure('citation_source');
        selected.add(entry.spanId);
        return { sourceId: span.sourceId, quote: span.quote };
      }) };
    });
  };
  const unanswered = readSlots(value.unanswered, 4, 'unanswered_limit');
  if (unanswered.some(item => typeof item !== 'string' || item.length > 400)) return evidenceFailure('unanswered_limit');
  const claims = resolveClaims(value.claims, 6, 1), disagreements = resolveClaims(value.disagreements, 3, 2);
  if (value.status === 'answered' && !claims.length && !disagreements.length) return evidenceFailure('answered_without_claims');
  if (value.status === 'insufficient' && (claims.length || disagreements.length)) return evidenceFailure('output_schema');
  const resolved = JSON.stringify({ status: value.status, disagreements, claims, unanswered });
  if (resolved.length > 24_000) return evidenceFailure('output_schema');
  return resolved;
}

/** Constrain citations to the server-selected corpus before generation. */
export function assistantOutputSchema(prompt: AssistantPrompt) {
  if (prompt.outputKind === 'plan') return ASSISTANT_PLAN_SCHEMA;
  if (prompt.outputKind === 'review') {
    const ids = [...new Set(prompt.reviewIds ?? [])];
    if (!ids.length || ids.length > 9) throw new AssistantError(502, 'The assistant could not verify this answer. Please try again.');
    return { type: 'object', additionalProperties: false, required: ['feedback', 'checks', 'fulfillsTask'], properties: {
      feedback: { type: 'string', maxLength: 1200, description: 'Concrete defect diagnosis before the verdict: identify the unsupported assertion by check ID, or missing material fact/qualification by source ID. Empty if and only if every check and fulfillsTask pass. Not a replacement answer or instructions.' },
      checks: { type: 'array', minItems: ids.length, maxItems: ids.length, items: {
        type: 'object', additionalProperties: false, required: ['id', 'supported'],
        properties: { id: { type: 'string', enum: ids }, supported: { type: 'boolean' } },
      } },
      fulfillsTask: { type: 'boolean', description: 'Whether the candidate satisfies the supplied task: answer, discussion summary, or interval catch-up. Summary and catch-up do not require a user question.' },
    } };
  }
  const catalog = evidenceCatalog(prompt);
  if (catalog) {
    const selectedEvidence = { type: 'object', additionalProperties: false, required: ['spanId'], description: 'Select the span supporting the specific event, outcome or qualification stated, not merely a span identifying a report that contains other facts.', properties: { spanId: { type: 'string', enum: [...catalog.keys()] } } };
    // Refer to one catalog rather than repeating up to 256 IDs in every slot.
    // Public arrays are constructed only after all nullable slots validate.
    return { type: 'object', additionalProperties: false, required: ['status', 'disagreements', 'claims', 'unanswered'],
      $defs: {
        evidenceSpan: selectedEvidence,
        evidenceSlots: slotSchema(4, { $ref: '#/$defs/evidenceSpan' }, 'Choose listed spans before composing the statement, covering every stated event, outcome, date and material qualification from each report being compared. Use 1–4 listed spans for a claim, 2–4 from at least two different sources for a disagreement. If a compound or multi-report statement needs more than four spans, split it into atomic claims or narrow its attribution to one supported report when repeated content permits; never drop necessary citations or material qualifications to fit. Preserve every relevant side of a required comparison. Every unused slot must be null. Never repeat a spanId in this object.'),
        claim: { type: 'object', additionalProperties: false, required: ['text', 'evidence'], description: 'Choose supporting spans before composing one short, attributed statement. Every stated fact and qualification must be covered by its selected spans; a span about an opening event does not cover later outcomes.', properties: {
          text: { type: 'string', minLength: 1, maxLength: 700 }, evidence: { $ref: '#/$defs/evidenceSlots' },
        } },
      }, properties: {
        status: { type: 'string', enum: ['answered', 'insufficient'], description: `Answered requires at least one cited claim or comparison across claims and disagreements. Insufficient requires all claim and disagreement slots to be null.${prompt.summaryTask ? ' For a summary, attributed descriptions of substantive source questions count as answered even when their answers are not in the evidence. Do not answer or assert the premise of those source questions.' : ''}` },
        disagreements: slotSchema(3, { $ref: '#/$defs/claim' }, 'Prefer this section for relevant conflicting reports, preserving both attributed positions with evidence from at least two different sources. A supported comparison can answer without duplicating its reports in claims. Every unused slot must be null.'),
        claims: slotSchema(6, { $ref: '#/$defs/claim' }, 'Use as many of these six slots as needed for essential attributed facts AND material qualifications. When material content repeats, summarize one cited report with singular wording, not several members or a frequency claim. Preserve distinct material facts, corrections, qualifications and conflicts from other reports. Never omit an explicit personal-only limitation or important unknown outcome merely to shorten a summary. Prefer disagreements for conflicting comparisons, but a supported comparison may appear here if it preserves both attributed positions and citations from at least two different sources. Do not repeat reports already conveyed in a comparison. Every unused slot must be null.'),
        unanswered: prompt.summaryTask
          ? { type: 'object', additionalProperties: false, required: ['slot1', 'slot2', 'slot3', 'slot4'], properties: Object.fromEntries([1, 2, 3, 4].map(n => [`slot${n}`, { type: 'null' }])), description: 'For a summary, unresolved reports belong in cited claims. All four slots must be null.' }
          : slotSchema(4, { type: 'string', maxLength: 400 }, 'Questions not resolved by the evidence. Every unused slot must be null.'),
      },
    };
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

/** Preserve complete evidence with the approved fixed model. */
export function workersAssistantRequest(prompt: AssistantPrompt) {
  const review = prompt.outputKind === 'review';
  const schema = assistantOutputSchema(prompt);
  const schemaName = prompt.outputKind === 'plan' ? 'discussion_turn_plan' : review ? 'discussion_answer_review' : 'discussion_answer';
  const model = review ? models.review : models.answer;
  const response_format = { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } };
  const messages = [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }];
  return { model, input: {
    messages, response_format,
    max_tokens: prompt.outputKind === 'plan' ? 1200 : review ? models.reviewMaxTokens : models.answerMaxTokens,
    reasoning_effort: 'low', store: false,
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
  const schemaName = prompt.outputKind === 'plan' ? 'discussion_turn_plan' : review ? 'discussion_answer_review' : 'discussion_answer';
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
          try { options.reportUsage?.({ model: request.model, stage: prompt.outputKind ?? 'answer', inputTokens: count(payload.usage?.prompt_tokens), outputTokens: count(payload.usage?.completion_tokens), durationMs: Date.now() - started }); } catch { /* metrics cannot change the answer */ }
          const first = payload.choices?.[0];
          if (first && first.finish_reason !== 'stop') fail('incomplete_output');
          const content = first?.message?.content ?? payload.response;
          const result = typeof content === 'string' ? content : content ? JSON.stringify(content) : '';
          if (result && result.length <= 24_000) { const resolved = resolveAssistantEvidence(result, prompt); prompt.validateOutput?.(resolved); return resolved; }
          if (result.length > 24_000) fail('oversized_output');
        }
        fail('empty_output');
      } finally { if (stop) signal.removeEventListener('abort', stop); }
    }
    if (!options.apiKey) return fail('missing_key');
    if (options.provider === 'groq') {
      if (options.apiKey !== options.apiKey.trim() || /[^\x21-\x7e]/.test(options.apiKey)) return fail('invalid_key_format');
      const selected = review ? models.groq.review : models.groq.answer;
      const started = Date.now();
      // Groq can return json_validate_failed even with strict:true. One bounded
      // format-only repair is safe; do not retry configuration/auth/rate errors.
      // Both attempts share the original 25s timeout and caller's total budget.
      // Even an invalid in-process override can never extend the hard cap.
      const maximumAttempts = typeof prompt.maxAttempts === 'number' && Number.isFinite(prompt.maxAttempts)
        ? Math.max(1, Math.min(2, Math.floor(prompt.maxAttempts))) : 2;
      const citationRepair = Object.hasOwn(prompt, 'evidenceSpans') && !review
        ? 'Use fixed slot objects, never arrays: claims has exactly slot1–slot6, disagreements slot1–slot3, unanswered slot1–slot4, and each evidence object slot1–slot4. Include every required slot key; set every unused slot to null. Every non-null evidence slot contains only a spanId selected from the supplied evidence catalog. Do not output quote or sourceId fields, invent IDs, or repeat a spanId within one evidence object. Insufficient requires all claim and disagreement slots to be null.'
        : 'Every quote is one continuous verbatim body excerpt of 12–400 characters, never joined with ellipses. Copy only actual source IDs and exact text from the supplied source bodies.';
      const lengthRepair = (prompt.summaryTask ? ' For a summary, all unanswered slots must be null. Summarize unresolved reports as cited claims; a supported account of an unresolved situation is an answered summary.' : '') + ([100, 150].includes(prompt.maxAnswerWords ?? 0)
        ? ` All claim, disagreement and unanswered text together must be at most ${prompt.maxAnswerWords} words. Omit optional background first; retain essential outcomes, stated dates, uncertainty and personal-only qualifications. Do not truncate claims or their evidence.` : '');
      for (let attempt = 0; attempt < maximumAttempts; attempt++) {
      signal.throwIfAborted();
      reason = 'network_error';
      const response = await (options.fetcher ?? fetch)('https://api.groq.com/openai/v1/chat/completions', {
        // Workers does not implement redirect:error. Return redirects without
        // following them, then reject every non-2xx response below.
        method: 'POST', redirect: 'manual', signal,
        headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selected,
          messages: [{ role: 'system', content: prompt.system + (attempt ? `\nFORMAT REPAIR: The previous attempt failed format or exact-citation validation. Return a concise object matching every required field. At most 6 claims, 3 disagreements, 4 unanswered items; each claim has 1–4 evidence entries, each disagreement 2–4. ${citationRepair} Each text is at most 700 characters. Review checks, if requested, include every supplied check ID exactly once. Do not add facts or change the requested task.${lengthRepair}` : '') }, { role: 'user', content: prompt.user }],
          response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
          reasoning_effort: review ? models.groq.reviewReasoningEffort : models.groq.reasoningEffort, include_reasoning: false,
          max_completion_tokens: prompt.outputKind === 'plan' ? 1200 : review ? models.groq.reviewMaxTokens : models.groq.answerMaxTokens,
          temperature: 0, seed: 39173,
        }),
      });
      reason = 'provider_error';
      const numberHeader = (name: string) => {
        const raw = response.headers.get(name);
        const value = raw === null ? NaN : Number(raw);
        return Number.isFinite(value) && value >= 0 && value <= 1_000_000_000 ? value : undefined;
      };
      let denial: AssistantTransport['denial'];
      let errorCode: AssistantTransport['errorCode'];
      let constraint: AssistantTransport['constraint'];
      const contentType = response.headers.get('content-type') ?? '';
      const responseFormat = contentType.includes('application/json') ? 'json' : contentType.includes('text/html') ? 'html' : 'other';
      if (!response.ok) {
        // Fixed categories only: never retain the body, failed generation,
        // error message, identifiers, prompt text or arbitrary provider codes.
        denial = 'other';
        errorCode = 'other';
        try {
          const failure = await readBoundedJson(response, 100_000) as { error?: { code?: unknown; type?: unknown; message?: unknown } };
          if (failure.error?.code === 'model_permission_blocked_org') denial = 'model-org';
          else if (failure.error?.code === 'model_permission_blocked_project') denial = 'model-project';
          else if (failure.error?.type === 'permissions_error') denial = 'permission';
          const code = failure.error?.code;
          if (code === 'json_validate_failed' || code === 'json_generation_failed' || code === 'context_length_exceeded') errorCode = code;
          if (errorCode === 'json_validate_failed') {
            const message = typeof failure.error?.message === 'string' ? failure.error.message : '';
            constraint = /\bmaxItems\b/.test(message) ? 'maxItems' : /\bminItems\b/.test(message) ? 'minItems' : /\bmaxLength\b/.test(message) ? 'maxLength' : /\bminLength\b/.test(message) ? 'minLength' : /\benum\b/.test(message) ? 'enum' : /\brequired\b/.test(message) ? 'required' : 'other';
          }
        } catch { /* unrecognized bodies remain private */ }
      }
      // Fixed labels and numeric telemetry only; no provider error text.
      try { options.reportTransport?.({ status: response.status, attempt: attempt + 1, ...(errorCode ? { errorCode } : {}), ...(constraint ? { constraint } : {}), tokenLimit: numberHeader('x-ratelimit-limit-tokens'), remainingTokens: numberHeader('x-ratelimit-remaining-tokens'), retryAfterSeconds: numberHeader('retry-after'), ...(denial ? { denial } : {}), responseFormat }); } catch { /* optional metrics */ }
      if (!response.ok) {
        if (response.status === 400 && (errorCode === 'json_validate_failed' || errorCode === 'json_generation_failed') && attempt + 1 < maximumAttempts && !signal.aborted) continue;
        return fail(response.status === 429 ? 'rate_limited' : response.status === 401 ? 'authentication_failed' : response.status === 403 ? 'permission_denied' : response.status === 400 ? 'invalid_request' : 'provider_error');
      }
      const data = await readBoundedJson(response, 100_000) as { choices?: { finish_reason?: string; message?: { content?: unknown } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
      const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : undefined;
      try { options.reportUsage?.({ model: selected, stage: prompt.outputKind ?? 'answer', inputTokens: count(data.usage?.prompt_tokens), outputTokens: count(data.usage?.completion_tokens), durationMs: Date.now() - started }); } catch { /* optional metrics */ }
      const first = data.choices?.[0];
      if (first?.finish_reason !== 'stop') return fail('incomplete_output');
      const content = first.message?.content;
      if (typeof content !== 'string' || !content.trim()) return fail('empty_output');
      if (content.length > 24_000) return fail('oversized_output');
      let resolved: string;
      try { resolved = resolveAssistantEvidence(content, prompt); prompt.validateOutput?.(resolved); }
      catch (error) {
        // A 200 response may still contain an invalid span ID or legacy quote.
        // Regenerate from original evidence, never repair/drop proof in-place.
        // This shares the HTTP400 repair budget: at most two answer attempts.
        const repairable = error instanceof AssistantError && error.code && [
          'output_json', 'output_schema', 'claim_limit', 'claim_text', 'citation_schema',
          'citation_missing', 'citation_length', 'citation_source', 'citation_quote',
          'conflict_sources', 'unanswered_limit', 'answered_without_claims', 'answer_word_limit',
        ].includes(error.code);
        if (repairable && !review && attempt + 1 < maximumAttempts && !signal.aborted) continue;
        throw error;
      }
      return resolved;
      }
      return fail('provider_error');
    }
    const response = await (options.fetcher ?? fetch)('https://api.openai.com/v1/responses', {
      method: 'POST', redirect: 'manual', signal,
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
    const resolved = resolveAssistantEvidence(output, prompt);
    prompt.validateOutput?.(resolved);
    return resolved;
  } catch (error) {
    // Allowlisted runtime categories only; never retain an exception message,
    // URL, authorization header, or provider response body.
    if (reason === 'network_error' && error instanceof Error) {
      if (/unsupported redirect|invalid redirect value/i.test(error.message)) reason = 'unsupported_redirect';
      else if (/illegal invocation|incorrect.*this.*reference/i.test(error.message)) reason = 'illegal_invocation';
    }
    if (options.signal?.aborted) reason = 'cancelled';
    else if (timeout.aborted) reason = 'timeout';
    else if (error instanceof AssistantError && error.status === 502) throw error;
    try { options.reportFailure?.(reason); } catch { /* telemetry cannot change the response */ }
    throw unavailable();
  }
}

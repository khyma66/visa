import { AssistantError, readBoundedJson } from './assistant-core';

export type AssistantPrompt = { system: string; user: string };
export type WorkersAiBinding = { run(model: string, input: Record<string, unknown>): Promise<unknown> };
export const WORKERS_ASSISTANT_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
export const OPENAI_ASSISTANT_MODEL = 'gpt-6-luna';
const evidence = { type: 'object', additionalProperties: false, required: ['sourceId', 'quote'], properties: { sourceId: { type: 'string' }, quote: { type: 'string' } } };
const claim = { type: 'object', additionalProperties: false, required: ['text', 'evidence'], properties: { text: { type: 'string' }, evidence: { type: 'array', items: evidence } } };
export const ASSISTANT_OUTPUT_SCHEMA = { type: 'object', additionalProperties: false, required: ['status', 'claims', 'disagreements', 'unanswered'], properties: {
  status: { type: 'string', enum: ['answered', 'insufficient'] }, claims: { type: 'array', items: claim }, disagreements: { type: 'array', items: claim }, unanswered: { type: 'array', items: { type: 'string' } },
} };

export function providerModel(provider: string | undefined): string {
  if (provider === 'workers-ai') return WORKERS_ASSISTANT_MODEL;
  if (provider === 'openai') return OPENAI_ASSISTANT_MODEL;
  throw new AssistantError(503, 'The assistant is not configured yet.');
}

export async function runAssistantModel(prompt: AssistantPrompt, options: {
  provider: string | undefined; apiKey?: string; binding?: WorkersAiBinding; signal?: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<string> {
  const model = providerModel(options.provider);
  const timeout = AbortSignal.timeout(25_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const unavailable = () => new AssistantError(503, 'The assistant is temporarily unavailable. Please try again shortly.');
  try {
    signal.throwIfAborted();
    if (options.provider === 'workers-ai') {
      if (!options.binding) throw unavailable();
      // Bounded single inference. No retries or automatic escalation multiplying costs.
      let stop: (() => void) | undefined;
      const aborted = new Promise<never>((_, reject) => { stop = () => reject(unavailable()); signal.addEventListener('abort', stop, { once: true }); });
      try {
        const value = await Promise.race([options.binding.run(model, {
          messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user + '\n/no_think' }],
          max_tokens: 1600, temperature: 0.1, response_format: { type: 'json_schema', json_schema: ASSISTANT_OUTPUT_SCHEMA },
        }), aborted]);
        if (value && typeof value === 'object') {
          const payload = value as { response?: unknown; choices?: { finish_reason?: string; message?: { content?: unknown } }[] };
          const first = payload.choices?.[0];
          if (first && first.finish_reason !== 'stop') throw unavailable();
          const content = first?.message?.content ?? payload.response;
          const result = typeof content === 'string' ? content : content ? JSON.stringify(content) : '';
          if (result && result.length <= 24_000) return result;
        }
        throw unavailable();
      } finally { if (stop) signal.removeEventListener('abort', stop); }
    }
    if (!options.apiKey) throw unavailable();
    const response = await (options.fetcher ?? fetch)('https://api.openai.com/v1/responses', {
      method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, store: false, reasoning: { effort: 'none' }, max_output_tokens: 1600,
        input: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
        text: { format: { type: 'json_schema', name: 'discussion_answer', strict: true, schema: ASSISTANT_OUTPUT_SCHEMA } },
      }),
    });
    if (!response.ok) { await response.body?.cancel(); throw unavailable(); }
    const data = await readBoundedJson(response, 100_000) as { status?: string; output?: { type?: string; content?: { type?: string; text?: string }[] }[] };
    if (data.status !== 'completed' || !Array.isArray(data.output)) throw unavailable();
    const output = data.output.filter(item => item.type === 'message').flatMap(item => item.content ?? []).filter(part => part.type === 'output_text').map(part => part.text ?? '').join('');
    if (!output || output.length > 24_000) throw unavailable();
    return output;
  } catch { throw unavailable(); }
}

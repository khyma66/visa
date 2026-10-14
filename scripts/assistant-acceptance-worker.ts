import { assistantPrompt, prepareAssistantCorpus, readBoundedJson, validateAssistantOutput } from '../src/lib/assistant-core';
import { runAssistantModel, WORKERS_ASSISTANT_MODEL, type WorkersAiBinding } from '../src/lib/assistant-provider';
import { acceptanceFixtures, evaluateAcceptance } from './assistant-acceptance-fixtures';

type Env = { ASSISTANT_AI: WorkersAiBinding; ACCEPTANCE_SECRET?: string; ACCEPTANCE_EXPIRES?: string; ACCEPTANCE_SOURCE_SHA?: string };
const response = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Assistant-Acceptance': 'v1' } });
async function authorized(request: Request, env: Env): Promise<boolean> {
  const expires = Number(env.ACCEPTANCE_EXPIRES);
  if (!env.ACCEPTANCE_SECRET || env.ACCEPTANCE_SECRET.length < 40 || !Number.isFinite(expires) || Date.now() >= expires || expires - Date.now() > 15 * 60_000) return false;
  const supplied = request.headers.get('authorization') ?? '';
  if (supplied.length > 100) return false;
  const digest = async (text: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const [expected, actual] = await Promise.all([digest(`Bearer ${env.ACCEPTANCE_SECRET}`), digest(supplied)]);
  let different = 0;
  for (let index = 0; index < expected.length; index++) different |= expected[index] ^ actual[index];
  return different === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Not an alternate chatbot endpoint: only authenticated, expiring fixed-fixture evaluation.
    const path = new URL(request.url).pathname;
    if (!((path === '/evaluate' && request.method === 'POST') || (path === '/ready' && request.method === 'GET')) || !await authorized(request, env)) return response({ error: 'Not found' }, 404);
    // This authenticated handshake performs no inference and distinguishes a
    // deployed Worker from a transient platform 404 while the route propagates.
    if (path === '/ready') return response({ ready: true, protocol: 'visathreads-assistant-acceptance-v1', sourceSha: env.ACCEPTANCE_SOURCE_SHA, model: WORKERS_ASSISTANT_MODEL, cases: acceptanceFixtures.map(fixture => fixture.id) });
    try {
      const body = await readBoundedJson(request, 128);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'id')) return response({ error: 'Invalid fixture' }, 400);
      const fixture = acceptanceFixtures.find(item => item.id === (body as { id?: unknown }).id);
      if (!fixture) return response({ error: 'Invalid fixture' }, 400);
      const corpus = prepareAssistantCorpus(fixture.corpus);
      const started = Date.now();
      const raw = await runAssistantModel(assistantPrompt(fixture.input, corpus), { provider: 'workers-ai', binding: env.ASSISTANT_AI, signal: request.signal });
      const result = validateAssistantOutput(raw, corpus);
      // Never return the prompt, source content, or generated prose; only fixed check names and booleans.
      return response({ ...evaluateAcceptance(fixture, result), model: WORKERS_ASSISTANT_MODEL, durationMs: Date.now() - started });
    } catch { return response({ error: 'Hosted inference or source validation failed' }, 502); }
  },
};

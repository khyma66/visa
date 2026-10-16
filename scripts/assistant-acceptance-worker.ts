import { prepareAssistantCorpus, readBoundedJson, validateAssistantOutput, type AssistantValidationCode } from '../src/lib/assistant-core';
import type { AssistantRequest, AssistantResult } from '../src/lib/assistant-contract';
import { createAssistantHandler, type AssistantFailureStage } from '../src/lib/assistant-service';
import { runAssistantModel, WORKERS_ASSISTANT_MODEL, type WorkersAiBinding, type AssistantProviderFailure } from '../src/lib/assistant-provider';
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
    if (path !== '/evaluate' || request.method !== 'POST' || !await authorized(request, env)) return response({ error: 'Not found' }, 404);
    try {
      const body = await readBoundedJson(request, 128);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'id')) return response({ error: 'Invalid fixture' }, 400);
      // Probe the exact inference method/path without invoking the model. A
      // separate /ready route cannot establish /evaluate route propagation.
      if ((body as { id?: unknown }).id === '__ready__') return response({ ready: true, protocol: 'visathreads-assistant-acceptance-v1', sourceSha: env.ACCEPTANCE_SOURCE_SHA, model: WORKERS_ASSISTANT_MODEL, cases: acceptanceFixtures.map(fixture => fixture.id) });
      const fixture = acceptanceFixtures.find(item => item.id === (body as { id?: unknown }).id);
      if (!fixture) return response({ error: 'Invalid fixture' }, 400);
      const started = Date.now();
      // Exercise the application service, including request parsing, quota,
      // preparation, source validation and post-generation revalidation. These
      // dependencies exist only in this expiring test Worker: the caller can
      // select a compiled fixture ID, never an identity, corpus or user prompt.
      const syntheticToken = 'compiled-synthetic-fixture-session';
      const events: string[] = [];
      const receivedInputs: AssistantRequest[] = [];
      let raw: string | undefined;
      let rawReview: string | undefined;
      let serviceFailure: { stage: AssistantFailureStage; status: number; code?: AssistantValidationCode } | undefined;
      let providerReason: AssistantProviderFailure | undefined;
      const handler = createAssistantHandler({
        model: WORKERS_ASSISTANT_MODEL,
        reportFailure: event => { serviceFailure = event; },
        availability: () => ({ posts: true, communities: true, catchup: true }),
        authenticate: async token => {
          if (token !== syntheticToken) throw Error('Invalid synthetic session');
          events.push('authenticate');
          return {
            actor: 'compiled-synthetic-fixture-member',
            corpus: async input => {
              events.push('corpus');
              receivedInputs.push(input);
              return structuredClone(fixture.corpus);
            },
            reserve: async () => { events.push('reserve'); return true; },
          };
        },
        generate: async (prompt, signal) => {
          const review = prompt.outputKind === 'review';
          events.push(review ? 'review' : 'generate');
          // Match the production route's runtime binding lookup. Directly
          // injecting the fetch environment would miss loader/binding errors.
          let binding: WorkersAiBinding | undefined;
          try {
            const { env: runtimeEnv } = await import(/* webpackIgnore: true */ 'cloudflare:workers');
            binding = (runtimeEnv as unknown as { ASSISTANT_AI?: WorkersAiBinding }).ASSISTANT_AI;
            if (!binding || typeof binding.run !== 'function' || binding !== env.ASSISTANT_AI) throw Error('Runtime AI binding mismatch');
          } catch { providerReason = 'missing_binding'; throw Error('Runtime AI binding unavailable'); }
          events.push('runtime-binding');
          const output = await runAssistantModel(prompt, { provider: 'workers-ai', binding, signal, reportFailure: reason => { providerReason = reason; } });
          if (review) rawReview = output;
          else raw = output;
          return output;
        },
      });
      // This is an in-memory Request passed to the shared service, not a
      // network call to production. No real account or database is involved.
      const serviceResponse = await handler(new Request('https://visathreads.com/api/assistant', {
        method: 'POST', signal: request.signal,
        headers: { Authorization: `Bearer ${syntheticToken}`, Origin: 'https://visathreads.com', 'Content-Type': 'application/json' },
        body: JSON.stringify(fixture.input),
      }));
      const serviceBody = await readBoundedJson(serviceResponse, 140_000);
      if (!serviceResponse.ok) {
        // Retain raw output only after a failed, fixed compiled synthetic
        // fixture. This never changes production responses or logging.
        let output: unknown;
        if (raw !== undefined) {
          try { output = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
          catch { output = undefined; }
        }
        return response({ id: fixture.id, passed: false, model: WORKERS_ASSISTANT_MODEL,
          error: 'Hosted application service failed', serviceStatus: serviceResponse.status, durationMs: Date.now() - started,
          syntheticDiagnostic: { source: 'compiled-synthetic-fixture-only', fixtureId: fixture.id,
            stage: raw === undefined ? 'application-service' : 'source-validation',
            ...(serviceFailure ? { serviceFailure } : {}), ...(providerReason ? { providerReason } : {}),
            ...(raw === undefined ? {} : output === undefined ? { rawOutput: raw } : { output }),
          },
        }, 502);
      }
      const result = serviceBody as AssistantResult;
      const evaluation = evaluateAcceptance(fixture, result);
      const directPostSearch = fixture.execution === 'direct-post-search';
      const draft = raw === undefined ? undefined : validateAssistantOutput(raw, prepareAssistantCorpus(fixture.corpus, receivedInputs[0]), Date.now(), receivedInputs[0]);
      const expectedReviews = draft && (draft.claims.length || draft.disagreements.length) ? 1 : 0;
      const sameInput = (input: AssistantRequest) => input.mode === fixture.input.mode
        && JSON.stringify(input.scope) === JSON.stringify(fixture.input.scope)
        && input.question === fixture.input.question
        && JSON.stringify(input.previousQuestions) === JSON.stringify(fixture.input.previousQuestions)
        && JSON.stringify(input.previousPosts) === JSON.stringify(fixture.input.previousPosts)
        && (input.since ? Date.parse(input.since) : undefined) === (fixture.input.since ? Date.parse(fixture.input.since) : undefined)
        && (input.until ? Date.parse(input.until) : undefined) === (fixture.input.until ? Date.parse(fixture.input.until) : undefined);
      evaluation.checks.push(
        { name: 'application_request_parsed', passed: receivedInputs.length > 0 && receivedInputs.every(sameInput) },
        { name: 'application_authentication_used', passed: events.filter(event => event === 'authenticate').length === 1 },
        ...(directPostSearch ? [
          { name: 'application_model_quota_not_used', passed: events.filter(event => event === 'reserve').length === 0 },
          { name: 'application_runtime_binding_not_loaded', passed: events.filter(event => event === 'runtime-binding').length === 0 },
          { name: 'application_provider_not_called', passed: events.filter(event => event === 'generate' || event === 'review').length === 0 },
          { name: 'application_sources_revalidated', passed: events[1] === 'corpus' && events.filter(event => event === 'corpus').length >= 2 },
        ] : [
          { name: 'application_quota_reserved', passed: events.filter(event => event === 'reserve').length === 1 },
          { name: 'application_runtime_binding_loaded', passed: events.filter(event => event === 'runtime-binding').length === 1 + expectedReviews },
          { name: 'application_provider_called_once', passed: events.filter(event => event === 'generate').length === 1 },
          { name: 'application_evidence_reviewed_when_needed', passed: events.filter(event => event === 'review').length === expectedReviews && (expectedReviews === 0 || (rawReview !== undefined && events.indexOf('review') > events.indexOf('generate'))) },
          { name: 'application_sources_revalidated', passed: events[1] === 'corpus' && events.slice(events.indexOf('generate') + 1).filter(event => event === 'corpus').length >= 2 },
        ]),
        { name: 'application_response_private', passed: serviceResponse.headers.get('cache-control') === 'private, no-store'
          && serviceResponse.headers.get('vary') === 'Authorization' && serviceResponse.headers.get('x-content-type-options') === 'nosniff' },
      );
      evaluation.passed = evaluation.checks.every(check => check.passed);
      // Only failed, fixed COMPILED SYNTHETIC fixtures may include diagnostic
      // output. This Worker has no database, production content or free-form
      // prompt input. Production API responses/logging are completely unchanged.
      return response({ ...evaluation, model: WORKERS_ASSISTANT_MODEL, durationMs: Date.now() - started,
        ...(!evaluation.passed ? { syntheticDiagnostic: {
          source: 'compiled-synthetic-fixture-only', fixtureId: fixture.id,
          failedChecks: evaluation.checks.filter(check => !check.passed).map(check => check.name),
          output: { status: result.status, claims: result.claims, disagreements: result.disagreements, unanswered: result.unanswered },
          // Preserve the distinction between model abstention and a rejected
          // citation only for a failed, fixed synthetic case. Never production.
          ...(raw !== undefined && raw.length <= 24_000 ? { rawModelOutput: raw } : {}),
        } } : {}),
      });
    } catch { return response({ error: 'Hosted inference or source validation failed' }, 502); }
  },
};

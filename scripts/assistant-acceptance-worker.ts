import { assistantPrompt, prepareAssistantCorpus, readBoundedJson, validateAssistantOutput, type AssistantValidationCode } from '../src/lib/assistant-core';
import type { AssistantCorpus, AssistantRequest, AssistantResult } from '../src/lib/assistant-contract';
import { assistantCandidateIdentity, createAssistantHandler, type AssistantFailureStage } from '../src/lib/assistant-service';
import { assistantReviewCorpus, validateAssistantReview } from '../src/lib/assistant-review';
import { runAssistantModel, providerModel, providerCacheKey, GROQ_ASSISTANT_PROFILE, WORKERS_ASSISTANT_PROFILE, type WorkersAiBinding, type AssistantProviderFailure, type AssistantUsage, type AssistantTransport } from '../src/lib/assistant-provider';
import { acceptanceFixtures, evaluateAcceptance } from './assistant-acceptance-fixtures';
import { assistantPlanPrompt, parseAssistantPlan } from '../src/lib/assistant-planner';
import { plannerFixtures, evaluatePlanner } from './assistant-planner-fixtures';

type Env = { ASSISTANT_AI?: WorkersAiBinding; GROQ_API_KEY?: string; ACCEPTANCE_PROVIDER?: string; ACCEPTANCE_SECRET?: string; ACCEPTANCE_EXPIRES?: string; ACCEPTANCE_SOURCE_SHA?: string };
const response = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Assistant-Acceptance': 'v1' } });
type InferenceRound = {
  kind: 'answer' | 'review'; maxAttempts: number; semanticRepair: boolean;
  rawOutputs: string[]; output?: string; transport: AssistantTransport[];
};

/** Independently derive the exact allowed sequence from strictly checked drafts/verdicts. */
export function checkAcceptanceInference(input: AssistantRequest, corpus: AssistantCorpus, result: AssistantResult,
  provider: string, events: string[], rounds: InferenceRound[], direct = false) {
  const counts = { answers: rounds.filter(round => round.kind === 'answer').length,
    reviews: rounds.filter(round => round.kind === 'review').length,
    transportCalls: rounds.reduce((total, round) => total + round.transport.length, 0) };
  const prepared = prepareAssistantCorpus(corpus, input);
  const noSafeEvidence = !direct && assistantPrompt(input, prepared, corpus).evidenceSpans.length === 0;
  let sequence = false;
  try {
    const expected = ['authenticate', 'corpus'];
    let cursor = 0;
    const take = (kind: InferenceRound['kind'], recovery: boolean) => {
      const round = rounds[cursor++];
      if (!round || round.kind !== kind || round.maxAttempts !== (recovery ? 1 : 2)
        || round.semanticRepair !== (recovery && kind === 'answer') || typeof round.output !== 'string') throw Error('Invalid inference sequence');
      expected.push(kind === 'answer' ? 'generate' : 'review', 'runtime-binding');
      return round.output;
    };
    if (noSafeEvidence) {
      if (result.status !== 'insufficient' || result.claims.length || result.disagreements.length || result.sources.length) throw Error('Uncitable source cannot support a draft');
    } else if (!direct) {
      expected.push('reserve');
      const validate = (raw: string) => validateAssistantOutput(raw, prepared, Date.now(), input);
      const hasClaims = (draft: AssistantResult) => draft.claims.length + draft.disagreements.length > 0;
      const insufficient = (draft: AssistantResult): AssistantResult => ({ ...draft, status: 'insufficient', claims: [], disagreements: [], sources: [] });
      const first = validate(take('answer', false));
      let checked = first;
      if (hasClaims(first)) {
        if (!assistantReviewCorpus(corpus, prepared, first)) checked = insufficient(first);
        else {
          checked = validateAssistantReview(take('review', false), first);
          // Only a complete, well-formed negative verdict permits a new draft.
          if (checked !== first) {
            const revised = validate(take('answer', true));
            if (assistantCandidateIdentity(revised) !== assistantCandidateIdentity(first)) {
              checked = revised;
              if (hasClaims(revised)) checked = assistantReviewCorpus(corpus, prepared, revised)
                ? validateAssistantReview(take('review', true), revised) : insufficient(revised);
            }
          }
        }
      }
      if (assistantCandidateIdentity(checked) !== assistantCandidateIdentity(result)
        || (result.status === 'insufficient' && (result.claims.length || result.disagreements.length || result.sources.length))) throw Error('Unverified final draft');
    }
    expected.push('corpus');
    sequence = cursor === rounds.length && JSON.stringify(events) === JSON.stringify(expected);
  } catch { /* A malformed or missing verdict cannot authorize another inference. */ }
  const budget = rounds.length <= 4 && counts.transportCalls <= 6 && rounds.every(round => {
    if (provider !== 'groq') return round.transport.length === 0;
    return round.transport.length >= 1 && round.transport.length <= round.maxAttempts
      && round.transport.every((item, index) => item.attempt === index + 1)
      && round.transport.at(-1)?.status === 200;
  });
  return { sequence, budget, counts, noSafeEvidence };
}

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
      const provider = env.ACCEPTANCE_PROVIDER === 'groq' ? 'groq' : 'workers-ai';
      const model = providerModel(provider);
      const profile = provider === 'groq' ? GROQ_ASSISTANT_PROFILE : WORKERS_ASSISTANT_PROFILE;
      const body = await readBoundedJson(request, 128);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'id')) return response({ error: 'Invalid fixture' }, 400);
      // Probe the exact inference method/path without invoking the model. A
      // separate /ready route cannot establish /evaluate route propagation.
      if ((body as { id?: unknown }).id === '__ready__') return response({ ready: true, protocol: 'visathreads-assistant-acceptance-v1', sourceSha: env.ACCEPTANCE_SOURCE_SHA, model, modelProfile: profile, cases: acceptanceFixtures.map(fixture => fixture.id) });
      const plannerId = (body as { id?: unknown }).id;
      if (typeof plannerId === 'string' && plannerId.startsWith('planner:')) {
        const fixture = plannerFixtures.find(item => `planner:${item.id}` === plannerId);
        if (!fixture) return response({ error: 'Invalid fixture' }, 400);
        const started = Date.now(), usage: AssistantUsage[] = [];
        const raw = await runAssistantModel(assistantPlanPrompt(fixture.input), { provider,
          apiKey: env.GROQ_API_KEY, binding: env.ASSISTANT_AI, signal: request.signal, reportUsage: item => usage.push(item) });
        const plan = parseAssistantPlan(raw, fixture.input);
        return response({ ...evaluatePlanner(fixture, plan), id: plannerId, model, durationMs: Date.now() - started, usage,
          syntheticPlan: plan });
      }
      if (provider === 'groq' && (body as { id?: unknown }).id === '__transport__') {
        const probes = [];
        // Fixed public connectivity probes: no credentials, prompts or account
        // data are sent. Only controlled exception categories are returned.
        for (const redirect of ['error', 'manual'] as const) {
          try {
            const res = await fetch('https://api.groq.com/openai/v1/models', { redirect, signal: AbortSignal.timeout(5000) });
            probes.push({ redirect, status: res.status });
            await res.body?.cancel();
          } catch (error) {
            probes.push({ redirect, error: /invalid redirect value|unsupported redirect/i.test(String(error)) ? 'unsupported-redirect' : 'transport-failed' });
          }
        }
        const authorizedModels = await fetch('https://api.groq.com/openai/v1/models', { redirect: 'manual', headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` }, signal: AbortSignal.timeout(5000) });
        const modelStatus = authorizedModels.status;
        const modelData = await readBoundedJson(authorizedModels, 100000).catch(() => null) as { data?: { id?: string }[] } | null;
        probes.push({ authenticatedModelsStatus: modelStatus, selectedModelListed: modelData?.data?.some(item => item.id === model) === true });
        return response({ id: '__transport__', model, probes });
      }
      const fixture = acceptanceFixtures.find(item => item.id === (body as { id?: unknown }).id);
      if (!fixture) return response({ error: 'Invalid fixture' }, 400);
      const started = Date.now();
      // Exercise the application service, including request parsing, quota,
      // preparation, source validation and post-generation revalidation. These
      // dependencies exist only in this expiring test Worker: the caller can
      // select a compiled fixture ID, never an identity, corpus or user prompt.
      const syntheticToken = 'compiled-synthetic-fixture-session';
      const events: string[] = [];
      const usage: AssistantUsage[] = [];
      const transport: AssistantTransport[] = [];
      const receivedInputs: AssistantRequest[] = [];
      const inferenceRounds: InferenceRound[] = [];
      let raw: string | undefined;
      let rawReview: string | undefined;
      let serviceFailure: { stage: AssistantFailureStage; status: number; code?: AssistantValidationCode } | undefined;
      let providerReason: AssistantProviderFailure | undefined;
      const handler = createAssistantHandler({
        model: providerCacheKey(provider),
        reportFailure: event => { serviceFailure = { stage: event.stage, status: event.status, ...(event.code ? { code: event.code } : {}) }; },
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
          const round: InferenceRound = { kind: review ? 'review' : 'answer', maxAttempts: prompt.maxAttempts ?? 2,
            semanticRepair: prompt.system.includes('SEMANTIC REPAIR:'), rawOutputs: [], transport: [] };
          inferenceRounds.push(round);
          events.push(review ? 'review' : 'generate');
          // Match the production route's runtime binding lookup. Directly
          // injecting the fetch environment would miss loader/binding errors.
          let binding: WorkersAiBinding | undefined;
          let apiKey: string | undefined;
          try {
            const { env: runtimeEnv } = await import(/* webpackIgnore: true */ 'cloudflare:workers');
            const runtimeBindings = runtimeEnv as unknown as { ASSISTANT_AI?: WorkersAiBinding; GROQ_API_KEY?: string };
            if (provider === 'groq') {
              apiKey = runtimeBindings.GROQ_API_KEY;
              if (!apiKey || apiKey !== env.GROQ_API_KEY) throw Error('Runtime secret binding unavailable');
            } else {
              binding = runtimeBindings.ASSISTANT_AI;
              if (!binding || typeof binding.run !== 'function' || binding !== env.ASSISTANT_AI) throw Error('Runtime AI binding mismatch');
            }
          } catch { providerReason = 'missing_binding'; throw Error('Runtime AI binding unavailable'); }
          events.push('runtime-binding');
          // Capture rejected drafts only here, for fixed synthetic fixtures.
          // Production never captures raw output or failed-generation content.
          const checkedPrompt = { ...prompt, ...(prompt.validateOutput ? { validateOutput(value: string) {
            raw = value;
            if (value.length <= 24_000) round.rawOutputs.push(value);
            prompt.validateOutput!(value);
          } } : {}) };
          const output = await runAssistantModel(checkedPrompt, { provider, apiKey, binding, signal, reportFailure: reason => { providerReason = reason; }, reportUsage: value => usage.push(value), reportTransport: value => { transport.push(value); round.transport.push(value); } });
          round.output = output;
          if (output.length <= (review ? 12_000 : 24_000) && round.rawOutputs.at(-1) !== output) round.rawOutputs.push(output);
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
        return response({ id: fixture.id, passed: false, model, usage, transport,
          error: 'Hosted application service failed', serviceStatus: serviceResponse.status, durationMs: Date.now() - started,
          syntheticDiagnostic: { source: 'compiled-synthetic-fixture-only', fixtureId: fixture.id,
            stage: raw === undefined ? 'application-service' : 'source-validation',
            ...(serviceFailure ? { serviceFailure } : {}), ...(providerReason ? { providerReason } : {}),
            ...(raw === undefined ? {} : output === undefined ? { rawOutput: raw } : { output }),
            ...(rawReview !== undefined && rawReview.length <= 12_000 ? { rawReviewOutput: rawReview } : {}),
            ...(inferenceRounds.some(round => round.rawOutputs.length) ? { inferenceRounds: inferenceRounds.map(({ kind, maxAttempts, semanticRepair, rawOutputs }) => ({ kind, maxAttempts, semanticRepair, rawOutputs })) } : {}),
          },
        }, 502);
      }
      const result = serviceBody as AssistantResult;
      const evaluation = evaluateAcceptance(fixture, result);
      const directPostSearch = fixture.execution === 'direct-post-search';
      const inference = checkAcceptanceInference(receivedInputs[0], fixture.corpus, result, provider, events, inferenceRounds, directPostSearch);
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
        ...(directPostSearch || inference.noSafeEvidence ? [
          { name: 'application_model_quota_not_used', passed: events.filter(event => event === 'reserve').length === 0 },
          { name: 'application_runtime_binding_not_loaded', passed: events.filter(event => event === 'runtime-binding').length === 0 },
          { name: 'application_provider_not_called', passed: events.filter(event => event === 'generate' || event === 'review').length === 0 },
          ...(!directPostSearch ? [
            { name: 'application_provider_call_sequence', passed: inference.sequence },
            { name: 'application_transport_budget', passed: inference.budget },
          ] : []),
          { name: 'application_evidence_reviewed_when_needed', passed: events.filter(event => event === 'review').length === 0 },
          { name: 'application_sources_revalidated', passed: inference.sequence },
        ] : [
          { name: 'application_quota_reserved', passed: events.filter(event => event === 'reserve').length === 1 },
          { name: 'application_runtime_binding_loaded', passed: inference.sequence },
          { name: 'application_provider_call_sequence', passed: inference.sequence },
          { name: 'application_transport_budget', passed: inference.budget },
          { name: 'application_evidence_reviewed_when_needed', passed: inference.sequence },
          { name: 'application_sources_revalidated', passed: inference.sequence },
        ]),
        { name: 'application_response_private', passed: serviceResponse.headers.get('cache-control') === 'private, no-store'
          && serviceResponse.headers.get('vary') === 'Authorization' && serviceResponse.headers.get('x-content-type-options') === 'nosniff' },
      );
      evaluation.passed = evaluation.checks.every(check => check.passed);
      // Only failed, fixed COMPILED SYNTHETIC fixtures may include diagnostic
      // output. This Worker has no database, production content or free-form
      // prompt input. Production API responses/logging are completely unchanged.
      return response({ ...evaluation, model, durationMs: Date.now() - started, usage, inferenceCounts: inference.counts, ...(transport.length ? { transport } : {}),
        ...(!evaluation.passed ? { syntheticDiagnostic: {
          source: 'compiled-synthetic-fixture-only', fixtureId: fixture.id,
          failedChecks: evaluation.checks.filter(check => !check.passed).map(check => check.name),
          output: { status: result.status, claims: result.claims, disagreements: result.disagreements, unanswered: result.unanswered },
          // Preserve the distinction between model abstention and a rejected
          // citation only for a failed, fixed synthetic case. Never production.
          ...(raw !== undefined && raw.length <= 24_000 ? { rawModelOutput: raw } : {}),
          ...(rawReview !== undefined && rawReview.length <= 12_000 ? { rawReviewOutput: rawReview } : {}),
          inferenceRounds: inferenceRounds.map(({ kind, maxAttempts, semanticRepair, rawOutputs }) => ({ kind, maxAttempts, semanticRepair, rawOutputs })),
        } } : {}),
      });
    } catch { return response({ error: 'Hosted inference or source validation failed' }, 502); }
  },
};

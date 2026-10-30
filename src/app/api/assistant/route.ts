import { createClient } from '@supabase/supabase-js';
import build from '@visa/build-provenance';
import { streamAssistantResponse } from '@/lib/assistant-stream';
import { retrieveAssistantCorpus } from '@/lib/assistant-data';
import { runAssistantModel, providerCacheKey, type WorkersAiBinding } from '@/lib/assistant-provider';
import { assistantResponse, assistantProductionRequest, configuredAvailability, createAssistantHandler, cloudflareAssistantCache,
  AssistantRequestError, assistantDatabaseFetch, assistantLimitError } from '@/lib/assistant-service';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

function identifyBuild(response: Response) {
  // Public health already exposes this immutable revision; never echo request headers.
  response.headers.set('X-VisaThreads-Build', build.gitSha ?? 'unconfigured');
  const provider = process.env.ASSISTANT_PROVIDER;
  response.headers.set('X-VisaThreads-Assistant-Provider', provider === 'groq' || provider === 'workers-ai' || provider === 'openai' ? provider : 'disabled');
  return response;
}

function availability() {
  // Public build values require direct references so Vite/Next can inline them.
  // Passing process.env wholesale loses them on a Worker with runtime-only vars.
  return configuredAvailability({
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ASSISTANT_PROJECT_REF: process.env.ASSISTANT_PROJECT_REF,
    ASSISTANT_PROVIDER: process.env.ASSISTANT_PROVIDER,
    ASSISTANT_ENABLED: process.env.ASSISTANT_ENABLED,
    ASSISTANT_COMMUNITIES_ENABLED: process.env.ASSISTANT_COMMUNITIES_ENABLED,
    ASSISTANT_CATCHUP_ENABLED: process.env.ASSISTANT_CATCHUP_ENABLED,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
  });
}
export async function GET(request: Request) {
  return identifyBuild(assistantResponse(assistantProductionRequest(request) ? availability() : { posts: false, communities: false, catchup: false }));
}

const handle = createAssistantHandler({
  availability,
  reportFailure: event => console.warn('assistant_request_failed', event),
  reportTiming: event => console.info('assistant_request_completed', event),
  reportStage: event => console.info('assistant_stage_completed', event),
  reportReview: event => console.info('assistant_review_completed', event),
  // The provider is read again during inference; deployments set immutable environment values.
  get model() { try { return providerCacheKey(process.env.ASSISTANT_PROVIDER); } catch { return 'disabled'; } },
  cache: cloudflareAssistantCache(),
  async authenticate(token, context) {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` }, fetch: assistantDatabaseFetch(context) },
    });
    const { data, error } = await client.auth.getUser(token);
    context.signal.throwIfAborted();
    if (error) throw new AssistantRequestError(error.status === 401 || error.status === 403 ? 401 : 503,
      error.status === 401 || error.status === 403 ? 'authentication' : 'unavailable');
    if (!data.user || data.user.is_anonymous) throw new AssistantRequestError(401, 'authentication');
    const { data: rate, error: rateError } = await client.rpc('check_assistant_request_rate');
    context.signal.throwIfAborted();
    if (rateError?.code === '42501') throw new AssistantRequestError(403, 'permission');
    if (rateError?.code === 'PT429') throw assistantLimitError(null, 'rate_limit');
    if (rateError) throw new AssistantRequestError(503, 'unavailable');
    const rateRow = Array.isArray(rate) ? rate[0] : rate;
    if (rateRow?.allowed === false) throw assistantLimitError(rateRow, 'rate_limit');
    if (rateRow?.allowed !== true) throw new AssistantRequestError(503, 'unavailable');
    return { actor: data.user.id, corpus: input => retrieveAssistantCorpus(client, input, context.startedAt), async reserve() {
      const { data: result, error: quotaError } = await client.rpc('reserve_assistant_request');
      context.signal.throwIfAborted();
      if (quotaError?.code === '42501') throw new AssistantRequestError(403, 'permission');
      if (quotaError?.code === 'PT429') throw assistantLimitError(null, 'rate_limit');
      if (quotaError) throw new AssistantRequestError(503, 'unavailable');
      const row = Array.isArray(result) ? result[0] : result;
      if (row?.allowed === false) throw assistantLimitError(row, 'quota');
      if (row?.allowed !== true) throw new AssistantRequestError(503, 'unavailable');
      return true;
    } };
  },
  async generate(prompt, signal, context) {
    let binding: WorkersAiBinding | undefined;
    if (process.env.ASSISTANT_PROVIDER === 'workers-ai') {
      try {
        const { env } = await import(/* webpackIgnore: true */ 'cloudflare:workers');
        binding = (env as unknown as { ASSISTANT_AI?: WorkersAiBinding }).ASSISTANT_AI;
      } catch { /* Local Next preview has no Workers AI binding. */ }
    }
    return runAssistantModel(prompt, { provider: process.env.ASSISTANT_PROVIDER, apiKey: process.env.ASSISTANT_PROVIDER === 'groq' ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY, binding, signal,
      reportFailure: reason => console.warn('assistant_provider_failed', { reason, requestId: context.requestId }),
      reportTransport: transport => console.info('assistant_provider_transport', { ...transport, requestId: context.requestId }),
      reportUsage: usage => console.info('assistant_model_usage', { ...usage, requestId: context.requestId }),
    });
  },
});

export async function POST(request: Request) {
  if (request.headers.get('Accept') === 'application/x-ndjson') return identifyBuild(streamAssistantResponse(request, handle));
  return identifyBuild(await handle(request));
}

import { createClient } from '@supabase/supabase-js';
import { AssistantError } from '@/lib/assistant-core';
import { retrieveAssistantCorpus } from '@/lib/assistant-data';
import { runAssistantModel, providerModel, type WorkersAiBinding } from '@/lib/assistant-provider';
import { assistantResponse, assistantProductionRequest, configuredAvailability, createAssistantHandler, cloudflareAssistantCache } from '@/lib/assistant-service';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

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
  });
}
export async function GET(request: Request) {
  return assistantResponse(assistantProductionRequest(request) ? availability() : { posts: false, communities: false, catchup: false });
}

const handle = createAssistantHandler({
  availability,
  reportFailure: event => console.warn('assistant_request_failed', event),
  // The provider is read again during inference; deployments set immutable environment values.
  get model() { try { return providerModel(process.env.ASSISTANT_PROVIDER); } catch { return 'disabled'; } },
  cache: cloudflareAssistantCache(),
  async authenticate(token) {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` }, fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(8000) }) },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user || data.user.is_anonymous) throw new AssistantError(401, 'Log in to use the assistant.');
    const { data: rate, error: rateError } = await client.rpc('check_assistant_request_rate');
    if (rateError) throw new AssistantError(503, 'The assistant is completing its setup. Please try again later.');
    const rateRow = Array.isArray(rate) ? rate[0] : rate;
    if (rateRow?.allowed !== true) throw new AssistantError(429, 'Too many assistant requests. Please wait a minute.', 60);
    return { actor: data.user.id, corpus: input => retrieveAssistantCorpus(client, input), async reserve() {
      const { data: result, error: quotaError } = await client.rpc('reserve_assistant_request');
      if (quotaError) throw new AssistantError(503, 'The assistant is completing its setup. Please try again later.');
      const row = Array.isArray(result) ? result[0] : result;
      return row?.allowed === true;
    } };
  },
  async generate(prompt, signal) {
    let binding: WorkersAiBinding | undefined;
    if (process.env.ASSISTANT_PROVIDER === 'workers-ai') {
      try {
        const { env } = await import(/* webpackIgnore: true */ 'cloudflare:workers');
        binding = (env as unknown as { ASSISTANT_AI?: WorkersAiBinding }).ASSISTANT_AI;
      } catch { /* Local Next preview has no Workers AI binding. */ }
    }
    return runAssistantModel(prompt, { provider: process.env.ASSISTANT_PROVIDER, apiKey: process.env.OPENAI_API_KEY, binding, signal,
      reportFailure: reason => console.warn('assistant_provider_failed', { reason }),
    });
  },
});

export const POST = handle;

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { generateGroundedSummary, SUMMARY_MODEL_VERSION, SUMMARY_PROMPT_VERSION, type SummarySource } from '@/lib/summary-model';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const ALLOWED_WINDOWS = new Set([6, 12, 24, 72]);
type CommunityRow = { id: string; is_public: boolean; is_active: boolean };
type QuestionRow = { id: string; title: string; body: string; created_at: string; status: string };
type AnswerRow = { id: string; question_id: string; body: string; created_at: string; status: string };

function configured() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function admin(): SupabaseClient {
  if (!configured()) throw new Error('Summary generation is not configured.');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function currentUser(request: Request): Promise<string | null> {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return null;
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data } = await client.auth.getUser(token);
  return data.user?.id ?? null;
}

async function access(request: Request, communityId: string, client: SupabaseClient) {
  const { data: community, error } = await client.from('communities').select('id,is_public,is_active').eq('id', communityId).maybeSingle();
  if (error || !community || !community.is_active) return { allowed: false, status: 404 };
  if (community.is_public) return { allowed: true, userId: await currentUser(request) };
  const userId = await currentUser(request);
  if (!userId) return { allowed: false, status: 401 };
  const { data: membership } = await client.from('community_members').select('community_id').eq('community_id', communityId).eq('user_id', userId).eq('is_active', true).maybeSingle();
  return membership ? { allowed: true, userId } : { allowed: false, status: 403 };
}

function parseWindow(request: Request) {
  const value = Number(new URL(request.url).searchParams.get('hours') ?? 24);
  if (!Number.isInteger(value) || !ALLOWED_WINDOWS.has(value)) throw new Error('Choose a 6, 12, 24 or 72 hour interval.');
  return value;
}

async function fingerprint(sources: SummarySource[]) {
  const body = sources.map((source) => source.id + ':' + source.createdAt + ':' + source.body).join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sourceSet(client: SupabaseClient, communityId: string, start: string, end: string): Promise<SummarySource[]> {
  const { data: questions, error: questionError } = await client.from('questions')
    .select('id,title,body,created_at,status').eq('community_id', communityId).neq('status', 'archived')
    .lt('created_at', end).gte('created_at', start).order('created_at', { ascending: true }).limit(120);
  if (questionError) throw new Error('Could not read community discussions.');
  const questionRows = (questions ?? []) as QuestionRow[];
  const ids = questionRows.map((row) => row.id);
  const { data: answers, error: answerError } = ids.length
    ? await client.from('answers').select('id,question_id,body,created_at,status').in('question_id', ids).eq('status', 'active').lt('created_at', end).gte('created_at', start).order('created_at', { ascending: true }).limit(240)
    : { data: [], error: null };
  if (answerError) throw new Error('Could not read community replies.');
  const titles = new Map(questionRows.map((row) => [row.id, row.title]));
  return [
    ...questionRows.map((row) => ({ id: row.id, kind: 'question' as const, createdAt: row.created_at, title: row.title, body: row.body })),
    ...((answers ?? []) as AnswerRow[]).map((row) => ({ id: row.id, kind: 'reply' as const, createdAt: row.created_at, title: titles.get(row.question_id), body: row.body })),
  ];
}

function response(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const windowHours = parseWindow(request);
    const client = admin();
    const communityId = (await context.params).id;
    const permission = await access(request, communityId, client);
    if (!permission.allowed) return response({ error: 'Community summary unavailable.' }, permission.status);
    const endDate = new Date();
    endDate.setUTCMinutes(0, 0, 0);
    const end = endDate.toISOString();
    const start = new Date(endDate.getTime() - windowHours * 60 * 60 * 1000).toISOString();
    const sources = await sourceSet(client, communityId, start, end);
    if (!sources.length) return response({ status: 'empty', windowStart: start, windowEnd: end, sources: 0 });
    const sourceFingerprint = await fingerprint(sources);
    const { data: cached } = await client.from('community_summary_artifacts').select('*')
      .eq('community_id', communityId).eq('window_hours', windowHours).eq('window_end', end)
      .eq('source_fingerprint', sourceFingerprint).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (!cached) return response({ status: 'missing', windowStart: start, windowEnd: end, sources: sources.length }, 202);
    return response({ status: 'ready', windowStart: start, windowEnd: end, sources: sources.length, generatedAt: cached.generated_at, summary: cached.result });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : 'Summary unavailable.' }, 503);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const windowHours = parseWindow(request);
    const client = admin();
    const communityId = (await context.params).id;
    const permission = await access(request, communityId, client);
    if (!permission.allowed) return response({ error: 'Community summary unavailable.' }, permission.status);
    const endDate = new Date();
    endDate.setUTCMinutes(0, 0, 0);
    const end = endDate.toISOString();
    const start = new Date(endDate.getTime() - windowHours * 60 * 60 * 1000).toISOString();
    const sources = await sourceSet(client, communityId, start, end);
    if (!sources.length) return response({ status: 'empty', windowStart: start, windowEnd: end, sources: 0 });
    const sourceFingerprint = await fingerprint(sources);
    const { data: existing } = await client.from('community_summary_artifacts').select('*')
      .eq('community_id', communityId).eq('window_hours', windowHours).eq('window_end', end)
      .eq('source_fingerprint', sourceFingerprint).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (existing) return response({ status: 'ready', windowStart: start, windowEnd: end, sources: sources.length, generatedAt: existing.generated_at, summary: existing.result });
    const summary = await generateGroundedSummary(sources);
    const { data: saved, error } = await client.from('community_summary_artifacts').upsert({
      community_id: communityId, window_hours: windowHours, window_start: start, window_end: end,
      source_fingerprint: sourceFingerprint, source_ids: sources.map((source) => source.id),
      model_version: SUMMARY_MODEL_VERSION, prompt_version: SUMMARY_PROMPT_VERSION, result: summary,
      expires_at: new Date(endDate.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: 'community_id,window_hours,window_end,source_fingerprint' }).select('generated_at,result').single();
    if (error || !saved) throw new Error('The summary could not be saved.');
    return response({ status: 'ready', windowStart: start, windowEnd: end, sources: sources.length, generatedAt: saved.generated_at, summary: saved.result });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : 'Summary unavailable.' }, 503);
  }
}

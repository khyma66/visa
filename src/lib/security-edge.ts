// Server-only traffic controls. These are deterrents, not proof that a visitor is a bot.
import { unprefixedDestinationPath } from './destination-routing';
export type TrafficGroup = 'archive' | 'discussion' | 'directory' | 'news' | 'probe';
export type TrafficSignal = { kind: 'read_rate_limit' | 'cross_site_read' | 'probe_path'; route_group: TrafficGroup; decision: 'blocked' | 'limited' };
type Limiter = { limit(input: { key: string }): Promise<{ success: boolean }> };
export type SecurityBindings = {
  SECURITY_READ_LIMIT?: Limiter; SECURITY_ARCHIVE_LIMIT?: Limiter;
  SECURITY_EVENT_SAMPLE?: Limiter; SECURITY_EVENT_BUDGET?: Limiter;
  SECURITY_INGEST_KEY?: string;
};
type TelemetryStage = 'fingerprint' | 'sample' | 'budget' | 'delivery';
class SecurityTelemetryError extends Error {
  constructor(readonly stage: TelemetryStage, readonly status?: number) {
    super('Security telemetry unavailable');
  }
}
// Log only fields created here, never messages from bindings or upstream services.
export function telemetryFailureDetails(error: unknown): {stage: TelemetryStage | 'unknown'; status?: number} {
  return error instanceof SecurityTelemetryError ? {stage:error.stage,...(error.status ? {status:error.status} : {})} : {stage:'unknown'};
}
async function telemetryStep<T>(stage: TelemetryStage, task: () => Promise<T>): Promise<T> {
  try { return await task(); }
  catch (error) { throw error instanceof SecurityTelemetryError ? error : new SecurityTelemetryError(stage); }
}
export function trafficGroup(path: string): TrafficGroup | null {
  path = unprefixedDestinationPath(path);
  if (/^\/(?:\.env(?:\.|\/|$)|\.git(?:\/|$)|wp-admin(?:\/|$)|wp-login\.php$|phpmyadmin(?:\/|$))/i.test(path)) return 'probe';
  if (path === '/api/community') return 'archive';
  if (/^\/(?:questions|experiences|c)(?:\/|$)/.test(path)) return 'discussion';
  if (/^\/(?:explore|tags|users)(?:\/|$)/.test(path) || path === '/') return 'directory';
  if (/^\/(?:news|api\/news)(?:\/|$)/.test(path)) return 'news';
  return null;
}
export async function trafficDecision(request: Request, env: SecurityBindings): Promise<TrafficSignal | null> {
  if (!['GET', 'HEAD'].includes(request.method)) return null;
  const path = new URL(request.url).pathname;
  const group = trafficGroup(path);
  if (!group) return null;
  if (group === 'probe') return {kind:'probe_path', route_group:group, decision:'blocked'};
  // Fetch Metadata protects browser cross-site reads only. Tools can omit it.
  if (path.startsWith('/api/') && request.headers.get('sec-fetch-site') === 'cross-site') {
    return {kind:'cross_site_read', route_group:group, decision:'blocked'};
  }
  // Cloudflare overwrites this header at its ingress. Never use it as a member identity.
  const ip = request.headers.get('cf-connecting-ip');
  const limiter = group === 'archive' ? env.SECURITY_ARCHIVE_LIMIT : env.SECURITY_READ_LIMIT;
  if (!ip || !limiter) return null;
  const key = `${new URL(request.url).hostname}:${ip}`;
  if (!(await limiter.limit({key})).success) return {kind:'read_rate_limit', route_group:group, decision:'limited'};
  return null;
}
export async function trafficFingerprint(ip: string, secret: string, date = new Date()): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`${date.toISOString().slice(0,10)}:${ip}`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
}
export async function recordTrafficSignal(request: Request, signal: TrafficSignal, env: SecurityBindings) {
  const secret = env.SECURITY_INGEST_KEY;
  const ip = request.headers.get('cf-connecting-ip');
  if (!secret || !/^[a-f0-9]{64}$/.test(secret) || !ip || !env.SECURITY_EVENT_SAMPLE || !env.SECURITY_EVENT_BUDGET) return;
  // At most one observation per traffic group/minute/location, plus a global local cap.
  // Counts in the dashboard are sampled observations, never exact blocked requests.
  const actor_hash = await telemetryStep('fingerprint', () => trafficFingerprint(ip, secret));
  const sample = env.SECURITY_EVENT_SAMPLE, budget = env.SECURITY_EVENT_BUDGET;
  if (!(await telemetryStep('sample', () => sample.limit({key:`${signal.kind}:${signal.route_group}:${actor_hash}`}))).success) return;
  if (!(await telemetryStep('budget', () => budget.limit({key:'security-events'}))).success) return;
  const origin = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const expected = new URL(request.url).hostname;
  // Fixed deployment pairs prevent accidental production evidence flowing into dev.
  const origins: Record<string,string> = {
    'visathreads.com':'https://cycnichledvqbxevrwnt.supabase.co',
    'visaflow-dev.varunchinna5966.workers.dev':'https://cycnichledvqbxevrwnt.supabase.co',
    'visa-central.com':'https://ppdwysmeistjxzjpmxyk.supabase.co',
  };
  if (!key || origin !== origins[expected]) return;
  const ray = request.headers.get('cf-ray');
  const ray_id = ray && /^[a-fA-F0-9]{16,32}(-[A-Z]{3})?$/.test(ray) ? ray : undefined;
  await telemetryStep('delivery', async () => {
  const response = await fetch(`${origin}/rest/v1/rpc/record_security_event`, {
    method:'POST', headers:{apikey:key,'Content-Type':'application/json','x-security-ingest-key':secret},
    body:JSON.stringify({event:{...signal,actor_hash,...(ray_id ? {ray_id} : {})}}),
    signal:AbortSignal.timeout(4000), redirect:'error',
  });
  // No request URL/query, IP, cookie, access token or private message goes to logs.
  await response.body?.cancel();
  if (!response.ok) throw new SecurityTelemetryError('delivery', response.status);
  });
}

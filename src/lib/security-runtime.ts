import { trafficDecision, recordTrafficSignal, type SecurityBindings } from './security-edge';

export async function protectTraffic(request: Request, waitUntil: (task: Promise<unknown>) => void): Promise<Response | null> {
  let env: SecurityBindings;
  try { env = (await import('cloudflare:workers')).env as SecurityBindings; }
  catch { return null; } // Local Next.js does not provide Workers bindings.
  try {
    const signal = await trafficDecision(request, env);
    if (!signal) return null;
    waitUntil(recordTrafficSignal(request, signal, env).catch(() => {
      console.warn('security_telemetry_unavailable');
    }));
    const status = signal.kind === 'probe_path' ? 404 : signal.kind === 'read_rate_limit' ? 429 : 403;
    return new Response(status === 429 ? 'Too many requests from this network. Please wait a minute and retry.' : status === 404 ? 'Not found.' : 'Cross-site feed requests are not supported.', {
      status, headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'private, no-store',...(status === 429 ? {'Retry-After':'60'} : {})},
    });
  } catch {
    // A limiter outage must not lock all readers out. Database authorization stays mandatory.
    console.warn('security_limiter_unavailable');
    return null;
  }
}

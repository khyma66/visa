export type PublicAuthConfig = { url: string; key: string };

/** A wrongly configured frontend must never receive a privileged database key. */
export function readPublicAuthConfig(url?: string, key?: string): PublicAuthConfig | null {
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) return null;
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) return null;
    if (key.startsWith('sb_publishable_')) return { url: parsed.origin, key };
    const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.role !== 'anon') return null;
    return { url: parsed.origin, key };
  } catch { return null; }
}

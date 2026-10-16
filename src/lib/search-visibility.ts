import type { MetadataRoute } from 'next';

type SearchEnvironment = Partial<Record<
  'APP_ENV' | 'PUBLIC_LAUNCH_APPROVED' | 'NEXT_PUBLIC_SITE_URL' | 'NEXT_PUBLIC_DEPLOYMENT_TARGET', string>>;

// Deliberately exclude individual discussions, imported posts, and member pages.
// Expand this list only after their publication and indexing policy is reviewed.
export const PUBLIC_SITEMAP_PATHS = [
  '/', '/us', '/countries', '/community-safety', '/contact',
  '/privacy', '/privacy-choices', '/terms', '/cookies',
] as const;

export const PRIVATE_CRAWL_PATHS = [
  '/api/', '/account', '/admin', '/owner', '/login', '/signup', '/messages',
  '/moderation', '/ask', '/assistant', '/feedback', '/my-communities', '/communities/new', '/experiences/new',
] as const;

/** Fail closed when the release gate or canonical origin is not configured. */
export function publicSearchOrigin(env: SearchEnvironment = process.env): string | null {
  if (env.APP_ENV !== 'production' || env.PUBLIC_LAUNCH_APPROVED !== 'true'
    || env.NEXT_PUBLIC_DEPLOYMENT_TARGET === 'sandbox') return null;

  const configured = env.NEXT_PUBLIC_SITE_URL;
  if (!configured || configured !== configured.trim() || /[\r\n\t]/.test(configured)) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || url.pathname !== '/' || url.search || url.hash
      || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')
      || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
      || ['visa-central.com', 'www.visa-central.com'].includes(url.hostname)
      || url.hostname.endsWith('.workers.dev')) return null;
    // Match middleware's redirect, rather than listing duplicate www URLs.
    if (url.hostname === 'www.visathreads.com') url.hostname = 'visathreads.com';
    return url.origin;
  } catch {
    return null;
  }
}

export function publicSitemap(env: SearchEnvironment = process.env): MetadataRoute.Sitemap {
  const origin = publicSearchOrigin(env);
  if (!origin) return [];
  // Do not invent lastModified dates from the request or deployment time.
  return PUBLIC_SITEMAP_PATHS.map((path) => ({ url: new URL(path, origin).href }));
}

export function publicRobots(env: SearchEnvironment = process.env): MetadataRoute.Robots {
  const origin = publicSearchOrigin(env);
  if (!origin) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: { userAgent: '*', allow: '/', disallow: [...PRIVATE_CRAWL_PATHS] },
    sitemap: `${origin}/sitemap.xml`,
  };
}

import type { MetadataRoute } from 'next';
import { VISA_GUIDES } from './visa-guides';

export type SearchEnvironment = Partial<Record<
  'APP_ENV' | 'PUBLIC_LAUNCH_APPROVED' | 'NEXT_PUBLIC_SITE_URL' | 'NEXT_PUBLIC_DEPLOYMENT_TARGET' | 'SEARCH_DISCOVERY_ENABLED', string>>;

// Imported content, member profiles and private areas are never enumerated here.
export const PUBLIC_SITEMAP_PATHS = [
  '/', '/us', '/countries', '/community-safety', '/contact',
  '/privacy', '/privacy-choices', '/terms', '/cookies', '/guides', '/about', '/security',
] as const;

export const PRIVATE_CRAWL_PATHS = [
  '/api/', '/account', '/admin', '/owner', '/login', '/signup', '/messages',
  '/moderation', '/ask', '/assistant', '/feedback', '/my-communities', '/communities/new', '/experiences/new',
] as const;

// Separate model-use controls from normal search crawlers. Google-Extended also
// controls Gemini grounding; it does not control inclusion in Google Search.
// Reviewed against operator documentation on 2026-10-18. robots is not access control.
export const MODEL_USE_CRAWLERS = ['GPTBot', 'ClaudeBot', 'Google-Extended'] as const;

// Owner-authorized search discovery is separate from opening community signup.
// It covers editorial pages only, never individual member or imported threads.
export function discoveryOrigin(env: SearchEnvironment = process.env): string | null {
  if (env.SEARCH_DISCOVERY_ENABLED !== 'true' || env.APP_ENV !== 'development') return null;
  return publicSearchOrigin({ ...env, APP_ENV: 'production', PUBLIC_LAUNCH_APPROVED: 'true' });
}

export function discoveryPath(path: string): boolean {
  return (PUBLIC_SITEMAP_PATHS as readonly string[]).includes(path)
    || VISA_GUIDES.some(guide => path === `/guides/${guide.slug}`);
}

/** Fail closed when the release gate or canonical origin is not configured. */
export function publicSearchOrigin(env: SearchEnvironment = process.env): string | null {
  if (env.APP_ENV !== 'production' || env.PUBLIC_LAUNCH_APPROVED !== 'true'
    || env.NEXT_PUBLIC_DEPLOYMENT_TARGET === 'sandbox'
    || env.NEXT_PUBLIC_DEPLOYMENT_TARGET === 'development-sandbox') return null;

  const configured = env.NEXT_PUBLIC_SITE_URL;
  if (!configured || configured !== configured.trim() || /[\r\n\t]/.test(configured)) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || url.pathname !== '/' || url.search || url.hash
      || !['visathreads.com', 'www.visathreads.com'].includes(url.hostname)) return null;
    // Match middleware's redirect, rather than listing duplicate www URLs.
    if (url.hostname === 'www.visathreads.com') url.hostname = 'visathreads.com';
    return url.origin;
  } catch {
    return null;
  }
}

export function publicSitemap(env: SearchEnvironment = process.env): MetadataRoute.Sitemap {
  const origin = publicSearchOrigin(env) ?? discoveryOrigin(env);
  if (!origin) return [];
  // Do not invent lastModified dates from the request or deployment time.
  return [...PUBLIC_SITEMAP_PATHS, ...VISA_GUIDES.map(guide => `/guides/${guide.slug}`)]
    .map((path) => ({ url: new URL(path, origin).href }));
}

export function publicRobots(env: SearchEnvironment = process.env): MetadataRoute.Robots {
  const origin = publicSearchOrigin(env) ?? discoveryOrigin(env);
  if (!origin) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: [...PRIVATE_CRAWL_PATHS] },
      { userAgent: [...MODEL_USE_CRAWLERS], disallow: '/' },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}

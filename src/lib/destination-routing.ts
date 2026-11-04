/** URL countries describe visa destinations, never residence or authorization. */
export const DESTINATIONS = [
  { code: 'us', name: 'United States', languages: ['en'], status: 'available' },
  { code: 'gb', name: 'United Kingdom', languages: ['en'], status: 'planned' },
  { code: 'ca', name: 'Canada', languages: ['en', 'fr'], status: 'planned' },
  { code: 'au', name: 'Australia', languages: ['en'], status: 'planned' },
] as const;

export const US_EN_ROOT = '/us/en';

/** Only implemented content routes migrate. Shared identity/support/API URLs stay stable. */
export function isDestinationContent(path: string): boolean {
  return path === '/' || path === '/us'
    || /^\/(news|tags|explore|guides|experiences)$/.test(path)
    || /^\/(guides|questions|experiences|c)\/[^/]+$/.test(path) && path !== '/experiences/new';
}

export function destinationPath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return value;
  const boundary = value.search(/[?#]/);
  const pathname = boundary < 0 ? value : value.slice(0, boundary);
  const suffix = boundary < 0 ? '' : value.slice(boundary);
  const path = pathname.replace(/\/$/, '') || '/';
  if (!isDestinationContent(path)) return value;
  return US_EN_ROOT + (path === '/' || path === '/us' ? '' : path) + suffix;
}

/** Root defaults to the current destination; middleware keeps this choice temporary. */
export function legacyDestinationRedirect(pathname: string): string | null {
  const target = destinationPath(pathname);
  return target === pathname ? null : target;
}

export function unprefixedDestinationPath(pathname: string): string {
  return pathname === US_EN_ROOT || pathname === US_EN_ROOT + '/' ? '/'
    : pathname.startsWith(US_EN_ROOT + '/') ? pathname.slice(US_EN_ROOT.length) : pathname;
}

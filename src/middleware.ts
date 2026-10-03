import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const production = process.env.APP_ENV === 'production';
  const approved = process.env.PUBLIC_LAUNCH_APPROVED === 'true';
  const sensitive = /^\/(login|signup|account|messages|moderation|ask)(\/|$)/.test(request.nextUrl.pathname);
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const localDevelopment = process.env.NODE_ENV === 'development';
  let backendSources = '';
  try {
    const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    if (backend.protocol === 'https:' && !backend.username && !backend.password) {
      backendSources = ` ${backend.origin} wss://${backend.host}`;
    }
  } catch { /* Unconfigured previews do not get a wildcard backend allowance. */ }
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${localDevelopment ? " 'unsafe-eval'" : ''}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self'${backendSources}${localDevelopment ? ' ws://localhost:* ws://127.0.0.1:*' : ''}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
  const requestHeaders = new Headers(request.headers);
  // Overwrite untrusted incoming CSP/nonce headers before the renderer reads them.
  requestHeaders.set('Content-Security-Policy', csp);
  requestHeaders.set('x-nonce', nonce);
  const response = production && !approved && request.nextUrl.pathname !== '/api/health'
    ? new NextResponse('VisaFlow is completing its public-launch checks. Please check back later.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '3600', 'Cache-Control': 'no-store' },
    }) : NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  response.headers.set('Content-Security-Policy', csp);
  if (request.nextUrl.protocol === 'https:') response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  if (!production || !approved || sensitive) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  // HTML with per-request nonces cannot be served from a shared page cache.
  // Public JSON feeds and fingerprinted static assets retain their own caching.
  if (!request.nextUrl.pathname.startsWith('/api/')) response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|assets/|favicon.svg).*)'] };

/**
 * Retired legacy MCP endpoint. The former handler exposed service-role database
 * and paid AI operations without authentication. Never enable it for the public
 * community. A future admin integration needs a separate authorization review.
 * This source change does not retire any previously deployed Worker by itself.
 */
export default {
  async fetch(): Promise<Response> {
    return new Response('This legacy endpoint is disabled.', {
      status: 410,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  },
};

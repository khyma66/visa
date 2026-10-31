// Permanent tombstone: old clients cannot trigger auth, database or model calls.
export function GET() {
  return Response.json({ posts: false, communities: false, catchup: false, code: 'removed' }, {
    status: 410,
    headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' },
  });
}

export const POST = GET;

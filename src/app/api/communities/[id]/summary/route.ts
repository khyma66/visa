// Fail closed: the summary prototype is not approved for hosted data or paid inference.
// Preserve the model/migration source for a separately validated rollout.
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ error: 'Community summaries are not available yet.' }, {
    status: 503,
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
export const POST = GET;

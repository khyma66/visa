// Arbitrary KV key access cannot safely be exposed as a public endpoint.
export async function GET() {
  return Response.json(
    { error: 'Cached content is temporarily unavailable.' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

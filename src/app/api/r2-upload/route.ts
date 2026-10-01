// Disabled until uploads enforce authenticated ownership, limits, and content rules.
export async function POST() {
  return Response.json(
    { error: 'File uploads are temporarily unavailable.' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

// Disabled until reads enforce object visibility and authenticated access where needed.
export async function GET() {
  return Response.json(
    { error: 'File access is temporarily unavailable.' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

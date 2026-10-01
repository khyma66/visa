// Disabled until deletion enforces authenticated ownership of an object.
export async function DELETE() {
  return Response.json(
    { error: 'File deletion is temporarily unavailable.' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

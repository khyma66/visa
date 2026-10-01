// Public callers must not enqueue arbitrary jobs using the Worker's privileged secret.
export async function POST() {
  return Response.json(
    { error: 'Clustering jobs are temporarily unavailable.' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

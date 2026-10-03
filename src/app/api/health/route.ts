export const dynamic = 'force-dynamic';

export function GET() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const production = process.env.APP_ENV === 'production';
  const ready = configured && (!production || process.env.PUBLIC_LAUNCH_APPROVED === 'true');
  return Response.json(
    {
      status: 'ok',
      service: 'visaflow',
      runtime: 'cloudflare-workers',
      environment: production ? 'production' : 'development',
      releaseStatus: ready ? 'configured' : 'not-ready',
      dependencyCheck: 'not-performed',
      timestamp: new Date().toISOString(),
    },
    {
      status: production && !ready ? 503 : 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}

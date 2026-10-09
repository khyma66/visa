import build from '@visa/build-provenance';

export const dynamic = 'force-dynamic';

export function GET() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const production = process.env.APP_ENV === 'production' || build.appEnvironment === 'production';
  const provenanceReady = Boolean(build.gitSha && build.gitTree && build.sourceSha256 && !build.dirty);
  const ready = configured && (!production || (process.env.PUBLIC_LAUNCH_APPROVED === 'true' && provenanceReady));
  return Response.json(
    {
      status: 'ok',
      service: 'visathreads',
      runtime: 'cloudflare-workers',
      environment: production ? 'production' : 'development',
      releaseStatus: ready ? 'configured' : 'not-ready',
      dependencyCheck: 'not-performed',
      build,
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

import archive from '@visa/archive';
import review from '../../../../../docs/release-review.json';
import { analyticsJson, authorizedAnalytics, summarizeImport } from '@/lib/analytics-server';
import { publicSearchOrigin } from '@/lib/search-visibility';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authorized = await authorizedAnalytics(request, { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY });
  if ('response' in authorized) return authorized.response;
  return analyticsJson({
    metrics: authorized.metrics,
    imports: summarizeImport(archive),
    readiness: {
      searchEligible: publicSearchOrigin() !== null,
      canonicalOrigin: 'https://visathreads.com',
      assistantEnabled: false,
      visitorTracking: 'not-configured', billing: 'not-configured',
    },
    release: {
      environment: process.env.APP_ENV ?? 'development',
      publicLaunchApproved: process.env.PUBLIC_LAUNCH_APPROVED === 'true',
      checks: Object.entries(review.checks).map(([key, value]) => ({ key, status: value.status })),
    },
  });
}

import { OwnerAnalyticsDashboard } from '@/components/OwnerAnalyticsDashboard';

export const metadata = { title: 'Private Analytics', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// This page is a sign-in shell only. All report data is authorized server-side
// and again in Postgres using the caller's live session and owner allowlist.
export default function AnalyticsPage() { return <OwnerAnalyticsDashboard />; }

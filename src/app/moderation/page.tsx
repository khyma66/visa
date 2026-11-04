import { ModerationDashboard } from '@/components/ModerationDashboard';
export const metadata = { title: 'Private Reports', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export default function ModerationPage() { return <ModerationDashboard />; }

import { OwnerSecurityDashboard } from '@/components/OwnerSecurityDashboard';
export const metadata = { title: 'Security | Owner workspace', robots: { index:false, follow:false } };
export const dynamic = 'force-dynamic';
export default function SecurityPage() { return <OwnerSecurityDashboard/>; }

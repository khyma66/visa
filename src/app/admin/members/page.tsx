import { OwnerMembersDashboard } from '@/components/OwnerMembersDashboard';
export const metadata = { title: 'Private Members', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
// Public shell contains no account data. The RPC checks live owner authorization.
export default function MembersPage() { return <OwnerMembersDashboard />; }

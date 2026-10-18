import { Suspense } from 'react';
import { OwnerLaunchWorkspace } from '@/components/OwnerLaunchWorkspace';

export const metadata = { title: 'Launch & Experiments', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// Only a sign-in shell is rendered here. Every data operation independently
// checks the caller's current session and the database's owner allowlist.
export default function LaunchPage() {
  return <Suspense fallback={<p className="p-6" role="status">Loading workspace…</p>}><OwnerLaunchWorkspace /></Suspense>;
}

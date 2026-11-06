import { Suspense } from 'react';
import { AdminWorkspace } from '@/components/AdminWorkspace';

export const metadata = { title: 'Admin workspace', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export default function AdminPage() { return <Suspense fallback={<p className="p-6" role="status">Loading admin workspace…</p>}><AdminWorkspace /></Suspense>; }

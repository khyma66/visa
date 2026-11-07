'use client';

import { lazy, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { useOwnerAccess } from './OwnerAccessProvider';
import { ADMIN_SECTIONS, adminHref, adminSection } from '@/lib/admin-navigation';

const panels = {
  analytics: lazy(() => import('./OwnerAnalyticsDashboard').then(module => ({ default: module.OwnerAnalyticsDashboard }))),
  members: lazy(() => import('./OwnerMembersDashboard').then(module => ({ default: module.OwnerMembersDashboard }))),
  reports: lazy(() => import('./ModerationDashboard').then(module => ({ default: module.ModerationDashboard }))),
  security: lazy(() => import('./OwnerSecurityDashboard').then(module => ({ default: module.OwnerSecurityDashboard }))),
  launch: lazy(() => import('./OwnerLaunchWorkspace').then(module => ({ default: module.OwnerLaunchWorkspace }))),
  feedback: lazy(() => import('./FeedbackInbox').then(module => ({ default: module.FeedbackInbox }))),
};

export function AdminWorkspace() {
  const { user, loading } = useAuth();
  const { status, retry } = useOwnerAccess();
  const params = useSearchParams();
  const section = adminSection(params.get('section'));
  const Panel = panels[section];
  if (loading || status === 'checking') return <main className="page-shell py-8"><h1 className="text-2xl font-bold">Admin workspace</h1><p role="status" className="mt-3">Checking access…</p></main>;
  if (!user) return <main className="page-shell py-8"><h1 className="text-2xl font-bold">Admin workspace</h1><Link href={`/login?next=${encodeURIComponent(adminHref(section))}`} className="mt-4 inline-block text-blue-700 underline">Sign in as owner</Link></main>;
  if (status !== 'owner') return <main className="page-shell py-8"><h1 className="text-2xl font-bold">Admin workspace</h1><p role="alert" className="mt-3">{status === 'error' ? 'We could not verify access. Please try again.' : 'This workspace is available only to the designated owner account.'}</p>{status === 'error' && <button onClick={retry} className="mt-4 rounded-lg border px-4 py-2">Retry</button>}<Link href="/account" className="mt-4 block text-blue-700 underline">Your account</Link></main>;
  return <div className="admin-workspace">
    <nav aria-label="Admin sections" className="tab-row border-b border-slate-200 px-4 py-2 lg:hidden">{ADMIN_SECTIONS.map(item => <Link key={item.id} href={adminHref(item.id)} prefetch={false} aria-current={section === item.id ? 'page' : undefined} className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${section === item.id ? 'bg-teal-50 text-teal-900' : 'text-slate-600 hover:bg-slate-50'}`}>{item.label}</Link>)}</nav>
    <Suspense fallback={<p role="status" className="p-6">Loading {ADMIN_SECTIONS.find(item => item.id === section)?.label.toLowerCase()}…</p>}><Panel key={`${user.id}:${section}`} /></Suspense>
  </div>;
}

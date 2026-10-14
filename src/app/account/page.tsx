import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AccountClient } from '@/components/AccountClient';

export const metadata: Metadata = { title: 'Your account', robots: { index: false, follow: false } };

export default function AccountPage() {
  return <Suspense fallback={<main className="site-shell py-12" role="status">Loading your account…</main>}><AccountClient /></Suspense>;
}

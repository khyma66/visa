import type { Metadata } from 'next';
import '../styles/globals.css';
import { AuthProvider } from '@/components/AuthProvider';
import { SiteHeader } from '@/components/SiteHeader';
import { CommunityAddonsNavigation } from '@/components/CommunityAddonsNavigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { CommunityNavigation } from '@/components/CommunityNavigation';

// A fresh CSP nonce must be attached to each request's streamed script tags.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'VisaFlow — Visa questions, answered', template: '%s · VisaFlow' },
  description: 'Ask visa questions with a public pseudonym, find similar cases, share experiences, and message other community members.',
  icons: { icon: '/favicon.svg' },
  keywords: 'visa questions, immigration community, pseudonymous visa discussions, visa answers',
  authors: [{ name: 'VisaFlow' }],
  openGraph: {
    type: 'website',
    title: 'VisaFlow — Visa questions, answered',
    description: 'Pseudonymous visa Q&A and access-controlled community messaging.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'VisaFlow — Visa questions, answered',
    description: 'Pseudonymous visa Q&A and access-controlled community messaging.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900 antialiased">
        <AuthProvider>
          <Suspense><SiteHeader /></Suspense>
          <div className="app-layout">
          <aside className="desktop-sidebar"><Suspense><CommunityNavigation /></Suspense></aside>
          <div className="app-content">
          <CommunityAddonsNavigation />
          <div id="main-content" tabIndex={-1}>{children}</div>
          <footer className="site-shell border-t border-slate-200 bg-white py-6 text-xs leading-6 text-slate-500">
            VisaFlow is a peer community, not a government service or legal adviser. Public usernames are pseudonyms, not a guarantee of anonymity.{' '}
            <Link href="/community-safety" className="font-bold text-teal-700 underline">Community safety</Link>
            <nav aria-label="Policies and support" className="mt-2 flex flex-wrap gap-x-4">
              <Link href="/privacy" className="underline">Preview privacy notice</Link>
              <Link href="/terms" className="underline">Community rules</Link>
              <Link href="/contact" className="underline">Reporting and privacy requests</Link>
            </nav>
          </footer>
          </div>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}

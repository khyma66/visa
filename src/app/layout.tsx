import type { Metadata } from 'next';
import '../styles/globals.css';
import { AuthProvider } from '@/components/AuthProvider';
import { SiteHeader } from '@/components/SiteHeader';
import { CommunityAddonsNavigation } from '@/components/CommunityAddonsNavigation';
import Link from 'next/link';
import { PolicyAcceptance } from '@/components/PolicyAcceptance';
import { SafetyNotice } from '@/components/SafetyNotice';
import { Suspense } from 'react';
import { CommunityNavigation } from '@/components/CommunityNavigation';

// A fresh CSP nonce must be attached to each request's streamed script tags.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL('https://visathreads.com'),
  title: { default: 'VisaThreads — U.S. Visa Questions, Answered', template: '%s · VisaThreads' },
  description: 'Ask visa questions with a public pseudonym, find similar cases, share experiences, and message other community members.',
  icons: { icon: '/favicon.svg' },
  keywords: 'visa questions, immigration community, pseudonymous visa discussions, visa answers',
  authors: [{ name: 'VisaThreads' }],
  openGraph: {
    type: 'website',
    title: 'VisaThreads — U.S. Visa Questions, Answered',
    description: 'Pseudonymous visa Q&A and access-controlled community messaging.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'VisaThreads — U.S. Visa Questions, Answered',
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
          <div id="main-content" tabIndex={-1}><PolicyAcceptance>{children}</PolicyAcceptance></div>
          <footer className="site-shell border-t border-slate-200 bg-white py-6 text-xs leading-6 text-slate-500">
            {process.env.NEXT_PUBLIC_APP_ENV !== 'production' && <p role="note" className="mb-2 font-semibold text-slate-700">Early preview · Not open for general public signup.</p>}
            <SafetyNotice />
            <nav aria-label="Policies and support" className="mt-2 flex flex-wrap gap-x-4">
              <Link href="/privacy" className="underline">Preview Privacy Notice</Link>
              <Link href="/terms" className="underline">Community Rules</Link>
              <Link href="/cookies" className="underline">Cookies and Storage</Link>
              <Link href="/privacy-choices" className="underline">Your Privacy Choices</Link>
              <Link href="/countries" className="underline">U.S. Community</Link>
              <Link href="/contact" className="underline">Reporting and Privacy Requests</Link>
            </nav>
          </footer>
          </div>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}

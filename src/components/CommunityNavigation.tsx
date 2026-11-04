'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Bell, BookOpen, Compass, Home, MessageCircle, Newspaper, NotebookPen, Plus, ShieldCheck, Tags, TrendingUp, Users } from 'lucide-react';
import { useAuth } from './AuthProvider';

export function CommunityNavigation({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { user } = useAuth();
  const askHref = user ? '/ask' : '/login?next=%2Fask#sign-in';
  const popular = (pathname === '/us/en' || pathname === '/') && params.get('sort') === 'score';
  const sections = [
    ...(mobile ? [{ name: 'Create & Ask', links: [
      { href: askHref, label: 'Ask a Question', icon: Plus },
    ] }] : []),
    { name: 'Discover', links: [
      { href: '/us/en', label: 'Home', icon: Home, active: (pathname === '/us/en' || pathname === '/') && !popular },
      { href: '/us/en?sort=score', label: 'Popular', icon: TrendingUp, active: popular },
      { href: '/us/en/explore', label: 'Explore Communities', icon: Compass },
      { href: '/us/en/news', label: 'News', icon: Newspaper },
      { href: '/us/en/experiences', label: 'Experience', icon: NotebookPen },
      { href: '/us/en/tags', label: 'Tags', icon: Tags },
    ] },
    { name: 'Your Communities', links: [
      { href: '/my-communities', label: 'My Communities', icon: Users },
      { href: '/notifications', label: 'Notifications', icon: Bell },
      { href: '/messages', label: 'Messages', icon: MessageCircle },
      { href: '/communities/new', label: 'Start a Community', icon: Plus },
    ] },
  ];
  return <nav aria-label={mobile ? 'Mobile navigation' : 'Main navigation'} className="community-navigation capitalize">
    {sections.map((section) => <div key={section.name} className="nav-section">
      <p className="nav-section-title">{section.name}</p>
      {section.links.map(({ href, label, icon: Icon, ...state }) => {
        const active = 'active' in state ? state.active : pathname === href;
        return <Link key={href} href={href} prefetch={section.name === 'Discover' ? true : undefined} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={`nav-item ${active ? 'nav-item-active' : ''}`}>
          <Icon size={20} strokeWidth={1.7} aria-hidden="true"/><span>{label}</span>
        </Link>;
      })}
    </div>)}
    <div className="nav-section">
      <p className="nav-section-title capitalize">Resources</p>
      <Link href="/countries" onClick={onNavigate} className="nav-item capitalize"><Compass size={20} aria-hidden="true"/>Visa Destinations</Link>
      <Link href="/us/en/guides" onClick={onNavigate} aria-current={pathname.startsWith('/us/en/guides') ? 'page' : undefined} className={`nav-item ${pathname.startsWith('/us/en/guides') ? 'nav-item-active' : ''} capitalize`}><BookOpen size={20} strokeWidth={1.7} aria-hidden="true"/>Visa Guides</Link>
      <Link href="/community-safety" onClick={onNavigate} className="nav-item capitalize"><ShieldCheck size={20} strokeWidth={1.7} aria-hidden="true"/>Community Safety</Link>
      <div className="nav-policy-links capitalize">
        <Link href="/about" onClick={onNavigate} className="capitalize">About</Link>
        <Link href="/privacy" onClick={onNavigate} className="capitalize">Privacy</Link>
        <Link href="/terms" onClick={onNavigate} className="capitalize">Rules</Link>
        <Link href="/contact" onClick={onNavigate} className="capitalize">Help & Contact</Link>
      </div>
    </div>
  </nav>;
}

'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { BookOpen, Compass, Home, MessageCircle, Newspaper, NotebookPen, Plus, ShieldCheck, Tags, TrendingUp, Users } from 'lucide-react';
import { useAuth } from './AuthProvider';

export function CommunityNavigation({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { user } = useAuth();
  const askHref = user ? '/ask' : '/login?next=%2Fask#sign-in';
  const popular = pathname === '/' && params.get('sort') === 'score';
  const sections = [
    ...(mobile ? [{ name: 'Create & Ask', links: [
      { href: askHref, label: 'Ask a Question', icon: Plus },
    ] }] : []),
    { name: 'Discover', links: [
      { href: '/', label: 'Home', icon: Home, active: pathname === '/' && !popular },
      { href: '/?sort=score', label: 'Popular', icon: TrendingUp, active: popular },
      { href: '/explore', label: 'Explore Communities', icon: Compass },
      { href: '/news', label: 'News', icon: Newspaper },
      { href: '/experiences', label: 'Experience', icon: NotebookPen },
      { href: '/tags', label: 'Tags', icon: Tags },
    ] },
    { name: 'Your Communities', links: [
      { href: '/my-communities', label: 'My Communities', icon: Users },
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
      <Link href="/guides" onClick={onNavigate} aria-current={pathname.startsWith('/guides') ? 'page' : undefined} className={`nav-item ${pathname.startsWith('/guides') ? 'nav-item-active' : ''} capitalize`}><BookOpen size={20} strokeWidth={1.7} aria-hidden="true"/>Visa Guides</Link>
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

'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Compass, Home, MessageCircle, Newspaper, Plus, ShieldCheck, Tags, TrendingUp, Users } from 'lucide-react';

export function CommunityNavigation({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const popular = pathname === '/' && params.get('sort') === 'score';
  const sections = [
    { name: 'Discover', links: [
      { href: '/', label: 'Home', icon: Home, active: pathname === '/' && !popular },
      { href: '/?sort=score', label: 'Popular', icon: TrendingUp, active: popular },
      { href: '/explore', label: 'Explore communities', icon: Compass },
      { href: '/news', label: 'News', icon: Newspaper },
      { href: '/experiences', label: 'Experience', icon: MessageCircle },
      { href: '/tags', label: 'Tags', icon: Tags },
    ] },
    { name: 'Your communities', links: [
      { href: '/my-communities', label: 'My communities', icon: Users },
      { href: '/messages', label: 'Messages', icon: MessageCircle },
      { href: '/communities/new', label: 'Start a community', icon: Plus },
    ] },
  ];
  return <nav aria-label={mobile ? 'Mobile navigation' : 'Main navigation'} className="community-navigation">
    {sections.map((section) => <div key={section.name} className="nav-section">
      <p className="nav-section-title">{section.name}</p>
      {section.links.map(({ href, label, icon: Icon, ...state }) => {
        const active = 'active' in state ? state.active : pathname === href;
        return <Link key={href} href={href} prefetch={false} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={`nav-item ${active ? 'nav-item-active' : ''}`}>
          <Icon size={20} strokeWidth={1.7} aria-hidden="true"/><span>{label}</span>
        </Link>;
      })}
    </div>)}
    <div className="nav-section">
      <p className="nav-section-title">Resources</p>
      <Link href="/community-safety" onClick={onNavigate} className="nav-item"><ShieldCheck size={20} strokeWidth={1.7} aria-hidden="true"/>Community safety</Link>
      <div className="nav-policy-links">
        <Link href="/privacy" onClick={onNavigate}>Privacy</Link>
        <Link href="/terms" onClick={onNavigate}>Rules</Link>
        <Link href="/contact" onClick={onNavigate}>Help & reporting</Link>
      </div>
    </div>
  </nav>;
}

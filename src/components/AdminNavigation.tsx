'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { BarChart3, Users, Flag, ShieldCheck, ClipboardList, Inbox, ArrowLeft, Settings, Plus } from 'lucide-react';
import { ADMIN_SECTIONS, adminHref, adminSection } from '@/lib/admin-navigation';

const icons = { analytics: BarChart3, members: Users, reports: Flag, security: ShieldCheck, launch: ClipboardList, feedback: Inbox };
export function AdminNavigation({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = pathname === '/admin' ? adminSection(params.get('section')) : pathname === '/owner/feedback' ? 'feedback' : pathname.split('/')[2];
  return <nav aria-label={mobile ? 'Mobile admin navigation' : 'Admin navigation'} className="community-navigation">
    {mobile && <div className="nav-section nav-create"><Link href="/ask" onClick={onNavigate} className="nav-item"><Plus size={20} aria-hidden="true"/><span>Ask a Question</span></Link></div>}
    <div className="nav-section"><p className="nav-section-title">Admin workspace</p>
      {ADMIN_SECTIONS.map(section => {
        const Icon = icons[section.id];
        const active = selected === section.id;
        return <Link key={section.id} href={adminHref(section.id)} prefetch={false} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={`nav-item ${active ? 'nav-item-active' : ''}`}><Icon size={20} aria-hidden="true"/><span>{section.label}</span></Link>;
      })}
    </div>
    <div className="nav-section"><Link href="/account?tab=settings" onClick={onNavigate} className="nav-item"><Settings size={20} aria-hidden="true"/>Account settings</Link><Link href="/us/en" onClick={onNavigate} className="nav-item"><ArrowLeft size={20} aria-hidden="true"/>Visit community</Link></div>
  </nav>;
}

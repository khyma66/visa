'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Compass, Newspaper, Plus, Users } from 'lucide-react';

/** Add beside the existing header; never replace the host application's navigation. */
export function CommunityAddonsNavigation() {
  const pathname = usePathname();
  const links = [
    ['/explore', 'Explore communities', Compass],
    ['/my-communities', 'My communities', Users],
    ['/news', 'News', Newspaper],
    ['/communities/new', 'Start a community', Plus],
  ] as const;
  return <div className="community-shortcuts">
    <nav aria-label="Community tools" className="flex flex-wrap items-center gap-2 px-4 py-2">
      {links.map(([href, label, Icon]) => <Link key={href} href={href} prefetch={false}
        aria-current={pathname === href ? 'page' : undefined}
        className={`inline-flex min-h-11 items-center rounded-full border px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${href === '/communities/new'
          ? 'border-teal-700 bg-teal-700 text-white hover:bg-teal-800'
          : pathname === href ? 'border-teal-200 bg-teal-50 text-teal-900' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
        <Icon size={16} className="mr-2 shrink-0" aria-hidden="true"/>{label}
      </Link>)}
    </nav>
  </div>;
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Add beside the existing header; never replace the host application's navigation. */
export function CommunityAddonsNavigation() {
  const pathname = usePathname();
  const links = [
    ['/explore', 'Explore communities'],
    ['/my-communities', 'My communities'],
    ['/news', 'News'],
    ['/communities/new', 'Start a community'],
  ];
  return <div className="border-b border-slate-200 bg-white">
    <nav aria-label="Community tools" className="site-shell flex flex-wrap items-center gap-2 py-3">
      {links.map(([href, label]) => <Link key={href} href={href}
        aria-current={pathname === href ? 'page' : undefined}
        className={`inline-flex min-h-11 items-center rounded-full border px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${href === '/communities/new'
          ? 'border-teal-700 bg-teal-700 text-white hover:bg-teal-800'
          : pathname === href ? 'border-teal-200 bg-teal-50 text-teal-900' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
        {label}
      </Link>)}
    </nav>
  </div>;
}

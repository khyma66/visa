'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Share2 } from 'lucide-react';

/** Share an existing public post; the new discussion links back to its source. */
export function PostShare({ path }: { path: string }) {
  const [status, setStatus] = useState('');
  const sharePath = `/ask?shared=${encodeURIComponent(path)}`;
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
      setStatus('Link copied.');
    } catch { setStatus('Could not copy the link. Open the post and copy its address.'); }
  }
  return <details className="relative text-xs font-semibold text-slate-600">
    <summary className="post-action cursor-pointer list-none"><Share2 size={16} aria-hidden="true"/>Share</summary>
    <div className="absolute left-0 z-20 mt-1 w-56 space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
      <button type="button" onClick={() => void copyLink()} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50">Copy link</button>
      <Link href={sharePath} className="block rounded-lg px-3 py-2 hover:bg-slate-50">Share to a community</Link>
      {status && <p role="status" className="px-3 py-2 font-normal">{status}</p>}
    </div>
  </details>;
}

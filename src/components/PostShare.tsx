'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Share2, Link2, Users, MessageCircle, Send, Mail, Smartphone, ExternalLink } from 'lucide-react';

/** Share an existing public post; the new discussion links back to its source. */
export function PostShare({ path }: { path: string }) {
  const [status, setStatus] = useState('');
  const [origin, setOrigin] = useState('https://visathreads.com');
  const [nativeShare, setNativeShare] = useState(false);
  const [menuOffset, setMenuOffset] = useState(0);
  useEffect(() => { setOrigin(window.location.origin); setNativeShare(typeof navigator.share === 'function'); }, []);
  const url = new URL(path, origin).href;
  const itemClass = 'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700';
  const destinations = [
    { label: 'WhatsApp', Icon: MessageCircle, href: `https://wa.me/?text=${encodeURIComponent(url)}` },
    { label: 'Telegram', Icon: Send, href: `https://t.me/share/url?url=${encodeURIComponent(url)}` },
    { label: 'Reddit', Icon: ExternalLink, href: `https://www.reddit.com/submit?url=${encodeURIComponent(url)}` },
    { label: 'Email', Icon: Mail, href: `mailto:?subject=${encodeURIComponent('A discussion on VisaThreads')}&body=${encodeURIComponent(url)}` },
  ];
  const sharePath = `/ask?shared=${encodeURIComponent(path)}`;
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
      setStatus('Link copied.');
    } catch { setStatus('Could not copy the link. Open the post and copy its address.'); }
  }
  async function shareOnDevice() {
    try { await navigator.share({ url, title: 'VisaThreads discussion' }); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('Sharing is unavailable. Try Copy link instead.'); }
  }
  return <details className="relative text-xs font-semibold text-slate-600" onToggle={event => {
    if (!event.currentTarget.open) return;
    const left = event.currentTarget.getBoundingClientRect().left;
    const width = Math.min(224, window.innerWidth - 32);
    setMenuOffset(Math.max(8 - left, Math.min(0, window.innerWidth - 8 - left - width)));
    setStatus('');
  }} onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
    <summary className="post-action cursor-pointer list-none"><Share2 size={16} aria-hidden="true"/>Share</summary>
    <div style={{ left: menuOffset }} className="absolute z-20 mt-1 w-56 max-w-[calc(100vw-2rem)] space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
      <button type="button" onClick={() => void copyLink()} className={itemClass}><Link2 size={16} aria-hidden="true"/>Copy link</button>
      <Link href={sharePath} className={itemClass}><Users size={16} aria-hidden="true"/>Share to a community</Link>
      {destinations.map(({ label, Icon, href }) => <a key={label} href={href} target="_blank" rel="noopener noreferrer" className={itemClass}><Icon size={16} aria-hidden="true"/>{label}<span className="sr-only"> (opens another app or tab)</span></a>)}
      {nativeShare && <button type="button" onClick={() => void shareOnDevice()} className={itemClass}><Smartphone size={16} aria-hidden="true"/>More apps…</button>}
      {status && <p role="status" className="px-3 py-2 font-normal">{status}</p>}
    </div>
  </details>;
}

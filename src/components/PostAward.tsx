'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Award } from 'lucide-react';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { useAuth } from './AuthProvider';

type Badge = 'helpful' | 'support' | 'insightful';
type Summary = Record<Badge, number> & { mine: Badge | null };
const badges: Array<[Badge,string]> = [['helpful','Helpful'],['support','Support'],['insightful','Insightful']];

export function PostAward({ postId, authorId, path }: { postId: string; authorId: string | null; path: string }) {
  const { user, demoMode } = useAuth();
  const [open,setOpen] = useState(false);
  const [data,setData] = useState<Summary | null>(null);
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const pending = useRef(false);
  useEffect(() => { setData(null); setOpen(false); setMessage(''); request.current?.abort(); pending.current=false; setBusy(false); }, [user?.id,postId]);
  useEffect(() => () => { request.current?.abort(); }, []);
  async function run(badge?: Badge) {
    if (pending.current) return;
    if (demoMode || !isSupabaseConfigured) { setMessage('Awards are unavailable in this preview.'); return; }
    const controller = new AbortController(); request.current?.abort(); request.current=controller;
    pending.current=true; setBusy(true); setMessage('');
    try {
      const query = badge ? getSupabase().rpc('set_post_award',{target:postId,selected_badge:badge}) : getSupabase().rpc('post_award_summary',{target:postId});
      const {data:result,error}=await query.abortSignal(AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]));
      if (error) throw error;
      if (!controller.signal.aborted) setData(result as Summary);
    } catch { if (!controller.signal.aborted) { setData(null); setMessage('Awards are temporarily unavailable. Please try again.'); } }
    finally { if (!controller.signal.aborted) { pending.current=false; setBusy(false); } }
  }
  return <div className="relative text-xs font-semibold text-slate-600">
    <button type="button" aria-expanded={open} onClick={() => { const next=!open; setOpen(next); if (next && user) void run(); }} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-2 hover:bg-slate-200"><Award size={14} aria-hidden="true"/>Award</button>
    {open && <div className="absolute left-0 z-20 mt-1 w-64 space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
      <p className="font-normal leading-5">Free recognition, with no payment or monetary value. Choose one badge; select it again to remove it.</p>
      {busy && <p role="status">Loading awards…</p>}
      {message && <p role="status">{message} <button type="button" className="underline" onClick={() => void run()}>Retry</button></p>}
      {data && <div className="space-y-1">{badges.map(([id,label]) => <button key={id} type="button" disabled={busy || !user || user.id===authorId} aria-pressed={data.mine===id} onClick={() => void run(id)} className="flex w-full justify-between rounded-lg px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-50"><span>{label}{data.mine===id ? ' ✓' : ''}</span><span>{data[id]}</span></button>)}</div>}
      {!user && <Link href={`/login?next=${encodeURIComponent(path)}`} className="block text-blue-700 underline">Log in to give an award</Link>}
      {user && user.id===authorId && <p className="font-normal">You cannot award your own post.</p>}
    </div>}
  </div>;
}

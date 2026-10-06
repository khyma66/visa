'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Tags } from 'lucide-react';
import type { CommunityFeed } from '@/lib/types';

export function TagDirectory() {
  const [feed,setFeed]=useState<CommunityFeed|null>(null);
  const [error,setError]=useState('');
  const [search,setSearch]=useState('');
  const [sort,setSort]=useState('popular');
  useEffect(()=>{
    const controller=new AbortController();
    void fetch('/api/community',{signal:controller.signal}).then(async(response)=>{
      if(!response.ok) throw new Error('Topics are currently unavailable.');
      setFeed(await response.json());
    }).catch((reason)=>{if(!controller.signal.aborted)setError(reason.message);});
    return ()=>controller.abort();
  },[]);
  const tags=useMemo(()=>{
    const rows=new Map<string,{count:number;examples:string[]}>();
    for(const q of feed?.questions??[]) for(const tag of new Set(q.tags)) {
      const row=rows.get(tag)??{count:0,examples:[]}; row.count++;
      if(row.examples.length<2) row.examples.push(q.title);
      rows.set(tag,row);
    }
    return [...rows].filter(([tag])=>tag.includes(search.trim().toLowerCase()))
      .sort((a,b)=>sort==='name'?a[0].localeCompare(b[0]):b[1].count-a[1].count||a[0].localeCompare(b[0]));
  },[feed,search,sort]);
  return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
    <Link href="/" className="text-sm text-blue-700 hover:underline">← All questions</Link>
    <div className="mt-5 flex items-center gap-3"><Tags className="text-orange-600"/><h1 className="text-3xl font-medium">Tags</h1></div>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">A tag describes the topic of a question. Browse topics, then choose one to see matching posts and related discussions.</p>
    <div className="my-6 flex flex-wrap items-center gap-3">
      <label className="relative"><Search size={17} className="absolute left-3 top-3 text-slate-400"/><input aria-label="Filter tags" value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Filter by tag name" className="rounded border bg-white py-2 pl-10 pr-3"/></label>
      <select aria-label="Sort tags" value={sort} onChange={(e)=>setSort(e.target.value)} className="rounded border bg-white p-2"><option value="popular">Most used</option><option value="name">Name A–Z</option></select>
      {feed&&<p role="status" className="ml-auto text-sm text-slate-500">{tags.length} tags · {feed.questions.length} posts</p>}
    </div>
    {error?<p role="alert" className="rounded bg-amber-50 p-4 text-amber-900">{error}</p>:!feed?<p>Loading tags…</p>:<>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{tags.map(([tag,row])=><Link key={tag} href={`/?tag=${encodeURIComponent(tag)}`} className="flex min-h-44 flex-col rounded border border-slate-200 bg-white p-5 hover:border-blue-400">
        <span className="w-fit rounded bg-blue-50 px-2 py-1 text-sm font-semibold text-blue-700">{tag}</span>
        <p className="my-3 line-clamp-3 text-xs leading-5 text-slate-600">{row.examples[0]}</p>
        <span className="mt-auto text-xs font-semibold text-slate-500">{row.count} {row.count===1?'post':'posts'}</span>
      </Link>)}</div>
      {!tags.length&&<p>No tags match “{search}”.</p>}
      <p className="mt-6 text-xs text-slate-500">Counts cover the discussions loaded here. A post may have several tags.</p>
    </>}
  </main>;
}

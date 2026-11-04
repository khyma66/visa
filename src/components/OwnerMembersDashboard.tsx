'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthProvider';
import { getSupabase } from '@/lib/supabase/client';
import { memberCsv, type MemberPage, type MemberCursor } from '@/lib/members';

const button = 'min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50';
const stamp = (value: string | null) => value ? new Date(value).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }) + ' UTC' : 'Never / unavailable';
type Filters = { search: string; status: string; days: number };

function Directory() {
  const [draft, setDraft] = useState<Filters>({search:'',status:'all',days:0});
  const [filters, setFilters] = useState(draft);
  const [cursors, setCursors] = useState<MemberCursor[]>([null]);
  const [data, setData] = useState<MemberPage | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const request = useRef<AbortController | null>(null);
  const cursor = cursors[cursors.length-1];
  async function load(exportPage: boolean, signal: AbortSignal) {
    const {data: result,error: failure} = await getSupabase().rpc('owner_members', {
      search_text:filters.search,account_filter:filters.status,joined_days:filters.days,
      before_created_at:cursor?.created_at ?? null,before_id:cursor?.id ?? null,export_page:exportPage,
    }).abortSignal(AbortSignal.any([signal,AbortSignal.timeout(15000)]));
    if (failure) throw new Error(failure.code==='42501' ? 'Owner access required. Sign in with the designated owner account.' : 'Members could not be loaded. Please retry.');
    return result as MemberPage;
  }
  useEffect(() => {
    const controller = new AbortController(); request.current = controller;
    setData(null); setError(''); setBusy(true);
    void load(false,controller.signal).then(result => {if (!controller.signal.aborted) setData(result);})
      .catch(reason => {if (!controller.signal.aborted) setError(reason.message);})
      .finally(() => {if (!controller.signal.aborted) setBusy(false);});
    return () => {controller.abort();};
  }, [filters,cursor,refresh]);
  async function download() {
    if (!window.confirm('Download this page of member emails for account administration? Keep the file private and delete it when no longer needed. Signup does not establish marketing consent.')) return;
    request.current?.abort();
    const controller = new AbortController(); request.current=controller;
    setBusy(true); setError('');
    try {
      const result = await load(true,controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(new Blob(['\ufeff',memberCsv(result.items)],{type:'text/csv;charset=utf-8'}));
      const a=document.createElement('a'); a.href=url; a.download=`visathreads-members-page-${cursors.length}.csv`; a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      setData(result);
    } catch(reason) {if (!controller.signal.aborted) {setData(null);setError(reason instanceof Error?reason.message:'Export failed.');}}
    finally {if (!controller.signal.aborted) setBusy(false);}
  }
  useEffect(() => () => {request.current?.abort();},[]);
  return <>
    <form className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4" onSubmit={event=>{event.preventDefault();setCursors([null]);setFilters({...draft,search:draft.search.trim()});}}>
      <label className="flex-1 text-sm font-semibold capitalize">Search email or username<input type="search" maxLength={200} value={draft.search} onChange={e=>setDraft({...draft,search:e.target.value})} className={`${button} mt-1 block w-full font-normal`} placeholder="Search members"/></label>
      <label className="text-sm font-semibold capitalize">Account filter<select value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})} className={`${button} mt-1 block`}><option value="all" className="capitalize">All accounts</option><option value="verified" className="capitalize">Email verified</option><option value="unverified" className="capitalize">Email unverified</option><option value="suspended" className="capitalize">Suspended</option></select></label>
      <label className="text-sm font-semibold capitalize">Signed up<select value={draft.days} onChange={e=>setDraft({...draft,days:Number(e.target.value)})} className={`${button} mt-1 block`}><option value={0} className="capitalize">Any time</option><option value={7} className="capitalize">Last 7 days</option><option value={30} className="capitalize">Last 30 days</option><option value={90} className="capitalize">Last 90 days</option></select></label>
      <button className={`${button} capitalize`} disabled={busy}>Apply filters</button>
      <button type="button" className={`${button} capitalize`} disabled={busy} onClick={()=>{setCursors([null]);setRefresh(v=>v+1);}}>Refresh</button>
    </form>
    {busy && <p role="status" className="capitalize">Checking owner access and loading members…</p>}
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-4 text-rose-900">{error}</p>}
    {data && <>
      <dl className="grid gap-4 sm:grid-cols-3">{[['Registered accounts',data.total],['Email verified',data.verified],['Signed up in 7 days',data.joined_7_days]].map(([label,value])=><div key={label} className="rounded-xl border border-slate-200 p-5"><dt className="text-sm text-slate-600">{label}</dt><dd className="mt-2 text-3xl font-bold tabular-nums">{value}</dd></div>)}</dl>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><p>{data.matched} matching accounts · Page {cursors.length} · {data.items.length} shown</p><button className={`${button} capitalize`} disabled={busy||!data.items.length} onClick={()=>void download()}>Export this page (CSV)</button></div>
      <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-left text-sm"><caption className="p-4 text-left font-semibold">Registered members · newest signups first</caption><thead className="bg-slate-50"><tr>{['Member','Signup email','Verification / status','Signed up','Last sign-in','Questions','Experiences','Replies'].map(label=><th key={label} scope="col" className="whitespace-nowrap px-4 py-3">{label}</th>)}</tr></thead><tbody>{data.items.map(row=><tr key={row.id} className="border-t border-slate-100"><th scope="row" className="px-4 py-3 font-medium">{row.username||'Profile not created'}{row.is_owner&&<span className="block text-xs text-teal-800 capitalize">Owner</span>}<details className="mt-1 text-xs text-slate-500"><summary className="capitalize">Member ID</summary>{row.id}</details></th><td className="px-4 py-3">{row.email||'No email on account'}</td><td className="px-4 py-3 capitalize"><span className="capitalize">{row.email_verified?'Verified':'Unverified'}</span><span className={`block text-xs ${row.suspended?'text-rose-800':'text-slate-500'} capitalize`}>{row.suspended?'Suspended':'Not suspended'}</span></td><td className="whitespace-nowrap px-4 py-3">{stamp(row.created_at)}</td><td className="whitespace-nowrap px-4 py-3">{stamp(row.last_sign_in_at)}</td>{[row.questions,row.experiences,row.replies].map((v,i)=><td key={i} className="px-4 py-3 tabular-nums">{v}</td>)}</tr>)}</tbody></table>{!data.items.length&&<p className="p-6 text-slate-600 capitalize">No accounts match these filters.</p>}</div>
      <nav aria-label="Member pages" className="flex gap-3"><button className={`${button} capitalize`} disabled={busy||cursors.length===1} onClick={()=>setCursors(v=>v.slice(0,-1))}>Previous</button><button className={`${button} capitalize`} disabled={busy||!data.next_cursor} onClick={()=>setCursors(v=>[...v,data.next_cursor])}>Next</button></nav>
      <p className="text-xs leading-5 text-slate-500">Updated {stamp(data.generated_at)}. Totals include owner and test accounts, but exclude anonymous and deleted accounts; they differ from eligible-member analytics. Contribution counts cover retained, non-archived posts and active replies. Last sign-in is not a last-seen or online indicator. Each page is a live snapshot; refresh to see newer signups.</p>
    </>}
  </>;
}
export function OwnerMembersDashboard() {
  const {user,loading,demoMode}=useAuth();
  return <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6"><header className="flex flex-wrap items-start justify-between gap-4"><div className="capitalize"><p className="text-xs font-semibold tracking-wider text-teal-800 capitalize">Owner workspace</p><h1 className="mt-2 text-3xl font-bold tracking-tight capitalize">Members</h1><p className="mt-2 text-sm text-slate-600 capitalize">Understand signups and account activity in one private view.</p></div><nav aria-label="Owner dashboards" className="flex flex-wrap gap-2"><Link className={`${button} capitalize`} href="/admin/analytics">Analytics</Link><Link href="/admin/reports" className={`${button} capitalize`}>Reports</Link><Link href="/admin/security" className={`${button} capitalize`}>Security</Link><Link className={`${button} capitalize`} href="/admin/launch">Launch & experiments</Link><Link className={`${button} capitalize`} href="/owner/feedback">Feedback inbox</Link></nav></header><p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950 capitalize">Confidential account information, available only to the designated owner. Use it for administration and support, not unsolicited marketing. Views and export requests are audited for 90 days. No passwords, private conversations, or session credentials are displayed.</p>{loading?<p role="status" className="capitalize">Checking your account…</p>:demoMode?<p className="capitalize">Member information is unavailable in demo mode.</p>:!user?<Link className={`${button} capitalize`} href="/login?next=%2Fadmin%2Fmembers#sign-in">Sign in as owner</Link>:<Directory key={user.id}/>}</main>;
}

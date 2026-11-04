'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ShieldCheck, Radar, Flag, History } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { getSupabase } from '@/lib/supabase/client';

type Case = { id:string; version:number; review_status:string };
type Traffic = Case & {kind:string;route_group:string;actor_hash:string;observations:number;first_seen:string;last_seen:string;ray_id:string|null;decision:string};
type Report = Case & {subject_username:string|null;subject_id:string|null;reporter_id:string|null;reason:string;details:string;target_kind:string;target_id:string;source:string;reported_at:string;captured_at:string;content_excerpt:string|null;content_sha256:string|null;report_status:string;qualifying_reporter:boolean};
type Dashboard = {
  generated_at:string; traffic:Traffic[]; reports:Report[];
  repeat_members:{subject_id:string;username:string|null;distinct_reporters:number;reports:number;latest_at:string}[];
  review_history:{id:number;case_kind:string;case_id:string;decision:string;note:string;created_at:string}[];
  pending_alerts:number;ingest_key_configured:boolean;last_traffic_observed:string|null;
};
type Cursor = {time:string;id:string}|null;
const button='min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50';
const stamp=(value:string|null)=>value ? new Date(value).toLocaleString('en-US',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})+' UTC':'Not observed';
const label=(value:string)=>value === 'imported_answer' ? 'Archive reply' : value.replaceAll('_',' ');

function Review({item,kind,onSaved}:{item:Case;kind:'traffic'|'report';onSaved:()=>void}) {
  const [decision,setDecision]=useState('reviewing'),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <form className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4" onSubmit={async event=>{
    event.preventDefault();setBusy(true);setError('');
    try {
      const result=await getSupabase().rpc('security_review',{case_kind:kind,case_id:item.id,expected_version:item.version,decision,note}).abortSignal(AbortSignal.timeout(15000));
      if(result.error) throw new Error(result.error.code==='40001'?'This case changed. Refresh before reviewing.':result.error.code==='42501'?'A current owner session is required. Sign in again.':'Review could not be saved. Please retry.');
      setNote('');onSaved();
    } catch(reason) {setError(reason instanceof Error?reason.message:'Review could not be saved.');} finally {setBusy(false);}
  }}>
    <label className="text-sm font-medium">Review decision<select className={`${button} mt-1 block`} value={decision} onChange={e=>setDecision(e.target.value)}><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option><option value="false_positive">False positive</option><option value="open">Reopen</option></select></label>
    <label className="min-w-48 flex-1 text-sm font-medium">Review note <span aria-hidden="true">*</span><input className={`${button} mt-1 block w-full font-normal`} value={note} onChange={e=>setNote(e.target.value)} minLength={5} maxLength={1000} required placeholder="Record evidence and the reason for your decision"/></label>
    <button className={button} disabled={busy}>{busy?'Saving…':'Save review'}</button>
    {error&&<p role="alert" className="w-full text-sm text-rose-800">{error}</p>}
  </form>;
}
function Console() {
  const [tab,setTab]=useState<'traffic'|'reports'|'history'|'coverage'>('traffic');
  const [trafficPages,setTrafficPages]=useState<Cursor[]>([null]),[reportPages,setReportPages]=useState<Cursor[]>([null]);
  const [data,setData]=useState<Dashboard|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  const traffic=trafficPages.at(-1),report=reportPages.at(-1);
  useEffect(()=>{
    const controller=new AbortController();setData(null);setError('');
    void (async()=>{
      const result=await getSupabase().rpc('owner_security_dashboard',{traffic_before:traffic?.time??null,traffic_id:traffic?.id??null,report_before:report?.time??null,report_id:report?.id??null}).abortSignal(AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]));
      if(controller.signal.aborted)return;
      if(result.error){setError(result.error.code==='42501'?'A current owner session is required. Other members and moderators cannot open security evidence.':'Security data is unavailable. Nothing has been marked as safe or empty. Please retry.');return;}
      setData(result.data as Dashboard);
    })().catch(()=>{if(!controller.signal.aborted)setError('Security data could not be loaded. Please retry.');});
    return()=>controller.abort();
  },[traffic,report,refresh]);
  const reload=()=>setRefresh(v=>v+1);
  return <>
    <nav aria-label="Security sections" className="flex flex-wrap gap-2">{([
      ['traffic','Traffic signals',Radar],['reports','Peer reports',Flag],['history','Review history',History],['coverage','Coverage',ShieldCheck],
    ] as const).map(([key,title,Icon])=><button key={key} className={`${button} inline-flex items-center gap-2 ${tab===key?'border-teal-700 text-teal-900':''}`} aria-pressed={tab===key} onClick={()=>setTab(key)}><Icon size={16}/>{title}</button>)}<button className={`${button} sm:ml-auto`} onClick={()=>{setTrafficPages([null]);setReportPages([null]);reload();}}>Refresh</button></nav>
    {error?<p role="alert" className="rounded-xl bg-rose-50 p-5 text-rose-900">{error}</p>:!data?<p role="status">Checking owner access and loading evidence…</p>:<>
      {tab==='traffic'&&<section className="space-y-4" aria-label="Traffic signals"><p className="text-sm leading-6 text-slate-600">Sampled signals from requests that reached the website. A network may be shared by many people. These are not proof of scraping or exact request counts. No raw IP addresses, query text or browser credentials are stored here.</p>
        {!data.ingest_key_configured&&<p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-950">Traffic evidence delivery is not configured. An empty list does not mean there was no suspicious traffic.</p>}
        <p className="text-xs text-slate-500">Last recorded observation: {stamp(data.last_traffic_observed)}</p>
        {data.traffic.map(item=><article key={item.id} className="rounded-xl border border-slate-200 bg-white p-5"><header className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold capitalize">{label(item.kind)} · {item.route_group}</h2><span className="rounded-full bg-slate-100 px-3 py-1 text-xs capitalize">{label(item.review_status)}</span></header><p className="mt-2 text-sm">{item.observations} sampled observation{item.observations===1?'':'s'} · {item.decision} · {stamp(item.last_seen)}</p><p className="mt-2 text-xs text-slate-500">Daily network reference {item.actor_hash.slice(0,12)} · First observed {stamp(item.first_seen)}</p>{item.ray_id&&<p className="mt-1 break-all text-xs text-slate-500">Cloudflare request reference: {item.ray_id}</p>}<Review item={item} kind="traffic" onSaved={reload}/></article>)}
        {!data.traffic.length&&<p className="rounded-xl border border-slate-200 p-6 text-slate-600">No retained traffic observations on this page. See Coverage for monitoring limitations.</p>}
        <nav aria-label="Traffic pages" className="flex gap-2"><button className={button} disabled={trafficPages.length===1} onClick={()=>setTrafficPages(p=>p.slice(0,-1))}>Previous</button><button className={button} disabled={data.traffic.length<50} onClick={()=>{const last=data.traffic.at(-1)!;setTrafficPages(p=>[...p,{time:last.last_seen,id:last.id}]);}}>Older observations</button></nav>
      </section>}
      {tab==='reports'&&<section className="space-y-4" aria-label="Peer report evidence"><div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950"><h2 className="font-semibold">Review signals, not automatic penalties</h2><p>Three distinct verified reporters with accounts at least 24 hours old, within seven days, flag a member for review. Self-reports, automatic signals, dismissed reports and false positives do not count. Coordinated reporting is still possible: verify the evidence before taking action.</p><Link className="mt-2 inline-block font-semibold underline" href="/admin/reports">Open moderation actions</Link></div>
        {data.repeat_members.map(member=><div key={member.subject_id} className="rounded-xl border border-amber-200 p-4"><p className="font-semibold">{member.username?'u/'+member.username:'Member no longer available'}</p><p className="text-sm text-slate-600">{member.distinct_reporters} distinct eligible reporters · {member.reports} reports · Latest {stamp(member.latest_at)}</p></div>)}
        {data.reports.map(item=><article key={item.id} className="rounded-xl border border-slate-200 p-5"><header className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">{item.subject_username?'u/'+item.subject_username:'Unavailable member'} · <span className="capitalize">{label(item.reason)}</span></h2><span className="rounded-full bg-slate-100 px-3 py-1 text-xs capitalize">{label(item.review_status)}</span></header><p className="mt-2 text-sm text-slate-600">{label(item.target_kind)} · {item.source==='automatic'?'Automatic signal':'Member allegation'} · Report status: {item.report_status} · {stamp(item.reported_at)}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{item.details||'No additional details supplied.'}</p><details className="mt-4 rounded-lg bg-slate-50 p-4"><summary className="cursor-pointer text-sm font-semibold">View first-report evidence</summary><p className="my-2 text-xs text-slate-500">Captured {stamp(item.captured_at)}. Up to 6,000 characters from the reported item only; other private messages are excluded. Content may subsequently have changed. A fingerprint detects changes; it does not prove an allegation.</p><pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">{item.content_excerpt??'The target was unavailable at capture.'}</pre>{item.content_sha256&&<p className="mt-3 break-all text-xs text-slate-500">SHA-256: {item.content_sha256}</p>}<p className="mt-2 break-all text-xs text-slate-500">Case {item.id} · Target {item.target_id} · Reporter reference {item.reporter_id??'Account removed'} · {item.qualifying_reporter?'Established verified reporter at capture':'Not counted toward escalation'}</p></details><Review item={item} kind="report" onSaved={reload}/></article>)}
        {!data.reports.length&&<p className="rounded-xl border border-slate-200 p-6 text-slate-600">No retained report evidence on this page. Capture starts when this feature is enabled; older reports are not reconstructed.</p>}
        <nav aria-label="Report pages" className="flex gap-2"><button className={button} disabled={reportPages.length===1} onClick={()=>setReportPages(p=>p.slice(0,-1))}>Previous</button><button className={button} disabled={data.reports.length<50} onClick={()=>{const last=data.reports.at(-1)!;setReportPages(p=>[...p,{time:last.reported_at,id:last.id}]);}}>Older reports</button></nav>
      </section>}
      {tab==='history'&&<section className="space-y-3" aria-label="Review history"><p className="text-sm text-slate-600">Latest 50 decisions. Notes are append-only; resolving a case does not remove its evidence or suspend a member.</p>{data.review_history.map(item=><article key={item.id} className="rounded-xl border border-slate-200 p-4"><h2 className="font-semibold capitalize">{item.case_kind} · {label(item.decision)}</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm">{item.note}</p><p className="mt-2 break-all text-xs text-slate-500">{stamp(item.created_at)} · Case {item.case_id}</p></article>)}{!data.review_history.length&&<p>No security reviews recorded yet.</p>}</section>}
      {tab==='coverage'&&<section className="space-y-4 text-sm leading-6" aria-label="Security coverage"><h2 className="text-xl font-semibold">What this dashboard covers</h2><ul className="list-disc space-y-2 pl-5"><li>Owner-only access requires a current, unrevoked login session. Member, moderator and anonymous accounts cannot read this evidence.</li><li>Public read limits are per network and Cloudflare location, not a global quota. Shared networks may reach a limit; distributed or slow scraping can still succeed.</li><li>Public content can be copied. The public archive download and direct public database reads are not made private by these edge rules.</li><li>Cloudflare WAF blocks happen before the website and are not included here. Zone Security Events access is not connected.</li><li>Traffic: 30-day retention. Report snapshots: 90 days. Review notes: 365 days. Daily cleanup removes expired records.</li><li>Traffic keys rotate daily. Reports retain only the specific reported item; no general inbox access is added.</li></ul><div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950"><h3 className="font-semibold">Email alerts: not connected</h3><p>{data.pending_alerts} deduplicated alert{data.pending_alerts===1?'':'s'} queued in the dashboard. No email has been sent by this feature. Delivery needs a verified owner inbox and a configured transactional sender. Email should contain a short summary and dashboard link, not report evidence.</p></div><p className="text-slate-500">Security signals support investigation; they are not a guarantee of safety or legal proof. Review access and retention when changing your privacy policy.</p></section>}
      <p className="text-xs text-slate-500">Updated {stamp(data.generated_at)} · Refresh for a new snapshot.</p>
    </>}
  </>;
}
export function OwnerSecurityDashboard() {
  const {user,loading,demoMode}=useAuth();
  return <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6"><header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-teal-800">Owner workspace</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Security</h1><p className="mt-2 text-sm text-slate-600">Investigate suspicious traffic and reported behavior with a documented review trail.</p></div><nav aria-label="Owner dashboards" className="flex flex-wrap gap-2"><Link className={button} href="/admin/analytics">Analytics</Link><Link className={button} href="/admin/members">Members</Link><Link className={button} href="/admin/reports">Reports</Link></nav></header>{loading?<p role="status">Checking your account…</p>:demoMode?<p>Security evidence is unavailable in demo mode.</p>:!user?<Link className={button} href="/login?next=%2Fadmin%2Fsecurity#sign-in">Sign in as owner</Link>:<Console key={user.id}/>}</main>;
}

import type { SecurityBindings } from './security-edge';

export const VIEW_ID = /^(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|apify-[a-zA-Z0-9_-]{1,160})$/;
const pairs: Record<string,string> = {
  'visathreads.com':'https://cycnichledvqbxevrwnt.supabase.co',
  'www.visathreads.com':'https://cycnichledvqbxevrwnt.supabase.co',
  'visaflow-dev.varunchinna5966.workers.dev':'https://cycnichledvqbxevrwnt.supabase.co',
  'visa-central.com':'https://ppdwysmeistjxzjpmxyk.supabase.co',
  'www.visa-central.com':'https://ppdwysmeistjxzjpmxyk.supabase.co',
};
export function viewsJson(value: unknown, status=200) {
  return Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex'}});
}
export async function viewFingerprint(secret:string,post:string,ip:string,agent:string,day:string) {
  const encoder=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signed=await crypto.subtle.sign('HMAC',key,encoder.encode(JSON.stringify(['post-view-v1',day,post,ip,agent])));
  return [...new Uint8Array(signed)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function handlePostViews(request:Request,env:SecurityBindings,visibleImported:(id:string)=>boolean,now=new Date()) {
  const url=new URL(request.url), origin=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,secret=env.SECURITY_INGEST_KEY;
  if (!origin || origin!==pairs[url.hostname] || !key || !secret || !/^[a-f0-9]{64}$/.test(secret)) return viewsJson({},503);
  if (request.headers.get('sec-fetch-site')==='cross-site') return viewsJson({},403);
  const ids=url.searchParams.getAll('id');
  if (!ids.length || ids.length>50 || ids.some(id=>!VIEW_ID.test(id))) return viewsJson({},400);
  const targets=[...new Set(ids)].filter(id=>!id.startsWith('apify-')||visibleImported(id));
  if (!targets.length) return viewsJson([]);
  const ip=request.headers.get('cf-connecting-ip');
  if (!ip || !env.SECURITY_READ_LIMIT) return viewsJson({},503);
  if (!(await env.SECURITY_READ_LIMIT.limit({key:`post-views:${url.hostname}:${ip}`})).success) return viewsJson({},429);
  const args:{targets:string[];fingerprint?:string;view_day?:string}={targets};
  if (request.method==='POST') {
    if (ids.length!==1 || request.headers.get('origin')!==url.origin) return viewsJson({},403);
    const ua=request.headers.get('user-agent')??'';
    // Respect privacy signals; bot filtering is a deterrent, not proof of a human.
    if (request.headers.get('sec-gpc')==='1' || request.headers.get('dnt')==='1' || !ua || /bot|crawl|spider|headless|preview|lighthouse/i.test(ua)) return viewsJson({},202);
    args.view_day=now.toISOString().slice(0,10);
    args.fingerprint=await viewFingerprint(secret,targets[0],ip,ua.slice(0,512),args.view_day);
  }
  const response=await fetch(`${origin}/rest/v1/rpc/post_views`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json','x-security-ingest-key':secret},body:JSON.stringify(args),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(5000)});
  if (!response.ok) {await response.body?.cancel();return viewsJson({},503);}
  const rows:unknown=await response.json();
  if (!Array.isArray(rows) || rows.length>50 || rows.some(row=>!targets.includes(row?.post_id)||!Number.isSafeInteger(row?.views)||row.views<0)) return viewsJson({},503);
  return viewsJson(rows);
}

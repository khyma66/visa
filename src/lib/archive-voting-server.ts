import type {SecurityBindings} from './security-edge';
import {viewsJson} from './post-views-server';
const origins:Record<string,string>={
  'visathreads.com':'https://cycnichledvqbxevrwnt.supabase.co','www.visathreads.com':'https://cycnichledvqbxevrwnt.supabase.co',
  'visaflow-dev.varunchinna5966.workers.dev':'https://cycnichledvqbxevrwnt.supabase.co',
  'visa-central.com':'https://ppdwysmeistjxzjpmxyk.supabase.co','www.visa-central.com':'https://ppdwysmeistjxzjpmxyk.supabase.co',
};
export async function handleArchiveVotes(request:Request,env:SecurityBindings,exists:(kind:string,id:string)=>boolean) {
  const url=new URL(request.url),origin=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,secret=env.SECURITY_INGEST_KEY;
  if(!origin||origin!==origins[url.hostname]||!key||!secret||!/^[a-f0-9]{64}$/.test(secret))return viewsJson({},503);
  if(request.headers.get('sec-fetch-site')==='cross-site')return viewsJson({},403);
  const ip=request.headers.get('cf-connecting-ip');
  if(!ip||!env.SECURITY_READ_LIMIT)return viewsJson({},503);
  if(!(await env.SECURITY_READ_LIMIT.limit({key:`archive-votes:${url.hostname}:${ip}`})).success)return viewsJson({},429);
  const kind=url.searchParams.get('kind'),ids=url.searchParams.getAll('id');
  if(!kind||!['question','answer'].includes(kind)||!ids.length||ids.length>50||ids.some(id=>!/^apify-[a-zA-Z0-9_-]{1,160}$/.test(id)||!exists(kind,id)))return viewsJson({},404);
  const authorization=request.headers.get('authorization');
  if(authorization&&(!/^Bearer [A-Za-z0-9._-]+$/.test(authorization)||authorization.length>8192))return viewsJson({},401);
  let rpc='archive_vote_summary',args:Record<string,unknown>={kind,targets:[...new Set(ids)]};
  if(request.method==='POST'){
    if(request.headers.get('origin')!==url.origin)return viewsJson({},403);
    if(!authorization)return viewsJson({},401);
    if(ids.length!==1||!request.headers.get('content-type')?.startsWith('application/json'))return viewsJson({},400);
    const reader=request.body?.getReader();if(!reader)return viewsJson({},400);
    let body='',length=0;const decoder=new TextDecoder();
    try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>1024){await reader.cancel();return viewsJson({},413);}body+=decoder.decode(part.value,{stream:true});}body+=decoder.decode();}catch{return viewsJson({},400);}
    let data;try{data=JSON.parse(body);}catch{return viewsJson({},400);}
    if(!data||![-1,0,1].includes(data.selected)||typeof data.expected_user!=='string'||!/^[a-f0-9-]{36}$/i.test(data.expected_user))return viewsJson({},400);
    rpc='set_archive_vote';args={kind,target:ids[0],selected:data.selected,expected_user:data.expected_user};
  }else if(request.method!=='GET')return viewsJson({},405);
  const response=await fetch(`${origin}/rest/v1/rpc/${rpc}`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json','x-security-ingest-key':secret,...(authorization?{Authorization:authorization}:{})},body:JSON.stringify(args),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(8000)});
  const result:unknown=await response.json();
  const code=result&&typeof result==='object'&&'code' in result?result.code:null;
  if(!response.ok)return viewsJson({message:code==='42501'?'Please sign in and review the current community policies.':code==='P0001'?'Voting is temporarily limited. Please try again later.':'Could not save your vote.'},response.status===401?401:response.status===403?403:503);
  if(rpc==='set_archive_vote')return Number.isSafeInteger(result)?viewsJson({score:result}):viewsJson({},503);
  if(!Array.isArray(result)||result.length!==new Set(ids).size||result.some(row=>!ids.includes(row?.id)||!Number.isSafeInteger(row?.score)||![-1,0,1].includes(row?.value)))return viewsJson({},503);
  return viewsJson(result);
}

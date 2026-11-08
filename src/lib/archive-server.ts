import {boundedNewsBytes} from './licensed-news';
export async function archiveRows(query:Record<string,string>,table:'archive_posts'|'archive_metadata'='archive_posts') {
  const origin=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!origin||!key)throw new Error('Archive configuration unavailable');
  const url=new URL('/rest/v1/'+table,origin);
  for(const [name,value] of Object.entries(query))url.searchParams.set(name,value);
  const response=await fetch(url,{headers:{apikey:key,Accept:'application/json'},redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('Archive read unavailable');
  return JSON.parse(new TextDecoder().decode(await boundedNewsBytes(response,512000)));
}
export function archiveEnabled(){return process.env.COMMUNITY_SOURCE_MODE==='snapshot'&&(process.env.APP_ENV!=='production'||process.env.IMPORTED_CONTENT_APPROVED==='true');}

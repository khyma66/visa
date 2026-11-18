import {boundedNewsBytes} from './licensed-news';
import {usVisaPost} from './post-presentation';
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

/** Validate against the published index, including content added after a build. */
export async function publishedArchiveQuestionIds(ids:string[],read=archiveRows):Promise<Set<string>> {
  const targets=[...new Set(ids)];
  if(!archiveEnabled()||!targets.length)return new Set();
  if(targets.length>50||targets.some(id=>!/^apify-[a-zA-Z0-9_-]{1,160}$/.test(id)))throw new Error('Invalid archive targets');
  const rows=await read({id:`in.(${targets.join(',')})`,select:'payload',limit:'50'});
  return new Set(rows.filter((row:{payload?:{id:string;status:string;destination_country?:string;visa_type?:string;title?:string;body?:string}})=>
    row.payload&&targets.includes(row.payload.id)&&row.payload.status!=='archived'&&usVisaPost(row.payload)
  ).map((row:{payload:{id:string}})=>row.payload.id));
}

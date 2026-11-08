import {archiveEnabled,archiveRows} from '@/lib/archive-server';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  if(!archiveEnabled()||!/^apify-[a-zA-Z0-9_-]{1,160}$/.test(id))return Response.json({error:'Not found'},{status:404});
  try {
    const rows=await archiveRows({id:`eq.${id}`,select:'payload,source_answers',limit:'1'});
    if(!rows[0])return Response.json({error:'Not found'},{status:404});
    return Response.json({question:rows[0].payload,answers:rows[0].source_answers},{headers:{'Cache-Control':'public, max-age=30','X-Content-Type-Options':'nosniff'}});
  }catch{return Response.json({error:'Discussion temporarily unavailable'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'30'}});}
}

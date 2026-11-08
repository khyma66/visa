import {archiveRows} from '@/lib/archive-server';
export const dynamic='force-dynamic';
export async function GET(){
 try{await archiveRows({select:'id',limit:'1'});return Response.json({status:'ready'},{headers:{'Cache-Control':'no-store'}});}
 catch{console.warn(JSON.stringify({event:'database_readiness_failed'}));return Response.json({status:'unavailable'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'30'}});}
}

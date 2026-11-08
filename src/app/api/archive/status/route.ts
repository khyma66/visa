import {archiveEnabled,archiveRows} from '@/lib/archive-server';
export async function GET(){
  try{return Response.json({available:archiveEnabled(),source:archiveEnabled()?(await archiveRows({select:'source',limit:'1'},'archive_metadata'))[0]?.source??null:null},{headers:{'Cache-Control':'public, max-age=60'}});}
  catch{return Response.json({error:'Archive unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
}

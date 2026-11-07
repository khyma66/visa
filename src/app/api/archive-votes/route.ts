import {handleArchiveVotes} from '@/lib/archive-voting-server';
import {usVisaPost} from '@/lib/post-presentation';
import {viewsJson} from '@/lib/post-views-server';
import {publicArchive} from '@/lib/public-server';
import type {SecurityBindings} from '@/lib/security-edge';
export const dynamic='force-dynamic';
async function handle(request:Request){
  try{
    const archive=publicArchive(),questions=new Set(archive?.questions.filter(q=>q.status!=='archived'&&usVisaPost(q)).map(q=>q.id)??[]);
    const answers=new Set(Object.values(archive?.answersByQuestionId??{}).flat().filter(a=>a.status==='active'&&questions.has(a.question_id)).map(a=>a.id)??[]);
    const env=(await import('cloudflare:workers')).env as SecurityBindings;
    return await handleArchiveVotes(request,env,(kind,id)=>(kind==='question'?questions:answers).has(id));
  }catch{return viewsJson({},503);}
}
export const GET=handle;
export const POST=handle;

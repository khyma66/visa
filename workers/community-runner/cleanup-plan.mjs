import { LABEL } from './core.mjs';
export function validateCleanupContent(plan,questions,answers) {
  const check=(value)=>{if(!value)throw new Error('Foreign, duplicate or unmarked content; cleanup stopped');};
  const jobs=new Map(plan.jobs.map(j=>[j.id,j])),remoteIds=new Map();
  for(const [items,kind] of [[questions,'question'],[answers,'answer']]) for(const item of items) {
    const prefix=`${LABEL} ${plan.campaign}/`;
    check(typeof item.body==='string' && item.body.startsWith(prefix));
    const jobId=item.body.slice(prefix.length).split('\n')[0],job=jobs.get(jobId);
    check(job && job.kind===kind && !remoteIds.has(jobId) && item.author_id===plan.actors[job.actor]?.id);
    if(kind==='question')check(item.title.startsWith('[Synthetic test] '));
    else check(item.question_id===remoteIds.get(job.question_id));
    remoteIds.set(jobId,item.id);
  }
}

import {getSupabase,isSupabaseConfigured} from './supabase/client';
import {readDemoVote,writeDemoVote} from './community';
export type VoteKind='question'|'answer'|'imported_answer';
export type VoteValue=-1|0|1;
type Pending={id:string;resolve:(value:VoteValue)=>void;reject:(reason:Error)=>void};
const batches=new Map<string,Pending[]>();
/** Batch a feed's selection reads; never cache one account's selections for another. */
export function readVote(kind:VoteKind,id:string,userId:string):Promise<VoteValue> {
  if(!isSupabaseConfigured)return Promise.resolve(readDemoVote(kind,id,userId));
  return new Promise((resolve,reject)=>{
    const key=`${kind}:${userId}`,pending=batches.get(key);
    if(pending){pending.push({id,resolve,reject});return;}
    const rows=[{id,resolve,reject}];batches.set(key,rows);
    queueMicrotask(async()=>{
      batches.delete(key);
      for(let i=0;i<rows.length;i+=50){const chunk=rows.slice(i,i+50);try{
        const client=getSupabase();
        const {data,error}=kind==='imported_answer'?await client.rpc('imported_reply_vote_state',{targets:chunk.map(row=>row.id)}):await client.from(kind==='question'?'question_votes':'answer_votes').select(`${kind}_id,value`).eq('user_id',userId).in(`${kind}_id`,chunk.map(row=>row.id));
        if(error)throw error;
        for(const row of chunk){const match=(data as unknown as Record<string,unknown>[]??[]).find(item=>item[kind==='imported_answer'?'id':`${kind}_id`]===row.id);row.resolve(match?.value===1?1:match?.value===-1?-1:0);}
      }catch{chunk.forEach(row=>row.reject(new Error('Could not load your vote.')));}}
    });
  });
}
export async function writeVote(kind:VoteKind,id:string,userId:string,value:VoteValue):Promise<number> {
  if(!isSupabaseConfigured)return writeDemoVote(kind,id,userId,value);
  const client=getSupabase();
  const {data:identity,error:identityError}=await client.auth.getUser();
  if(identityError||identity.user?.id!==userId)throw new Error('Your account changed. Please sign in again.');
  if(kind==='imported_answer'){
    const {data,error}=await client.rpc('vote_imported_reply',{target:id,vote_value:value,expected_user:userId});
    if(error)throw new Error(error.message);if(typeof data!=='number'||!Number.isInteger(data))throw new Error('Your vote could not be confirmed.');return data;
  }
  const {data,error}=await client.rpc('set_native_vote',{kind,target:id,selected:value,expected_user:userId});
  if(error)throw new Error(error.message);
  if(typeof data!=='number'||!Number.isInteger(data))throw new Error('Your vote could not be confirmed.');
  return data;
}

'use client';

import {useEffect,useRef,useState} from 'react';
import {ArrowDown,ArrowUp,ThumbsUp} from 'lucide-react';
import {useAuth} from './AuthProvider';
import {readVote,writeVote,type VoteKind,type VoteValue} from '@/lib/voting';

/** One horizontal, touch-sized voting control on cards, posts and replies. */
export function VoteControls({id,kind,score,authorId,path,readOnly=false}:{id:string;kind:VoteKind;score:number;authorId:string|null;path:string;readOnly?:boolean}) {
  const {user}=useAuth();
  const [confirmed,setConfirmed]=useState<number|null>(null);
  const [selection,setSelection]=useState<VoteValue>(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const lock=useRef(false),version=useRef(0);
  useEffect(()=>{setConfirmed(null);},[score]);
  useEffect(()=>{
    const current=++version.current;setSelection(0);setConfirmed(null);setError('');lock.current=false;setBusy(false);
    if(user&&!readOnly)void readVote(kind,id,user.id).then(value=>{if(version.current===current&&!lock.current)setSelection(value);}).catch(()=>{});
    return()=>{version.current++;};
  },[id,kind,user?.id,readOnly]);
  async function vote(value:-1|1) {
    if(!user){window.location.href=`/login?next=${encodeURIComponent(path)}`;return;}
    if(lock.current||user.id===authorId||readOnly)return;
    lock.current=true;setBusy(true);setError('');const current=++version.current;
    try {
      const next=selection===value?0:value;
      const result=await writeVote(kind,id,user.id,next);
      if(current===version.current){setConfirmed(result);setSelection(next);}
    }catch(reason){if(current===version.current)setError(reason instanceof Error?reason.message:'Could not save your vote. Please try again.');}
    finally{if(current===version.current){lock.current=false;setBusy(false);}}
  }
  if(readOnly)return <span className="vote-reactions" aria-label={`${score} reactions`}><ThumbsUp size={16} aria-hidden="true"/>{score.toLocaleString('en-US')}<span>reactions</span></span>;
  const own=user?.id===authorId;
  return <div className="vote-control-wrap">
    <div className="vote-controls" role="group" aria-label={kind==='question'?'Post votes':'Comment votes'} aria-busy={busy}>
      <button type="button" disabled={own||busy} aria-label="Upvote" aria-pressed={selection===1} title={own?'You cannot vote on your own contribution':selection===1?'Remove upvote':'Upvote'} onClick={()=>void vote(1)} className="vote-up"><ArrowUp size={19} aria-hidden="true"/></button>
      <span className="vote-score" aria-live="polite" aria-label={`${confirmed??score} votes`}>{Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(confirmed??score)}</span>
      <button type="button" disabled={own||busy} aria-label="Downvote" aria-pressed={selection===-1} title={own?'You cannot vote on your own contribution':selection===-1?'Remove downvote':'Downvote'} onClick={()=>void vote(-1)} className="vote-down"><ArrowDown size={19} aria-hidden="true"/></button>
    </div>
    {error&&<p role="alert" className="vote-error">{error}</p>}
  </div>;
}

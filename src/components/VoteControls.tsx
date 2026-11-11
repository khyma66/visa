'use client';

import {useEffect,useRef,useState} from 'react';
import {ArrowBigDown,ArrowBigUp} from 'lucide-react';
import {useAuth} from './AuthProvider';
import {readArchiveVote,readVote,writeVote,type VoteKind,type VoteValue} from '@/lib/voting';

/** One compact horizontal voting control on cards, posts and replies. */
export function VoteControls({id,kind,score,authorId,path}:{id:string;kind:VoteKind;score:number;authorId:string|null;path:string}) {
  const {user}=useAuth();
  const archive=kind.startsWith('archive_');
  const [confirmed,setConfirmed]=useState<number|null>(null);
  const [selection,setSelection]=useState<VoteValue>(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const lock=useRef(false),version=useRef(0);
  useEffect(()=>{if(!archive)setConfirmed(null);},[score,archive]);
  useEffect(()=>{
    const current=++version.current;setSelection(0);setConfirmed(null);setError('');lock.current=false;setBusy(false);
    if(archive)void readArchiveVote(kind,id,user?.id??null).then(data=>{if(version.current===current&&!lock.current){setSelection(data.value);setConfirmed(data.score);}}).catch(()=>{});
    else if(user)void readVote(kind,id,user.id).then(value=>{if(version.current===current&&!lock.current)setSelection(value);}).catch(()=>{});
    return()=>{version.current++;};
  },[id,kind,user?.id,archive]);
  async function vote(value:-1|1) {
    if(!user){window.location.href=`/login?next=${encodeURIComponent(path)}`;return;}
    if(lock.current||user.id===authorId)return;
    lock.current=true;setBusy(true);setError('');const current=++version.current;
    try {
      const next=selection===value?0:value;
      const result=await writeVote(kind,id,user.id,next);
      if(current===version.current){setConfirmed(result);setSelection(next);}
    }catch(reason){if(current===version.current)setError(reason instanceof Error?reason.message:'Could not save your vote. Please try again.');}
    finally{if(current===version.current){lock.current=false;setBusy(false);}}
  }
  const own=user?.id===authorId;
  const displayed=archive&&confirmed===null?'—':Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(confirmed??score);
  return <div className="vote-control-wrap">
    <div className="vote-controls" role="group" aria-label={kind==='question'||kind==='archive_question'?'Post votes':'Comment votes'} title={archive?'Votes from VisaThreads members':undefined} aria-busy={busy}>
      <button type="button" disabled={own||busy} aria-label="Upvote" aria-pressed={selection===1} title={own?'You cannot vote on your own contribution':selection===1?'Remove upvote':'Upvote'} onClick={()=>void vote(1)} className="vote-up"><ArrowBigUp size={20} strokeWidth={1.75} fill={selection===1?'currentColor':'none'} aria-hidden="true"/></button>
      <span className="vote-score" aria-live="polite" aria-label={archive&&confirmed===null?'Votes loading':`${confirmed??score} ${archive?'VisaThreads ':''}votes`}>{displayed}</span>
      <button type="button" disabled={own||busy} aria-label="Downvote" aria-pressed={selection===-1} title={own?'You cannot vote on your own contribution':selection===-1?'Remove downvote':'Downvote'} onClick={()=>void vote(-1)} className="vote-down"><ArrowBigDown size={20} strokeWidth={1.75} fill={selection===-1?'currentColor':'none'} aria-hidden="true"/></button>
    </div>
    {error&&<p role="alert" className="vote-error">{error}</p>}
  </div>;
}

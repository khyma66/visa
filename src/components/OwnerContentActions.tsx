'use client';
import {useId,useRef,useState} from 'react';
import {Pencil,Trash2} from 'lucide-react';
import {useAuth} from './AuthProvider';
import {CompactTextarea} from './CompactTextarea';
import {manageOwnContent} from '@/lib/community';
import type {Question,Answer} from '@/lib/types';

export function OwnerContentActions({content,kind,canEdit=true,onChanged}:{content:Question|Answer;kind:'question'|'answer'|'imported_answer';canEdit?:boolean;onChanged?:(deleted:boolean)=>void}){
 const {user}=useAuth();const dialog=useRef<HTMLDialogElement>(null),lock=useRef(false);const label=useId();
 const [mode,setMode]=useState<'edit'|'delete'>('edit'),[body,setBody]=useState(content.body),[title,setTitle]=useState('title' in content?content.title:''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 if(!user||user.id!==content.author_id||content.source==='apify')return null;
 const noun=kind==='question'?'post':'comment';
 function open(action:'edit'|'delete'){setMode(action);setBody(content.body);setTitle('title' in content?content.title:'');setError('');dialog.current?.showModal();}
 async function submit(event:React.FormEvent){event.preventDefault();if(lock.current||!user)return;lock.current=true;setBusy(true);setError('');
  try{await manageOwnContent({kind,id:content.id,operation:mode,body:body.trim(),title:kind==='question'?title.trim():undefined,expectedBody:content.body,expectedTitle:'title' in content?content.title:undefined,userId:user.id});dialog.current?.close();if(onChanged)onChanged(mode==='delete');else window.location.reload();}
  catch(reason){setError(reason instanceof Error?reason.message:'Could not save this change.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <>
  {canEdit&&<button type="button" className="post-action" onClick={()=>open('edit')}><Pencil size={16} aria-hidden="true"/>Edit {noun}</button>}
  <button type="button" className="post-action text-red-700" onClick={()=>open('delete')}><Trash2 size={16} aria-hidden="true"/>Delete {noun}</button>
  <dialog ref={dialog} aria-labelledby={label} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl bg-white p-5 text-slate-900 shadow-xl backdrop:bg-black/40" onCancel={event=>{if(busy)event.preventDefault();}}>
   <form onSubmit={submit}>
    <h2 id={label} className="text-xl font-semibold">{mode==='edit'?'Edit':'Delete'} {noun}{mode==='delete'?'?':''}</h2>
    {mode==='delete'?<p className="mt-3 text-sm leading-6">This {noun} will be removed from public view{kind==='question'?', along with its discussion':''}. This cannot be undone from your account.</p>:<div className="mt-4 space-y-4">
     {kind==='question'&&<label className="block text-sm font-medium">Title<input required minLength={15} maxLength={180} value={title} onChange={e=>setTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3"/></label>}
     <label className="block text-sm font-medium">{kind==='question'?'Post':'Comment'}<CompactTextarea required minLength={kind==='question'?30:20} maxLength={10000} rows={3} value={body} onChange={e=>setBody(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3 font-normal"/></label>
    </div>}
    {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    <div className="mt-5 flex justify-end gap-3"><button type="button" disabled={busy} className="rounded-full px-4 py-2 hover:bg-slate-100" onClick={()=>dialog.current?.close()}>Cancel</button><button disabled={busy} className={`rounded-full px-4 py-2 text-white disabled:opacity-50 ${mode==='delete'?'bg-red-700':'bg-blue-700'}`}>{busy?'Saving…':mode==='edit'?'Save changes':`Delete ${noun}`}</button></div>
   </form>
  </dialog>
 </>;
}

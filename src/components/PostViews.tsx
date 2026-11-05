'use client';
import {useCallback,useEffect,useSyncExternalStore} from 'react';
import {Eye} from 'lucide-react';
import {observePostView,postViewCount,watchPostViews} from '@/lib/post-views';
import {useAuth} from './AuthProvider';
export function PostViews({postId,record=false}:{postId:string;record?:boolean}) {
  const {demoMode}=useAuth();
  const subscribe=useCallback((notify:()=>void)=>demoMode?()=>{}:watchPostViews(postId,notify),[postId,demoMode]);
  const snapshot=useCallback(()=>demoMode?null:postViewCount(postId),[postId,demoMode]);
  const count=useSyncExternalStore(subscribe,snapshot,()=>null);
  useEffect(()=>{if(record&&!demoMode)return observePostView(postId);},[postId,record,demoMode]);
  if(count===null)return null;
  return <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-normal text-slate-500 normal-case" title="Estimated views on VisaThreads since counting began. Repeat visits from the same network and browser are limited to one per day." aria-label={`${count.toLocaleString('en-US')} ${count===1?'view':'views'} on VisaThreads`}><Eye size={14} aria-hidden="true"/>{Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(count)} {count===1?'view':'views'}</span>;
}

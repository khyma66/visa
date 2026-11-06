// Browser-only aggregate cache. No visitor identifier, cookie or local storage.
const values=new Map<string,{count:number;at:number}>();
const listeners=new Map<string,Set<()=>void>>();
const pending=new Set<string>();
const reading=new Set<string>();
const recorded=new Map<string,string>();
const recording=new Map<string,Promise<void>>();
const READ_TTL_MS=5*60*1000;
let scheduled=false;
export function postViewCount(id:string):number|null {return values.get(id)?.count??null;}
function publish(id:string,count:number) {
  const previous=values.get(id)?.count;
  const next=Math.max(count,previous??0);
  values.set(id,{count:next,at:Date.now()});
  if(next!==previous)listeners.get(id)?.forEach(notify=>notify());
  if(values.size>500) for(const key of values.keys()) {if(!listeners.has(key))values.delete(key);if(values.size<=500)break;}
}
function acceptRows(rows:unknown,ids:string[]) {
  if(!Array.isArray(rows))return;
  for(const row of rows) if(ids.includes(row?.post_id)&&Number.isSafeInteger(row?.views)&&row.views>=0)publish(row.post_id,row.views);
}
async function flush() {
  const ids=[...pending].slice(0,50);ids.forEach(id=>pending.delete(id));
  if(!ids.length){scheduled=false;return;}
  ids.forEach(id=>reading.add(id));
  try {
    const params=new URLSearchParams();ids.forEach(id=>params.append('id',id));
    const response=await fetch(`/api/post-views?${params}`,{cache:'no-store',signal:AbortSignal.timeout(6000)});
    if(response.ok)acceptRows(await response.json(),ids);
  } catch { /* A measurement outage must not interfere with reading a post. */ }
  finally {ids.forEach(id=>reading.delete(id));scheduled=false;if(pending.size)schedule();}
}
function schedule(){if(!scheduled){scheduled=true;queueMicrotask(()=>{void flush();});}}
export function watchPostViews(id:string,notify:()=>void) {
  const set=listeners.get(id)??new Set();set.add(notify);listeners.set(id,set);
  if(!reading.has(id)&&(!values.has(id)||Date.now()-values.get(id)!.at>READ_TTL_MS)){pending.add(id);schedule();}
  return ()=>{set.delete(notify);if(!set.size)listeners.delete(id);};
}
export function recordPostView(id:string):Promise<void> {
  const day=new Date().toISOString().slice(0,10);
  if(recorded.get(id)===day)return Promise.resolve();
  const active=recording.get(id);
  if(active)return active;
  const request=(async()=>{
    try {
      const response=await fetch(`/api/post-views?id=${encodeURIComponent(id)}`,{method:'POST',cache:'no-store',signal:AbortSignal.timeout(6000)});
      if(response.ok){
        const rows=await response.json();
        acceptRows(rows,[id]);
        if(Array.isArray(rows)&&rows.some(row=>row?.post_id===id&&Number.isSafeInteger(row.views)&&row.views>=0)){
          recorded.set(id,day);
          if(recorded.size>500)recorded.delete(recorded.keys().next().value!);
        }
      }
    } catch { /* Counts are best effort; never block replies or navigation. */ }
    finally {recording.delete(id);}
  })();
  recording.set(id,request);
  return request;
}

/** Count only a foreground post opened for two uninterrupted seconds. */
export function observePostView(id:string,doc:Document=document) {
  let timer:ReturnType<typeof setTimeout>|undefined,done=false;
  const update=()=>{
    clearTimeout(timer);
    if(!done&&doc.visibilityState==='visible')timer=setTimeout(()=>{done=true;void recordPostView(id);},2000);
  };
  doc.addEventListener('visibilitychange',update);update();
  return ()=>{clearTimeout(timer);doc.removeEventListener('visibilitychange',update);};
}

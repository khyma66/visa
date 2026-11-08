// Run only against a separately provisioned staging project with synthetic data.
import http from 'k6/http';
import ws from 'k6/ws';
import {check,sleep} from 'k6';
import {Rate,Trend} from 'k6/metrics';
const origin=__ENV.STAGING_SUPABASE_URL;
if(!origin||!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(origin)||origin.includes('cycnichledvqbxevrwnt'))throw Error('An isolated staging Supabase project is required');
const key=__ENV.STAGING_PUBLIC_KEY;
if(!key)throw Error('Staging public key is required');
const users=__ENV.STAGING_FIXTURES?JSON.parse(open(__ENV.STAGING_FIXTURES)):[];
const target=Number(__ENV.TARGET_VUS??100);
if(!Number.isInteger(target)||target<1||target>100000)throw Error('TARGET_VUS must be 1–100000');
const realtime=__ENV.REALTIME==='true';
if(realtime&&users.length<target)throw Error('One synthetic staging user token per concurrent user is required');
const joins=new Rate('realtime_join_success'),latency=new Trend('realtime_join_ms');
export const options={stages:[{duration:'2m',target:Math.min(target,100)},{duration:'5m',target},{duration:'10m',target},{duration:'2m',target:0}],thresholds:{http_req_failed:['rate<0.001'],http_req_duration:['p(95)<500','p(99)<1500'],...(realtime?{realtime_join_success:['rate>0.999'],realtime_join_ms:['p(95)<2000']}: {})}};
export default function(){
 const user=users[(__VU-1)%Math.max(users.length,1)];
 const headers={apikey:key,'Content-Type':'application/json',...(user?{Authorization:'Bearer '+user.token}:{})};
 const feed=http.post(origin+'/rest/v1/rpc/platform_post_page',JSON.stringify({sort_mode:__VU%3===0?'score':'newest'}),{headers,tags:{operation:'feed'}});
 check(feed,{'feed succeeds':r=>r.status===200,'feed is bounded':r=>{try{return JSON.parse(r.body).length<=51;}catch{return false;}}});
 if(realtime){
  const started=Date.now();let joined=false;
  ws.connect(origin.replace('https:','wss:')+'/realtime/v1/websocket?apikey='+encodeURIComponent(key)+'&vsn=1.0.0',{},socket=>{
   socket.on('open',()=>socket.send(JSON.stringify({topic:'realtime:inbox:'+user.id,event:'phx_join',payload:{config:{private:true,broadcast:{self:false},presence:{enabled:false}},access_token:user.token},ref:'1'})));
   socket.on('message',text=>{const value=JSON.parse(text);if(value.event==='phx_reply'&&value.ref==='1'){joined=value.payload?.status==='ok';joins.add(joined);latency.add(Date.now()-started);}});
   socket.setInterval(()=>socket.send(JSON.stringify({topic:'phoenix',event:'heartbeat',payload:{},ref:String(Date.now())})),25000);
   socket.setTimeout(()=>{if(!joined)joins.add(false);socket.close();},60000);
  });
 }else sleep(10+Math.random()*5);
}

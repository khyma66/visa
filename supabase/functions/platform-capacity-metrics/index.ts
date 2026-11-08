// Service credentials stay inside Supabase's function runtime. Only aggregate
// resource values are returned, after a dedicated monitoring-token check.
Deno.serve(async(req:Request)=>{
 const headers={'Cache-Control':'no-store','Content-Type':'application/json'};
 const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const token=(req.headers.get('Authorization')??'').replace(/^Bearer /,'');
 if(!/^[a-f0-9]{64}$/.test(token))return reply({error:'Monitor access denied'},401);
 const origin=Deno.env.get('SUPABASE_URL');
 const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')??'{}').default;
 const publicKey=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')??'{}').default??Deno.env.get('SUPABASE_ANON_KEY');
 if(!origin||!service||!publicKey)return reply({error:'Metrics configuration unavailable'},503);
 try{
  const authorized=await fetch(origin+'/rest/v1/rpc/capacity_probe',{method:'POST',headers:{apikey:publicKey,'Content-Type':'application/json'},body:JSON.stringify({token}),signal:AbortSignal.timeout(5000)});
  if(!authorized.ok){await authorized.body?.cancel();return reply({error:'Monitor access denied'},401);}
  await authorized.body?.cancel();
  const response=await fetch(origin+'/customer/v1/privileged/metrics',{headers:{Authorization:'Basic '+btoa('service_role:'+service)},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok||!response.body){await response.body?.cancel();return reply({error:'Provider metrics unavailable',provider_status:response.status},503);}
  const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>4000000)throw Error('Metrics size bound');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const lines=new TextDecoder().decode(bytes).split('\n');
  const samples=lines.filter(line=>line&&!line.startsWith('#')).map(line=>line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+([0-9.eE+-]+)/)).filter((row):row is RegExpMatchArray=>row!==null);
  const number=(name:string)=>{const values=samples.filter(row=>row[1]===name).map(row=>Number(row[3]));return values.length&&values.every(Number.isFinite)?values.reduce((a,b)=>a+b,0):null;};
  const cpu=samples.filter(row=>row[1]==='node_cpu_seconds_total');
  const idle=cpu.filter(row=>/mode="idle"/.test(row[2]??'')).reduce((n,row)=>n+Number(row[3]),0);
  const total=cpu.reduce((n,row)=>n+Number(row[3]),0);
  const metrics={cpu_total:cpu.length?total:null,cpu_idle:cpu.length?idle:null,cpu_cores:number('node_cpu_online'),load1:number('node_load1'),memory_total:number('node_memory_MemTotal_bytes'),memory_available:number('node_memory_MemAvailable_bytes')};
  if(!cpu.length||metrics.memory_total===null||metrics.memory_available===null)return reply({error:'Required provider metrics missing'},503);
  const stored=await fetch(origin+'/rest/v1/rpc/record_provider_capacity',{method:'POST',headers:{apikey:service,...(service.startsWith('eyJ')?{Authorization:'Bearer '+service}:{}),'Content-Type':'application/json'},body:JSON.stringify({metrics}),redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!stored.ok){await stored.body?.cancel();return reply({error:'Provider sample could not be stored'},503);}
  await stored.body?.cancel();return reply({status:'collected',cpu_memory:'connected',realtime_total:'not-provided'});
 }catch{return reply({error:'Provider metrics collection failed'},503);}
});

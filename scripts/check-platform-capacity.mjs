import assert from 'node:assert/strict';
const origin=process.env.CAPACITY_SUPABASE_URL??'https://cycnichledvqbxevrwnt.supabase.co';
assert.equal(origin,'https://cycnichledvqbxevrwnt.supabase.co','Unexpected monitoring database');
const key=process.env.CAPACITY_PUBLIC_KEY??'sb_publishable_7QnSRDvWRYFIqA3zhsNIsw_iWSspCTN';
const token=process.env.CAPACITY_MONITOR_TOKEN;
assert(token&&/^[a-f0-9]{64}$/.test(token),'Capacity monitor token is not configured');
const metricsResponse=await fetch(origin+'/functions/v1/platform-capacity-metrics',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});
assert(metricsResponse.ok,'Provider metrics collection failed');
const response=await fetch(origin+'/rest/v1/rpc/capacity_probe',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({token}),redirect:'error',signal:AbortSignal.timeout(15000)});
assert(response.ok,'Capacity monitor could not read the latest sample');
const data=await response.json();
assert(data.sample?.at&&Number.isFinite(Date.parse(data.sample.at)),'Capacity sample is missing');
assert(Date.now()-Date.parse(data.sample.at)<20*60000,'Capacity sampling is delayed; review the owner capacity dashboard');
assert(data.provider?.at&&Date.now()-Date.parse(data.provider.at)<20*60000,'Provider metrics are stale');
assert(Array.isArray(data.alerts),'Invalid capacity alert response');
assert.equal(data.alerts.length,0,'A capacity threshold needs review: open the private owner capacity dashboard');
for(const path of ['/api/health','/api/ready']){
 const response=await fetch('https://visathreads.com'+path,{redirect:'error',signal:AbortSignal.timeout(15000)});
 assert(response.ok,'Website or database readiness failed');
}
console.log('Capacity sample, thresholds, website, and database readiness passed.');

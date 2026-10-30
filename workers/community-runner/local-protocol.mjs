import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { mkdir,writeFile } from 'node:fs/promises';
import { fixture,START } from '../../tests/scale/community-runner-fixtures.mjs';
import { tick,DEV_ORIGIN } from './core.mjs';
import { POLICY } from '../../tests/scale/multiuser-core.mjs';
const local=Object.fromEntries(execFileSync(process.env.VISAFLOW_LOCAL_SUPABASE_CLI ?? 'supabase',['status','--workdir','.local/supabase-protocol','-o','env'],{encoding:'utf8'})
  .trim().split('\n').map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1).replace(/^"|"$/g,'')];}));
assert.equal(local.API_URL,'http://127.0.0.1:55431');
const admin=createClient(local.API_URL,local.SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const f=fixture(10),created=[],results=[];let passed=false,cleaned=false;
const ok=r=>{if(r.error)throw new Error(`Local protocol failure (${r.error.code??r.error.status})`);return r.data;};
try {
  for(const a of f.actors){
    const {user}=ok(await admin.auth.admin.createUser({email:a.email,password:a.password,email_confirm:true,user_metadata:{first_name:'Synthetic',last_name:'Tester'},
      app_metadata:{visaflow_test_purpose:'community-runner',visaflow_test_run:f.env.CAMPAIGN_ID}}));
    a.id=user.id;created.push(a.id);
    const client=createClient(local.API_URL,local.PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    try {ok(await client.auth.signInWithPassword({email:a.email,password:a.password}));
      ok(await client.from('policy_acceptances').insert({user_id:a.id,policy_version:POLICY,market:'US',terms_accepted:true,privacy_acknowledged:true,adult_confirmed:true}));
    }finally{ok(await client.auth.signOut({scope:'local'}));}
  }
  f.env.RUNNER_ACTORS=JSON.stringify(f.actors);f.env.SUPABASE_PUBLIC_KEY=local.PUBLISHABLE_KEY;
  const fetcher=(url,init)=>{
    assert.equal(new URL(url).origin,DEV_ORIGIN);
    // Only this local test transport can redirect the fixed dev endpoint to loopback.
    return fetch(url.replace(DEV_ORIGIN,local.API_URL),init);
  };
  for(let i=0;i<30;i++){
    const time=START+Math.floor(i/10)*86400000+(i%10)*7200000;
    const result=await tick(f.env,time,{now:time,fetcher});results.push(result);
    assert.equal(result.state,'done',JSON.stringify(result));
  }
  assert.equal(ok(await admin.from('questions').select('id').in('author_id',created)).length,10);
  assert.equal(ok(await admin.from('answers').select('id').in('author_id',created)).length,20);
  assert.equal(f.db.prepare("SELECT COUNT(DISTINCT actor) n FROM runner_jobs WHERE status='done'").get().n,10);
  passed=true;
} finally {
  if(created.length){
    ok(await admin.from('answers').delete().in('author_id',created));
    ok(await admin.from('questions').delete().in('author_id',created));
    for(const id of created)ok(await admin.auth.admin.deleteUser(id));
    for(const id of created)assert.equal((await admin.auth.admin.getUserById(id)).error?.status,404);
    assert.equal(ok(await admin.from('questions').select('id').in('author_id',created)).length,0);
    assert.equal(ok(await admin.from('answers').select('id').in('author_id',created)).length,0);
  }
  cleaned=true;f.close();
  const report={localProtocol:true,passed,cleanupVerified:cleaned,accounts:created.length,completedActions:results.filter(r=>r.state==='done').length,
    questions:passed?10:null,replies:passed?20:null,hosted:false,aiCalls:0,checkedAt:new Date().toISOString()};
  await mkdir('.local/community-runner',{recursive:true,mode:0o700});
  await writeFile('.local/community-runner/local-protocol.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
}

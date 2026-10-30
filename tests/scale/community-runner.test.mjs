import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { DEV_ORIGIN,LABEL,Ledger,SupabaseActor,contentFor,makePlan,readJSON,tick,validateConfig } from '../../workers/community-runner/core.mjs';
import { fixture,START } from './community-runner-fixtures.mjs';
import { validateCleanupContent } from '../../workers/community-runner/cleanup-plan.mjs';
const run=(f,now=START,options={})=>tick(f.env,now,{now,fetcher:f.fetcher,...options});
test('disabled worker makes no DB, network or AI calls',async()=>assert.deepEqual(await tick({RUNNER_ENABLED:'false'},START),{state:'disabled'}));
test('plans distribute distinct reply actors and balanced A/B threads; input is bounded',()=>{
  const f=fixture();try {
    for(let i=0;i<f.jobs.length;i+=3){const [q,a,b]=f.jobs.slice(i,i+3);assert.notEqual(q.actor,a.actor);assert.notEqual(q.actor,b.actor);assert.notEqual(a.actor,b.actor);assert.equal(a.question_id,q.id);assert.equal(b.dependency,a.id);}
    assert.equal(f.jobs.filter(j=>j.kind==='question'&&j.variant==='A').length,5);
    assert.throws(()=>makePlan(['short'],f.env.CAMPAIGN_ID));
    assert.throws(()=>makePlan(Array(501).fill('A sufficiently long question?'),f.env.CAMPAIGN_ID));
    assert.throws(()=>makePlan(['A sufficiently long question?','A sufficiently long question?'],f.env.CAMPAIGN_ID));
  }finally{f.close();}
});
test('production, stale quota checks, expired campaigns and ordinary member credentials are rejected',()=>{
  const f=fixture();try {
    for(const patch of [{SUPABASE_URL:'https://cycnichledvqbxevrwnt.supabase.co'},{SUPABASE_PUBLIC_KEY:'sb_secret_FORBIDDEN'},
      {FREE_TIER_VERIFIED_AT:'2020-01-01'},{OUTBOUND_HOOKS_DISABLED:'false'},{CAMPAIGN_END:'2026-10-01'},
      {RUNNER_ACTORS:JSON.stringify(f.actors.map(a=>({...a,email:'real@gmail.com'})))}])assert.throws(()=>validateConfig({...f.env,...patch},START));
  }finally{f.close();}
});
test('duplicate and overlapping scheduled events cannot publish twice',async()=>{
  const f=fixture();try {
    const result=await Promise.all([run(f),run(f)]);assert.equal(result.filter(r=>r.state==='done').length,1);
    await run(f);assert.equal(f.rows.size,1);assert.equal(f.calls.filter(c=>c.method==='POST'&&c.url.pathname==='/rest/v1/questions').length,1);
  }finally{f.close();}
});
test('300 actions over a simulated month: 100 questions, 200 replies, ten identities, no budget overflow',async()=>{
  const f=fixture(101);try {
    for(let day=0;day<30;day++){
      f.env.FREE_TIER_VERIFIED_AT=new Date(START+day*86400000).toISOString();
      for(let slot=0;slot<12;slot++)await run(f,START+day*86400000+slot*7200000);
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM runner_jobs WHERE day=?').get(new Date(START+day*86400000).toISOString().slice(0,10)).n,10);
    }
    assert.equal(f.rows.size,300);assert.equal([...f.rows.values()].filter(x=>x.title).length,100);
    assert.equal(new Set([...f.rows.values()].map(x=>x.author_id)).size,10);
    for(let actor=0;actor<10;actor++)assert.equal(f.db.prepare("SELECT COUNT(DISTINCT variant) n FROM runner_jobs WHERE kind='question' AND status='done' AND actor=?").get(actor).n,2);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM runner_jobs WHERE status='ready'").get().n,3);
    assert([...f.rows.values()].every(x=>x.body.startsWith(`${LABEL} ${f.env.CAMPAIGN_ID}/`)));
    for(const row of f.rows.values())if(row.question_id)assert.notEqual(row.author_id,f.rows.get(row.question_id).author_id);
  }finally{f.close();}
});
test('replies verify the persisted test question; changed target pauses without writing',async()=>{
  const f=fixture();try {await run(f);[...f.rows.values()][0].body='Unrelated member content';const r=await run(f,START+7200000);assert.equal(r.state,'paused');assert.equal(r.reason,'persisted_content_mismatch');assert.equal(f.rows.size,1);}finally{f.close();}
});
test('trusted Auth metadata is required; user_metadata cannot authorize an actor',async()=>{
  const f=fixture();try {
    const r=await run(f,START,{fetcher:async(url,init)=>url.endsWith('/auth/v1/user')?Response.json({id:f.actors[0].id,email:f.actors[0].email,role:'authenticated',user_metadata:{visaflow_test_purpose:'community-runner',visaflow_test_run:f.env.CAMPAIGN_ID}}):f.fetcher(url,init)});
    assert.equal(r.reason,'actor_ownership_mismatch');assert.equal(f.rows.size,0);
  }finally{f.close();}
});
test('a lost write response pauses; rerunning cannot repeat the mutation',async()=>{
  const f=fixture();try {
    const r=await run(f,START,{fetcher:async(url,init)=>{const response=await f.fetcher(url,init);if(url.endsWith('/rest/v1/questions')&&init.method==='POST')throw new Error('Network lost');return response;}});
    assert.equal(r.state,'paused');assert.equal(f.rows.size,1);await run(f,START+7200000);assert.equal(f.rows.size,1);
  }finally{f.close();}
});
test('crash reconciliation only reads an exact persisted job and never republishes',async()=>{
  const f=fixture();try {
    const ledger=new Ledger(f.binding);let job=await ledger.claim(f.env.CAMPAIGN_ID,START);
    job=await ledger.saveContent(job,contentFor(job));const actor=new SupabaseActor(f.env,f.actors[0],f.fetcher);
    const remote=randomUUID();f.rows.set(remote,{id:remote,...actor.payload(job)});
    const r=await run(f,START+7200000);assert.equal(r.state,'reconciled');assert.equal(f.calls.filter(c=>c.url.pathname.startsWith('/rest/')&&c.method==='POST').length,0);
  }finally{f.close();}
});
test('a crash before writing remains paused for review, not automatically retried',async()=>{
  const f=fixture();try {await new Ledger(f.binding).claim(f.env.CAMPAIGN_ID,START);assert.equal((await run(f,START+7200000)).reason,'interrupted_before_content');assert.equal(f.rows.size,0);}finally{f.close();}
});
test('rate limits stop immediately and preserve the reserved budget slot',async()=>{
  const f=fixture();try {let calls=0;const r=await run(f,START,{fetcher:async()=>{calls++;return Response.json({}, {status:429});}});assert.equal(calls,1);assert.equal(r.reason,'provider_rate_limit');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM runner_jobs WHERE slot IS NOT NULL').get().n,1);}finally{f.close();}
});
test('AI receives only a bounded test context and invalid output cannot select an actor or target',async()=>{
  const f=fixture();try {
    f.env.CONTENT_MODE='ai';let calls=0;
    const r=await run(f,START,{generate:async prompt=>{calls++;assert.equal(prompt.max_tokens,400);assert(!JSON.stringify(prompt).includes('password'));return {response:JSON.stringify({title:'A fictional test question?',body:'A sufficiently long fictional test body for a question.',actor:'admin'})};}});
    assert.equal(calls,1);assert.equal(r.reason,'invalid_ai_fields');assert.equal(f.rows.size,0);
  }finally{f.close();}
});
test('an empty AI response is a failure, not a fabricated successful generation',async()=>{
  const f=fixture();try {f.env.CONTENT_MODE='ai';assert.equal((await run(f,START,{generate:async()=>({})})).reason,'invalid_ai_response');}finally{f.close();}
});
test('signout failures pause subsequent work and are surfaced in the result',async()=>{
  const f=fixture();try {const r=await run(f,START,{fetcher:async(url,init)=>url.includes('/logout')?new Response(null,{status:503}):f.fetcher(url,init)});assert.equal(r.reason,'session_signout_failed');assert.equal(await new Ledger(f.binding).paused(),true);}finally{f.close();}
});
test('oversized service responses and generated contact information are rejected',async()=>{
  await assert.rejects(readJSON(new Response('x'.repeat(40000))),/response_too_large/);
  const f=fixture();try {assert.throws(()=>contentFor(f.jobs[0],JSON.stringify({title:'A fictional test question?',body:'Please send this test account information to https://example.com now.'})),/external_contact/);}finally{f.close();}
});
test('cleanup requires exact job ownership, marker, kind and original parent',async()=>{
  const f=fixture();try {
    for(let i=0;i<3;i++)await run(f,START+i*7200000);
    const plan={campaign:f.env.CAMPAIGN_ID,actors:f.actors,jobs:f.jobs},q=[...f.rows.values()].filter(x=>x.title),a=[...f.rows.values()].filter(x=>!x.title);
    validateCleanupContent(plan,q,a);
    assert.throws(()=>validateCleanupContent(plan,q,[...a,{...a[0],id:randomUUID()}]));
    assert.throws(()=>validateCleanupContent(plan,q,a.map(x=>({...x,question_id:randomUUID()}))));
    assert.throws(()=>validateCleanupContent(plan,q.map(x=>({...x,author_id:randomUUID()})),a));
    assert.throws(()=>validateCleanupContent(plan,q,a.map(x=>({...x,body:'Someone else wrote this.'}))));
  }finally{f.close();}
});

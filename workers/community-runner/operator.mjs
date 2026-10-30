// Operator-only provisioning/cleanup. This module is never imported into the Worker.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { DEV_ORIGIN, makePlan } from './core.mjs';
import { POLICY } from '../../tests/scale/multiuser-core.mjs';
import { networkBudget,checkEvidence } from '../../tests/scale/multiuser-core.mjs';
import { validateCleanupContent } from './cleanup-plan.mjs';

const root=resolve('.local/community-runner');
const [command,file,additionalQuestions]=process.argv.slice(2);
const save=async (path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});
const check=(v,message)=>{if(!v)throw new Error(message);};
const ok=result=>{if(result.error)throw new Error(`Dev request failed (${result.error.code ?? result.error.status ?? 'unknown'})`);return result.data;};
const quote=value=>value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'","''")}'`;
await mkdir(root,{recursive:true,mode:0o700});
try {
  if(command === 'plan' || command === 'append') {
    check(file,'Provide a JSON array of 1–500 synthetic questions.');
    const previous=command==='append'?JSON.parse(await readFile(file,'utf8')):null;
    if(previous)check(previous.target===DEV_ORIGIN && previous.state!=='cleaned' && additionalQuestions,'Provide an active plan and additional question file.');
    const campaign=previous?.campaign??randomUUID(),oldJobs=previous?.jobs??[],knownIds=oldJobs.map(j=>j.id);
    const seeds=[...oldJobs.filter(j=>j.kind==='question').map(j=>j.seed),...JSON.parse(await readFile(previous?additionalQuestions:file,'utf8'))];
    const jobs=makePlan(seeds,campaign,()=>knownIds.length?knownIds.shift():randomUUID());
    const plan=previous?{...previous,jobs}:{schemaVersion:1,campaign,target:DEV_ORIGIN,jobs,actors:[],state:'planned'};
    const path=previous?file:resolve(root,`${campaign}.json`); await save(path,plan);
    const columns=['id','campaign','sequence','kind','actor','question_id','dependency','variant','seed'];
    const sql=jobs.slice(oldJobs.length).map(job=>`INSERT INTO runner_jobs(${columns.join(',')}) VALUES(${columns.map(k=>quote(job[k])).join(',')});`).join('\n');
    const sqlPath=resolve(root,`${campaign}${previous?'.append-'+oldJobs.length:''}.sql`);
    await writeFile(sqlPath,'BEGIN TRANSACTION;\n'+sql+'\nCOMMIT;\n',{mode:0o600});
    console.log(JSON.stringify({campaign,plan:path,sql:sqlPath,queuedActions:jobs.length,monthlyActionCap:300,questionsPerFullMonth:100}));
  } else if(command === 'provision' || command === 'cleanup') {
    check(file,'Provide the plan path.');
    const plan=JSON.parse(await readFile(file,'utf8'));
    check(plan.schemaVersion===1 && plan.target===DEV_ORIGIN && /^[a-f0-9-]{36}$/.test(plan.campaign),'Invalid dev plan');
    check(process.env.VISAFLOW_MULTIUSER_ADMIN_KEY,'Provide the dev admin key in the private process environment.');
    const budget=networkBudget({maxRequests:1000,intervalMs:350,authIntervalMs:4000});
    const admin=createClient(DEV_ORIGIN,process.env.VISAFLOW_MULTIUSER_ADMIN_KEY,{global:{fetch:budget.fetch},auth:{persistSession:false,autoRefreshToken:false}});
    if(command==='provision') {
      check(plan.state==='planned' && plan.actors.length===0,'Use cleanup for a partial provision; do not provision twice.');
      check(process.env.RUNNER_QUOTA_EVIDENCE,'Fresh Free-tier quota evidence is required before provisioning.');
      checkEvidence(JSON.parse(await readFile(process.env.RUNNER_QUOTA_EVIDENCE,'utf8')),10);
      const config=JSON.parse(await readFile('workers/community-runner/wrangler.jsonc','utf8'));
      check(config.vars.RUNNER_ENABLED==='false' && config.vars.CAMPAIGN_ID===plan.campaign && config.vars.SUPABASE_URL===DEV_ORIGIN,'Configure the disabled dev Worker for this campaign first.');
      check(config.d1_databases?.[0]?.database_id !== '00000000-0000-0000-0000-000000000000','Create the dev ledger first.');
      const session=spawnSync('node_modules/.bin/wrangler',['whoami','--json'],{encoding:'utf8',env:{...process.env,VISAFLOW_MULTIUSER_ADMIN_KEY:'',WRANGLER_LOG_PATH:'/tmp/visaflow-runner-setup.log'}});
      check(session.status===0,'Reconnect Cloudflare before provisioning accounts.');
      check(/^sb_publishable_/.test(process.env.VISAFLOW_MULTIUSER_PUBLIC_KEY ?? ''),'Dev publishable key required');
      check((await readFile('src/lib/policy.ts','utf8')).includes(`'${POLICY}'`),'Review current test policy version');
      plan.state='provisioning';await save(file,plan);const secrets=[];
      for(let i=0;i<10;i++) {
        const actor={id:null,email:`vf-runner-${plan.campaign}-${i}@example.invalid`};
        plan.actors.push(actor);await save(file,plan);
        const password=randomBytes(32).toString('base64url');
        const {user}=ok(await admin.auth.admin.createUser({email:actor.email,password,email_confirm:true,
          user_metadata:{first_name:'Synthetic',last_name:`Tester ${i+1}`},
          app_metadata:{visaflow_test_purpose:'community-runner',visaflow_test_run:plan.campaign}}));
        actor.id=user.id;await save(file,plan);
        const client=createClient(DEV_ORIGIN,process.env.VISAFLOW_MULTIUSER_PUBLIC_KEY,{global:{fetch:budget.fetch},auth:{persistSession:false,autoRefreshToken:false}});
        try {
          ok(await client.auth.signInWithPassword({email:actor.email,password}));
          ok(await client.from('policy_acceptances').insert({user_id:actor.id,policy_version:POLICY,market:'US',terms_accepted:true,privacy_acknowledged:true,adult_confirmed:true}));
        } finally { ok(await client.auth.signOut({scope:'local'})); }
        secrets.push({...actor,password});
      }
      // Pass only the two ordinary-user secrets to Wrangler over stdin, never arguments or disk.
      const deployed=spawnSync('node_modules/.bin/wrangler',['secret','bulk','--config','workers/community-runner/wrangler.jsonc'],{
        input:JSON.stringify({RUNNER_ACTORS:JSON.stringify(secrets),SUPABASE_PUBLIC_KEY:process.env.VISAFLOW_MULTIUSER_PUBLIC_KEY}),encoding:'utf8',
        env:{...process.env,VISAFLOW_MULTIUSER_ADMIN_KEY:'',WRANGLER_LOG_PATH:'/tmp/visaflow-runner-setup.log'}});
      check(deployed.status===0,'Secret enrollment failed; run cleanup with the plan. No credentials were written to disk.');
      plan.state='provisioned';await save(file,plan);console.log(JSON.stringify({campaign:plan.campaign,provisioned:10,secretEnrollment:true}));
    } else {
      check(process.env.RUNNER_STOPPED_CONFIRMED==='true','Disable the Worker and wait for in-flight work before cleanup.');
      // Reconcile a lost create response by exact reserved email and trusted metadata.
      const reserved=new Map(plan.actors.map(a=>[a.email,a])),present=new Set();
      for(let page=1;page<=20;page++) {
        const {users}=ok(await admin.auth.admin.listUsers({page,perPage:100}));
        for(const user of users) {
          if(user.app_metadata?.visaflow_test_run===plan.campaign)check(reserved.has(user.email),'Unexpected campaign account; cleanup stopped');
          if(!reserved.has(user.email))continue;
          const a=reserved.get(user.email);
          check(user.app_metadata?.visaflow_test_purpose==='community-runner' && user.app_metadata?.visaflow_test_run===plan.campaign,'Account ownership mismatch');
          check(!a.id || a.id===user.id,'Account ID mismatch');a.id=user.id;present.add(user.id);
        }
        if(users.length<100)break;
        check(page<20,'Auth pagination bound reached');
      }
      await save(file,plan);
      const ids=plan.actors.map(a=>a.id).filter(Boolean);
      for(const id of ids)if(!present.has(id))check((await admin.auth.admin.getUserById(id)).error?.status===404,'Recorded account changed or inventory incomplete');
      if(!ids.length){plan.state='cleaned';await save(file,plan);console.log(JSON.stringify({campaign:plan.campaign,cleanupVerified:true}));process.exit(0);}
      const questions=ok(await admin.from('questions').select('id,author_id,title,body').in('author_id',ids).limit(501));
      const answers=ok(await admin.from('answers').select('id,author_id,question_id,body').in('author_id',ids).limit(1001));
      check(questions.length<=500 && answers.length<=1000,'Cleanup row bound reached');
      validateCleanupContent(plan,questions,answers);
      if(questions.length) {
        const children=ok(await admin.from('answers').select('id,author_id').in('question_id',questions.map(q=>q.id)).limit(1001));
        check(children.length<=1000 && children.every(a=>ids.includes(a.author_id) && answers.some(own=>own.id===a.id)),'Foreign replies exist; preserve thread');
        const votes=ok(await admin.from('question_votes').select('user_id').in('question_id',questions.map(q=>q.id)).limit(1));
        check(votes.length===0,'Votes exist; preserve thread for review');
      }
      if(answers.length) {
        const votes=ok(await admin.from('answer_votes').select('user_id').in('answer_id',answers.map(a=>a.id)).limit(1));
        check(votes.length===0,'Votes exist; preserve replies for review');
      }
      // Accounts may not be used for private conversations or unrelated activities.
      const conversations=ok(await admin.from('direct_conversations').select('id').or(`user_one_id.in.(${ids.join(',')}),user_two_id.in.(${ids.join(',')})`).limit(1));
      check(conversations.length===0,'Private conversations exist; cleanup stopped');
      for(const [table,column] of [['imported_answers','author_id'],['question_votes','user_id'],['answer_votes','user_id'],['community_reports','reporter_id']])
        check(ok(await admin.from(table).select(column).in(column,ids).limit(1)).length===0,'Unrelated account activity exists; cleanup stopped');
      if([...questions,...answers].length)check(ok(await admin.from('community_reports').select('id').in('target_id',[...questions,...answers].map(x=>x.id)).limit(1)).length===0,'Reports exist; preserve content for review');
      for(const id of present) ok(await admin.auth.admin.updateUserById(id,{ban_duration:'876000h'}));
      if(answers.length)ok(await admin.from('answers').delete().in('id',answers.map(a=>a.id)));
      if(questions.length)ok(await admin.from('questions').delete().in('id',questions.map(q=>q.id)));
      for(const id of present) {const response=await admin.auth.admin.deleteUser(id);if(response.error && response.error.status!==404)ok(response);}
      check(ok(await admin.from('questions').select('id').in('author_id',ids)).length===0 && ok(await admin.from('answers').select('id').in('author_id',ids)).length===0,'Content cleanup incomplete');
      for(const id of ids){const result=await admin.auth.admin.getUserById(id);check(result.error?.status===404,'Account cleanup incomplete');}
      plan.state='cleaned';await save(file,plan);console.log(JSON.stringify({campaign:plan.campaign,cleanupVerified:true}));
    }
  } else throw new Error('Use plan QUESTIONS.json, append PLAN.json QUESTIONS.json, provision PLAN.json or cleanup PLAN.json');
} catch(error) {
  // Only operator-authored errors are emitted; raw provider bodies and credentials are never printed.
  console.error(error instanceof Error && !/eyJ|sb_secret_/.test(error.message) ? error.message : 'Operator action failed');
  process.exitCode=1;
}

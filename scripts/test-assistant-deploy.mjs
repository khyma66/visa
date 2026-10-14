import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assistantDevelopmentEnvironment,verifyAssistantWorker,ASSISTANT_DEV_REF} from './development-site.mjs';
const env={NEXT_PUBLIC_SUPABASE_URL:`https://${ASSISTANT_DEV_REF}.supabase.co`,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+'x'.repeat(30),NEXT_PUBLIC_SITE_URL:'https://visa-central.com'};
test('regular development pins its isolated project and rejects production, secret keys, and unapproved domains',()=>{
  assert.equal(assistantDevelopmentEnvironment(env).CLOUDFLARE_ENV,'sandbox');
  for(const change of [{NEXT_PUBLIC_SUPABASE_URL:'https://cycnichledvqbxevrwnt.supabase.co'},{NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_secret_xxx'},{NEXT_PUBLIC_SITE_URL:'https://visathreads.com'}]) assert.throws(()=>assistantDevelopmentEnvironment({...env,...change}));
});
test('regular development has its own Worker and accepts only the two verified dev domain routes',async()=>{
  const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  assert.doesNotThrow(()=>verifyAssistantWorker(config.env.sandbox));
  assert.throws(()=>verifyAssistantWorker(config.env.development));
  assert.throws(()=>verifyAssistantWorker({...config.env.sandbox,routes:[{pattern:'visathreads.com',custom_domain:true}]}));
  assert.equal(config.env.sandbox.vars.ASSISTANT_COMMUNITIES_ENABLED,'false');assert.equal(config.env.sandbox.vars.ASSISTANT_CATCHUP_ENABLED,'false');
});

test('generated configuration cannot widen development routes or enable later rollout stages',async()=>{
  const {env:{sandbox:config}}=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  for(const change of [
    {name:'visaflow-dev'}, {ai:{binding:'ASSISTANT_AI'}}, {vars:{...config.vars,ASSISTANT_ENABLED:'true'}}, {workers_dev:true}, {routes:[]},
    {routes:[...config.routes,{pattern:'visathreads.com',custom_domain:true}]},
    {routes:config.routes.map(r=>({...r,custom_domain:false}))},
    {vars:{...config.vars,APP_ENV:'production'}},
    {vars:{...config.vars,NEXT_PUBLIC_SITE_URL:'https://visathreads.com'}},
    {vars:{...config.vars,ASSISTANT_PROVIDER:'workers-ai'}},
    {vars:{...config.vars,ASSISTANT_PROJECT_REF:'cycnichledvqbxevrwnt'}},
    {vars:{...config.vars,NEXT_PUBLIC_SUPABASE_URL:'https://cycnichledvqbxevrwnt.supabase.co'}},
    {vars:{...config.vars,ASSISTANT_COMMUNITIES_ENABLED:'true'}},
  ]) assert.throws(()=>verifyAssistantWorker({...config,...change}));
  for(const origin of ['https://www.visathreads.com','https://visa-central.com.evil.invalid','https://visa-central.com/','http://visa-central.com'])
    assert.throws(()=>assistantDevelopmentEnvironment({...env,NEXT_PUBLIC_SITE_URL:origin}));
});

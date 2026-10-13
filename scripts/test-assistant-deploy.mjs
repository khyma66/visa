import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assistantDevelopmentEnvironment,verifyAssistantWorker,ASSISTANT_DEV_REF} from './assistant-dev.mjs';
const env={NEXT_PUBLIC_SUPABASE_URL:`https://${ASSISTANT_DEV_REF}.supabase.co`,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+'x'.repeat(30),NEXT_PUBLIC_SITE_URL:'https://visathreads-ai-dev.example.workers.dev'};
test('dedicated assistant staging pins project and rejects production, secret keys, custom domains',()=>{
  assert.equal(assistantDevelopmentEnvironment(env).CLOUDFLARE_ENV,'assistant');
  for(const change of [{NEXT_PUBLIC_SUPABASE_URL:'https://cycnichledvqbxevrwnt.supabase.co'},{NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_secret_xxx'},{NEXT_PUBLIC_SITE_URL:'https://visathreads.com'}]) assert.throws(()=>assistantDevelopmentEnvironment({...env,...change}));
});
test('assistant deployment has its own Worker and never inherits live domain routes',async()=>{
  const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  assert.doesNotThrow(()=>verifyAssistantWorker(config.env.assistant));
  assert.throws(()=>verifyAssistantWorker(config.env.development));
  assert.throws(()=>verifyAssistantWorker({...config.env.assistant,routes:[{pattern:'visathreads.com',custom_domain:true}]}));
  assert.equal(config.env.assistant.vars.ASSISTANT_COMMUNITIES_ENABLED,'false');assert.equal(config.env.assistant.vars.ASSISTANT_CATCHUP_ENABLED,'false');
});

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
export const ASSISTANT_DEV_REF='ppdwysmeistjxzjpmxyk';
export function assistantDevelopmentEnvironment(values) {
  if(values.NEXT_PUBLIC_SUPABASE_URL!==`https://${ASSISTANT_DEV_REF}.supabase.co`) throw new Error('Assistant staging requires the isolated ppdwysmeistjxzjpmxyk project. Production is forbidden.');
  const key=values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??'';
  if(!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key)) throw new Error('Set the dev project publishable key in .env.assistant.local. Secret and service-role keys are forbidden.');
  if(!/^https:\/\/visathreads-ai-dev\.[a-z0-9-]+\.workers\.dev$/.test(values.NEXT_PUBLIC_SITE_URL??'')) throw new Error('Set NEXT_PUBLIC_SITE_URL to the visathreads-ai-dev Worker URL.');
  return {NEXT_PUBLIC_SUPABASE_URL:values.NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key,NEXT_PUBLIC_SITE_URL:values.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_APP_ENV:'development',APP_ENV:'development',CLOUDFLARE_ENV:'assistant',ASSISTANT_PROJECT_REF:ASSISTANT_DEV_REF,
    ASSISTANT_PROVIDER:'workers-ai',APIFY_LIVE_FETCH_ENABLED:'false',COMMUNITY_SOURCE_MODE:'snapshot'};
}
export function verifyAssistantWorker(config) {
  if(config.name!=='visathreads-ai-dev'||config.routes?.length||config.workers_dev===false||config.vars?.ASSISTANT_PROJECT_REF!==ASSISTANT_DEV_REF
    ||config.ai?.binding!=='ASSISTANT_AI') throw new Error('Refusing deployment: generated Worker is not isolated assistant staging.');
}
async function run(bin,args,env) {
  await new Promise((resolvePromise,reject)=>{
    const child=spawn(resolve(root,'node_modules','.bin',bin),args,{cwd:root,env,stdio:'inherit'});
    child.on('error',reject);child.on('exit',code=>code===0?resolvePromise():reject(new Error(`${bin} exited with ${code}`)));
    for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>child.kill(signal));
  });
}
export async function buildAssistantDevelopment(deploy=false) {
  const {loadEnv}=await import('vite');
  const values={...loadEnv('assistant',root,''),...process.env};
  const env={...process.env,...assistantDevelopmentEnvironment(values)};
  // Existing process values prevent unrelated .env.production.local settings taking precedence.
  for(const name of Object.keys(env)) if(/^(?:APIFY_TOKEN|DATABASE_URL|DIRECT_URL|SUPABASE_.*(?:SERVICE_ROLE|SECRET).*)$/.test(name)) delete env[name];
  const sourceConfig=JSON.parse(await readFile(resolve(root,'wrangler.jsonc'),'utf8'));
  verifyAssistantWorker(sourceConfig.env.assistant);
  await run('vinext',['build'],env);
  const generated=JSON.parse(await readFile(resolve(root,'dist/server/wrangler.json'),'utf8'));
  verifyAssistantWorker(generated);
  if(deploy) await run('vinext-cloudflare',['deploy','--config','dist/server/wrangler.json','--skip-build'],env);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(process.argv.slice(2).some(arg=>arg!=='--deploy')) throw new Error('Only --deploy is supported.');
  buildAssistantDevelopment(process.argv.includes('--deploy')).catch(error=>{console.error(error.message);process.exitCode=1;});
}

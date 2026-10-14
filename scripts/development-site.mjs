import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
export const ASSISTANT_DEV_REF='ppdwysmeistjxzjpmxyk';
export const ASSISTANT_DEV_WORKER='visathreads-sandbox';
export const ASSISTANT_DEV_ORIGIN='https://visa-central.com';
const devHosts=['visa-central.com','www.visa-central.com'];
export function assistantDevelopmentEnvironment(values) {
  if(values.NEXT_PUBLIC_SUPABASE_URL!==`https://${ASSISTANT_DEV_REF}.supabase.co`) throw new Error('Development requires the isolated ppdwysmeistjxzjpmxyk project. Production is forbidden.');
  const key=values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??'';
  if(!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key)) throw new Error('Set the dev project publishable key in .env.sandbox.local. Secret and service-role keys are forbidden.');
  if(values.NEXT_PUBLIC_SITE_URL!==ASSISTANT_DEV_ORIGIN) throw new Error('Set NEXT_PUBLIC_SITE_URL to https://visa-central.com. Production domains are forbidden.');
  return {NEXT_PUBLIC_SUPABASE_URL:values.NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key,NEXT_PUBLIC_SITE_URL:values.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_APP_ENV:'development',NEXT_PUBLIC_DEPLOYMENT_TARGET:'development-sandbox',APP_ENV:'development',CLOUDFLARE_ENV:'sandbox',ASSISTANT_PROJECT_REF:'',
    ASSISTANT_PROVIDER:'',ASSISTANT_ENABLED:'false',ASSISTANT_COMMUNITIES_ENABLED:'false',ASSISTANT_CATCHUP_ENABLED:'false',APIFY_LIVE_FETCH_ENABLED:'false',COMMUNITY_SOURCE_MODE:'snapshot'};
}
export function verifyAssistantWorker(config) {
  const routes=config.routes;
  const safeRoutes=Array.isArray(routes)&&routes.length===2&&
    devHosts.every(host=>routes.some(route=>route.pattern===host&&route.custom_domain===true))&&
    routes.every(route=>Object.keys(route).every(key=>['pattern','custom_domain'].includes(key)));
  if(config.name!==ASSISTANT_DEV_WORKER||!safeRoutes||config.workers_dev!==false||
    config.vars?.NEXT_PUBLIC_SUPABASE_URL!==`https://${ASSISTANT_DEV_REF}.supabase.co`||config.vars?.APP_ENV!=='development'||
    config.vars?.NEXT_PUBLIC_SITE_URL!==ASSISTANT_DEV_ORIGIN||config.vars?.ASSISTANT_PROVIDER||config.vars?.ASSISTANT_PROJECT_REF||
    config.vars?.ASSISTANT_COMMUNITIES_ENABLED!=='false'||config.vars?.ASSISTANT_CATCHUP_ENABLED!=='false'||
    config.vars?.ASSISTANT_ENABLED!=='false'||config.ai) throw new Error('Refusing deployment: Worker, domains or database are not the isolated visa-central sandbox.');
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
  const values={...loadEnv('sandbox',root,''),...process.env};
  const env={...process.env,...assistantDevelopmentEnvironment(values)};
  // Existing process values prevent unrelated .env.production.local settings taking precedence.
  for(const name of Object.keys(env)) if(/^(?:OPENAI_API_KEY|APIFY_TOKEN|DATABASE_URL|DIRECT_URL|SUPABASE_.*(?:SERVICE_ROLE|SECRET).*)$/.test(name)) delete env[name];
  const sourceConfig=JSON.parse(await readFile(resolve(root,'wrangler.jsonc'),'utf8'));
  verifyAssistantWorker(sourceConfig.env.sandbox);
  await run('vinext',['build'],env);
  const generated=JSON.parse(await readFile(resolve(root,'dist/server/wrangler.json'),'utf8'));
  verifyAssistantWorker(generated);
  if(deploy) await run('vinext-cloudflare',['deploy','--config','dist/server/wrangler.json','--skip-build'],env);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(process.argv.slice(2).some(arg=>arg!=='--deploy')) throw new Error('Only --deploy is supported.');
  buildAssistantDevelopment(process.argv.includes('--deploy')).catch(error=>{console.error(error.message);process.exitCode=1;});
}

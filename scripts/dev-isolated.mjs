import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

export function developmentEnvironment(effective, { demo = false } = {}) {
  const fail = (message) => { throw new Error(`Local development blocked: ${message}`); };
  let url = effective.NEXT_PUBLIC_SUPABASE_URL ?? '';
  let key = effective.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
  if (demo) { url = ''; key = ''; }
  if (Boolean(url) !== Boolean(key)) fail('Provide both local Supabase settings or use npm run dev:demo.');
  if (url) {
    let parsed;
    try { parsed = new URL(url); } catch { fail('Use a loopback Supabase URL or npm run dev:demo.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
      || !parsed.port || parsed.pathname !== '/' || parsed.username || parsed.password || parsed.search || parsed.hash) {
      fail('Hosted databases are not permitted in local interactive development. Use your separate local stack or npm run dev:demo.');
    }
    let publicKey = /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key);
    if (!publicKey && key.split('.').length === 3) {
      try { const claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url')); publicKey=claims.role==='anon' && !claims.ref; } catch { publicKey=false; }
    }
    if (!publicKey) fail('Use only this local stack\'s publishable/anon key; hosted JWTs and privileged keys are forbidden.');
    url = parsed.origin;
  }
  // Existing process variables take priority over .env files in Vite and Next.
  // Force both checked values into the child, including empty values in demo.
  return {
    NEXT_PUBLIC_SUPABASE_URL:url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key,
    NEXT_PUBLIC_APP_ENV:'development', APP_ENV:'development', CLOUDFLARE_ENV:'development',
    NODE_ENV:'development', COMMUNITY_SOURCE_MODE:'snapshot', APIFY_LIVE_FETCH_ENABLED:'false',
    VISAFLOW_LOCAL_DATA_MODE:url ? 'local-supabase' : 'browser-demo',
  };
}

export function developmentArguments(args) {
  let demo=false, next=true, port='3000';
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--demo') demo=true;
    else if(args[i]==='--next') next=true;
    else if(args[i]==='--port' && /^\d+$/.test(args[i+1] ?? '') && Number(args[i+1])>=1024 && Number(args[i+1])<=65535) port=args[++i];
    else throw new Error('Local development accepts only --demo, --next, and --port 1024–65535.');
  }
  return {demo,next,port};
}

export async function runDevelopment(args=process.argv.slice(2)) {
  const options=developmentArguments(args);
  // In demo mode there is no reason for this launcher to open any env file.
  const effective=options.demo ? {} : (await import('vite')).loadEnv('development',root,'');
  const overrides=developmentEnvironment(effective,options);
  const env={...process.env,...overrides,NEXT_PUBLIC_SITE_URL:`http://localhost:${options.port}`};
  for(const name of Object.keys(env)) {
    if (/^(?:APIFY_TOKEN|DATABASE_URL|DIRECT_URL|SUPABASE_.*(?:SERVICE_ROLE|SECRET).*)$/.test(name)) env[name]='';
  }
  console.log(overrides.VISAFLOW_LOCAL_DATA_MODE==='browser-demo'
    ? 'Starting isolated browser demo: posts and messages stay in this browser; real login/realtime are unavailable.'
    : 'Starting against a checked local Supabase origin. Hosted production credentials are not used.');
  // The Worker development plugin independently loads .dev.vars, even when
  // process.env is sanitized. Use the existing Next server for isolated local
  // interaction; hosted Worker builds/deployments remain a separate workflow.
  const command=resolve(root,'node_modules','.bin','next');
  const child=spawn(command,['dev','--hostname','127.0.0.1','--port',options.port],{cwd:root,env,stdio:'inherit'});
  for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>child.kill(signal));
  child.on('error',()=>{console.error('Could not start the isolated development server.');process.exitCode=1;});
  child.on('exit',(code)=>{process.exitCode=code ?? 1;});
  return child;
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  runDevelopment().catch(error=>{console.error(error.message);process.exitCode=1;});
}

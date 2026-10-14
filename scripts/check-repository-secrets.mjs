// Read-only pattern scan. Report categories and filenames, never matching values.
// This cannot prove that every credential type has been found or revoked.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const git=(args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:128*1024*1024});
const findings=new Map();
function inspect(text,path,scope) {
  const categories=new Set();
  if (/sb_secret_[A-Za-z0-9_-]{20,}/.test(text)) categories.add('Supabase secret key');
  if (/apify_api_[A-Za-z0-9]{25,}/.test(text)) categories.add('Apify token');
  for(const token of text.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    let payload; try{payload=JSON.parse(Buffer.from(token[1],'base64url').toString('utf8'));}catch{continue;}
    if(payload.role==='service_role') categories.add('Supabase service-role JWT');
  }
  // Conservative contextual checks: these are potential credentials to review.
  for(const match of text.matchAll(/(?:CF_API_TOKEN|CLOUDFLARE_API_TOKEN|R2_SECRET_ACCESS_KEY|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*["']?([A-Za-z0-9_+\/-]{32,})/g)) {
    if(!/replace|example|placeholder|your_/i.test(match[1]) && new Set(match[1]).size>12) categories.add('Possible Cloudflare/storage credential');
  }
  for(const category of categories) findings.set(`${scope}:${path}:${category}`,{scope,path,category});
}
const files=git(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean);
let scanned=0;
for(const path of new Set(files)) {
  try { const text=await readFile(new URL(path,new URL('../',import.meta.url)),'utf8'); inspect(text,path,'working-tree'); scanned++; }
  catch(error){if(error.code!=='ENOENT' && error.code!=='EISDIR') throw error;}
}
if(process.argv.includes('--history')) {
  const patches=git(['log','--all','--format=','--patch','--no-ext-diff','--no-textconv']);
  let path='unknown'; let lines=[];
  const flush=()=>{inspect(lines.join('\n'),path,'git-history');lines=[];};
  for(const line of patches.split('\n')) {
    if(line.startsWith('diff --git ')){flush();path=line.split(' b/').slice(1).join(' b/');}
    else lines.push(line);
  }
  flush();
}
console.log(JSON.stringify({scannedWorkingFiles:scanned,historyScanned:process.argv.includes('--history'),findings:[...findings.values()],note:'Pattern-based review only. Values are never printed; historical findings require provider rotation/revocation, not just file removal.'},null,2));
if(findings.size) process.exitCode=1;

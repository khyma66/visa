// Non-mutating public-role probe: verify required RPCs exist AND deny signed-out
// callers. A missing migration must stop deployment, not produce broken menus.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const config=JSON.parse(await readFile(process.argv[2],'utf8'));
const origin=config.NEXT_PUBLIC_SUPABASE_URL;
const allowed=new Set(['https://cycnichledvqbxevrwnt.supabase.co','https://ppdwysmeistjxzjpmxyk.supabase.co']);
assert(allowed.has(origin),'Unexpected database origin');
const key=config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? config.NEXT_PUBLIC_SUPABASE_ANON_KEY;
assert(key,'Public database key is missing');
for(const [name,args] of Object.entries({member_notification_data:{page_number:0},my_reputation:{},community_spam_domains:{},post_library_state:{targets:[]},list_post_library:{selection:'saved',page_number:0},owner_security_dashboard:{},record_security_event:{event:{}}})) {
  const response=await fetch(origin+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify(args),redirect:'error',signal:AbortSignal.timeout(10000)});
  const result=await response.json();
  assert([401,403].includes(response.status) && result.code==='42501',name+': apply the reviewed community safety and security evidence migrations to this environment before deploying the UI.');
}
console.log('Community safety schema exists and rejects anonymous access.');

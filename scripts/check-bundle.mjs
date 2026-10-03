import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
const knownSecrets=[];
try {
  const env=parseEnv(await readFile(new URL('../.dev.vars',import.meta.url),'utf8'));
  for (const [name,value] of Object.entries(env)) if (/TOKEN|SECRET|PASSWORD/.test(name) && value.length>12 && !value.includes('replace_')) knownSecrets.push(value);
} catch (error) { if (error.code!=='ENOENT') throw error; }
let scanned=0;
async function scan(directory) {
  for (const entry of await readdir(directory,{withFileTypes:true})) {
    const path=new URL(entry.name+(entry.isDirectory()?'/':''),directory);
    if (entry.isDirectory()) { await scan(path); continue; }
    if (!/\.(js|json|html|map|css|svg)$/.test(entry.name)) continue;
    const text=await readFile(path,'utf8'); scanned++;
    assert(!knownSecrets.some((secret) => text.includes(secret)),`Private credential found in bundle: ${entry.name}`);
    assert(!/sb_secret_[A-Za-z0-9_-]{20,}/.test(text),`Supabase secret found in bundle: ${entry.name}`);
    for (const token of text.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
      let claims; try { claims=JSON.parse(Buffer.from(token[1],'base64url').toString()); } catch { continue; }
      assert(claims.role!=='service_role',`Service-role JWT found in bundle: ${entry.name}`);
    }
  }
}
await scan(new URL('../dist/client/',import.meta.url));
await scan(new URL('../dist/server/',import.meta.url));
console.log(`PASS: ${scanned} bundle files checked for known local secrets and Supabase privileged keys. This is not a complete repository/history secret audit.`);

// Review files are data, never executable instructions. Validation is the default.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { hash } from './editorial-apify.mjs';
import { parseCsv } from './editorial-csv.mjs';
import { validateRewrite, redact } from './editorial-rewrite.mjs';

export function validateReview(rows, originals) {
  const sources=new Map(originals.map(p=>[p.id,p])); const seen=new Set();
  return rows.map(row=>{
    const original=sources.get(row.id);
    assert(original&&!seen.has(row.id),'Unknown or duplicate source ID');seen.add(row.id);
    for(const key of ['source_url','source_key','source_hash','source_posted_at','run_id','original_text']) assert(row[key]===original[key],`Original source field changed: ${key}`);
    assert(['pending','approved','rejected'].includes(row.review_decision),'Use pending, approved or rejected');
    assert(/^\d{1,8}$/.test(row.backend_revision),'Invalid backend revision');
    const draft={...row,tags:JSON.parse(row.tags),review_flags:JSON.parse(row.review_flags)};
    const flags=validateRewrite(redact(original.original_text),draft);
    if(row.review_decision==='approved') {
      assert(row.reuse_basis.trim().length>=20,'Approved rows need a source reuse basis');
      assert(row.reviewer_notes.trim().length>=10,'Approved rows need a review note');
    }
    return {...draft,review_flags:flags,expected_revision:Number(row.backend_revision)};
  });
}
export async function ownerRpc(operation,payload,{origin,key,token,fetcher=fetch}) {
  assert(['https://cycnichledvqbxevrwnt.supabase.co','https://ppdwysmeistjxzjpmxyk.supabase.co'].includes(origin),'Choose the verified production or development database');
  assert(key&&token,'Configure the publishable key and the signed-in owner access token locally');
  const response=await fetcher(`${origin}/rest/v1/rpc/editorial_owner_action`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({operation,payload})});
  assert(response.ok,`Owner operation failed (HTTP ${response.status}); no automatic retry`);
  return response.json();
}
async function main(){
  const {values}=parseArgs({options:{file:{type:'string'},sources:{type:'string'},action:{type:'string',default:'validate'},apply:{type:'boolean',default:false},'confirmed-sha256':{type:'string'}}});
  assert(values.file&&values.sources,'Supply --file review.csv --sources source-posts.json');
  const file=await readFile(values.file,'utf8');const rows=validateReview(parseCsv(file),JSON.parse(await readFile(values.sources,'utf8')));
  const checksum=hash(file);
  assert(['validate','stage','review','schedule'].includes(values.action),'Invalid action');
  console.log(JSON.stringify({rows:rows.length,sha256:checksum,decisions:rows.reduce((r,p)=>({...r,[p.review_decision]:(r[p.review_decision]??0)+1}),{}),publishing_activated:false}));
  if(!values.apply||values.action==='validate')return;
  assert(values['confirmed-sha256']===checksum,'Confirm the exact reviewed CSV SHA-256 before any backend change');
  const config={origin:process.env.EDITORIAL_SUPABASE_URL,key:process.env.EDITORIAL_PUBLISHABLE_KEY,token:process.env.EDITORIAL_OWNER_ACCESS_TOKEN};
  const receipts=[];
  // Save each receipt immediately: partial network failure can be reconciled via the owner list operation.
  const receiptFile=`${values.file}.${values.action}.${Date.now()}.receipts.json`;
  const save=()=>writeFile(receiptFile,JSON.stringify({csv_sha256:checksum,action:values.action,receipts},null,2)+'\n',{mode:0o600});
  if(values.action==='stage'){
    for(let offset=0;offset<rows.length;offset+=50){
      const items=rows.slice(offset,offset+50).map(r=>Object.fromEntries(['id','source_key','source_url','source_posted_at','source_hash','run_id','title','body','visa_type','post_kind','experience_category','tags','review_flags','expected_revision'].map(k=>[k,r[k]])));
      receipts.push(...await ownerRpc('stage',{items},config));await save();
    }
  }else for(const row of rows){
    if(values.action==='review'&&row.review_decision!=='pending') receipts.push(await ownerRpc('review',{id:row.id,revision:Number(row.backend_revision),decision:row.review_decision,facts_verified:true,reuse_basis:row.reuse_basis,review_note:row.reviewer_notes},config));
    if(values.action==='schedule'&&row.review_decision==='approved'){
      assert(/^[0-9a-f-]{36}$/.test(row.author_id)&&Number.isFinite(Date.parse(row.scheduled_at)),'Scheduling needs the consented author UUID and ISO date');
      receipts.push(await ownerRpc('schedule',{id:row.id,revision:Number(row.backend_revision),author_id:row.author_id,scheduled_at:row.scheduled_at},config));
    }
    await save();
  }
  console.log(JSON.stringify({operations:receipts.length,receipt_file:receiptFile,publishing_activated:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});

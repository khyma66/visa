// Read existing results only. No actor runs are started and no credential is published.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import assert from 'node:assert/strict';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const token = parseEnv(await readFile(new URL('.dev.vars',root),'utf8')).APIFY_TOKEN;
assert(token && !token.includes('replace_'), 'Configure the existing local Apify credential first.');
const actor='2chN8UQcH1CfxLRNE';
const baseline='9iVj9RajtVcIVkzgZ';
async function api(path) {
  const response=await fetch(`https://api.apify.com/v2/${path}`,{
    headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}, signal:AbortSignal.timeout(30000),
    redirect:'error',
  });
  if (!response.ok) throw new Error(`Apify read failed: HTTP ${response.status}`);
  const reader=response.body.getReader(); const chunks=[]; let bytes=0;
  while (true) {
    const {done,value}=await reader.read(); if(done) break;
    bytes+=value.byteLength;
    if(bytes>20*1024*1024) { await reader.cancel(); throw new Error('API response exceeded the safe page size; no snapshot was published.'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const original=(await api(`actor-runs/${baseline}`)).data;
const originalInput=await api(`key-value-stores/${original.defaultKeyValueStoreId}/records/INPUT`);
// Runs must use exactly the original project's group URLs, not other actor customers/sources.
const sourceKey=(input)=>JSON.stringify((input.startUrls??[]).map((item)=>typeof item==='string'?item:item.url).sort());
assert(sourceKey(originalInput)!=='[]','The source group configuration could not be verified.');
const runs=[];
for(let offset=0;offset<1000;offset+=100) {
  const {data}=await api(`acts/${actor}/runs?desc=1&status=SUCCEEDED&limit=100&offset=${offset}`);
  runs.push(...data.items);
  if(offset+data.items.length>=data.total) break;
  assert(offset<900,'More than 1000 runs need a larger archival workflow; nothing was published.');
}
if(!runs.some((r)=>r.id===baseline) && original.status==='SUCCEEDED') runs.push(original);
const matching=[]; let otherSources=0;
for(const run of runs) {
  const input=await api(`key-value-stores/${run.defaultKeyValueStoreId}/records/INPUT`);
  if(sourceKey(input)!==sourceKey(originalInput)) { otherSources++; continue; }
  const dataset=(await api(`datasets/${run.defaultDatasetId}`)).data;
  matching.push({...run,itemCount:dataset.itemCount});
}
const inventory={successfulRuns:runs.length,matchingRuns:matching.length,otherSources,
  sourceRows:matching.reduce((sum,r)=>sum+r.itemCount,0),
  runs:matching.map((r)=>({id:r.id,finishedAt:r.finishedAt,itemCount:r.itemCount}))};
console.log(JSON.stringify(inventory,null,2));
if(!process.argv.includes('--snapshot')) process.exit(0);
assert(matching.length,'No matching completed runs were found.');
assert(inventory.sourceRows<=50000,'Archive exceeds development export capacity; no partial snapshot will be published.');
const moduleUrl=(code)=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const transpile=(source)=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const tags=moduleUrl(transpile(await readFile(new URL('src/lib/tagging.ts',root),'utf8')));
// Reuse the exact sanitization/normalization used by the live endpoint.
let code=transpile((await readFile(new URL('src/app/api/community/route.ts',root),'utf8'))+'\nexport { normalizePost };');
code=code.replace("'next/server'",JSON.stringify(moduleUrl('export class NextResponse extends Response {}')))
  .replace("'@/lib/tagging'",JSON.stringify(tags))
.replace("'@visa/archive'",JSON.stringify(moduleUrl('export default {questions:[],answersByQuestionId:{},source:{}};')));
const {normalizePost}=await import(moduleUrl(code));
const questions=new Map(),comments=new Map(); let fetched=0,empty=0,duplicates=0;
const now=new Date().toISOString();
const fields=['id','legacyId','url','time','text','user','topComments','likesCount','topReactionsCount','commentsCount','sharesCount','groupTitle'];
// Newest snapshot wins post text/counts; retain distinct available comments from older runs.
matching.sort((a,b)=>b.finishedAt.localeCompare(a.finishedAt));
for(const run of matching) {
  let read=0;
  for(let offset=0;offset<run.itemCount;offset+=100) {
    const page=await api(`datasets/${run.defaultDatasetId}/items?limit=100&offset=${offset}&fields=${fields.join(',')}`);
    assert(Array.isArray(page) && page.length>0,'Incomplete dataset page; export stopped.');
    read+=page.length; fetched+=page.length;
    for(const post of page) {
      const normalized=normalizePost(post,run.finishedAt??now);
      if(!normalized) { empty++; continue; }
      const {question,answers}=normalized;
      if(questions.has(question.id)) duplicates++; else questions.set(question.id,question);
      if(!comments.has(question.id)) comments.set(question.id,new Map());
      for(const answer of answers) if(!comments.get(question.id).has(answer.id)) comments.get(question.id).set(answer.id,answer);
    }
  }
  assert.equal(read,run.itemCount,'Dataset count changed or was incompletely fetched; export stopped.');
}
const answersByQuestionId=Object.fromEntries([...comments].map(([id,answers])=>[id,[...answers.values()]]));
const rows=[...questions.values()].map((q)=>({...q,answer_count:Math.max(q.answer_count,answersByQuestionId[q.id].length)}));
rows.sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id));
const archive={questions:rows,answersByQuestionId,fetchedAt:now,source:{name:'Apify',runId:matching[0].id,status:'snapshot',
  totalItems:fetched,importedItems:rows.length,emptyItems:empty,duplicateItems:duplicates,
  runCount:matching.length,commentCount:Object.values(answersByQuestionId).reduce((sum,r)=>sum+r.length,0),
  runIds:matching.map((r)=>r.id),capturedAt:now,oldestRunAt:matching.at(-1).finishedAt,newestRunAt:matching[0].finishedAt}};
const serialized=JSON.stringify(archive);
assert(!serialized.includes(token),'A credential was found in generated results.');
assert(Buffer.byteLength(serialized)<12*1024*1024,'Archive is too large for bundled development hosting; no partial snapshot written.');
await mkdir(new URL('src/data/',root),{recursive:true});
// Rename within the same directory so a failed write never truncates the good snapshot.
const temporary = new URL('src/data/api-archive.json.tmp',root);
await writeFile(temporary,serialized+'\n',{mode:0o600});
await rename(temporary,new URL('src/data/api-archive.json',root));
console.log(JSON.stringify({snapshot:archive.source,bytes:Buffer.byteLength(serialized),tags:new Set(rows.flatMap((q)=>q.tags)).size},null,2));

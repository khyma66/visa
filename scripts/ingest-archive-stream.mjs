// Memory-bounded ingestion for large, already-reviewed public datasets. Input is
// NDJSON: {"question": {...}, "answers": [...]}, one discussion per line.
import assert from 'node:assert/strict';
import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {archiveRecords} from './archive-database-records.mjs';
const token=process.env.ARCHIVE_INGEST_TOKEN;
assert(token&&/^[a-f0-9]{64}$/.test(token),'Scoped archive ingestion token is missing');
assert(process.argv[2]&&process.argv[3],'Provide reviewed NDJSON and source metadata paths');
const source=JSON.parse(await readFile(process.argv[3],'utf8'));
assert(source.name==='Apify','Reviewed source metadata is required');
let batch=[],bytes=2,processed=0,changed=0;
async function flush(final=false){
 if(!batch.length&&!final)return;
 const response=await fetch('https://cycnichledvqbxevrwnt.supabase.co/rest/v1/rpc/archive_ingest_batch',{
  method:'POST',headers:{apikey:'sb_publishable_7QnSRDvWRYFIqA3zhsNIsw_iWSspCTN','Content-Type':'application/json'},
  body:JSON.stringify({token,posts:batch,source_metadata:final?source:null}),redirect:'error',signal:AbortSignal.timeout(20000),
 });
 assert(response.ok,`Import stopped after ${processed} rows; restarting is idempotent`);
 const result=await response.json();assert(Number.isSafeInteger(result)&&result>=0,'Invalid import receipt');changed+=result;processed+=batch.length;batch=[];bytes=2;
}
for await(const line of createInterface({input:createReadStream(process.argv[2],{highWaterMark:65536}),crlfDelay:Infinity})){
 if(!line.trim())continue;
 assert(Buffer.byteLength(line)<900000,'Discussion exceeds reviewed input bounds');
 const value=JSON.parse(line);
 const record=archiveRecords({source,questions:[value.question],answersByQuestionId:{[value.question.id]:value.answers??[]}})[0];
 const size=Buffer.byteLength(JSON.stringify(record))+1;
 if(batch.length===50||bytes+size>900000)await flush();
 batch.push(record);bytes+=size;
}
await flush(true);
console.log(JSON.stringify({operation:'streamed-indexed-archive-sync',processed,changed}));

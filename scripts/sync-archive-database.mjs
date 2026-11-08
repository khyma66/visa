import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {archiveRecords,archiveBatches} from './archive-database-records.mjs';
const token=process.env.ARCHIVE_INGEST_TOKEN;
assert(token&&/^[a-f0-9]{64}$/.test(token),'Scoped archive ingestion token is missing');
const feed=JSON.parse(await readFile(process.argv[2],'utf8'));
const batches=archiveBatches(archiveRecords(feed));let changed=0;
for(let i=0;i<batches.length;i++){
 const response=await fetch('https://cycnichledvqbxevrwnt.supabase.co/rest/v1/rpc/archive_ingest_batch',{
  method:'POST',headers:{apikey:'sb_publishable_7QnSRDvWRYFIqA3zhsNIsw_iWSspCTN','Content-Type':'application/json'},
  body:JSON.stringify({token,posts:batches[i],source_metadata:i===batches.length-1?feed.source:null}),redirect:'error',signal:AbortSignal.timeout(20000),
 });
 assert(response.ok,'Archive batch ingestion failed; retry is idempotent');
 const count=await response.json();assert(Number.isSafeInteger(count)&&count>=0,'Invalid import receipt');changed+=count;
}
console.log(JSON.stringify({operation:'indexed-archive-sync',batches:batches.length,changed}));

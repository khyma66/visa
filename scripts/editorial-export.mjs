// Reproducible local export. Refuses partial batches and never overwrites a review file.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { hash } from './editorial-apify.mjs';
import { redact, validateRewrite } from './editorial-rewrite.mjs';
import { parseCsv, serializeCsv } from './editorial-csv.mjs';
import { validateReview } from './editorial-review.mjs';

export function prepareReview(originals,drafts) {
  assert(originals.length>0 && originals.length===drafts.length,'Every source post needs a draft');
  const byId=new Map(drafts.map(d=>[d.id,d]));
  assert.equal(byId.size,drafts.length,'Duplicate draft IDs');
  const seen=new Map();
  const rows=originals.map(source=>{
    const draft=byId.get(source.id);
    assert(draft && draft.source_hash===hash(source.original_text),'Missing or stale draft');
    const flags=validateRewrite(redact(source.original_text),draft);
    if(seen.has(source.source_hash))flags.push(`Duplicate source text; compare ${seen.get(source.source_hash)}`);
    else seen.set(source.source_hash,source.id);
    return {...draft,review_flags:flags,review_decision:'pending',reviewer_notes:'',reuse_basis:'',
      author_id:'',scheduled_at:'',backend_revision:0};
  });
  const csv=serializeCsv(rows);
  validateReview(parseCsv(csv),originals);
  return {rows,csv};
}
async function main(){
  const {values}=parseArgs({options:{sources:{type:'string'},drafts:{type:'string'},out:{type:'string'}}});
  assert(values.sources&&values.drafts&&values.out,'Supply --sources source-posts.json --drafts DIRECTORY --out NEW.csv');
  const originals=JSON.parse(await readFile(values.sources,'utf8'));
  const drafts=await Promise.all(originals.map(async source=>{
    assert(/^[a-f0-9]{64}$/.test(source.id),'Invalid source ID');
    return JSON.parse(await readFile(`${values.drafts}/${source.id}.json`,'utf8'));
  }));
  const {rows,csv}=prepareReview(originals,drafts);
  await writeFile(values.out,csv,{mode:0o600,flag:'wx'});
  assert.equal(hash(await readFile(values.out,'utf8')),hash(csv));
  console.log(JSON.stringify({file:values.out,rows:rows.length,pending:rows.length,
    flagged:rows.filter(r=>r.review_flags.length).length,sha256:hash(csv),publishing_activated:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});

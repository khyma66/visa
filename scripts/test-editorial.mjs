import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hash, postDate, selectPosts, sourceGroups, apifyRead, collect } from './editorial-apify.mjs';
import { serializeCsv,parseCsv,COLUMNS } from './editorial-csv.mjs';
import { validateReview,ownerRpc } from './editorial-review.mjs';
import { redact,validateRewrite } from './editorial-rewrite.mjs';
const url='https://www.facebook.com/groups/123/posts/456';
const original={id:hash(url),source_url:url,source_key:'https://www.facebook.com/groups/123',source_posted_at:'2026-09-03T05:00:00.000Z',source_hash:hash('Original text'),original_text:'Original text',run_id:'I0AI56pOzxvFHTz40'};
const review={...original,review_decision:'pending',title:'A member asks about H-1B processing',body:'A member asks about H-1B processing and reported delays.',visa_type:'H-1B',post_kind:'question',experience_category:'',tags:['h1b'],review_flags:[],backend_revision:0};
test('CSV quotes newlines and protects spreadsheet formulas reversibly',()=>{
  for(const text of ['=HYPERLINK("evil")',' +123','@name','-42',"'=already literal","''apostrophes",'A "quote", comma\nand line']){
    const rows=parseCsv(serializeCsv([{...review,original_text:text,body:text}]));assert.equal(rows[0].body,text);assert.equal(rows[0].original_text,text);
    if(/^[=+@-]/.test(text))assert(serializeCsv([{...review,body:text}]).includes(`"'${text.replaceAll('"','""')}"`));
  }
});
test('invalid and ambiguous CSV files are rejected',()=>{
  assert.throws(()=>parseCsv('id,id\na,b'),/duplicate/);
  assert.throws(()=>parseCsv(COLUMNS.join(',')+'\n"unfinished'),/Unclosed/);
  assert.throws(()=>parseCsv(COLUMNS.join(',')+'\n"ok"bad'),/Unexpected/);
});
test('review validation preserves source facts and never approves pending rows',()=>{
  const parsed=parseCsv(serializeCsv([review]));assert.equal(validateReview(parsed,[original])[0].review_decision,'pending');
  assert.throws(()=>validateReview([{...parsed[0],source_posted_at:'2026-11-03'}],[original]),/source field changed/);
  assert.throws(()=>validateReview([{...parsed[0],review_decision:'approved'}],[original]),/reuse basis/);
});
test('duplicate row IDs and missing original fields are rejected',()=>{
  const parsed=parseCsv(serializeCsv([review]));assert.throws(()=>validateReview([...parsed,...parsed],[original]),/duplicate/);
});
test('date filter uses original post time and excludes missing dates',()=>{
  const item=(time,id)=>({post:{time,text:'A source post',url:`https://www.facebook.com/groups/123/posts/${id}`},captured_at:'2026-11-03T00:00:00Z'});
  const result=selectPosts([item('2026-09-03T05:00:00Z',1),item('2026-09-03T04:59:59Z',2),item('2026-11-04T06:00:00Z',3),item(null,4)],{from:'2026-09-03T05:00:00.000Z',until:'2026-11-04T06:00:00.000Z'});
  assert.equal(result.posts.length,1);assert.equal(result.counts.outside_window,2);assert.equal(result.counts.missing_date,1);
  assert.equal(postDate('yesterday'),null);
});
test('latest snapshot wins while URL deduplication preserves distinct posts',()=>{
  const rows=[{post:{url,text:'Old text',time:'2026-09-04T00:00:00Z'},captured_at:'2026-09-10'},
    {post:{url:url+'?tracking=1',text:'Updated text',time:'2026-09-04T00:00:00Z'},captured_at:'2026-10-07'}];
  const result=selectPosts(rows,{from:'2026-09-03T00:00:00.000Z',until:'2026-11-04T00:00:00.000Z'});
  assert.equal(result.posts.length,1);assert.equal(result.posts[0].original_text,'Updated text');assert.equal(result.counts.duplicates,1);
});
test('only existing Facebook group sources are accepted',()=>{
  assert.deepEqual(sourceGroups({startUrls:[{url:'https://facebook.com/groups/123/'}]}),['https://www.facebook.com/groups/123']);
  assert.throws(()=>sourceGroups({startUrls:['https://attacker.invalid/group']}));
});
test('Apify authentication stays in headers and redirects are denied',async()=>{
  await apifyRead('datasets/fixture','synthetic-token',async(target,options)=>{
    assert.equal(new URL(target).origin,'https://api.apify.com');assert(!target.includes('synthetic-token'));assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer synthetic-token');return Response.json({data:{}});
  });
});
test('collector fails on partial pagination instead of silently exporting a truncated batch',async()=>{
  const run={id:'I0AI56pOzxvFHTz40',actId:'actor',status:'SUCCEEDED',finishedAt:'2026-10-08',defaultKeyValueStoreId:'store',defaultDatasetId:'dataset'};
  await assert.rejects(()=>collect({baseline:run.id,from:'2026-09-03T00:00:00Z',until:'2026-11-04T00:00:00Z',read:async path=>{
    if(path.startsWith('actor-runs/'))return{data:run};if(path.includes('records/INPUT'))return{startUrls:['https://www.facebook.com/groups/123']};
    if(path.startsWith('actors/'))return{data:{items:[run],total:1}};if(path.endsWith('/items?limit=100&offset=0&fields=id,legacyId,url,time,text,groupTitle'))return[];return{data:{itemCount:1}};
  }}),/Incomplete dataset/);
});
test('known personal identifiers are removed before inference',()=>{
  const result=redact('Email example@example.invalid receipt IOE1234567890 telephone 9876543210 passport X1234567');
  assert(!result.includes('example@'));assert(!result.includes('IOE123'));assert(!result.includes('9876543210'));assert(!result.includes('X1234567'));
});
test('numerical changes are flagged and I-94 is not mistaken for first person',()=>{
  const draft={...review,body:'A member asks whether the I-94 expiration changes a 60-day period.',review_flags:[]};
  const flags=validateRewrite('H-1B I-94 and 30-day period',draft);assert(flags.some(f=>f.includes('added numbers: 60')));assert(flags.some(f=>f.includes('omitted numbers: 30')));assert(!flags.some(f=>f.includes('first-')));
});
test('owner API refuses unrecognized databases and redirect credential forwarding',async()=>{
  await assert.rejects(()=>ownerRpc('stage',{}, {origin:'https://attacker.invalid',key:'key',token:'token'}),/verified/);
  await ownerRpc('list',{}, {origin:'https://cycnichledvqbxevrwnt.supabase.co',key:'synthetic',token:'synthetic',fetcher:async(url,options)=>{assert.equal(options.redirect,'error');return Response.json({items:[]});}});
});
test('number words and list markers do not create spurious numeric warnings',()=>{
  const draft={...review,title:'A member asks about processing timelines',body:'A member asks about a six-month timeline and a two-year extension.',review_flags:[]};
  assert.deepEqual(validateRewrite('1. Ask about 6 months.\n2. Ask about 2 years.',draft),[]);
});
test('material visa details are checked and computed flags refresh after correction',()=>{
  const draft={...review,body:'A member asks about an H-1B petition and I-94.',review_flags:['Check first- or second-person wording','Specific source ambiguity']};
  const flags=validateRewrite('H1B COS and I-94; PREMIUM processing',draft);
  assert(flags.some(f=>f.includes('change of status, premium processing')));
  assert(!flags.some(f=>f.includes('first-')));assert(flags.includes('Specific source ambiguity'));
  draft.body+=' The question concerns change of status and premium processing.';
  assert.deepEqual(validateRewrite('H1B COS and I-94; PREMIUM processing',{...draft,review_flags:flags}),['Specific source ambiguity']);
});

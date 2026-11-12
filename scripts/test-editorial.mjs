import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hash, postDate, selectPosts, sourceGroups, apifyRead, collect } from './editorial-apify.mjs';
import { serializeCsv,parseCsv,COLUMNS } from './editorial-csv.mjs';
import { validateReview,ownerRpc,withStageReceipts } from './editorial-review.mjs';
import { redact,validateRewrite } from './editorial-rewrite.mjs';
import { prepareReview } from './editorial-export.mjs';
import { planSchedule } from './editorial-plan.mjs';
import { grantConsent, SOURCE } from './editorial-consent.mjs';
import { nextSlot, preparePilot } from './editorial-pilot.mjs';
const url='https://www.facebook.com/groups/123/posts/456';
const original={id:hash(url),source_url:url,source_key:'https://www.facebook.com/groups/123',source_posted_at:'2026-09-03T05:00:00.000Z',source_hash:hash('Original text'),original_text:'Original text',run_id:'I0AI56pOzxvFHTz40'};
const review={...original,review_decision:'pending',title:'A member asks about H-1B processing',body:'A member asks about H-1B processing and reported delays.',visa_type:'H-1B',post_kind:'question',experience_category:'',tags:['h1b'],review_flags:[],backend_revision:0};
const consent=(n)=>({author_id:`22222222-2222-4222-8222-${String(n).padStart(12,'0')}`,source_key:original.source_key,enabled:true,daily_limit:1,expires_at:'2027-01-01T00:00:00Z'});
const approved=(n)=>({...review,id:hash(String(n)),backend_revision:1,review_decision:'approved',reuse_basis:'Written permission from the source author.',reviewer_notes:'Compared all facts to the original source.',author_id:'',scheduled_at:''});
test('account authorization signs in as the account, grants only its scoped permission and closes the temporary session',async()=>{
  const calls=[];
  const client={auth:{
    signInWithPassword:async value=>{calls.push(['login',value.email]);return {data:{session:{}},error:null};},
    getUser:async()=>({data:{user:{email:'member@example.com'}},error:null}),
    signOut:async options=>{calls.push(['logout',options.scope]);return {error:null};}
  },rpc:async (name,args)=>{calls.push(['rpc',name,args]);return {data:{enabled:true,expires_at:'2026-11-25',daily_limit:3},error:null};}};
  assert.equal((await grantConsent(client,'member@example.com','password-not-logged')).enabled,true);
  assert.deepEqual(calls,[['login','member@example.com'],['rpc','editorial_consent',{source:SOURCE,allow_posting:true,days_valid:14,per_day:3}],['logout','local']]);
});
test('account authorization rejects a mismatched identity and closes its session without granting',async()=>{
  let grants=0,logout=0;
  const client={auth:{signInWithPassword:async()=>({data:{session:{}},error:null}),getUser:async()=>({data:{user:{email:'other@example.com'}},error:null}),signOut:async()=>{logout++;return {error:null};}},rpc:async()=>{grants++;}};
  await assert.rejects(()=>grantConsent(client,'member@example.com','ignored'),/could not be verified/);
  assert.equal(grants,0);assert.equal(logout,1);
});
test('pilot scheduling picks a future slot in the Chicago daytime',()=>{
  assert.equal(nextSlot(Date.parse('2026-11-11T23:50:00Z')),'2026-11-12T00:15:00.000Z');
  assert.equal(nextSlot(Date.parse('2026-11-12T03:00:00Z')),'2026-11-12T14:00:00.000Z');
});
test('pilot refuses changed settings before any write',async()=>{
  const calls=[];
  const client={rpc:async (_name,{operation})=>{calls.push(operation);return {data:{items:[],settings:{enabled:false,tactical_views_enabled:true}}};}};
  await assert.rejects(()=>preparePilot(client,'22222222-2222-4222-8222-222222222222',async()=>true),/view settings changed/);
  assert.deepEqual(calls,['list']);
});
test('pilot approves and schedules only the verified single post after confirmation',async()=>{
  const calls=[];
  const item={id:'6057998d86d5a7521241f76e53c48ef79fd6d614efc28daf790cac11b3b61431',status:'draft',revision:2,
    title:'Question about an H-1B denial after an RFE response',
    body:'A community member reports selection in this year’s H-1B lottery, followed by a request for evidence (RFE) in September. The RFE response was submitted on November 1, and on November 5 the member saw a denial status referring to the case being denied and available options. The member asks what that status means and what options are available.',
    source_url:'https://www.facebook.com/groups/H1B.Visa.Community/permalink/2341109953370786',source_key:SOURCE,source_posted_at:'2026-11-06T16:29:13Z'};
  const client={rpc:async (_name,{operation,payload})=>{calls.push([operation,payload]);return {data:operation==='list'?{items:[item],settings:{enabled:false,tactical_views_enabled:false}}:{}};}};
  const result=await preparePilot(client,'22222222-2222-4222-8222-222222222222',async()=>true,Date.parse('2026-11-12T03:00:00Z'));
  assert.equal(result.scheduled_at,'2026-11-12T14:00:00.000Z');
  assert.deepEqual(calls.map(c=>c[0]),['list','review','source','schedule','controls']);
  assert.equal(calls[3][1].author_id,'22222222-2222-4222-8222-222222222222');
});
test('offline plan rotates accounts and respects daily quotas across Chicago DST',()=>{
  const rows=Array.from({length:8},(_,n)=>approved(n));
  const planned=planSchedule([...rows,{...review,id:hash('pending')}],[1,2,3,4,5].map(consent),{from:'2026-10-31T13:00:00Z',now:'2026-10-31T12:00:00Z'});
  assert.equal(planned[0].scheduled_at.slice(0,10),'2026-10-31');
  assert.equal(planned[5].scheduled_at.slice(0,10),'2026-11-01');
  const chicago=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',hourCycle:'h23'});
  for(const row of planned.slice(0,8)) {
    const hour=Number(chicago.format(new Date(row.scheduled_at)));
    assert(hour>=8&&hour<21);
  }
  assert.equal(planned[0].author_id,consent(1).author_id);assert.equal(planned[5].author_id,consent(1).author_id);
  assert.equal(planned.at(-1).review_decision,'pending');assert.equal(planned.at(-1).author_id,undefined);
  assert.equal(rows[0].scheduled_at,'');
});
test('offline plan rejects expired consent, missing review, duplicate identities and existing assignments',()=>{
  const opts={from:'2026-11-08T14:00:00Z',now:'2026-11-08T13:00:00Z'};
  assert.throws(()=>planSchedule([approved(1)],[{...consent(1),expires_at:opts.now}],opts),/Insufficient/);
  assert.throws(()=>planSchedule([approved(1)],[consent(1),consent(1)],opts),/Duplicate account/);
  assert.throws(()=>planSchedule([{...approved(1),backend_revision:0}],[consent(1)],opts),/Stage and review/);
  assert.throws(()=>planSchedule([{...approved(1),author_id:consent(1).author_id}],[consent(1)],opts),/unscheduled/);
  assert.throws(()=>planSchedule([approved(1),approved(1)],[consent(1)],opts),/Duplicate draft/);
});
test('monthly limits roll over rather than oversubscribing a calendar month',()=>{
  const planned=planSchedule(Array.from({length:7},(_,n)=>approved(n)),[1,2,3,4,5].map(consent),{from:'2026-10-30T13:00:00Z',now:'2026-10-30T12:00:00Z',monthly:5});
  assert.equal(planned[5].scheduled_at.slice(0,10),'2026-11-01');
});
test('posting proposals spread across the day with stable slots and no quota or gap violations',()=>{
  const rows=Array.from({length:10},(_,n)=>approved(n)),accounts=[1,2,3,4,5].map(consent);
  const opts={from:'2026-11-08T14:00:00Z',now:'2026-11-08T13:00:00Z'};
  const planned=planSchedule(rows,accounts,opts);
  assert.deepEqual(planSchedule(rows,accounts,opts),planned);
  assert(Date.parse(planned[4].scheduled_at)-Date.parse(planned[0].scheduled_at)>=7*3600000);
  for(let i=1;i<planned.length;i++)assert(Date.parse(planned[i].scheduled_at)-Date.parse(planned[i-1].scheduled_at)>=3600000);
  assert.equal(new Set(planned.slice(0,5).map(r=>r.author_id)).size,5);
  assert.notDeepEqual(planned.slice(0,5).map(r=>r.scheduled_at.slice(11)),planned.slice(5).map(r=>r.scheduled_at.slice(11)));
});
test('long posting gaps still work and proposals never activate publication',()=>{
  const planned=planSchedule([approved(1),approved(2)],[consent(1)],{
    from:'2026-11-08T14:00:00Z',now:'2026-11-08T13:00:00Z',gapMinutes:1440,
  });
  assert(Date.parse(planned[1].scheduled_at)-Date.parse(planned[0].scheduled_at)>=86400000);
  assert(planned.every(r=>!Object.hasOwn(r,'views')&&!Object.hasOwn(r,'publishing_enabled')));
});
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
  for(const text of ['Venezuelan passport traveled outside the US','passport holders recently traveled','passport validity expires next month'])assert.equal(redact(text),text);
  assert.equal(redact('The consulate will contact Mr. Example directly.'),'The consulate will contact [person removed] directly.');
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
test('questions cannot silently become claims and absent source images are flagged',()=>{
  const source='Hello, is this employer hiring? Please see the screenshot.';
  const draft={...review,body:'A member reports that this employer is currently hiring.',review_flags:[]};
  const flags=validateRewrite(source,draft);
  assert(flags.includes('Check question preserved as a question'));
  assert(flags.includes('Source references an image not included in this text-only review'));
  draft.body='A member is asking whether this employer is currently hiring.';
  assert(!validateRewrite(source,draft).includes('Check question preserved as a question'));
});
test('export requires a complete batch and resets all cached approvals and assignments',()=>{
  assert.throws(()=>prepareReview([original],[]),/Every source/);
  const {rows,csv}=prepareReview([original],[{...review,review_decision:'approved',reviewer_notes:'old',reuse_basis:'old',author_id:'old',scheduled_at:'old',backend_revision:8}]);
  assert.equal(rows[0].review_decision,'pending');assert.equal(rows[0].backend_revision,0);assert.equal(rows[0].author_id,'');
  assert.equal(parseCsv(csv)[0].original_text,original.original_text);
});
test('staging receipts refresh revisions without altering human decisions or source text',()=>{
  const row={...review,review_decision:'approved',reviewer_notes:'Compared with source',backend_revision:3};
  const updated=withStageReceipts([row],[{id:row.id,revision:4,status:'draft'}]);
  assert.equal(updated[0].backend_revision,4);assert.equal(updated[0].review_decision,'approved');assert.equal(row.backend_revision,3);
  assert.throws(()=>withStageReceipts([row],[]),/Incomplete/);
  assert.throws(()=>withStageReceipts([row],[{id:row.id,revision:5,status:'draft'}]),/Invalid/);
});

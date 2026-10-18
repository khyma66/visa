import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { archiveSource } from './archive-source.mjs';

const archive=JSON.parse(await readFile(archiveSource(fileURLToPath(new URL('../',import.meta.url))),'utf8'));
const moduleUrl=(code)=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const transpile=(source)=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const tags=moduleUrl(transpile(await readFile(new URL('../src/lib/tagging.ts',import.meta.url),'utf8')));
const discovery=transpile(await readFile(new URL('../src/lib/discovery.ts',import.meta.url),'utf8')).replace("'./tagging'",JSON.stringify(tags));
const {createDiscoveryIndex}=await import(moduleUrl(discovery));
const presentation=moduleUrl(transpile(await readFile(new URL('../src/lib/post-presentation.ts',import.meta.url),'utf8')));
const normalization=transpile(await readFile(new URL('../src/lib/archive-presentation.ts',import.meta.url),'utf8')).replace("'./post-presentation'",JSON.stringify(presentation));
const {normalizeArchiveFeed}=await import(moduleUrl(normalization));
const route=transpile((await readFile(new URL('../src/app/api/community/route.ts',import.meta.url),'utf8'))+'\nexport { normalizePost };')
  .replace("'next/server'",JSON.stringify(moduleUrl('export class NextResponse extends Response {}')))
  .replace("'@/lib/tagging'",JSON.stringify(tags))
  .replace("'@/lib/archive-presentation'",JSON.stringify(moduleUrl(normalization)))
  .replace("'@visa/archive'",JSON.stringify(moduleUrl('export default {questions:[],answersByQuestionId:{},source:{}};')));
const {normalizePost}=await import(moduleUrl(route));

test('new imports have unknown views; source shares and replies are never substituted for views',()=>{
  for(const sharesCount of [undefined,0,97,'1500']) {
    for(const commentsCount of [0,4,1300]) {
      const input={id:'views-fixture',text:'What documents should I bring to my H1B interview?',sharesCount,commentsCount,
        topComments:[{id:'one',text:'Check the consulate instructions.'}]};
      const before=structuredClone(input);
      const normalized=normalizePost(input,'2026-10-18T00:00:00Z');
      assert.equal(normalized.question.view_count,null);
      assert.equal(normalized.question.answer_count,1);
      assert.equal(normalized.question.source_comment_count,commentsCount);
      assert.deepEqual(input,before,'Source records must remain unchanged');
    }
  }
});

test('public archive reply counts equal captured unique active replies, retaining upstream totals separately',()=>{
  const before=structuredClone(archive);
  const normalized=normalizeArchiveFeed(archive);
  for(const question of normalized.questions) {
    const original=archive.questions.find((row)=>row.id===question.id);
    const replies=normalized.answersByQuestionId[question.id];
    assert.equal(question.answer_count,replies.length);
    assert.equal(new Set(replies.map((row)=>row.id)).size,replies.length);
    assert.equal(question.source_comment_count,original.source_comment_count??original.answer_count);
    assert(replies.every((row)=>row.status==='active'&&row.question_id===question.id));
    assert.deepEqual(question.tags,original.tags);
  }
  assert.deepEqual(archive,before,'Presentation normalization must not rewrite reviewed records');
  assert.deepEqual(normalizeArchiveFeed(normalized),normalized,'Repeat normalization must not lose the upstream total');
});

test('reply normalization removes duplicate, archived and wrong-parent rows without inventing missing comments',()=>{
  const question={id:'apify-normalize',source:'apify',answer_count:99,tags:['h1b']};
  const reply={id:'apify-comment-one',question_id:question.id,status:'active',body:'Captured reply'};
  const native={id:'member-post',source:'visaflow',answer_count:7};
  const feed={questions:[question,native],answersByQuestionId:{[question.id]:[
    reply,{...reply,body:'Latest captured revision'},
    {...reply,id:'archived',status:'archived'},
    {...reply,id:'wrong-parent',question_id:'apify-another'},
  ]},source:{}};
  const normalized=normalizeArchiveFeed(feed);
  assert.equal(normalized.questions[0].answer_count,1);
  assert.equal(normalized.questions[0].source_comment_count,99);
  assert.equal(normalized.answersByQuestionId[question.id][0].body,'Latest captured revision');
  assert.equal(normalized.questions[1],native,'Native stored counts are outside the archive normalizer');
  assert.equal(feed.answersByQuestionId[question.id].length,4);
  const missing=normalizeArchiveFeed({...feed,answersByQuestionId:{}});
  assert.equal(missing.questions[0].answer_count,0);
  assert.deepEqual(missing.answersByQuestionId[question.id],[]);
  const updated=normalizeArchiveFeed({...feed,questions:[{...question,source_comment_count:0}]});
  assert.equal(updated.questions[0].source_comment_count,0,'An explicit upstream zero is not replaced by an older displayed count');
});

test('collected runs reconcile exactly with the published unique archive',()=>{
  const {source,questions,answersByQuestionId}=archive;
  assert(source.runCount>=2);
  assert.equal(source.runIds.length,source.runCount);
  assert.equal(source.totalItems,source.importedItems+source.duplicateItems+source.emptyItems);
  assert.equal(questions.length,source.importedItems);
  assert.equal(new Set(questions.map((q)=>q.id)).size,questions.length);
  assert.equal(Object.values(answersByQuestionId).flat().length,source.commentCount);
  for(const question of questions) {
    assert(question.body.length>0 && question.title.length>0);
    assert(question.tags.length>0 && question.tags.length<=5);
    assert.equal(new Set(question.tags).size,question.tags.length);
    assert.match(question.id,/^apify-[a-zA-Z0-9_-]+$/);
    assert(!('user' in question || 'profileId' in question || 'profileName' in question));
    const answers=answersByQuestionId[question.id];
    assert.equal(new Set(answers.map((a)=>a.id)).size,answers.length);
    assert(answers.every((a)=>a.question_id===question.id && a.body.length>0));
  }
});

test('every archive tag resolves to posts and related matches never include self or promotions',()=>{
  const comments=Object.fromEntries(Object.entries(archive.answersByQuestionId).map(([id,rows])=>[id,rows.map((r)=>r.body).join('\n')]));
  const index=createDiscoveryIndex(archive.questions,comments);
  const allTags=[...new Set(archive.questions.flatMap((q)=>q.tags))];
  assert(allTags.length>=20);
  for(const tag of allTags) assert(archive.questions.filter((q)=>q.tags.includes(tag)).length>0);
  let matched=0;
  for(const question of archive.questions) {
    const matches=index.search(question,5);
    if(matches.length) matched++;
    assert(matches.length<=5);
    assert(matches.every((m)=>m.id!==question.id && archive.questions.some((q)=>q.id===m.id && q.post_kind!=='promotion')));
    assert.equal(new Set(matches.map((m)=>m.id)).size,matches.length);
  }
  assert(matched>archive.questions.length/2,'Most archive posts should have meaningful related matches');
  console.log(`Verified ${archive.questions.length} posts, ${allTags.length} tags; ${matched} posts have related matches.`);
});

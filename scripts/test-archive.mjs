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

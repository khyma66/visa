import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/lib/post-presentation.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {usVisaPost,selectedExperiences}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
export function archiveRecords(feed){
 assert(Array.isArray(feed.questions)&&feed.source?.name==='Apify'&&feed.answersByQuestionId,'Invalid reviewed archive');
 return feed.questions.map(original=>{
  const scoped=usVisaPost(original),payload=scoped??original,answers=feed.answersByQuestionId[original.id]??[];
  assert(answers.length<=100&&answers.every(a=>a.question_id===original.id),'Invalid source reply bounds');
  assert(Buffer.byteLength(JSON.stringify(answers))<=300000,'Source reply bytes exceed bounds');
  return{id:payload.id,payload,source_answers:answers,experience:selectedExperiences([payload])[0]??null,created_at:payload.created_at,tags:payload.tags,visa_type:payload.visa_type,post_kind:payload.post_kind??'question',status:scoped?payload.status:'archived',vote_score:payload.vote_score,answer_count:payload.answer_count,discussion_text:answers.filter(a=>a.status==='active').map(a=>a.body).join('\n').slice(-20000)};
 });
}
export function archiveBatches(records){
 const result=[];let batch=[],bytes=2;
 for(const row of records){const size=Buffer.byteLength(JSON.stringify(row))+1;assert(size<900000,'Archive record exceeds batch limit');if(batch.length===50||bytes+size>900000){result.push(batch);batch=[];bytes=2;}batch.push(row);bytes+=size;}
 if(batch.length)result.push(batch);return result;
}

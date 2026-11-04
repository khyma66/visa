import assert from 'node:assert/strict';
import {test} from 'node:test';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/lib/members.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {memberCsv}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
test('CSV neutralizes formulas, quotes and embedded controls',()=>{
  const csv=memberCsv([{id:'id',username:'\t=HYPERLINK("evil")',email:'+attack@example.invalid',created_at:'date',email_verified:true,suspended:false,is_owner:false,questions:0,experiences:0,replies:0}]);
  assert.ok(csv.includes('"\' =HYPERLINK(""evil"")"'));
  assert.ok(csv.includes('"\'+attack@example.invalid"'));
  assert.equal(csv.split('\r\n').length,2);
});

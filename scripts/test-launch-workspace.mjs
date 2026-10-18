import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const {outputText}=ts.transpileModule(await readFile(new URL('../src/lib/launch-workspace.ts',import.meta.url),'utf8'),
  {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
const {LAUNCH_TASK_DEFINITIONS,experimentEconomics,unmetTaskDependencies,launchWorkspaceError}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
test('cash and economic contribution include founder time without inventing attribution',()=>{
  const costs={cash_cost_usd:50,founder_hours:8,hour_value_usd:40};
  assert.deepEqual(experimentEconomics({...costs,attributable_contribution_usd:null}),{
    founder_cost_usd:320,total_cost_usd:370,cash_contribution_usd:null,economic_contribution_usd:null,cash_roi_percent:null,economic_roi_percent:null,
  });
  assert.deepEqual(experimentEconomics({...costs,attributable_contribution_usd:0}),{
    founder_cost_usd:320,total_cost_usd:370,cash_contribution_usd:-50,economic_contribution_usd:-370,cash_roi_percent:-100,economic_roi_percent:-100,
  });
  const measured=experimentEconomics({...costs,attributable_contribution_usd:79.39});
  assert.equal(measured.cash_contribution_usd,29.39);assert.equal(measured.economic_contribution_usd,-290.61);
  assert.equal(measured.cash_roi_percent,58.78);assert.equal(measured.economic_roi_percent,-78.54);
});
test('undefined ROI with no denominator remains unknown, including actual refunds or negative contribution',()=>{
  const value=experimentEconomics({cash_cost_usd:0,founder_hours:0,hour_value_usd:0,attributable_contribution_usd:-20});
  assert.equal(value.cash_contribution_usd,-20);assert.equal(value.cash_roi_percent,null);assert.equal(value.economic_roi_percent,null);
  for(const invalid of [NaN,Infinity,-1,Number.MAX_VALUE])assert.throws(()=>experimentEconomics({cash_cost_usd:invalid,founder_hours:1,hour_value_usd:1,attributable_contribution_usd:null}));
});
test('task dependency graph has real IDs, no cycles and no fabricated progress',()=>{
  const all=new Map(LAUNCH_TASK_DEFINITIONS.map(task=>[task.id,task]));
  assert.equal(all.size,16);
  function visit(id,ancestors=[]){assert(!ancestors.includes(id));const task=all.get(id);assert(task);for(const dep of task.dependencies)visit(dep,[...ancestors,id]);}
  for(const task of all.values())visit(task.id);
  const task=all.get('L06');assert.deepEqual(unmetTaskDependencies(task,[{id:'L04',status:'done'}]),['L05']);
  assert.deepEqual(unmetTaskDependencies(task,[{id:'L04',status:'done'},{id:'L05',status:'done'}]),[]);
});
test('safe error messages preserve actionable conflicts without echoing arbitrary upstream content',()=>{
  assert.match(launchWorkspaceError({code:'40001'}),/another tab/);
  assert.match(launchWorkspaceError({code:'42501'}),/designated owner/);
  assert.match(launchWorkspaceError({code:'22023',message:'Completion requires evidence'}),/20 characters/);
  assert.doesNotMatch(launchWorkspaceError({message:'secret token from upstream'}),/secret token/);
});

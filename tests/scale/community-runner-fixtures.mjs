import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DEV_ORIGIN,makePlan } from '../../workers/community-runner/core.mjs';
const schema=await readFile(new URL('../../workers/community-runner/schema.sql',import.meta.url),'utf8');
export const START=Date.parse('2026-11-01T00:00:00Z');
export function fixture(count=10) {
  const db=new DatabaseSync(':memory:');db.exec(schema);
  const binding={prepare(sql){return {bind(...params){const stmt=db.prepare(sql);return {
    async first(){return stmt.get(...params) ?? null;},async run(){return {success:true,meta:stmt.run(...params)};},
  };}};}};
  const campaign=randomUUID(),jobs=makePlan(Array.from({length:count},(_,i)=>`Which details would clarify fictional question number ${i+1}?`),campaign);
  const insert=db.prepare('INSERT INTO runner_jobs(id,campaign,sequence,kind,actor,question_id,dependency,variant,seed) VALUES(?,?,?,?,?,?,?,?,?)');
  for(const j of jobs)insert.run(...['id','campaign','sequence','kind','actor','question_id','dependency','variant','seed'].map(k=>j[k]));
  const actors=Array.from({length:10},(_,i)=>({id:randomUUID(),email:`vf-runner-${campaign}-${i}@example.invalid`,password:`password-fixture-${i}-never-a-real-secret`}));
  const env={DB:binding,RUNNER_ENABLED:'true',SUPABASE_URL:DEV_ORIGIN,SUPABASE_PUBLIC_KEY:'sb_publishable_fixture',CAMPAIGN_ID:campaign,
    CAMPAIGN_START:new Date(START).toISOString(),CAMPAIGN_END:new Date(START+31*86400000).toISOString(),
    FREE_TIER_VERIFIED_AT:new Date(START).toISOString(),OUTBOUND_HOOKS_DISABLED:'true',CONTENT_MODE:'fixtures',RUNNER_ACTORS:JSON.stringify(actors)};
  const rows=new Map(),calls=[];
  const fetcher=async(input,init)=>{
    const url=new URL(input);assert.equal(url.origin,DEV_ORIGIN);assert.equal(init.redirect,'error');calls.push({url,method:init.method});
    const actor=actors.find(a=>init.headers.Authorization===`Bearer ${a.id}`);
    if(url.pathname==='/auth/v1/token'){
      const {email,password}=JSON.parse(init.body),a=actors.find(a=>a.email===email&&a.password===password);
      return Response.json(a?{access_token:a.id}:{error:'bad_credentials'},{status:a?200:401});
    }
    if(url.pathname==='/auth/v1/user')return Response.json({id:actor.id,email:actor.email,role:'authenticated',app_metadata:{visaflow_test_purpose:'community-runner',visaflow_test_run:campaign}});
    if(url.pathname==='/auth/v1/logout')return new Response(null,{status:204});
    assert(actor,'All application calls require a user session');
    if(init.method==='POST'){
      const body=JSON.parse(init.body);assert.equal(body.author_id,actor.id);assert(!('id' in body),'App cannot insert the server-owned ID column');
      assert(![...rows.values()].some(r=>r.body===body.body),'Duplicate write');
      body.id=randomUUID();rows.set(body.id,body);return new Response(null,{status:201});
    }
    const id=url.searchParams.get('id');
    const matches=id?[rows.get(id.slice(3))].filter(Boolean):[...rows.values()].filter(r=>r.author_id===url.searchParams.get('author_id').slice(3)&&r.body===url.searchParams.get('body').slice(3));
    return Response.json(matches);
  };
  return {db,binding,env,jobs,actors,rows,calls,fetcher,close:()=>db.close()};
}

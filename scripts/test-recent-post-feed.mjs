import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';
const source=await readFile(new URL('../src/lib/post-presentation.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {recentPostCutoff,recentPosts}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
test('two calendar months clamp month ends and preserve the exact UTC boundary',()=>{
  assert.equal(new Date(recentPostCutoff(new Date('2026-04-30T12:00:00Z'))).toISOString(),'2026-02-28T12:00:00.000Z');
  assert.equal(new Date(recentPostCutoff(new Date('2028-04-30T12:00:00Z'))).toISOString(),'2028-02-29T12:00:00.000Z');
  assert.equal(new Date(recentPostCutoff(new Date('2026-01-08T12:00:00Z'))).toISOString(),'2025-11-08T12:00:00.000Z');
  const rows=[{created_at:'2026-09-08T12:00:00Z'},{created_at:'2026-09-08T11:59:59Z'},{created_at:'invalid'}];
  assert.deepEqual(recentPosts(rows,new Date('2026-11-08T12:00:00Z')),[rows[0]]);
  assert.equal(rows.length,3);
});
test('recent feed filters before rank/limit, retains direct history, and obeys RLS',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create table questions(id uuid primary key default gen_random_uuid(), status text default 'open',post_kind text default 'question',experience_category text,search_document tsvector,tags text[] default '{}',visa_type text default '',answer_count integer default 0,vote_score integer default 0,created_at timestamptz,visible boolean default true);
      alter table questions enable row level security;
      create policy visible_posts on questions for select using(visible);
      grant select on questions to anon,authenticated;
      create view question_feed with(security_invoker=true) as select * from questions;
      grant select on question_feed to anon,authenticated;`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261108224738_recent_post_feed.sql',import.meta.url),'utf8'));
    await db.exec(`begin;
      insert into questions(created_at,vote_score) select now()-interval '3 months',1000 from generate_series(1,60);
      insert into questions(created_at,vote_score) values(now(),2),(((now() at time zone 'UTC')-interval '2 months') at time zone 'UTC',1);
      insert into questions(created_at,visible) values(now(),false);
      set local role anon;`);
    for(const sort of ['newest','score','activity','unanswered']){
      const {rows}=await db.query('select * from recent_community_post_page(sort_mode=>$1)',[sort]);
      assert.equal(rows.length,2,sort);
      assert(rows.every(row=>row.visible));
    }
    assert.equal((await db.query('select * from question_feed')).rows.length,62,'old posts remain readable');
    const rows=(await db.query('select * from recent_community_post_page()')).rows;
    assert.equal((await db.query('select * from recent_community_post_page(before_time=>$1,before_id=>$2,before_score=>0)',[rows[0].created_at,rows[0].id])).rows.length,1);
    await db.exec('rollback');
  }finally{await db.close();}
});

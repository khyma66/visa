import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const db = new PGlite({ extensions: { pg_trgm } });
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
let question, archived;
const scalar = async (query, args = []) => Object.values((await db.query(query, args)).rows[0])[0];
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    create schema realtime; create table realtime.messages(topic text, extension text, payload jsonb);
    alter table realtime.messages enable row level security;
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
    create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$
      insert into realtime.messages values(topic,'broadcast',payload); $$;
    grant usage on schema realtime to authenticated; grant select on realtime.messages to authenticated;
    create publication supabase_realtime;`);
  for (const name of [
    '20260904032053_community_core.sql', '20260907191603_secure_community_views.sql',
    '20260910031322_realtime_discovery_and_message_requests.sql', '20260910034701_production_access_hardening.sql',
    '20260910035131_imported_comment_discovery.sql', '20260910055528_launch_safety_and_moderation.sql',
    '20260911050812_community_write_guard_gaps.sql', '20261003175707_native_parent_visibility_hardening.sql',
    '20261003180924_answer_cursor_pagination.sql', '20261003181839_discussion_latest_reply_indexes.sql',
  ]) await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  await db.query('insert into auth.users values($1),($2)', [alice, bob]);
  question = await scalar(`insert into public.questions(author_id,title,body) values($1,'Answer pagination fixture question',
    'A public thread with more than one hundred answers for pagination testing.') returning id`, [alice]);
  archived = await scalar(`insert into public.questions(author_id,title,body,status) values($1,'Archived pagination fixture question',
    'An archived parent must not expose any of its answers through the new RPC.','archived') returning id`, [alice]);
  await db.query(`insert into public.answers(id,question_id,author_id,body,is_accepted,vote_score,created_at)
    select ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,$1,$2,
      'Native pagination answer number ' || n, n=7,n%7,'2026-10-01'::timestamptz
    from generate_series(1,125) n`, [question, bob]);
  await db.query(`insert into public.answers(question_id,author_id,body,status) values
    ($1,$3,'Removed native answer should not be returned.','archived'),
    ($2,$3,'Active answer on archived parent must be hidden.','active')`, [question, archived, bob]);
  await db.query(`insert into public.imported_answers(id,question_id,author_id,body,vote_score,created_at)
    select ('20000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'apify-fixture',$1,
      'Imported member reply number ' || n,n%5,'2026-10-01'::timestamptz
    from generate_series(1,137) n`, [bob]);
  await db.query(`insert into public.imported_answers(question_id,author_id,body,status)
    values('apify-fixture',$1,'Removed imported reply should not be returned.','archived')`, [bob]);
});
after(() => db.close());

async function asRole(role, fn) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [role === 'anon' ? '' : alice]);
    await db.exec(`set local role ${role}`);
    return await fn();
  } finally { await db.exec('rollback'); }
}
for (const role of ['anon', 'authenticated']) {
  for (const kind of ['native', 'imported']) {
    test(`${role} pages all ${kind} answers beyond 100 with stable accepted/score/ID ties`, () => asRole(role, async () => {
      const rpc = kind === 'native' ? 'answer_page' : 'imported_answer_page';
      const target = kind === 'native' ? question : 'apify-fixture';
      const expected = kind === 'native' ? 125 : 137;
      let cursor = null;
      const ids = [];
      for (let page = 0; page < 5; page++) {
        const rows = (await db.query(`select * from public.${rpc}($1,$2,$3,$4)`,
          [target, cursor?.is_accepted ?? null, cursor?.vote_score ?? null, cursor?.id ?? null])).rows;
        assert(rows.length <= 51);
        if (kind === 'native' && page === 0) assert.equal(rows[0].id, '10000000-0000-4000-8000-000000000007');
        const shown = rows.slice(0,50);
        ids.push(...shown.map((row) => row.id));
        if (rows.length <= 50) break;
        cursor = shown.at(-1);
      }
      assert.equal(ids.length, expected);
      assert.equal(new Set(ids).size, expected);
      const view = kind === 'native' ? 'answer_feed' : 'imported_answer_feed';
      const ordered = (await db.query(`select id from public.${view} where question_id=$1 order by is_accepted desc,vote_score desc,id desc`, [target])).rows;
      assert.deepEqual(ids, ordered.map((row) => row.id));
    }));
  }
  test(`${role} answer cursor cannot bypass archived parent visibility`, () => asRole(role, async () => {
    assert.equal((await db.query('select * from public.answer_page($1)', [archived])).rows.length, 0);
  }));
}
test('closed native threads retain readable answer pages', async () => {
  await db.exec('begin');
  try {
    await db.query("update public.questions set status='closed' where id=$1", [question]);
    await db.exec('set local role anon');
    assert.equal((await db.query('select * from public.answer_page($1)', [question])).rows.length, 51);
  } finally { await db.exec('rollback'); }
});

for (const role of ['anon', 'authenticated']) {
  test(`${role} latest context can include a low-ranked reply outside the first answer page`, async () => {
    await db.exec('begin');
    try {
      const newest = '10000000-0000-4000-8000-000000000119';
      await db.query("update public.answers set created_at='2026-10-03T12:00:00Z' where id=$1", [newest]);
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [role === 'anon' ? '' : alice]);
      await db.exec(`set local role ${role}`);
      assert(!(await db.query('select id from public.answer_page($1)', [question])).rows.some((row) => row.id === newest));
      const context = (await db.query('select id,body,created_at from public.answer_feed where question_id=$1 order by created_at desc,id desc limit 12', [question])).rows;
      assert.equal(context.length,12); assert.equal(context[0].id,newest);
      assert.equal((await db.query('select id,body,created_at from public.answer_feed where question_id=$1 order by created_at desc,id desc limit 12', [archived])).rows.length,0);
    } finally { await db.exec('rollback'); }
  });
}

const community = await readFile(new URL('../../src/lib/community.ts', import.meta.url), 'utf8');
const pagingSource = community.slice(community.indexOf('export const ANSWER_PAGE_SIZE'), community.indexOf('export async function createAnswer('));
const paging = await import(moduleUrl(transpile(`const isSupabaseConfigured=true;
  const getSupabase=()=>globalThis.__answerBackend;
  const importedFeedOrNull=async()=>globalThis.__answerArchive;
  function throwIfError(error) { if(error) throw new Error(error.message); }
  ${pagingSource}`)));
const row = (n, extra = {}) => ({ id: `30000000-0000-4000-8000-${String(n).padStart(12,'0')}`,
  question_id: 'apify-fixture', author_id: bob, author_username: 'bob-test', author_avatar_seed: 'bob',
  body: 'A sufficiently detailed answer fixture.', is_accepted: false, vote_score: 0, status: 'active',
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...extra });

test('client preserves archive comments while independently paging member replies', async () => {
  const members = Array.from({length:125}, (_,i) => row(125-i));
  const source = row(900, { id:'apify-comment-source', source:'apify', vote_score:999 });
  globalThis.__answerArchive = { answersByQuestionId: { 'apify-fixture': [source] } };
  const calls = [];
  globalThis.__answerBackend = { rpc: async (name,args) => {
    calls.push({name,args});
    return { data: members.filter((answer) => !args.before_id || answer.id < args.before_id).slice(0,51), error:null };
  }};
  try {
    let page = await paging.getAnswerPage('apify-fixture');
    assert.equal(page.answers.length,51);
    assert.equal(page.cursor.id,members[49].id);
    let answers = page.answers;
    while(page.more) {
      page = await paging.getAnswerPage('apify-fixture',page.cursor);
      answers = paging.sortAnswers([...answers,...page.answers]);
    }
    assert.equal(answers.length,126);
    assert.equal(answers.filter((answer) => answer.source === 'apify').length,1);
    assert(calls.every((call) => call.name === 'imported_answer_page' && !String(call.args.before_id).startsWith('apify-')));
    assert.equal(calls.length,3);
  } finally { delete globalThis.__answerArchive; delete globalThis.__answerBackend; }
});
test('native first-page RPC uses one lookahead and correct continuation cursor', async () => {
  const rows = Array.from({length:51}, (_,i) => row(51-i));
  globalThis.__answerBackend = { rpc: async (name,args) => {
    assert.equal(name,'answer_page'); assert.equal(args.target_question,question);
    return {data:rows,error:null};
  }};
  try {
    const page = await paging.getAnswerPage(question);
    assert.equal(page.answers.length,50); assert.equal(page.more,true);
    assert.equal(page.cursor.id,rows[49].id);
    assert(!page.answers.some((answer) => answer.id === rows[50].id));
  } finally { delete globalThis.__answerBackend; }
});
test('answer ordering uses accepted, score, stable ID and deduplicates refreshed rows', () => {
  const rows = paging.sortAnswers([row(1),row(3),row(2,{is_accepted:true}),row(1,{vote_score:9})]);
  assert.deepEqual(rows.map((answer) => answer.id), [row(2).id,row(1).id,row(3).id]);
});

test('latest discussion merges source and member replies to twelve rows without using ranked pages', async () => {
  const source = Array.from({length:15}, (_,i) => row(i+1, {id:`apify-comment-${String(i).padStart(3,'0')}`,
    body:`Source comment ${i}`,source:'apify',created_at:'2026-10-02T00:00:00Z'}));
  source.push(row(999,{id:'apify-comment-hidden',body:'Hidden source body',source:'apify',status:'archived',created_at:'2026-10-04T00:00:00Z'}));
  const replies = [row(100,{body:'Newest member reply',created_at:'2026-10-03T00:00:00Z'})];
  globalThis.__answerArchive={answersByQuestionId:{'apify-fixture':source}};
  const calls=[];
  globalThis.__answerBackend={from(table){
    calls.push(table);
    const chain={select(fields){assert.equal(fields,'id,body,created_at');return chain;},
      eq(key,value){assert.equal(key,'question_id');assert.equal(value,'apify-fixture');return chain;},
      order(key,options){calls.push([key,options]);return chain;},
      async limit(n){assert.equal(n,12);return {data:replies,error:null};}};
    return chain;
  }};
  try {
    const context=await paging.getDiscussionContext('apify-fixture');
    const lines=context.split('\n');
    assert.equal(lines.length,12);assert.equal(lines[0],'Newest member reply');
    assert.equal(lines[1],'Source comment 14');assert(!context.includes('Hidden source body'));
    assert.deepEqual(calls,['imported_answer_feed',['created_at',{ascending:false}],['id',{ascending:false}]]);
  } finally {delete globalThis.__answerArchive;delete globalThis.__answerBackend;}
});

test('native latest discussion requests only twelve public rows and propagates failures', async () => {
  globalThis.__answerBackend={from(table){
    assert.equal(table,'answer_feed');
    const chain={select(){return chain;},eq(){return chain;},order(){return chain;},
      async limit(n){assert.equal(n,12);return {data:null,error:{message:'Context unavailable'}};}};
    return chain;
  }};
  try {await assert.rejects(()=>paging.getDiscussionContext(question),/Context unavailable/);}
  finally {delete globalThis.__answerBackend;}
});

let detailSource = transpile(await readFile(new URL('../../src/components/QuestionDetail.tsx', import.meta.url),'utf8'));
const link = moduleUrl(`import React from ${JSON.stringify(import.meta.resolve('react'))}; export default function Link(props){return React.createElement('a',props,props.children);}`);
const dependencies = {
  'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'), react:import.meta.resolve('react'),
  'next/link':link, 'next/navigation':moduleUrl('export const useParams=()=>({id:globalThis.__answerUi.question.id});'),
  'lucide-react':import.meta.resolve('lucide-react'), 'date-fns':import.meta.resolve('date-fns'),
  '@/lib/community':moduleUrl('export const acceptAnswer=()=>{},createAnswer=()=>{},getAnswerPage=()=>{},getDiscussionContext=()=>{},getQuestion=()=>{},sortAnswers=x=>x,voteAnswer=()=>{},voteQuestion=()=>{};'),
  '@/lib/realtime':moduleUrl('export const subscribeLive=()=>()=>{};'),
  '@/lib/messaging-state':moduleUrl(transpile(await readFile(new URL('../../src/lib/messaging-state.ts', import.meta.url), 'utf8'))),
  './AuthProvider':moduleUrl('export const useAuth=()=>({user:globalThis.__answerUi.user,demoMode:false});'),
};
for (const name of ['RelatedQuestions','Avatar','ReportButton','SafetyNotice']) dependencies[`./${name}`] = moduleUrl(`export const ${name}=()=>null;`);
for (const [name,replacement] of Object.entries(dependencies)) {
  detailSource = detailSource.replaceAll(`from '${name}'`,`from ${JSON.stringify(replacement)}`).replaceAll(`from "${name}"`,`from ${JSON.stringify(replacement)}`);
}
const {QuestionDetail} = await import(moduleUrl(detailSource));
function renderQuestion(extra={}) {
  const q = {id:question,author_id:alice,author_username:'alice-test',author_avatar_seed:'alice',title:'UI answer pagination fixture',
    body:'A sufficiently long fixture body.',visa_type:'H-1B',destination_country:'United States',tags:['h1b'],status:'open',vote_score:0,
    answer_count:125,created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-01T00:00:00Z',...extra};
  globalThis.__answerUi = {question:q,user:{id:alice}};
  try { return renderToStaticMarkup(React.createElement(QuestionDetail,{initialQuestion:q,initialAnswers:[row(1,{question_id:q.id})]})); }
  finally {delete globalThis.__answerUi;}
}
test('closed-question UI removes answer form and acceptance controls', () => {
  const closed = renderQuestion({status:'closed'});
  assert(closed.includes('This question is closed.'));
  assert(!closed.includes('<form')); assert(!closed.includes('Accept this answer'));
  const open = renderQuestion();
  assert(open.includes('<form')); assert(open.includes('Accept this answer'));
});
test('answer UI exposes total count and load-more instead of silently truncating', () => {
  const html = renderQuestion();
  assert(html.includes('125 answers')); assert(html.includes('1 shown')); assert(html.includes('Load more answers'));
});
test('imported questions never show Message author or acceptance even without a source URL', () => {
  const html = renderQuestion({id:'apify-fixture',source:'apify',source_url:null,author_id:'source-not-an-account'});
  assert(!html.includes('Message author')); assert(!html.includes('Accept this answer'));
  assert(html.includes('Load more replies'));
});
test('public SSR uses the same bounded ranking and stable tie breaker', async () => {
  const source = await readFile(new URL('../../src/lib/public-server.ts',import.meta.url),'utf8');
  assert(source.includes("order:'is_accepted.desc,vote_score.desc,id.desc',limit:'50'"));
});

test('related UI refreshes latest discussion independently of pages and preserves draft context', async () => {
  const source=await readFile(new URL('../../src/components/QuestionDetail.tsx',import.meta.url),'utf8');
  assert(source.includes('Promise.all([getAnswerPage(id), getDiscussionContext(id)])'));
  assert(source.includes('draftText: answerBody, commentText: discussionContext'));
  assert(source.includes('subscribeLive([`question:${id}`], () => { void load(); }'));
});

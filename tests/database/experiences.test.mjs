import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
const db = new PGlite({ extensions: { pg_trgm } });
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    create schema realtime; create table realtime.messages(topic text, extension text, payload jsonb);
    alter table realtime.messages enable row level security;
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
    create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$insert into realtime.messages values(topic,'broadcast',payload)$$;
    grant usage on schema realtime to authenticated; grant select on realtime.messages to authenticated;
    create publication supabase_realtime;`);
  for (const name of ['20260904032053_community_core.sql','20260907191603_secure_community_views.sql',
    '20260910031322_realtime_discovery_and_message_requests.sql','20260910034701_production_access_hardening.sql',
    '20260910055528_launch_safety_and_moderation.sql','20260911050812_community_write_guard_gaps.sql',
    '20261004221850_policy_acceptance_receipts.sql','20261006044132_visa_experiences.sql'])
    await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8'));
  await db.query('insert into auth.users values($1),($2)',[alice,bob]);
  await db.query(`insert into public.questions(author_id,title,body,post_kind,experience_category,visa_type,created_at)
    select $1,'Interview experience number '||n,'My application interview and outcome with enough detail for a real post.',
      'experience',case when n%2=0 then 'Other' else 'Visa interview' end,'Other','2026-09-01'::timestamptz+n*interval '1 minute'
    from generate_series(1,130) n`,[alice]);
  await db.query(`insert into public.questions(author_id,title,body) values($1,'A regular visa question here','A sufficiently detailed regular question that must stay outside Experience.')`,[alice]);
});
after(() => db.close());
async function as(role, uid, fn) {
  await db.exec('begin');
  try {await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);await db.exec(`set local role ${role}`);return await fn();}
  finally {await db.exec('rollback');}
}
const publish=(author=alice,category='Other',kind='experience')=>db.query(`insert into public.questions(author_id,title,body,visa_type,post_kind,experience_category)
  values($1,'My actual visa experience','This is a detailed first-hand timeline and outcome of a visa application.','Other',$2,$3) returning id`,[author,kind,category]);
const consent=()=>db.query(`insert into public.policy_acceptances(user_id,policy_version,market,terms_accepted,privacy_acknowledged,adult_confirmed)
  values($1,'2026-10-04-preview-v1','US',true,true,true)`,[alice]);
for(const role of ['anon','authenticated']) {
  test(`${role}: category-filtered pages return all 65 experiences, newest first, without questions`,()=>as(role,role==='anon'?'':alice,async()=>{
    let cursor; const ids=[];
    for(let n=0;n<3;n++) {
      const rows=(await db.query(`select * from public.community_post_page('','','Other','newest',$1,$2,0,'experience','Other')`,[cursor?.created_at??null,cursor?.id??null])).rows;
      assert(rows.every(q=>q.post_kind==='experience' && q.experience_category==='Other'));
      ids.push(...rows.map(q=>q.id));cursor=rows.at(-1);if(rows.length<50)break;
    }
    assert.equal(ids.length,65);assert.equal(new Set(ids).size,65);
    const expected=(await db.query("select id from question_feed where experience_category='Other' order by created_at desc,id desc")).rows.map(q=>q.id);
    assert.deepEqual(ids,expected);
    assert.equal((await db.query('select * from community_question_page()')).rows.length,1);
  }));
}
test('publication requires login and current policy acknowledgement',async()=>{
  await assert.rejects(()=>as('anon','',()=>publish()));
  await assert.rejects(()=>as('authenticated',alice,()=>publish()),/acknowledge/);
});
test('signed-in publication persists selected category and Other visa type',()=>as('authenticated',alice,async()=>{
  await consent(); const id=(await publish()).rows[0].id;
  const q=(await db.query('select * from question_feed where id=$1',[id])).rows[0];
  assert.equal(q.experience_category,'Other');assert.equal(q.visa_type,'Other');assert.equal(q.post_kind,'experience');
  assert.equal(q.author_id,alice);
}));
test('cannot forge another author or publish a missing/unknown category',async()=>{
  for(const [author,category,kind] of [[bob,'Other','experience'],[alice,null,'experience'],[alice,'Unknown','experience'],[alice,'Other','question']])
    await assert.rejects(()=>as('authenticated',alice,async()=>{await consent();await publish(author,category,kind);}));
});
test('archived experiences stay hidden through the invoker view and paginated RPC',async()=>{
  await db.exec('begin');try{
    await db.exec("update questions set status='archived' where post_kind='experience'");
    await db.exec('set local role anon');
    assert.equal((await db.query("select * from community_post_page(filter_kind=>'experience')")).rows.length,0);
    assert.equal((await db.query("select * from question_feed where post_kind='experience'")).rows.length,0);
  }finally{await db.exec('rollback');}
});

import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const db = new PGlite({ extensions: { pg_trgm } });
const author = '11111111-1111-4111-8111-111111111111';
let newest, commentParent;
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    create schema realtime; create table realtime.messages(topic text,extension text,payload jsonb);
    alter table realtime.messages enable row level security;
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
    create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$insert into realtime.messages values(topic,'broadcast',payload)$$;
    grant usage on schema realtime to authenticated; grant select on realtime.messages to authenticated;
    create publication supabase_realtime;`);
  for (const name of ['20260904032053_community_core','20260907191603_secure_community_views',
    '20260910031322_realtime_discovery_and_message_requests','20260910034701_production_access_hardening',
    '20260910035131_imported_comment_discovery','20260910055528_launch_safety_and_moderation',
    '20260911050812_community_write_guard_gaps','20261003175707_native_parent_visibility_hardening',
    '20261003181308_deterministic_discovery_candidates']) {
    await db.exec(await readFile(new URL(`../../supabase/migrations/${name}.sql`,import.meta.url),'utf8'));
  }
  await db.query('insert into auth.users values($1)',[author]);
  await db.query(`insert into public.questions(author_id,title,body,tags,created_at)
    select $1,'Old RFE question number '||n,'An older fixture asking about a request for evidence.',array['rfe'],'2026-01-01'::timestamptz
    from generate_series(1,205) n`,[author]);
  newest=(await db.query(`insert into public.questions(author_id,title,body,tags,created_at)
    values($1,'Latest RFE question fixture','The newest request for evidence question on this topic.',array['rfe'],'2026-10-03') returning id`,[author])).rows[0].id;
  commentParent=(await db.query(`insert into public.questions(author_id,title,body,tags,created_at)
    values($1,'A question about application timelines','This topic originally only discussed application timelines.',array['timeline'],'2026-10-03') returning id`,[author])).rows[0].id;
  await db.query(`insert into public.answers(question_id,author_id,body,created_at)
    select id,$1,'An older fixture response about biometrics appointments.','2026-01-01' from public.questions where id<>$2`,[author,commentParent]);
  await db.query(`insert into public.answers(question_id,author_id,body,created_at)
    values($1,$2,'A new reply mentioning biometrics appointments for retrieval.','2026-10-03')`,[commentParent,author]);
  await db.query(`insert into public.imported_answers(question_id,author_id,body,created_at)
    select 'apify-old-fixture-'||n,$1,'Old source reply about biometrics appointments.','2026-01-01'::timestamptz from generate_series(1,205) n`,[author]);
  await db.query(`insert into public.imported_answers(question_id,author_id,body,created_at)
    values('apify-new-fixture',$1,'New source reply about biometrics appointments.','2026-10-03')`,[author]);
  await db.exec('set role anon');
});
after(()=>db.close());

test('new questions remain discoverable after a topic exceeds the bounded candidate pool',async()=>{
  const args=[null,['rfe'],[],'','',12];
  const first=(await db.query('select * from public.discover_questions($1,$2,$3,$4,$5,$6)',args)).rows;
  assert.equal(first.length,12);
  assert.equal(first[0].id,newest);
  assert.deepEqual((await db.query('select * from public.discover_questions($1,$2,$3,$4,$5,$6)',args)).rows,first);
  const excluded=(await db.query('select * from public.discover_questions($1,$2,$3,$4,$5,$6)',[newest,...args.slice(1)])).rows;
  assert(!excluded.some(row=>row.id===newest));
});
test('a new comment can surface its parent after more than 200 older matching comments',async()=>{
  const rows=(await db.query("select * from public.discover_questions(null,array['biometrics'],array['biometrics'],'','',12)")).rows;
  assert(rows.some(row=>row.id===commentParent && row.matched_tags.includes('biometrics')));
});
test('new imported-reply hints are bounded, deterministic and do not contain comment bodies',async()=>{
  const result=(await db.query("select public.discover_community(null,array['biometrics'],array['biometrics']) as result")).rows[0].result;
  assert.deepEqual(result.imported_topics['apify-new-fixture'],['biometrics']);
  assert.equal(Object.keys(result.imported_topics).length,200);
  assert(!JSON.stringify(result).includes('New source reply'));
});

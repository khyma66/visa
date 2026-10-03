import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const url = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const transpile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const tagsUrl = url(transpile(await readFile(new URL('../src/lib/tagging.ts', import.meta.url), 'utf8')));
const discoveryCode = transpile(await readFile(new URL('../src/lib/discovery.ts', import.meta.url), 'utf8')).replace("'./tagging'", JSON.stringify(tagsUrl));
const { createDiscoveryIndex } = await import(url(discoveryCode));
const q = (id, tags, body = '') => ({ id, title: `Discussion about ${tags.join(' ')}`, body,
  tags, visa_type: 'H-1B', destination_country: 'United States', status: 'open', vote_score: 0,
  answer_count: 0, created_at: '2026-09-01T00:00:00Z' });

test('live subscription pooling keeps other consumers connected and cleans up', async () => {
  const created = [];
  const removed = [];
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  globalThis.__testSupabase = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'alice' }, access_token: 'fixture' } } }) },
    realtime: { setAuth: async () => {} },
    channel(topic) {
      const c = { topic, on(_type,_filter,listener) { this.listener = listener; return this; },
        subscribe(callback) { this.status = callback; return this; } };
      created.push(c); return c;
    },
    removeChannel: async (c) => { removed.push(c); },
  };
  try {
    const stub = url('export const isSupabaseConfigured = true; export const getSupabase = () => globalThis.__testSupabase;');
    const source = transpile(await readFile(new URL('../src/lib/realtime.ts',import.meta.url),'utf8')).replace("'./supabase/client'",JSON.stringify(stub));
    const { subscribeLive } = await import(url(source));
    let first = 0, second = 0;
    const stop1 = subscribeLive(['discovery:rfe'], () => first++);
    const stop2 = subscribeLive(['discovery:rfe'], () => second++);
    await new Promise((r) => setTimeout(r,0));
    assert.equal(created.length,1);
    created[0].status('SUBSCRIBED');
    await new Promise((r) => setTimeout(r,120));
    assert.equal(first,1); assert.equal(second,1);
    stop1(); assert.equal(removed.length,0);
    created[0].listener();
    await new Promise((r) => setTimeout(r,120));
    assert.equal(first,1); assert.equal(second,2);
    stop2(); assert.equal(removed.length,1);
    const cancelled = subscribeLive(['discovery:h1b'], () => {});
    cancelled();
    await new Promise((r) => setTimeout(r,0));
    assert.equal(created.length,1);
  } finally {
    delete globalThis.__testSupabase; delete globalThis.window; delete globalThis.document;
  }
});

test('discovery responds to draft topics, archived comments and new posts', () => {
  const rows = [q('transfer', ['h1b','transfer']), q('rfe', ['rfe']), q('schengen', ['schengen']),
    { ...q('promo', ['rfe']), post_kind: 'promotion' }, { ...q('hidden', ['rfe']), status: 'archived' }];
  const index = createDiscoveryIndex(rows);
  const base = { id: 'current', title: 'H1B transfer', tags: ['h1b', 'transfer'] };
  assert.equal(index.search(base)[0].id, 'transfer');
  assert.equal(index.search({ ...base, commentText: 'Request for evidence RFE response' })[0].id, 'rfe');
  assert(!index.search({ ...base, commentText: 'RFE response' }).some((r) => ['promo','hidden'].includes(r.id)));
  assert(!index.search({ id: 'transfer', tags: ['h-1b'] }).some((r) => r.id === 'transfer'));
  assert.equal(createDiscoveryIndex([q('past', ['timeline'])], { past: 'Received an RFE last week' }).search({ commentText: 'request for evidence' })[0].id, 'past');
  assert.equal(createDiscoveryIndex([...rows,q('just-posted',['biometrics'])]).search({ title: 'Biometrics appointment' })[0].id, 'just-posted');
  assert.deepEqual(index.search({ title: 'Thank you please help' }), []);
  assert.equal(createDiscoveryIndex([q('imported', ['timeline'])]).search({ commentText: 'RFE response' },5,{imported:['rfe']})[0].id,'imported');
});

test('database migration: request lifecycle, private reads, idempotent sends, comment search and broadcast authorization', async () => {
  const db = new PGlite({ extensions: { pg_trgm } });
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  const eve = '33333333-3333-4333-8333-333333333333';
  const msg = '44444444-4444-4444-8444-444444444444';
  const msg2 = '55555555-5555-4555-8555-555555555555';
  try {
    // Platform-owned schemas are stand-ins for tests; WebSocket delivery needs hosted integration testing.
    await db.exec(`create role anon; create role authenticated; create role service_role;
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
    for (const name of ['20260904032053_community_core.sql', '20260907191603_secure_community_views.sql', '20260910031322_realtime_discovery_and_message_requests.sql', '20260910034701_production_access_hardening.sql', '20260910035131_imported_comment_discovery.sql']) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url),'utf8'));
    }
    await db.query('insert into auth.users values($1),($2),($3)', [alice,bob,eve]);
    await db.query("update public.profiles set username = case id when $1 then 'alice-test' when $2 then 'bob-test' else 'eve-test' end",[alice,bob]);
    async function asUser(id) {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
      await db.exec('set role authenticated');
    }
    const scalar = async (query, args = []) => Object.values((await db.query(query,args)).rows[0])[0];
    await asUser(alice);
    const conversation = await scalar("select public.start_direct_conversation('bob-test')");
    assert.equal(await scalar("select public.start_direct_conversation('bob-test')"),conversation);
    assert.equal(await scalar('select request_status from public.conversation_inbox'),'pending');
    await assert.rejects(() => db.query("select public.respond_to_conversation($1,'accepted')",[conversation]), /recipient/);
    await db.query('select public.send_direct_message($1,$2,$3)',[conversation,'Hello Bob',msg]);
    await db.query('select public.send_direct_message($1,$2,$3)',[conversation,'Hello Bob',msg]);
    assert.equal(await scalar('select count(*)::integer from public.direct_messages'),1);
    await assert.rejects(() => db.query('select public.send_direct_message($1,$2,$3)',[conversation,'Second message',msg2]),/accepted/);
    await assert.rejects(() => db.query('insert into public.direct_messages(conversation_id,sender_id,body) values($1,$2,$3)',[conversation,alice,'Bypass']), /permission/);
    await asUser(eve);
    assert.equal(await scalar('select count(*)::integer from public.conversation_inbox'),0);
    assert.equal(await scalar('select count(*)::integer from public.message_page($1)',[conversation]),0);
    await assert.rejects(() => db.query('select public.send_direct_message($1,$2,$3)',[conversation,'Intruder',msg2]),/unavailable/);
    await db.query("select set_config('realtime.topic',$1,false)",[`conversation:${conversation}`]);
    assert.equal(await scalar('select count(*)::integer from realtime.messages'),0);
    await asUser(bob);
    assert.equal(await scalar('select count(*)::integer from public.message_page($1)',[conversation]),1);
    assert((await scalar('select count(*)::integer from realtime.messages')) > 0);
    await db.query("select public.respond_to_conversation($1,'accepted')",[conversation]);
    await db.query('select public.send_direct_message($1,$2,$3)',[conversation,'Hello Alice',msg2]);
    await db.query('update public.direct_messages set read_at = now() where id = $1',[msg]);
    await db.query("select public.respond_to_conversation($1,'blocked')",[conversation]);
    await asUser(alice);
    await assert.rejects(() => db.query('select public.send_direct_message($1,$2,gen_random_uuid())',[conversation,'After block']),/closed/);
    await assert.rejects(() => db.query("select public.respond_to_conversation($1,'accepted')",[conversation]),/closed/);

    const question = await scalar(`insert into public.questions(author_id,title,body,tags)
      values($1,'How does the processing timeline work?','I am looking for experiences with processing timelines.',array['timeline']) returning id`,[alice]);
    await asUser(bob);
    const answer = await scalar(`insert into public.answers(question_id,author_id,body)
      values($1,$2,'My case received an RFE request for evidence last week.') returning id`,[question,bob]);
    assert((await scalar('select topic_tags from public.answers where id = $1',[answer])).includes('rfe'));
    await assert.rejects(() => db.query('select public.accept_answer($1)',[answer]),/author/);
    await asUser(alice);
    await db.query('select public.accept_answer($1)',[answer]);
    assert.equal(await scalar('select is_accepted from public.answers where id=$1',[answer]),true);
    await asUser(bob);
    const discover = await db.query("select * from public.discover_questions(null,array['rfe'],array['rfe'],'','H-1B',5)");
    assert.equal(discover.rows[0].id,question);
    assert(discover.rows[0].matched_tags.includes('rfe'));
    await db.query('insert into public.imported_answers(question_id,author_id,body) values($1,$2,$3)',['apify-12345',bob,'Another RFE comment from a real VisaFlow user.']);
    assert.equal(await scalar("select count(*)::integer from public.imported_answer_feed where question_id='apify-12345'"),1);
    const combined = await scalar("select public.discover_community(null,array['rfe'],array['rfe'])");
    assert(combined.native.some((q) => q.id === question));
    assert(combined.imported_topics['apify-12345'].includes('rfe'));
    await db.exec('reset role');
    await db.query("update public.answers set status='archived' where id=$1",[answer]);
    await asUser(alice);
    assert.equal((await db.query("select * from public.discover_questions(null,array['rfe'],array['rfe'],'','H-1B',5)")).rows.length,0);
    assert.deepEqual(await scalar('select tags from public.questions where id=$1',[question]),['timeline']);
    await db.exec('reset role');
    await db.query(`insert into public.questions(author_id,title,body,tags,created_at)
      select $1, 'Pagination fixture question ' || n, 'Fixture body for verifying pagination with tied timestamps.',array['pagination'], '2026-01-01'::timestamptz
      from generate_series(1,60) n`,[alice]);
    await asUser(eve);
    const first = (await db.query("select * from public.community_question_page('','pagination')")).rows;
    assert.equal(first.length,50);
    const last = first.at(-1);
    const second = (await db.query("select * from public.community_question_page('','pagination','','newest',$1,$2,0)",[last.created_at,last.id])).rows;
    assert.equal(second.length,10);
    assert.equal(new Set([...first,...second].map((r) => r.id)).size,60);
    await db.exec('reset role');
    await db.exec(await readFile(new URL('../supabase/migrations/20260910055528_launch_safety_and_moderation.sql', import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20260911050812_community_write_guard_gaps.sql', import.meta.url),'utf8'));
    await db.query("update public.answers set status='active' where id=$1",[answer]);
    await asUser(alice);
    await db.query('select public.accept_answer($1)',[answer]);
    await db.query("update public.profiles set bio='Safe bio fixture' where id=$1",[alice]);
    await db.exec('reset role');
    await db.query("update public.questions set status='closed' where id=$1",[question]);
    await asUser(alice);
    await assert.rejects(() => db.query('select public.accept_answer($1)',[answer]), /open question/);
    await db.exec('reset role');
    await db.query("update public.questions set status='open' where id=$1",[question]);
    await db.query('insert into private.community_moderators values($1)',[eve]);
    await asUser(eve);
    await assert.rejects(() => db.query("select public.report_community_content('message',$1,'harassment')",[msg]), /unavailable/);
    await asUser(bob);
    const report = await scalar("select public.report_community_content('question',$1,'spam','Fixture report')",[question]);
    assert.equal(await scalar("select public.report_community_content('question',$1,'spam')",[question]),report);
    assert.equal(await scalar('select count(*)::integer from public.community_reports'),1);
    await assert.rejects(() => db.query('select public.community_moderation_queue()'), /Moderator/);
    await assert.rejects(() => db.query('insert into private.community_moderators values($1)',[bob]), /permission/);
    await assert.rejects(() => db.query("update public.community_reports set status='removed' where id=$1",[report]), /permission/);
    await asUser(alice);
    assert.equal(await scalar('select count(*)::integer from public.community_reports'),0);
    for (let i=0;i<5;i++) await db.query(`insert into public.questions(author_id,title,body) values($1,'Posting limit fixture question','A sufficiently long question body for posting limit verification.')`,[alice]);
    await assert.rejects(() => db.query(`insert into public.questions(author_id,title,body) values($1,'Posting limit fixture question','A sufficiently long question body for posting limit verification.')`,[alice]), /Too many requests/);
    await asUser(eve);
    assert.equal((await scalar('select public.community_moderation_queue()')).length,1);
    await db.query("select public.moderate_community_report($1,'removed',true)",[report]);
    await asUser(alice);
    assert.equal(await scalar('select count(*)::integer from public.question_feed where id=$1',[question]),0);
    await assert.rejects(() => db.query("update public.questions set status='open' where id=$1",[question]), /permission/);
    await assert.rejects(() => db.query("insert into public.imported_answers(author_id,question_id,body) values($1,'apify-12345','Attempted reply after suspension of this test account.')",[alice]), /suspended/);
    await assert.rejects(() => db.query("select public.start_direct_conversation('eve-test')"), /suspended/);
    await assert.rejects(() => db.query('select public.accept_answer($1)',[answer]), /suspended/);
    await assert.rejects(() => db.query("update public.profiles set bio='Suspended bio write' where id=$1",[alice]), /suspended/);
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    const suspendedChat = await scalar("insert into public.direct_conversations(user_one_id,user_two_id,request_status,requested_by) values($1,$2,'accepted',$1) returning id",[alice,eve]);
    await asUser(alice);
    await assert.rejects(() => db.query('select public.send_direct_message($1,$2,gen_random_uuid())',[suspendedChat,'After suspension']), /suspended/);
    await db.exec('reset role');
    await db.exec('set role anon');
    await assert.rejects(() => db.query('select public.community_moderation_queue()'), /permission/);
    await db.exec('reset role');
    const broadcasts = (await db.query('select * from realtime.messages')).rows;
    assert(broadcasts.some((r) => r.topic === `question:${question}`));
    assert(broadcasts.some((r) => r.topic === 'discovery:rfe'));
    assert(broadcasts.every((r) => Object.keys(r.payload).join(',') === 'id'));
    console.log('Verified actual PostgreSQL migrations and RLS with three distinct identities.');
  } finally { await db.close(); }
});

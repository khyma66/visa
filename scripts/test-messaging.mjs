import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const stateUrl = moduleUrl(transpile(await readFile(new URL('../src/lib/messaging-state.ts', import.meta.url), 'utf8')));
const { displayedUnreadIds, hasMessageOverlap, sortMessages } = await import(stateUrl);
const message = (n, extra = {}) => ({ id: `message-${String(n).padStart(4, '0')}`, conversation_id: 'conversation-a', sender_id: 'alice', body: `Message ${n}`, created_at: `2026-10-01T12:00:00.000Z`, read_at: null, ...extra });
let backend;
globalThis.__visaMessagingTestBackend = () => backend;
let communitySource = transpile(await readFile(new URL('../src/lib/community.ts', import.meta.url), 'utf8'));
const dependencies = {
  './post-presentation': moduleUrl(transpile(await readFile(new URL('../src/lib/post-presentation.ts', import.meta.url), 'utf8'))),
  './demo-data': moduleUrl('export const DEMO_ANSWERS=[], DEMO_CONVERSATIONS=[], DEMO_MESSAGES=[], DEMO_QUESTIONS=[], DEMO_USER={};'),
  './supabase/client': moduleUrl('export const isSupabaseConfigured=true; export const getSupabase=()=>globalThis.__visaMessagingTestBackend();'),
  './tagging': moduleUrl('export const inferTags=()=>[], normalizeTags=()=>[];'),
  './discovery': moduleUrl('export const contextTags=()=>[], createDiscoveryIndex=()=>({}), searchTerms=()=>[];'),
  './messaging-state': stateUrl,
};
for (const [name, replacement] of Object.entries(dependencies)) communitySource = communitySource.replace(`'${name}'`, JSON.stringify(replacement));
const { refreshMessages, refreshConversations, markConversationRead } = await import(moduleUrl(communitySource));

test('message ordering, deduplication and displayed unread receipt selection', () => {
  assert.deepEqual(sortMessages([message(2), message(1), message(2, { body: 'Updated' })]).map((row) => row.body), ['Message 1', 'Updated']);
  assert.equal(hasMessageOverlap([message(1)], [message(2)]), false);
  assert.equal(hasMessageOverlap([message(1)], [message(1), message(2)]), true);
  assert.deepEqual(displayedUnreadIds([message(1), message(1), message(2, { sender_id: 'bob' }), message(3, { read_at: '2026-10-01' })], 'bob'), ['message-0001']);
});

test('offline bursts reset disconnected windows, making all intervening messages pageable', async () => {
  const previous = Array.from({ length: 50 }, (_, i) => message(i + 1));
  const latest = Array.from({ length: 50 }, (_, i) => message(i + 201));
  backend = {
    rpc: async (name) => { assert.equal(name, 'message_page'); return { data: [...latest].reverse(), error: null }; },
    from: () => { throw new Error('Disconnected windows must not be merged'); },
  };
  const result = await refreshMessages('conversation-a', previous);
  assert.equal(result.reset, true);
  assert.equal(result.hasOlder, true);
  assert.deepEqual(result.messages, latest);
});

test('live refresh preserves contiguous history and re-reads redacted older messages', async () => {
  const previous = Array.from({ length: 75 }, (_, i) => message(i + 1));
  const latest = Array.from({ length: 50 }, (_, i) => message(i + 51));
  const stored = previous.map((row) => row.id === message(3).id ? { ...row, body: '[Removed by a moderator]' } : row);
  backend = {
    rpc: async () => ({ data: [...latest].reverse(), error: null }),
    from: (table) => {
      assert.equal(table, 'direct_messages');
      return { select: () => ({ eq: (key, value) => {
        assert.equal(key, 'conversation_id'); assert.equal(value, 'conversation-a');
        return { in: async (_key, ids) => ({ data: stored.filter((row) => ids.includes(row.id)), error: null }) };
      } }) };
    },
  };
  const result = await refreshMessages('conversation-a', previous);
  assert.equal(result.reset, false);
  assert.equal(result.messages.length, 100);
  assert.equal(result.messages[2].body, '[Removed by a moderator]');
});

test('read receipt writes are scoped to displayed conversation IDs and bounded batches', async () => {
  const calls = [];
  backend = { rpc: async (name, args) => { calls.push([name, args]); return { error: null }; } };
  const rows = Array.from({ length: 60 }, (_, i) => message(i + 1));
  await markConversationRead('conversation-a', 'bob', [...rows, message(90, { conversation_id: 'other' }), message(91, { sender_id: 'bob' })]);
  assert.equal(calls.length, 2);
  assert(calls.every(([name, args]) => name === 'mark_direct_messages_read' && args.target_conversation === 'conversation-a' && args.message_ids.length <= 50));
  assert.deepEqual(calls.flatMap(([, args]) => args.message_ids), rows.map((row) => row.id));
});

test('inbox refresh resets disconnected pages instead of leaving an inaccessible middle gap', async () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: `new-${i}`, last_message_at: '2026-10-02' }));
  backend = { rpc: async () => ({ data: rows, error: null }), from: () => { throw new Error('Do not join separated inbox pages'); } };
  const result = await refreshConversations([{ id: 'old-1', last_message_at: '2026-10-01' }]);
  assert.equal(result.reset, true); assert.equal(result.hasOlder, true); assert.deepEqual(result.conversations, rows);
});

test('inbox activity overlap cannot prove cursor continuity when old conversations move forward', async () => {
  const previous = Array.from({ length: 100 }, (_, i) => ({ id: `old-${i}`, last_message_at: '2026-10-01' }));
  const latest = [{ id: 'old-99', last_message_at: '2026-10-03' }, ...Array.from({ length: 49 }, (_, i) => ({ id: `new-${i}`, last_message_at: '2026-10-02' }))];
  backend = { rpc: async () => ({ data: latest, error: null }), from: () => { throw new Error('Never merge activity-ordered windows'); } };
  const result = await refreshConversations(previous);
  assert.equal(result.reset, true);
  assert.equal(result.hasOlder, true);
  assert.deepEqual(result.conversations, latest);
  assert.equal(result.conversations.at(-1).id, 'new-48', 'The next cursor must allow recovery of the missing middle');
});

test('Postgres enforces private inbox cursors, scoped read receipts, redaction invalidation and retry safety', async () => {
  const db = new PGlite({ extensions: { pg_trgm } });
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  const eve = '33333333-3333-4333-8333-333333333333';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
      create schema realtime; create table realtime.messages(topic text, extension text, payload jsonb);
      alter table realtime.messages enable row level security;
      create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
      create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$insert into realtime.messages values(topic,'broadcast',payload)$$;
      grant usage on schema realtime to authenticated; grant select on realtime.messages to authenticated;
      create publication supabase_realtime;`);
    for (const name of ['20260904032053_community_core.sql', '20260907191603_secure_community_views.sql', '20260910031322_realtime_discovery_and_message_requests.sql', '20260910034701_production_access_hardening.sql', '20260910035131_imported_comment_discovery.sql', '20260910055528_launch_safety_and_moderation.sql', '20260911050812_community_write_guard_gaps.sql', '20261003175714_messaging_delivery_reliability.sql']) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    }
    const scalar = async (query, args = []) => Object.values((await db.query(query, args)).rows[0])[0];
    const asUser = async (id) => {
      await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
      if (id) await db.exec('set role authenticated');
    };
    await db.query('insert into auth.users values($1),($2),($3)', [alice, bob, eve]);
    await db.query("update public.profiles set username=case id when $1 then 'alice-test' when $2 then 'bob-test' else 'eve-test' end", [alice, bob]);
    await asUser(alice);
    const conversation = await scalar("select public.start_direct_conversation('bob-test')");
    const firstId = randomUUID();
    await db.query('select public.send_direct_message($1,$2,$3)', [conversation, 'First message', firstId]);
    await assert.rejects(() => db.query('select public.send_direct_message($1,$2,$3)', [conversation, 'Different payload', firstId]), /identifier already used/);
    await asUser(bob);
    await db.query("select public.respond_to_conversation($1,'accepted')", [conversation]);
    await asUser('');
    const messageIds = Array.from({ length: 60 }, () => randomUUID());
    for (const id of messageIds) await db.query("insert into public.direct_messages(id,conversation_id,sender_id,body,created_at) values($1,$2,$3,'Pagination fixture','2026-10-01')", [id, conversation, alice]);
    const outsiders = Array.from({ length: 60 }, () => randomUUID());
    for (const id of outsiders) {
      await db.query('insert into auth.users values($1)', [id]);
      await db.query("insert into public.direct_conversations(user_one_id,user_two_id,last_message_at) values(least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid),'2026-10-01')", [alice, id]);
    }
    await asUser(alice);
    const first = (await db.query('select * from public.conversation_page()')).rows;
    const last = first.at(-1);
    const second = (await db.query('select * from public.conversation_page($1,$2)', [last.last_message_at, last.id])).rows;
    assert.equal(first.length, 50); assert.equal(second.length, 11);
    assert.equal(new Set([...first, ...second].map((row) => row.id)).size, 61);
    await asUser(eve);
    assert.equal(await scalar('select count(*)::integer from public.conversation_page()'), 0);
    await db.query('select public.mark_direct_messages_read($1,$2)', [conversation, messageIds]);
    await assert.rejects(() => db.query('select public.send_direct_message($1,$2,$3)', [conversation, 'Outsider', randomUUID()]), /unavailable/);
    await asUser(bob);
    assert.equal(await scalar('select count(*)::integer from public.direct_messages where read_at is not null'), 0);
    await db.query('select public.mark_direct_messages_read($1,$2)', [conversation, messageIds]);
    assert.equal(await scalar('select count(*)::integer from public.direct_messages where read_at is not null'), 50);
    const page1 = (await db.query('select * from public.message_page($1)', [conversation])).rows;
    const cursor = page1.at(-1);
    const page2 = (await db.query('select * from public.message_page($1,$2,$3)', [conversation, cursor.created_at, cursor.id])).rows;
    assert.equal(new Set([...page1, ...page2].map((row) => row.id)).size, 61);
    await asUser('');
    await db.query('insert into private.community_moderators values($1)', [eve]);
    await asUser(bob);
    const report = await scalar("select public.report_community_content('message',$1,'harassment')", [firstId]);
    await asUser('');
    const before = await scalar('select count(*)::integer from realtime.messages');
    await asUser(eve);
    assert.equal((await scalar('select public.community_moderation_queue()'))[0].content, 'First message');
    await db.query("select public.moderate_community_report($1,'removed',false)", [report]);
    await asUser('');
    assert.equal(await scalar('select count(*)::integer from realtime.messages'), before + 3);
    const newEvents = (await db.query('select topic,payload from realtime.messages offset $1', [before])).rows;
    assert.deepEqual(new Set(newEvents.map((row) => row.topic)), new Set([`conversation:${conversation}`, `inbox:${alice}`, `inbox:${bob}`]));
    assert(newEvents.every((row) => Object.keys(row.payload).join(',') === 'id'));
    await asUser(bob);
    assert.equal(await scalar('select body from public.direct_messages where id=$1', [firstId]), '[Removed by a moderator]');
    await db.query("select public.respond_to_conversation($1,'blocked')", [conversation]);
    await asUser(alice);
    await assert.rejects(() => db.query('select public.send_direct_message($1,$2,$3)', [conversation, 'Blocked', randomUUID()]), /closed/);
    await asUser(''); await db.exec('set role anon');
    await assert.rejects(() => db.query('select * from public.conversation_page()'), /permission/);
    await assert.rejects(() => db.query('select public.mark_direct_messages_read($1,$2)', [conversation, messageIds]), /permission/);
  } finally { await db.close(); }
});

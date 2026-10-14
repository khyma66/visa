// Disposable PostgreSQL identities only: no hosted signups or production writes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

test('ten isolated users exchange private messages using post topics', { timeout: 60000 }, async (t) => {
  const db = new PGlite({ extensions: { pg_trgm } });
  // Topics inspected on the public preview; no source author or body is copied.
  const references = JSON.parse(await readFile(new URL('./fixtures/messaging-post-topics.json', import.meta.url), 'utf8'));
  assert.equal(references.length, 3);
  assert.equal(new Set(references.map((reference) => reference.id)).size, 3);
  const users = Array.from({ length: 10 }, () => ({ id: randomUUID() }));
  const conversations = [];
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  async function asUser(id) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec('set role authenticated');
  }
  try {
    // Supabase-owned auth/realtime interfaces are emulated; application tables,
    // triggers, functions, grants and RLS come from the actual migrations.
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
    for (const name of [
      '20260904032053_community_core.sql',
      '20260907191603_secure_community_views.sql',
      '20260910031322_realtime_discovery_and_message_requests.sql',
      '20260910034701_production_access_hardening.sql',
      '20260910035131_imported_comment_discovery.sql',
      '20260910055528_launch_safety_and_moderation.sql',
      '20260911050812_community_write_guard_gaps.sql',
    ]) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));

    await t.test('signup trigger generates ten distinct valid usernames', async () => {
      for (const user of users) {
        await db.query('insert into auth.users values($1)', [user.id]);
        user.username = await scalar('select username from public.profiles where id=$1', [user.id]);
        assert.match(user.username, /^[a-z][a-z0-9-]{4,31}$/);
      }
      assert.equal(new Set(users.map((u) => u.username)).size, 10);
    });

    for (let i = 0; i < users.length; i++) {
      await t.test(`identity ${i + 1} creates a post and messages identity ${(i + 1) % 10 + 1}`, async () => {
        const sender = users[i], recipient = users[(i + 1) % 10];
        const reference = references[i % references.length];
        await asUser(recipient.id);
        const question = await scalar(`insert into public.questions(author_id,title,body,tags)
          values($1,$2,$3,$4) returning id`, [recipient.id, `Test discussion ${i + 1}: ${reference.tags.join(', ')}`,
          'This disposable test question uses an existing post topic as a discussion reference.', reference.tags]);
        await asUser(sender.id);
        const author = await scalar('select author_username from public.question_feed where id=$1', [question]);
        assert.equal(author, recipient.username);
        const conversation = await scalar('select public.start_direct_conversation($1)', [author]);
        assert.equal(await scalar('select public.start_direct_conversation($1)', [author]), conversation);
        assert.equal(await scalar('select request_status from public.conversation_inbox where id=$1', [conversation]), 'pending');
        await assert.rejects(() => db.query("select public.respond_to_conversation($1,'accepted')", [conversation]), /recipient/);
        const message = randomUUID();
        const body = `Synthetic test message referencing ${reference.id}: ${reference.tags.join(', ')}`;
        await db.query('select public.send_direct_message($1,$2,$3)', [conversation, body, message]);
        await db.query('select public.send_direct_message($1,$2,$3)', [conversation, body, message]);
        await assert.rejects(() => db.query('select public.send_direct_message($1,$2,$3)', [conversation, 'Second pending message', randomUUID()]), /accepted/);
        await asUser(recipient.id);
        assert.equal(await scalar('select count(*)::integer from public.message_page($1)', [conversation]), 1);
        await assert.rejects(() => db.query('select public.send_direct_message($1,$2,$3)', [conversation, 'Reply before acceptance', randomUUID()]), /accepted/);
        await db.query("select public.respond_to_conversation($1,'accepted')", [conversation]);
        await db.query('select public.send_direct_message($1,$2,$3)', [conversation, 'Accepted. Let us compare the experiences in that discussion.', randomUUID()]);
        await db.query('update public.direct_messages set read_at=now() where id=$1', [message]);
        await asUser(sender.id);
        assert(await scalar('select read_at from public.direct_messages where id=$1', [message]));
        await db.query('select public.send_direct_message($1,$2,$3)', [conversation, 'Thanks for responding to the test conversation.', randomUUID()]);
        assert.equal(await scalar('select count(*)::integer from public.message_page($1)', [conversation]), 3);
        conversations.push({ id: conversation, sender: sender.id, recipient: recipient.id });
      });
    }

    await t.test('all eighty outsider/conversation combinations deny reads, writes and private broadcasts', async () => {
      let combinations = 0;
      for (const user of users) {
        await asUser(user.id);
        assert.equal(await scalar('select count(*)::integer from public.conversation_inbox'), 2);
        assert.equal(await scalar('select count(*)::integer from public.direct_messages'), 6);
        for (const conversation of conversations) {
          if ([conversation.sender, conversation.recipient].includes(user.id)) continue;
          combinations++;
          assert.equal(await scalar('select count(*)::integer from public.message_page($1)', [conversation.id]), 0);
          await assert.rejects(() => db.query('select public.send_direct_message($1,$2,$3)', [conversation.id, 'Unauthorized intrusion', randomUUID()]), /unavailable/);
          await assert.rejects(() => db.query("select public.respond_to_conversation($1,'blocked')", [conversation.id]), /unavailable/);
          await db.query("select set_config('realtime.topic',$1,false)", [`conversation:${conversation.id}`]);
          assert.equal(await scalar('select count(*)::integer from realtime.messages'), 0);
        }
      }
      assert.equal(combinations, 80);
    });

    await t.test('all ten users can block their incoming chat and subsequent sends fail', async () => {
      for (const conversation of conversations) {
        await asUser(conversation.recipient);
        await db.query("select public.respond_to_conversation($1,'blocked')", [conversation.id]);
        await asUser(conversation.sender);
        await assert.rejects(() => db.query('select public.send_direct_message($1,$2,$3)', [conversation.id, 'After block', randomUUID()]), /closed/);
        await assert.rejects(() => db.query("select public.respond_to_conversation($1,'accepted')", [conversation.id]), /closed/);
      }
    });

    await t.test('unknown archive aliases, self chat, anonymous chat and direct-table bypass fail', async () => {
      await asUser(users[0].id);
      await assert.rejects(() => db.query('select public.start_direct_conversation($1)', [users[0].username]), /another registered/);
      await assert.rejects(() => db.query("select public.start_direct_conversation('unregistered-archive-author')"), /another registered/);
      await assert.rejects(() => db.query('insert into public.direct_messages(conversation_id,sender_id,body) values($1,$2,$3)', [conversations[0].id, users[1].id, 'Spoofed sender']), /permission/);
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub','',false)");
      assert.equal(await scalar('select count(*)::integer from public.direct_messages'), 30);
      await db.exec('set role anon');
      await assert.rejects(() => db.query('select public.start_direct_conversation($1)', [users[0].username]), /permission/);
    });
    console.log(`Ten-user local PostgreSQL test: 10 generated usernames, 10 posts, 10 private conversations, 30 messages, 80 outsider combinations; ${references.length} post references. Hosted email signup, browsers and WebSocket transport are not covered.`);
  } finally { await db.close(); }
});

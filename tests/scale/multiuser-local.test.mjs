import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { COHORTS, newManifest, pairJourney, POLICY, MARKER } from './multiuser-core.mjs';

for (const count of COHORTS) test(`${count} local identities: paired messages, persistence, denial, posts, replies and votes (not WebSocket capacity)`, { timeout: 120000 }, async t => {
  const db = new PGlite({ extensions: { pg_trgm } });
  const manifest = newManifest(count);
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
      create schema realtime; create table realtime.messages(topic text,extension text,payload jsonb);
      alter table realtime.messages enable row level security;
      create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
      create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$insert into realtime.messages values(topic,'broadcast',payload);$$;
      grant usage on schema realtime to authenticated; grant select on realtime.messages to authenticated;
      create publication supabase_realtime;`);
    for (const name of ['20260904032053_community_core.sql', '20260907191603_secure_community_views.sql',
      '20260910031322_realtime_discovery_and_message_requests.sql', '20260910034701_production_access_hardening.sql',
      '20260910035131_imported_comment_discovery.sql', '20260910055528_launch_safety_and_moderation.sql',
      '20260911050812_community_write_guard_gaps.sql', '20261003175714_messaging_delivery_reliability.sql',
      '20261004221850_policy_acceptance_receipts.sql', '20261006042952_public_avatar_initials.sql',
      '20261006043113_avatar_name_policy_v2.sql', '20261003180348_secure_native_vote_rpcs.sql']) {
      await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    }
    assert((await readFile(new URL('../../src/lib/policy.ts', import.meta.url), 'utf8')).includes(`'${POLICY}'`));
    const scalar = async (sql, args) => Object.values((await db.query(sql, args)).rows[0])[0];
    async function asUser(id, fn) {
      await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec('set role authenticated');
      try { return await fn(); } finally { await db.exec('reset role'); }
    }
    const functions = { start_direct_conversation: ['other_username'], send_direct_message: ['target_conversation','message_body','message_id'],
      respond_to_conversation: ['target_conversation','decision'], message_page: ['target_conversation'], mark_direct_messages_read: ['target_conversation','message_ids'] };
    const actors = [];
    for (const u of manifest.users) {
      await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)', [u.id, { first_name: 'Synthetic' }]);
      const username = await scalar('select username from public.profiles where id=$1', [u.id]);
      await asUser(u.id, () => db.query(`insert into public.policy_acceptances(user_id,policy_version,market,terms_accepted,privacy_acknowledged,adult_confirmed) values($1,$2,'US',true,true,true)`, [u.id, POLICY]));
      actors.push({ id: u.id, username, rpc: (name, args) => asUser(u.id, async () => {
        assert(Object.hasOwn(functions, name));
        const values = functions[name].map(k => args[k]);
        const sql = `select * from public.${name}(${values.map((_, i) => `$${i + 1}`).join(',')})`;
        const rows = (await db.query(sql, values)).rows;
        return name === 'message_page' ? rows : Object.values(rows[0])[0];
      }) });
    }
    const pairs = [];
    for (let i = 0; i < count; i += 2) {
      const a = actors[i], b = actors[i + 1];
      pairs.push(await pairJourney(a, b, actors[(i + 2) % count], manifest.runId));
      const question = await asUser(a.id, () => scalar('insert into public.questions(author_id,title,body) values($1,$2,$3) returning id', [a.id, `${MARKER} ${manifest.runId}`, `${MARKER} ${manifest.runId} A synthetic question.`]));
      const answer = await asUser(b.id, () => scalar('insert into public.answers(author_id,question_id,body) values($1,$2,$3) returning id', [b.id, question, `${MARKER} ${manifest.runId} A synthetic reply.`]));
      await asUser(a.id, () => db.query('select public.vote_answer($1,1)', [answer]));
      await asUser(b.id, () => db.query('select public.vote_question($1,1)', [question]));
      await asUser(a.id, () => db.query('select public.accept_answer($1)', [answer]));
      assert.equal(await scalar('select is_accepted from public.answers where id=$1', [answer]), true);
    }
    assert.equal(await scalar('select count(*)::int from public.direct_messages'), count);
    assert.equal(await scalar('select count(*)::int from public.direct_conversations'), count / 2);
    assert.equal(new Set(pairs.flatMap(p => [p.sender, p.recipient])).size, count);
    t.diagnostic(JSON.stringify({ localIdentities: count, pairs: pairs.length, persistedMessages: count, posts: count/2, replies: count/2, hostedAuthenticated: 0, hostedSubscribed: 0 }));
  } finally { await db.close(); }
});

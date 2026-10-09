// Runs against explicitly provisioned, disposable fixtures. Never uses a service-role key.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { liveTestTarget, liveTestFixtures, liveTestFetch } from './test-environment.mjs';

// Validate the dedicated target BEFORE opening any fixture/password file or
// creating a client. The elected production database is never allowed here.
const target = liveTestTarget(process.env);
const users = liveTestFixtures(JSON.parse(await readFile(new URL('../.local/realtime-fixtures.json', import.meta.url), 'utf8')), target);
const restrictedFetch = liveTestFetch(target);
const clients = users.map(() => createClient(target.origin, target.publishableKey, {
  global: { fetch: restrictedFetch },
  auth: { persistSession: false, autoRefreshToken: false }, realtime: { timeout: 12000 },
}));
const channels = [];
const ok = ({ data, error }) => { if (error) throw new Error('A disposable fixture request failed. Inspect staging logs; response details are not printed.'); return data; };
async function listen(client, topic) {
  const received = [];
  let complete;
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Subscribe timeout: ${topic}`)), 15000);
    complete = (status, error) => {
      if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error(`Subscribe ${status}: disposable test channel unavailable`)); }
    };
  });
  const channel = client.channel(topic, { config: { private: true } })
    .on('broadcast', { event: 'changed' }, (event) => received.push({ event, time: performance.now() }))
    .subscribe(complete);
  channels.push([client,channel]);
  await ready;
  return received;
}
async function waitFor(check, label) {
  const end = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > end) throw new Error(`No live event: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

try {
  for (let i=0;i<clients.length;i++) {
    const auth = ok(await clients[i].auth.signInWithPassword({ email: users[i].email, password: users[i].password }));
    assert.equal(auth.user.id,users[i].id);
    await clients[i].realtime.setAuth(auth.session.access_token);
    users[i].profile = ok(await clients[i].from('profiles').select('id,username').eq('id',users[i].id).single());
  }
  console.log('PASS: Three separate authenticated sessions and public profiles.');
  // These fixtures are single-use: never append test data to existing accounts.
  for (let i=0;i<clients.length;i++) {
    for (const table of ['questions','answers','imported_answers']) {
      assert.equal(ok(await clients[i].from(table).select('id').eq('author_id',users[i].id).limit(1)).length,0,
        'Disposable fixture already has content; provision fresh staging fixtures.');
    }
    assert.equal(ok(await clients[i].from('conversation_inbox').select('id').limit(1)).length,0,
      'Disposable fixture already has a conversation; provision fresh staging fixtures.');
  }
  const [alice,bob,eve] = clients;
  const bobInbox = await listen(bob,`inbox:${users[1].id}`);
  const conversation = ok(await alice.rpc('start_direct_conversation',{other_username:users[1].profile.username}));
  await waitFor(() => bobInbox.length,'new chat request');
  const bobChat = await listen(bob,`conversation:${conversation}`);
  const messageId = randomUUID();
  const start = performance.now();
  ok(await alice.rpc('send_direct_message',{target_conversation:conversation,message_body:'VisaFlow integration test introduction',message_id:messageId}));
  await waitFor(() => bobChat.length,'first private message');
  console.log(`PASS: Private message delivered over WebSocket in ${Math.round(bobChat[0].time-start)} ms (one disposable-environment measurement).`);
  ok(await alice.rpc('send_direct_message',{target_conversation:conversation,message_body:'VisaFlow integration test introduction',message_id:messageId}));
  assert.equal(ok(await bob.rpc('message_page',{target_conversation:conversation})).length,1);
  assert((await alice.rpc('send_direct_message',{target_conversation:conversation,message_body:'Second pending message',message_id:randomUUID()})).error);
  assert.equal(ok(await eve.rpc('message_page',{target_conversation:conversation})).length,0);
  assert.equal(ok(await eve.from('conversation_inbox').select('*')).length,0);
  await assert.rejects(listen(eve,`conversation:${conversation}`),/CHANNEL_ERROR|timeout/i);
  console.log('PASS: Request limit, retry deduplication, outsider read denial and private-channel denial.');
  ok(await bob.rpc('respond_to_conversation',{target_conversation:conversation,decision:'accepted'}));
  ok(await bob.rpc('send_direct_message',{target_conversation:conversation,message_body:'VisaFlow integration test accepted reply',message_id:randomUUID()}));
  ok(await bob.rpc('mark_direct_messages_read',{target_conversation:conversation,message_ids:[messageId]}));
  assert(ok(await alice.from('direct_messages').select('read_at').eq('id',messageId).single()).read_at);
  ok(await bob.rpc('respond_to_conversation',{target_conversation:conversation,decision:'blocked'}));
  assert((await alice.rpc('send_direct_message',{target_conversation:conversation,message_body:'Blocked reply',message_id:randomUUID()})).error);
  console.log('PASS: Acceptance, reply, read receipt and block enforcement.');
  const discovery = await listen(bob,'discovery:rfe');
  const question = ok(await alice.from('questions').insert({author_id:users[0].id,
    title:'Integration fixture: how should I prepare an RFE response?',body:'This is a temporary development fixture for RFE response and premium processing discovery.',tags:[]}).select('*').single());
  assert(question.tags.includes('rfe'));
  await waitFor(() => discovery.length,'question topic discovery');
  const questionEvents = await listen(alice,`question:${question.id}`);
  const answer = ok(await bob.from('answers').insert({question_id:question.id,author_id:users[1].id,body:'This test reply mentions biometrics appointments to verify comment-aware search.'}).select('id').single());
  assert((await bob.rpc('accept_answer',{target_answer_id:answer.id})).error);
  ok(await alice.rpc('accept_answer',{target_answer_id:answer.id}));
  await waitFor(() => questionEvents.length,'shared answer');
  const result = ok(await alice.rpc('discover_questions',{query_tags:['biometrics'],comment_tags:['biometrics'],query_text:''}));
  assert(result.some((q) => q.id===question.id && q.matched_tags.includes('biometrics')));
  const importedTopic = `apify-test-${users[0].id}`;
  const importedEvents = await listen(alice,`question:${importedTopic}`);
  ok(await bob.from('imported_answers').insert({question_id:importedTopic,author_id:users[1].id,body:'Temporary integration fixture for biometrics replies on imported posts.'}));
  await waitFor(() => importedEvents.length,'imported post reply');
  assert.equal(ok(await alice.from('imported_answer_feed').select('id').eq('question_id',importedTopic)).length,1);
  const anon = createClient(target.origin,target.publishableKey,{global:{fetch:restrictedFetch},auth:{persistSession:false}});
  assert(ok(await anon.rpc('community_question_page',{})).some((q) => q.id===question.id));
  const combined = ok(await anon.rpc('discover_community',{query_tags:['biometrics'],comment_tags:['biometrics']}));
  assert(combined.native.some((q) => q.id===question.id));
  assert(combined.imported_topics[importedTopic].includes('biometrics'));
  assert((await anon.rpc('start_direct_conversation',{other_username:users[1].profile.username})).error);
  console.log('PASS: Native posting, automatic tags, comment-aware retrieval, shared imported replies and public feed.');
} finally {
  await Promise.all(channels.map(([client,channel]) => client.removeChannel(channel)));
  await Promise.all(clients.map((client) => client.auth.signOut()));
  clients.forEach((client) => client.realtime.disconnect());
}

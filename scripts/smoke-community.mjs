// Read-only preview verification. No accounts, emails or content writes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

const origin = process.argv[2] ?? 'https://visa-central.com';
assert(['https://visa-central.com','https://visaflow-dev.varunchinna5966.workers.dev'].includes(origin), 'Use an approved preview origin.');
const env = parseEnv(await readFile(new URL('../.env.local',import.meta.url),'utf8'));
const database = env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(database,'https://cycnichledvqbxevrwnt.supabase.co','This smoke test targets the existing development project only.');
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert(key,'A publishable key is required.');
if (!key.startsWith('sb_publishable_')) {
  assert.equal(JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role,'anon','Never use a privileged key.');
}
const snapshot = JSON.parse(await readFile(new URL('../src/data/api-archive.json',import.meta.url),'utf8'));
async function read(path) {
  const response = await fetch(new URL(path,origin),{signal:AbortSignal.timeout(15000),redirect:'error'});
  assert.equal(response.status,200,`${path} unavailable`);
  return response.json();
}
const [feed,summary] = await Promise.all([read('/api/community'),read('/api/tags')]);
assert.deepEqual(feed.questions.map(row=>row.id),snapshot.questions.map(row=>row.id));
assert.equal(Object.values(feed.answersByQuestionId).flat().length,snapshot.source.commentCount);
assert.equal(feed.source.runId,snapshot.source.runId);
for (const row of summary.tags) {
  assert.equal(row.count,feed.questions.filter(question=>question.status!=='archived' && question.tags.includes(row.tag)).length);
  assert.deepEqual(Object.keys(row).sort(),['count','example','tag']);
}
console.log(`PASS archive: ${feed.questions.length} posts, ${snapshot.source.commentCount} comments, ${summary.tags.length} tags; latest source ${feed.source.newestRunAt}`);

async function rpc(name,args={}) {
  return fetch(new URL(`/rest/v1/rpc/${name}`,database),{
    method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify(args),
    signal:AbortSignal.timeout(15000),redirect:'error',
  });
}
const tagsResponse=await rpc('community_tag_page',{archive_counts:summary.tags});
assert.equal(tagsResponse.status,200,'Tag directory RPC unavailable');
const tags=await tagsResponse.json();
assert(tags.length>0 && tags.length<=51);
for(const tag of tags) assert.equal(Number(tag.question_count),Number(tag.native_count)+Number(tag.archive_count));
const nonexistent='00000000-0000-4000-8000-000000000000';
for(const [name,args] of [
  ['answer_page',{target_question:nonexistent}],
  ['imported_answer_page',{target_question:'apify-preview-smoke-nonexistent'}],
  ['discover_community',{query_tags:['h1b'],comment_tags:['rfe'],query_text:''}],
]) {
  const response=await rpc(name,args);
  assert.equal(response.status,200,`${name} unavailable`);
  await response.body?.cancel();
}
for(const [name,args] of [
  ['conversation_page',{}],
  ['mark_direct_messages_read',{target_conversation:nonexistent,message_ids:[]}],
  ['vote_question',{target_question_id:nonexistent,vote_value:1}],
  ['vote_answer',{target_answer_id:nonexistent,vote_value:1}],
]) {
  const response=await rpc(name,args);
  assert([401,403].includes(response.status),`${name} must deny anonymous callers`);
  await response.body?.cancel();
}
console.log('PASS public read RPCs, tag totals and anonymous denial for private messaging/voting. No records were written.');

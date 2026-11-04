import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const db = new PGlite({ extensions: { pg_trgm } });
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const eve = '33333333-3333-4333-8333-333333333333';
const ids = {};
const scalar = async (query, args = []) => Object.values((await db.query(query, args)).rows[0])[0];
const migration = (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

before(async () => {
  // Platform stubs exercise actual PostgreSQL policies/functions, not HTTP mocks.
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
    '20260904032053_community_core.sql',
    '20260907191603_secure_community_views.sql',
    '20260910031322_realtime_discovery_and_message_requests.sql',
    '20260910034701_production_access_hardening.sql',
    '20260910035131_imported_comment_discovery.sql',
    '20260910055528_launch_safety_and_moderation.sql',
    '20260911050812_community_write_guard_gaps.sql',
    '20261003175707_native_parent_visibility_hardening.sql',
  ]) await db.exec(await migration(name));
  await db.query('insert into auth.users values($1),($2),($3)', [alice, bob, eve]);
  await db.query('insert into private.community_moderators values($1)', [eve]);
  await db.exec('create table private.feedback_owner(user_id uuid primary key references auth.users(id))');
  await db.query('insert into private.feedback_owner values($1)',[alice]);
  await db.exec(await migration('20261102054340_community_spam_protection.sql'));
  await db.exec(await migration('20261016021725_imported_answer_write_privileges.sql'));
  for (const status of ['open', 'closed', 'archived']) {
    const question = await scalar(`insert into public.questions(author_id,title,body,tags,status)
      values($1,$2,'Parent visibility fixture with a sufficiently long body.',array['timeline'],$3) returning id`,
    [alice, `${status} parent visibility fixture`, status]);
    const answer = await scalar(`insert into public.answers(question_id,author_id,body)
      values($1,$2,'A relevant RFE request for evidence response for this thread.') returning id`, [question, bob]);
    ids[status] = { question, answer };
    await db.query('insert into public.question_votes(question_id,user_id,value) values($1,$2,1)', [question, eve]);
    await db.query('insert into public.answer_votes(answer_id,user_id,value) values($1,$2,1)', [answer, eve]);
  }
  ids.hiddenAnswer = await scalar(`insert into public.answers(question_id,author_id,body,status)
    values($1,$2,'A removed answer mentioning biometrics should not be discoverable.','archived') returning id`, [ids.open.question, bob]);
  await db.query('insert into public.answer_votes(answer_id,user_id,value) values($1,$2,1)', [ids.hiddenAnswer, eve]);
});
after(() => db.close());

async function asRole(role, uid, fn) {
  assert(['anon', 'authenticated'].includes(role));
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid ?? '']);
    await db.exec(`set local role ${role}`);
    return await fn();
  } finally { await db.exec('rollback'); }
}
const denied = (fn) => assert.rejects(fn, (error) => error.code === '42501');

const signals = async body => JSON.parse(JSON.stringify(await scalar('select private.community_spam_signals($1)',[body])));
const answer = body => db.query('insert into public.answers(question_id,author_id,body) values($1,$2,$3) returning id',[ids.open.question,bob,body]);
for (const link of ['https://USCIS.gov.evil.example/pay','https://uscis.gov@evil.example','https://uscis.gov%40evil.example','https://uscis.gov\\evil.example','https://travel.state.gov.fake.example']) {
  test(`blocks deceptive link ${link}`,()=>asRole('authenticated',bob,()=>assert.rejects(()=>answer(`Please apply using this link: ${link}`),/link/i)));
}
for (const link of ['https://www.uscis.gov/forms','https://travel.state.gov/content','https://www.canada.ca/en','https://example.org/uscis.gov','https://example.com/?next=uscis.gov','https://notuscis.gov.example/info']) {
  test(`allows ordinary source ${link}`,()=>asRole('authenticated',bob,()=>answer(`My reference explaining the application procedure: ${link}`)));
}
test('defanged scam warning is allowed',()=>asRole('authenticated',bob,()=>answer('Beware of hxxps://uscis.gov.evil.example: this is not an official source.')));
test('flags guarantees plus solicitation, but not normal visa discussion',async()=>{
  assert.equal((await signals('Guaranteed visa approval, pay me on Telegram.')).reasons.length,1);
  assert.equal((await signals('Is approval guaranteed? I am worried about my interview.')).reasons.length,0);
  assert.equal((await signals('Use https://bit.ly/example for the source')).reasons.length,1);
});
test('suspicious warning remains published for context review, with a server-generated report',()=>asRole('authenticated',bob,async()=>{
  const id=(await answer('Beware: someone said guaranteed visa approval, contact me on WhatsApp. This sounds like a scam.')).rows[0].id;
  const reports=(await db.query('select * from community_reports where target_id=$1',[id])).rows;
  assert.equal(reports[0].source,'automatic');
  assert.equal((await db.query('select status from answers where id=$1',[id])).rows[0].status,'active');
}));
test('third long duplicate is rejected across replies',()=>asRole('authenticated',bob,async()=>{
  const body='This is a repeated promotional answer with enough text to trigger the duplicate protection without relying on links.';
  await answer(body);await answer(body);
  await assert.rejects(()=>answer(body.toUpperCase().replaceAll(' ','  ')),/recently posted/);
}));
test('new member may share three sources, fourth link waits',()=>asRole('authenticated',bob,async()=>{
  for(let i=0;i<3;i++) await answer(`This source explains my application question number ${i}: https://example.org/${i}`);
  await assert.rejects(()=>answer('Another reference to an application source https://example.org/four'),/ten minutes/);
}));
test('text-only follow-up remains possible after link limit',()=>asRole('authenticated',bob,async()=>{
  for(let i=0;i<3;i++) await answer(`Source number ${i} https://example.org/${i}`);
  await answer('Thank you for the explanation. I will check those instructions.');
}));
test('edits cannot introduce deceptive links',()=>asRole('authenticated',bob,()=>assert.rejects(()=>db.query('update answers set body=$1 where id=$2',['Apply through https://uscis.gov@evil.example today',ids.open.answer]),/hides its destination/)));
test('ordinary members cannot manage domains or read private histories',()=>asRole('authenticated',bob,async()=>{
  await assert.rejects(()=>db.query("select public.community_spam_domains('block','evil.example','Verified phishing destination')"),/Moderator access/);
}));
test('private histories cannot be read through the Data API role',()=>asRole('authenticated',bob,()=>assert.rejects(()=>db.query('select * from private.community_spam_recent'),/permission denied/)));
test('moderators can block a domain including subdomains and then unblock it',async()=>{
  await asRole('authenticated',eve,async()=>{
    await db.query("select public.community_spam_domains('block','evil.example','Verified phishing destination')");
    // Inspect the trigger's detector as the database owner without exposing it to clients.
    await db.exec('reset role');
    assert.match((await signals('https://sub.evil.example/form')).blocked,/blocked after moderator/);
    assert.equal((await signals('https://notevil.example/form')).blocked,null);
    await db.exec('set local role authenticated');
    await db.query("select public.community_spam_domains('unblock','evil.example','')");
    assert.deepEqual(await scalar('select public.community_spam_domains()'),[]);
  });
});
test('anonymous role cannot call operator controls',()=>asRole('anon',null,()=>assert.rejects(()=>db.query('select public.community_spam_domains()'),/permission denied/)));
test('queue includes automatic origin, and moderator dismissal is preserved on unchanged content',async()=>{
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[bob]);
    await db.exec('set local role authenticated');
    const id=(await answer('Guaranteed visa approval: contact me on Telegram for payment details.')).rows[0].id;
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[eve]);
    const report=(await scalar('select community_moderation_queue()')).find(r=>r.target_id===id);
    assert.equal(report.source,'automatic');
    await db.query("select moderate_community_report($1,'dismissed',false)",[report.id]);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[bob]);
    await db.query('update answers set body=body where id=$1',[id]);
    assert.equal(await scalar('select status from community_reports where id=$1',[report.id]),'dismissed');
    await db.query('update answers set body=body || $1 where id=$2',[' New payment offer.',id]);
    assert.equal(await scalar('select status from community_reports where id=$1',[report.id]),'pending');
  } finally {await db.exec('rollback');}
});
test('designated owner can review reports and manage scam domains',()=>asRole('authenticated',alice,async()=>{
  assert(Array.isArray(await scalar('select community_moderation_queue()')));
  assert(Array.isArray(await scalar('select community_spam_domains()')));
}));
for(const body of ['A fake reference is at uscis.gov.evil.example/apply','A fake reference is at WWW.USCIS.GOV.evil.example/apply','Please see https://us\u200bcis.gov.evil.example/form']) {
  test(`deceptive bare or obfuscated domain is blocked: ${body}`,()=>asRole('authenticated',bob,()=>assert.rejects(()=>answer(body),/link resembles/)));
}
test('question titles and bodies are both screened',()=>asRole('authenticated',bob,()=>assert.rejects(()=>db.query(`insert into questions(author_id,title,body) values($1,'https://uscis.gov.evil.example','A sufficiently long body asking about a visa appointment.')`,[bob]),/link resembles/)));
test('archive replies use the same server guard',()=>asRole('authenticated',bob,()=>assert.rejects(()=>db.query(`insert into imported_answers(question_id,author_id,body) values('apify-fixture',$1,'Please apply using https://uscis.gov@evil.example today')`,[bob]),/hides its destination/)));
test('archive replies can be automatically reported',()=>asRole('authenticated',bob,async()=>{
  const id=await scalar(`insert into imported_answers(question_id,author_id,body) values('apify-fixture',$1,'Guaranteed visa approval: contact me on WhatsApp for payment.') returning id`,[bob]);
  assert.equal(await scalar('select source from community_reports where target_id=$1',[id]),'automatic');
}));
test('history counts both posts and replies, so changing surfaces cannot bypass link limit',()=>asRole('authenticated',bob,async()=>{
  for(let i=0;i<3;i++) await answer(`Source ${i} https://example.org/${i}`);
  await assert.rejects(()=>db.query(`insert into questions(author_id,title,body) values($1,'Another application source','Please read https://example.org/next for this application.')`,[bob]),/ten minutes/);
}));
test('expired history permits fresh links',async()=>{
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[bob]);
    await db.exec('set local role authenticated');
    for(let i=0;i<3;i++) await answer(`Source ${i} https://example.org/${i}`);
    await db.exec('reset role');
    await db.exec("update private.community_spam_recent set seen_at=now()-interval '11 minutes'");
    await db.exec('set local role authenticated');
    await answer('A new source after the cooldown https://example.org/later');
  } finally {await db.exec('rollback');}
});
test('repeated edits reuse one history slot',()=>asRole('authenticated',bob,async()=>{
  for(let i=0;i<40;i++) await db.query('update answers set body=$1 where id=$2',[`An updated relevant answer with a new detail numbered ${i}.`,ids.open.answer]);
  await db.exec('reset role');
  assert.equal(await scalar('select count(*)::integer from private.community_spam_recent where user_id=$1',[bob]),1);
}));
test('member cannot forge automatic reports',()=>asRole('authenticated',bob,()=>assert.rejects(()=>db.query(`insert into community_reports(reporter_id,target_kind,target_id,reason,source) values($1,'answer',$2,'scam','automatic')`,[bob,ids.open.answer]),/permission denied/)));
test('moderation can remove flagged content while preserving normal removal behavior',async()=>{
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[bob]);
    await db.exec('set local role authenticated');
    const id=(await answer('Guaranteed visa approval: contact me on Telegram for payment details.')).rows[0].id;
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[eve]);
    const report=(await scalar('select community_moderation_queue()')).find(r=>r.target_id===id);
    await db.query("select moderate_community_report($1,'removed',false)",[report.id]);
    await db.exec('reset role');
    assert.equal(await scalar('select status from answers where id=$1',[id]),'archived');
  } finally {await db.exec('rollback');}
});
test('many repeated short URLs produce one bounded review reason',async()=>{
  const result=await signals('https://bit.ly/x '.repeat(100));
  assert.equal(result.reasons.length,2);
  assert(JSON.stringify(result.reasons).length<300);
});
test('Unicode and punycode destinations are reviewed, not assumed malicious',async()=>{
  for(const host of ['xn--example-9d0b.example','exаmple.org']) {
    const result=await signals(`Source https://${host}/info`);
    assert.equal(result.blocked,null);
    assert(result.reasons.some(reason=>reason.includes('internationalized')));
  }
});
test('block and unblock preserve an operator audit trail',()=>asRole('authenticated',eve,async()=>{
  await db.query("select community_spam_domains('block','phishing.example','Confirmed deceptive payment form')");
  await db.query("select community_spam_domains('unblock','phishing.example','')");
  await db.exec('reset role');
  const rows=(await db.query("select action,reason,operator_id from private.community_spam_domain_audit where domain='phishing.example' order by id")).rows;
  assert.deepEqual(rows.map(r=>r.action),['block','unblock']);
  assert(rows.every(r=>r.operator_id===eve && r.reason==='Confirmed deceptive payment form'));
}));

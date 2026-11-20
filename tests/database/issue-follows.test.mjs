import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222',eve='33333333-3333-4333-8333-333333333333';
const anchor='44444444-4444-4444-8444-444444444444',chat='55555555-5555-4555-8555-555555555555',hidden='66666666-6666-4666-8666-666666666666';
const read=name=>readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8');
before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create schema private;create schema realtime;
    create function realtime.send(jsonb,text,text,boolean) returns void language sql as $$select$$;
    create table auth.users(id uuid primary key,deleted_at timestamptz,is_anonymous boolean default false,banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.profiles(id uuid primary key,username text);
    create table public.communities(id uuid primary key,is_public boolean,is_active boolean);
    create table public.questions(id uuid primary key default gen_random_uuid(),author_id uuid,title text,status text default 'open',community_id uuid,
      tags text[] not null default '{}',post_kind text not null default 'question');
    create table public.answers(id uuid primary key default gen_random_uuid(),question_id uuid,author_id uuid,status text default 'active');
    create table public.direct_conversations(id uuid primary key,user_one_id uuid,user_two_id uuid,request_status text);
    create table public.direct_messages(id uuid primary key default gen_random_uuid(),conversation_id uuid,sender_id uuid,read_at timestamptz);
    grant usage on schema public,auth to anon,authenticated,service_role;grant usage on schema private to authenticated;
    insert into auth.users(id) values('${alice}'),('${bob}'),('${eve}');
    insert into public.profiles values('${alice}','alice'),('${bob}','bob'),('${eve}','eve');
    insert into public.communities values('${hidden}',false,true);
    insert into public.questions(id,author_id,title,tags) values('${anchor}','${bob}','OPT unemployment days question',array['opt','unemployment-days','stem-opt']);
    insert into public.direct_conversations values('${chat}','${alice}','${eve}','accepted');`);
  await db.exec(await read('20261104152855_member_notifications.sql'));
  await db.exec(await read('20261119120000_issue_follows.sql'));
});
after(()=>db.close());
async function as(user,role,fn){
  await db.exec('begin');
  try {await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user??'']);await db.exec(`set local role ${role}`);return await fn();}
  finally {await db.exec('rollback');}
}
// Commit a member action (follows must survive the helper's rollback for fan-out tests).
async function commitAs(user,fn){
  await db.exec('begin');
  try {await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);await db.exec('set local role authenticated');const value=await fn();await db.exec('commit');return value;}
  catch(error){await db.exec('rollback');throw error;}
}
const follow=(target,title=null,topics=null,expected=alice)=>db.query('select public.follow_issue($1,$2,$3,$4) as value',[target,title,topics,expected]).then(r=>r.rows[0].value);
const unfollow=(target,expected=alice)=>db.query('select public.unfollow_issue($1,$2)',[target,expected]);
const follows=()=>db.query('select public.member_issue_follows() as value').then(r=>r.rows[0].value);
const data=()=>db.query('select public.member_notification_data(0) as value').then(r=>r.rows[0].value);
async function post(author,tags,extra={}){
  const {rows}=await db.query('insert into public.questions(author_id,title,tags,post_kind,community_id,status) values($1,$2,$3,$4,$5,$6) returning id',
    [author,extra.title??'Another OPT question',tags,extra.kind??'question',extra.community??null,extra.status??'open']);
  return rows[0].id;
}
async function clean(){await db.exec(`delete from private.member_notifications;delete from private.issue_follows;delete from public.questions where id<>'${anchor}';`);}

test('signed-out and anonymous sessions cannot follow, list or read follows directly',async()=>{
  await as(null,'anon',()=>assert.rejects(()=>follow(anchor),/permission denied/));
  await as(null,'authenticated',()=>assert.rejects(()=>follow(anchor),/Sign in/));
  await as(null,'anon',()=>assert.rejects(()=>db.query('select * from private.issue_follows'),/permission denied/));
  await as(alice,'service_role',()=>assert.rejects(()=>db.query('select * from private.issue_follows'),/permission denied/));
});
test('member follows use the post database topics, not client-supplied ones, and are idempotent',async()=>{
  try{
    const saved=await commitAs(alice,()=>follow(anchor,'Spoofed title',['spoofed']));
    assert.deepEqual(saved.topics,['opt','unemployment-days','stem-opt']);
    assert.equal(saved.title,'OPT unemployment days question');
    await commitAs(alice,()=>follow(anchor));
    assert.equal((await as(alice,'authenticated',()=>follows())).length,1);
    await as(alice,'authenticated',()=>assert.rejects(()=>follow(anchor,null,null,bob),/Account changed/));
    await as(alice,'authenticated',()=>assert.rejects(()=>follow('not-a-post'),/cannot be followed/));
    await as(alice,'authenticated',()=>assert.rejects(()=>follow(hidden),/no longer available/));
  }finally{await clean();}
});
test('imported discussions accept normalized, bounded topics only',async()=>{
  try{
    const saved=await commitAs(alice,()=>follow('apify-reddit_abc','  Earlier   OPT thread ',['OPT','opt','visa-question','<script>','a b','h1b','cap-gap','rfe','stem-opt','extra']));
    assert.deepEqual(saved.topics,['opt','h1b','cap-gap','rfe','stem-opt']);
    assert.equal(saved.title,'Earlier OPT thread');
    await as(alice,'authenticated',()=>assert.rejects(()=>follow('apify-x',"Title",['visa-question']),/no topics/));
    await as(alice,'authenticated',()=>assert.rejects(()=>follow('apify-x','',['opt']),/cannot be followed/));
  }finally{await clean();}
});
test('RLS: members see and delete only their own follow rows',async()=>{
  try{
    await commitAs(alice,()=>follow(anchor));
    await commitAs(eve,()=>follow(anchor,null,null,eve));
    await as(alice,'authenticated',async()=>{
      const rows=(await db.query('select user_id from private.issue_follows')).rows;
      assert.deepEqual(rows.map(r=>r.user_id),[alice]);
      await db.query('delete from private.issue_follows');
      await assert.rejects(()=>db.query("insert into private.issue_follows(user_id,anchor_id,anchor_title,topics) values($1,'apify-x','t','{opt}')",[eve]),/permission denied/);
    });
    assert.equal((await as(eve,'authenticated',()=>follows())).length,1);
    await as(eve,'authenticated',()=>assert.rejects(()=>db.query("update private.issue_follows set topics='{x}'"),/permission denied/));
  }finally{await clean();}
});
test('a new member post sharing enough topics notifies followers once, never the author',async()=>{
  try{
    await commitAs(alice,()=>follow(anchor));
    await commitAs(eve,()=>follow(anchor,null,null,eve));
    await post(eve,['opt','visa-interview']); // only one shared topic of three: not enough
    assert.equal((await as(alice,'authenticated',()=>data())).items.length,0);
    const id=await post(eve,['stem-opt','opt'],{kind:'experience',title:'My STEM OPT experience'});
    const value=await as(alice,'authenticated',()=>data());
    assert.equal(value.items.length,1);assert.equal(value.unreadNotifications,1);
    const [item]=value.items;
    assert.equal(item.kind,'issue');assert.equal(item.actor_username,null);
    assert.equal(item.href,`/us/en/experiences/${id}`);assert.equal(item.title,'My STEM OPT experience');
    assert.equal(item.issue_anchor_id,anchor);assert.equal(item.issue_title,'OPT unemployment days question');
    assert.equal((await as(eve,'authenticated',()=>data())).items.length,0,'author is not notified about their own post');
    await db.query('update public.questions set title=$1 where id=$2',['Edited STEM OPT story',id]);
    assert.equal((await db.query("select count(*)::int as n from private.member_notifications where user_id=$1",[alice])).rows[0].n,1);
  }finally{await clean();}
});
test('one-topic follows need that topic; private communities, archived posts and blocks stay silent',async()=>{
  try{
    await commitAs(alice,()=>follow('apify-one','Cap gap',['cap-gap']));
    await post(bob,['cap-gap'],{community:hidden});
    await post(bob,['cap-gap'],{status:'archived'});
    await db.query("update public.direct_conversations set request_status='blocked' where id=$1",[chat]);
    await post(eve,['cap-gap']);
    assert.equal((await as(alice,'authenticated',()=>data())).items.length,0);
    const id=await post(bob,['cap-gap']);
    let value=await as(alice,'authenticated',()=>data());
    assert.equal(value.items.length,1);assert.equal(value.items[0].href,`/us/en/questions/${id}`);
    await db.query("update public.questions set status='archived' where id=$1",[id]);
    value=await as(alice,'authenticated',()=>data());assert.equal(value.items.length,0);assert.equal(value.unreadNotifications,0);
  }finally{await db.query("update public.direct_conversations set request_status='accepted' where id=$1",[chat]);await clean();}
});
test('overlapping follows still yield one notice per post, capped at ten issue notices a day',async()=>{
  try{
    await commitAs(alice,()=>follow(anchor));
    await commitAs(alice,()=>follow('apify-two','Same issue',['opt','stem-opt']));
    await post(bob,['opt','stem-opt']);
    assert.equal((await as(alice,'authenticated',()=>data())).items.length,1);
    for(let i=0;i<15;i++) await post(bob,['opt','stem-opt']);
    assert.equal((await db.query("select count(*)::int as n from private.member_notifications where user_id=$1 and kind='issue'",[alice])).rows[0].n,10);
  }finally{await clean();}
});
test('unfollow stops future notices, clears that issue from Notifications and cannot touch others',async()=>{
  try{
    await commitAs(alice,()=>follow(anchor));
    await commitAs(eve,()=>follow(anchor,null,null,eve));
    await post(bob,['opt','stem-opt']);
    await commitAs(eve,()=>unfollow(anchor,eve));
    assert.equal((await as(alice,'authenticated',()=>follows())).length,1,'another member cannot remove my follow');
    await as(alice,'authenticated',()=>assert.rejects(()=>unfollow(anchor,eve),/Account changed/));
    await commitAs(alice,()=>unfollow(anchor));
    assert.equal((await as(alice,'authenticated',()=>follows())).length,0);
    assert.equal((await as(alice,'authenticated',()=>data())).items.length,0);
    await post(bob,['opt','stem-opt']);
    assert.equal((await as(alice,'authenticated',()=>data())).items.length,0);
  }finally{await clean();}
});
test('members can follow at most fifty issues',async()=>{
  try{
    await db.query("insert into private.issue_follows(user_id,anchor_id,anchor_title,topics) select $1,'apify-n'||g,'Issue '||g,'{opt}' from generate_series(1,50) g",[alice]);
    await as(alice,'authenticated',()=>assert.rejects(()=>follow(anchor),/up to 50/));
    await as(alice,'authenticated',async()=>{await follow('apify-n1','Issue 1 renamed',['opt']);});
  }finally{await clean();}
});
test('existing reply and message notifications still work after the kind is extended',async()=>{
  try{
    await db.query('insert into public.answers(question_id,author_id) values($1,$2)',[anchor,alice]);
    await db.query('insert into public.direct_messages(conversation_id,sender_id) values($1,$2)',[chat,eve]);
    assert.deepEqual((await as(bob,'authenticated',()=>data())).items.map(i=>i.kind),['reply']);
    assert.deepEqual((await as(alice,'authenticated',()=>data())).items.map(i=>i.kind),['message']);
    await assert.rejects(()=>db.query("insert into private.member_notifications(user_id,actor_id,kind,question_id) values($1,$2,'issue',$3)",[alice,bob,anchor]),/check/);
  }finally{await db.exec('delete from public.answers;delete from public.direct_messages;');await clean();}
});

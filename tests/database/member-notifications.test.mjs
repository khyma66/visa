import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222',eve='33333333-3333-4333-8333-333333333333';
const q='44444444-4444-4444-8444-444444444444',chat='55555555-5555-4555-8555-555555555555';
const migration=await readFile(new URL('../../supabase/migrations/20261104152855_member_notifications.sql',import.meta.url),'utf8');
before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create schema private;create schema realtime;
    create function realtime.send(jsonb,text,text,boolean) returns void language sql as $$select$$;
    create table auth.users(id uuid primary key,deleted_at timestamptz,is_anonymous boolean default false,banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.profiles(id uuid primary key,username text);
    create table public.communities(id uuid primary key,is_public boolean,is_active boolean);
    create table public.questions(id uuid primary key,author_id uuid,title text,status text,community_id uuid);
    create table public.answers(id uuid primary key default gen_random_uuid(),question_id uuid,author_id uuid,status text default 'active');
    create table public.direct_conversations(id uuid primary key,user_one_id uuid,user_two_id uuid,request_status text);
    create table public.direct_messages(id uuid primary key default gen_random_uuid(),conversation_id uuid,sender_id uuid,read_at timestamptz);
    grant usage on schema public,auth to anon,authenticated,service_role;grant usage on schema private to authenticated;
    insert into auth.users(id) values('${alice}'),('${bob}'),('${eve}');
    insert into public.profiles values('${alice}','alice'),('${bob}','bob'),('${eve}','eve');
    insert into public.questions values('${q}','${alice}','Visa Question','open',null);
    insert into public.direct_conversations values('${chat}','${alice}','${bob}','accepted');`);
  await db.exec(migration);
});
after(()=>db.close());
async function as(user,role,fn){
  await db.exec('begin');
  try {await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user??'']);await db.exec(`set local role ${role}`);return await fn();}
  finally {await db.exec('rollback');}
}
const data=(page=0)=>db.query('select public.member_notification_data($1) as value',[page]).then(r=>r.rows[0].value);
const mark=(ids,expected=alice)=>db.query('select public.read_member_notifications($1,$2)',[ids,expected]);
const prefs=(reply=true,message=true,re=false,me=false,expected=alice)=>db.query('select public.set_notification_preferences($1,$2,$3,$4,$5)',[reply,message,re,me,expected]);
async function reply(author=bob){return (await db.query('insert into public.answers(question_id,author_id) values($1,$2) returning id',[q,author])).rows[0].id;}
async function message(){return (await db.query('insert into public.direct_messages(conversation_id,sender_id) values($1,$2) returning id',[chat,bob])).rows[0].id;}
async function clean(){await db.exec('delete from public.answers;delete from public.direct_messages;delete from private.notification_preferences;');}

test('anonymous and invalid sessions cannot access notification RPCs or storage',async()=>{
  await as(null,'anon',()=>assert.rejects(()=>data(),/permission denied/));
  await as(null,'authenticated',()=>assert.rejects(()=>data(),/Sign in/));
  for(const role of ['anon','authenticated','service_role']) {
    await as(alice,role,()=>assert.rejects(()=>db.query('select * from private.member_notifications'),/permission denied/));
    await as(alice,role,()=>assert.rejects(()=>db.query('select * from private.notification_preferences'),/permission denied/));
  }
});
test('reply alert belongs only to post owner, deep-links to answer, and never duplicates on edit',async()=>{
  const id=await reply();
  try {
    const owner=await as(alice,'authenticated',()=>data());
    assert.equal(owner.items.length,1);assert.equal(owner.unreadNotifications,1);
    assert.equal(owner.items[0].href,`/questions/${q}#answer-${id}`);
    assert.equal(owner.items[0].actor_username,'bob');
    assert.equal((await as(bob,'authenticated',()=>data())).items.length,0);
    assert.equal((await as(eve,'authenticated',()=>data())).items.length,0);
    await db.query("update public.answers set status='active' where id=$1",[id]);
    assert.equal((await as(alice,'authenticated',()=>data())).items.length,1);
    await reply(alice); assert.equal((await as(alice,'authenticated',()=>data())).items.length,1);
  }finally{await clean();}
});
test('message badge counts real unread messages, recipient alert clears when message is read',async()=>{
  const id=await message();
  try{
    let value=await as(alice,'authenticated',()=>data());
    assert.equal(value.unreadMessages,1);assert.equal(value.unreadNotifications,1);
    assert.equal(value.items[0].href,`/messages?to=bob&member=${bob}`);
    assert.equal((await as(bob,'authenticated',()=>data())).unreadMessages,0);
    await db.query('update public.direct_messages set read_at=now() where id=$1',[id]);
    value=await as(alice,'authenticated',()=>data());
    assert.equal(value.unreadMessages,0);assert.equal(value.unreadNotifications,0);assert.ok(value.items[0].read_at);
  }finally{await clean();}
});
test('marking notification read does not pretend its private message was read',async()=>{
  await message();
  try{await as(alice,'authenticated',async()=>{
    let value=await data();await mark([value.items[0].id]);value=await data();
    assert.equal(value.unreadNotifications,0);assert.equal(value.unreadMessages,1);
    await mark([value.items[0].id]);assert.equal((await data()).unreadNotifications,0);
  });}finally{await clean();}
});
test('another member cannot mark owner alerts read or change preferences across account switch',async()=>{
  await reply();
  try{
    const owner=await as(alice,'authenticated',()=>data());
    await as(bob,'authenticated',()=>mark([owner.items[0].id],bob));
    assert.equal((await as(alice,'authenticated',()=>data())).unreadNotifications,1);
    await as(bob,'authenticated',()=>assert.rejects(()=>mark([owner.items[0].id],alice),/Account changed/));
    await as(bob,'authenticated',()=>assert.rejects(()=>prefs(false,false,false,false,alice),/Account changed/));
  }finally{await clean();}
});
test('hidden replies, archived posts, private communities, blocked and closed chats do not leak alerts',async()=>{
  const id=await reply();await message();
  try{
    await db.query("update public.answers set status='archived' where id=$1",[id]);
    assert.equal((await as(alice,'authenticated',()=>data())).items.length,1);
    await db.query("update public.answers set status='active' where id=$1",[id]);
    await db.query("update public.questions set status='archived' where id=$1",[q]);
    assert.equal((await as(alice,'authenticated',()=>data())).items.length,1);
    await db.query("update public.questions set status='open' where id=$1",[q]);
    await db.query("insert into public.communities values($1,false,true)",[eve]);await db.query('update public.questions set community_id=$1 where id=$2',[eve,q]);
    assert.equal((await as(alice,'authenticated',()=>data())).items.length,1);
    await db.query('update public.questions set community_id=null where id=$1',[q]);
    await db.query("update public.direct_conversations set request_status='blocked' where id=$1",[chat]);
    let value=await as(alice,'authenticated',()=>data());assert.equal(value.items.length,0);assert.equal(value.unreadMessages,0);
    await db.query("update public.direct_conversations set request_status='declined' where id=$1",[chat]);
    value=await as(alice,'authenticated',()=>data());assert.equal(value.items.length,1);assert.equal(value.unreadMessages,0);
  }finally{await db.query("update public.direct_conversations set request_status='accepted' where id=$1",[chat]);await clean();}
});
test('in-app preferences independently suppress future alerts and email cannot falsely enable',async()=>{
  await db.query('insert into private.notification_preferences(user_id,reply_in_app,message_in_app) values($1,false,true)',[alice]);
  try{
    await reply();await message();let value=await as(alice,'authenticated',()=>data());
    assert.deepEqual(value.items.map(n=>n.kind),['message']);assert.equal(value.emailAvailable,false);
    await db.query('update private.notification_preferences set reply_in_app=true,message_in_app=false where user_id=$1',[alice]);
    await reply();await message();value=await as(alice,'authenticated',()=>data());
    assert.equal(value.items.length,2);assert.equal(value.unreadMessages,2);
    await as(alice,'authenticated',()=>assert.rejects(()=>prefs(true,true,true,false),/not connected/));
    await as(alice,'authenticated',async()=>{await prefs(false,false);assert.equal((await data()).preferences.message_in_app,false);});
  }finally{await clean();}
});
test('bounded pages and input validation; deleting original content removes alert',async()=>{
  for(let i=0;i<25;i++) await reply();
  try{
    await as(alice,'authenticated',async()=>{
      assert.equal((await data()).items.length,21);assert.equal((await data(1)).items.length,5);
    });
    await as(alice,'authenticated',()=>assert.rejects(()=>data(-1),/Invalid/));
    await as(alice,'authenticated',()=>assert.rejects(()=>mark(Array(101).fill(q)),/Invalid/));
    await db.exec('delete from public.answers');assert.equal((await as(alice,'authenticated',()=>data())).items.length,0);
  }finally{await clean();}
});

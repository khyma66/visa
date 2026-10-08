import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = source => ts.transpileModule(source, { compilerOptions: { target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX } }).outputText;
const load = async file => transpile(await readFile(new URL(file,import.meta.url),'utf8'));
const stateUrl=moduleUrl(await load('../src/lib/messaging-state.ts'));
const {getMemberMessageHref,messageLoginHref,normalizeMessageUsername,conversationFolder,canSendToConversation}=await import(stateUrl);
const alice='11111111-1111-4111-8111-111111111111';
const bob='22222222-2222-4222-8222-222222222222';
const conversationId='33333333-3333-4333-8333-333333333333';
const native={id:'44444444-4444-4444-8444-444444444444',author_id:bob,author_username:'bob-test'};
const member={id:bob,username:'bob-test',avatar_seed:'bob'};
const conversation={id:conversationId,other_user_id:bob,other_username:'bob-test',request_status:'pending',requested_by:bob};
let backend;
globalThis.__visaMessageEntryBackend=()=>backend;
let communitySource=await load('../src/lib/community.ts');
const dependencies={
  './post-presentation':moduleUrl(await load('../src/lib/post-presentation.ts')),
  './demo-data':moduleUrl('export const DEMO_ANSWERS=[],DEMO_CONVERSATIONS=[],DEMO_MESSAGES=[],DEMO_QUESTIONS=[],DEMO_USER={};'),
  './supabase/client':moduleUrl('export const isSupabaseConfigured=true;export const getSupabase=()=>globalThis.__visaMessageEntryBackend();'),
  './tagging':moduleUrl('export const inferTags=()=>[],normalizeTags=()=>[];'),
  './discovery':moduleUrl('export const contextTags=()=>[],createDiscoveryIndex=()=>({}),searchTerms=()=>[];'),
  './messaging-state':stateUrl,
};
for(const [name,url] of Object.entries(dependencies)) communitySource=communitySource.replace(`'${name}'`,JSON.stringify(url));
const communityUrl=moduleUrl(communitySource);
const {getMessageRecipient,getMessageEntry,startConversation}=await import(communityUrl);
function stub(profile=member,existing=null,rpcResult=conversationId) {
  const reads=[],writes=[];
  backend={
    from:table=>({select:columns=>({eq:(key,value)=>({maybeSingle:async()=>{
      reads.push({table,columns,key,value});
      return {data:table==='profiles'?profile:existing,error:null};
    }})})}),
    rpc:async(name,args)=>{writes.push({name,args});return{data:rpcResult,error:null};},
  };
  return {reads,writes};
}

test('only genuine native question/reply identities produce author messaging links',()=>{
  assert.equal(getMemberMessageHref(native,alice),`/messages?to=bob-test&member=${bob}`);
  assert.equal(getMemberMessageHref({...native,source:'visaflow'},alice),`/messages?to=bob-test&member=${bob}`);
  for(const extra of [{source:'apify'},{id:'apify-123'},{id:'apify-123',source:'visaflow'},{author_id:'source-123'},{author_username:'facebook name'},{author_username:'bob&member=other'}]) assert.equal(getMemberMessageHref({...native,...extra},alice),null);
  assert.equal(getMemberMessageHref(native,bob),null);
  assert.equal(getMemberMessageHref({...native,source_url:null,source:'apify'},alice),null);
});

test('login preserves the exact member target without allowing external return URLs',()=>{
  const href=messageLoginHref('bob-test',bob);
  assert.equal(new URL(href,'https://visathreads.com').searchParams.get('next'),`/messages?to=bob-test&member=${bob}`);
  assert.equal(new URL(messageLoginHref('//evil.invalid','bad'),'https://visathreads.com').searchParams.get('next'),'/messages');
  assert.equal(new URL(messageLoginHref('bob-test','apify-source'),'https://visathreads.com').searchParams.get('next'),'/messages');
  assert.equal(normalizeMessageUsername(' U/Bob-Test '),'bob-test');
  assert.throws(()=>normalizeMessageUsername('source author'),/registered public username/);
});

test('opening a new member author link verifies the profile and performs no mutations',async()=>{
  const calls=stub();
  assert.deepEqual(await getMessageEntry('bob-test',alice,bob),{member,conversation:null});
  assert.deepEqual(calls.reads,[
    {table:'profiles',columns:'id,username,avatar_seed',key:'username',value:'bob-test'},
    {table:'conversation_inbox',columns:'*',key:'other_user_id',value:bob},
  ]);
  assert.deepEqual(calls.writes,[]);
});

test('existing incoming and closed conversations retain the correct folder; closed requests cannot compose',async()=>{
  for(const status of ['pending','accepted','declined','blocked']) {
    const row={...conversation,request_status:status};
    const calls=stub(member,row);
    const entry=await getMessageEntry('bob-test',alice,bob);
    assert.equal(entry.conversation.id,conversationId);
    assert.equal(conversationFolder(row,alice),status==='pending'?'requests':status==='accepted'?'chats':'closed');
    assert.equal(canSendToConversation(row,alice,[],false),status==='accepted');
    assert.deepEqual(calls.writes,[]);
  }
});

test('a pending sender can send only one introduction and loading does not enable compose',()=>{
  const outgoing={...conversation,requested_by:alice};
  assert.equal(conversationFolder(outgoing,alice),'chats');
  assert.equal(canSendToConversation(outgoing,alice,[],false),true);
  assert.equal(canSendToConversation(outgoing,alice,[{id:'intro'}],false),false);
  assert.equal(canSendToConversation(outgoing,alice,[],true),false);
  assert.equal(canSendToConversation(null,alice,[],false),false);
});

test('invalid/source, removed, mismatched, and self author identities stop before request creation',async()=>{
  let calls=stub();
  await assert.rejects(()=>getMessageRecipient('bob-test','apify-source-id'),/not a registered/);
  assert.deepEqual(calls.reads,[]);
  for(const [profile,expected] of [[null,bob],[member,alice],[{...member,id:'source-user'},undefined]]) {
    calls=stub(profile);
    await assert.rejects(()=>getMessageEntry('bob-test',alice,expected),/unavailable/);
    assert.equal(calls.reads.length,1);assert.deepEqual(calls.writes,[]);
  }
  calls=stub();
  await assert.rejects(()=>getMessageEntry('bob-test',bob,bob),/yourself/);
  assert.equal(calls.reads.length,1);assert.deepEqual(calls.writes,[]);
});

test('explicit requests recheck pinned profile identity and use only the existing protected RPC',async()=>{
  const calls=stub();
  assert.equal(await startConversation(' U/Bob-Test ',bob),conversationId);
  assert.deepEqual(calls.writes,[{name:'start_direct_conversation',args:{other_username:'bob-test'}}]);
  assert.equal(calls.reads.length,1);
  const mismatch=stub({...member,id:alice});
  await assert.rejects(()=>startConversation('bob-test',bob),/unavailable/);
  assert.deepEqual(mismatch.writes,[]);
  stub(member,null,null);
  await assert.rejects(()=>startConversation('bob-test',bob),/Could not open/);
});

let ui=await load('../src/components/MessagesClient.tsx');
const uiDeps={
  'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),react:import.meta.resolve('react'),
  'next/link':moduleUrl(`import React from ${JSON.stringify(import.meta.resolve('react'))};export default function Link(props){return React.createElement('a',props,props.children);}`),
  'lucide-react':import.meta.resolve('lucide-react'),'date-fns':import.meta.resolve('date-fns'),
  '@/lib/community':communityUrl,'@/lib/messaging-state':stateUrl,
  '@/lib/realtime':moduleUrl('export const subscribeLive=()=>()=>{};'),
  './AuthProvider':moduleUrl('export const useAuth=()=>({user:null,loading:false,demoMode:false});'),
};
for(const name of ['Avatar','ReportButton','SafetyNotice']) uiDeps[`./${name}`]=moduleUrl(`export const ${name}=()=>null;`);
for(const [name,url] of Object.entries(uiDeps)) ui=ui.replaceAll(`from '${name}'`,`from ${JSON.stringify(url)}`).replaceAll(`from "${name}"`,`from ${JSON.stringify(url)}`);
const {MessagesClient}=await import(moduleUrl(ui));
test('signed-out inbox renders a login link retaining the selected native author',()=>{
  const html=renderToStaticMarkup(React.createElement(MessagesClient,{recipientUsername:'bob-test',recipientMemberId:bob}));
  assert(html.includes(messageLoginHref('bob-test',bob)));
  assert(html.includes('Log in to see conversations for your account.'));
});

test('background inbox invalidation does not change the manually selected folder',async()=>{
  const source=await readFile(new URL('../src/components/MessagesClient.tsx',import.meta.url),'utf8');
  const refresh=source.slice(source.indexOf('const loadInbox ='),source.indexOf('useEffect(() => {'));
  assert(!refresh.includes('setTab('),'Only explicit open/respond actions should select a folder');
  assert(refresh.includes('openConversation(first, false)'),'Default background selection must preserve the chosen folder too');
  assert(source.includes('navigation === navigationGeneration.current'),'A slow author lookup must not replace an explicitly selected chat');
  assert(source.includes('if (activeRef.current === conversation) setTab('),'A late acceptance response must not change a newly selected chat folder');
  assert(source.includes('generation !== inboxGeneration.current'),'Discard stale inbox reads after an explicit selection');
});

test('account transitions remount all inbox state before another identity can render it',async()=>{
  const provider=await readFile(new URL('../src/components/AuthProvider.tsx',import.meta.url),'utf8');
  assert(provider.includes("<Fragment key={user?.id ?? 'signed-out'}>{children}</Fragment>"));
  const source=await readFile(new URL('../src/components/MessagesClient.tsx',import.meta.url),'utf8');
  assert(source.includes('if (activeRef.current !== conversation.id)'));
  assert(source.includes("setMessages([]); setBody(''); setHasOlder(false); setMessagesLoading(true);"),'Explicit chat switches clear the previous chat and draft before rendering the next');
});

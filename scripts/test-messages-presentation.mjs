import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Render the real component with local, deterministic hooks. No network or real
// inbox is accessed; async handlers update this fixture for the next render.
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const source = await readFile(new URL('../src/components/MessagesClient.tsx', import.meta.url), 'utf8');
const stateNames = [...source.matchAll(/const \[([A-Za-z]+), set[A-Za-z]+\] = useState/g)].map(match => match[1]);
const reactUrl = import.meta.resolve('react');
const linkUrl = moduleUrl(`import React from ${JSON.stringify(reactUrl)};export default props=>React.createElement('a',props,props.children);`);
const apiNames = ['getConversation', 'getConversationCounts', 'getConversationMessageCount', 'getMessageEntry', 'getMessageRecipient', 'listConversationFolder', 'listMessages', 'markConversationRead', 'refreshMessages', 'respondToConversation', 'sendMessage', 'startConversation'];
const dependencies = {
  react: moduleUrl(`
    export const useCallback=fn=>fn;
    export const useEffect=effect=>{globalThis.__messagesPresentation.effects.push(effect);};
    export const useState=initial=>{const fixture=globalThis.__messagesPresentation;const i=fixture.stateIndex++;
      if(!Object.hasOwn(fixture.state,i))fixture.state[i]=typeof initial==='function'?initial():initial;
      return [fixture.state[i],value=>{fixture.state[i]=typeof value==='function'?value(fixture.state[i]):value;}];};
    export const useRef=initial=>{const fixture=globalThis.__messagesPresentation;const i=fixture.refIndex++;
      return fixture.refs[i]??=( {current:initial} );};
  `),
  'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'),
  'next/link': linkUrl,
  'lucide-react': import.meta.resolve('lucide-react'),
  'date-fns': import.meta.resolve('date-fns'),
  '@/lib/community': moduleUrl(apiNames.map(name => `export const ${name}=(...args)=>{const fixture=globalThis.__messagesPresentation;fixture.calls.push([${JSON.stringify(name)},args]);if(!fixture.api[${JSON.stringify(name)}])throw new Error('Unexpected API call: ${name}');return fixture.api[${JSON.stringify(name)}](...args);};`).join('\n')),
  '@/lib/messaging-state': moduleUrl(transpile(await readFile(new URL('../src/lib/messaging-state.ts', import.meta.url), 'utf8'))),
  './AuthProvider': moduleUrl('export const useAuth=()=>globalThis.__messagesPresentation.auth;'),
  './Avatar': moduleUrl(`import React from ${JSON.stringify(reactUrl)};export const Avatar=()=>React.createElement('span',{'data-avatar':true});`),
  './ReportButton': moduleUrl(`import React from ${JSON.stringify(reactUrl)};export const ReportButton=props=>React.createElement('button',{'data-report-target':props.target},'Report');`),
  '@/lib/realtime': moduleUrl('export const subscribeLive=(topics,callback)=>{const fixture=globalThis.__messagesPresentation;fixture.subscriptions.push({topics,callback});return ()=>{};};'),
};
let code = transpile(source);
for (const [specifier, replacement] of Object.entries(dependencies)) code = code.replaceAll(`from '${specifier}'`, `from ${JSON.stringify(replacement)}`).replaceAll(`from "${specifier}"`, `from ${JSON.stringify(replacement)}`);
const { MessagesClient } = await import(moduleUrl(code));
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const conversation = (id, status = 'accepted', requestedBy = alice) => ({ id, other_user_id: bob, other_username: `${id}-member`, other_avatar_seed: id, request_status: status, requested_by: requestedBy, unread_count: 0, last_message: null, last_message_at: '2026-01-01T12:00:00Z' });
const message = (id, sender = alice, extra = {}) => ({ id, conversation_id: 'accepted', sender_id: sender, body: `${id} text`, created_at: '2026-01-01T12:00:00Z', read_at: null, ...extra });

function fixture(values = {}, auth = {}) {
  const state = {};
  for (const [name, value] of Object.entries(values)) {
    assert(stateNames.includes(name), `Unknown state: ${name}`);
    state[stateNames.indexOf(name)] = value;
  }
  return { state, refs: [], effects: [], calls: [], subscriptions: [], api: { getConversationCounts: async () => ({ chats: 0, requests: 0, closed: 0 }) }, stateIndex: 0, refIndex: 0, auth: { user: { id: alice }, loading: false, demoMode: false, ...auth } };
}
function render(f, props = {}) {
  globalThis.__messagesPresentation = f;
  f.stateIndex = 0; f.refIndex = 0; f.effects = [];
  const tree = MessagesClient(props);
  return { tree, html: renderToStaticMarkup(tree) };
}
function nodes(tree, predicate) {
  if (!React.isValidElement(tree)) return [];
  return [...(predicate(tree) ? [tree] : []), ...React.Children.toArray(tree.props.children).flatMap(child => nodes(child, predicate))];
}
function button(tree, label) {
  return nodes(tree, item => item.type === 'button').find(item => item.props['aria-label'] === label || React.Children.toArray(item.props.children).join('') === label);
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('messages waits for auth and signed-out accounts cannot see cached conversation text', () => {
  const cached = { conversations: [conversation('accepted')], activeId: 'accepted', messages: [message('private-secret')] };
  const loading = render(fixture(cached, { loading: true })).html;
  assert.match(loading, /Loading messages/);
  assert.doesNotMatch(loading, /private-secret|accepted-member/);
  const signedOut = render(fixture(cached, { user: null }), { recipientUsername: 'bob-member', recipientMemberId: bob }).html;
  assert.match(signedOut, /Log In to see conversations for your account/);
  assert.match(signedOut, /href="\/login\?next=%2Fmessages%3Fto%3Dbob-member%26member%3D22222222/);
  assert.doesNotMatch(signedOut, /private-secret|accepted-member|New Chat Request/);
  assert.doesNotMatch(signedOut, /Protect yourself in messages|Community Safety reminders/);
});

test('initial inbox waits for results rather than showing a false empty folder', () => {
  const { html } = render(fixture());
  assert.match(html, /Not end-to-end encrypted/);
  assert.match(html, /Loading conversations/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /No chats yet/);
});

test('failed inbox has a usable retry and only confirmed empty results show the empty state', async () => {
  const f = fixture();
  f.api.listConversationFolder = async () => { throw new Error('Sensitive backend detail'); };
  render(f); f.effects[0](); await flush();
  let output = render(f);
  assert.match(output.html, /role="alert"/);
  assert.match(output.html, /couldn’t load your conversations/);
  assert.doesNotMatch(output.html, /Sensitive backend detail|No chats yet/);
  f.api.listConversationFolder = async () => ({ conversations: [], hasOlder: false });
  button(output.tree, 'Retry inbox').props.onClick(); await flush();
  output = render(f);
  assert.match(output.html, /No chats yet/);
  assert.doesNotMatch(output.html, /Retry inbox|Loading conversations/);
});

test('pagination cannot invalidate an in-flight inbox refresh or leave its loading state stuck', async () => {
  const row = conversation('outgoing', 'pending');
  const f = fixture({ conversations: [row], inboxHasOlder: true });
  let completeRefresh;
  f.api.listConversationFolder = () => new Promise(resolve => { completeRefresh = resolve; });
  const output = render(f); f.effects[0]();
  const earlier = button(output.tree, 'Load earlier conversations');
  assert.equal(earlier.props.disabled, true);
  earlier.props.onClick();
  assert.deepEqual(f.calls.map(([name]) => name), ['listConversationFolder', 'getConversationCounts']);
  completeRefresh({ conversations: [row], reset: true, hasOlder: true }); await flush();
  const refreshed = render(f);
  assert.equal(button(refreshed.tree, 'Load earlier conversations').props.disabled, false);
  assert.match(refreshed.html, /aria-busy="false"/);
});

test('refresh superseding an older-page request settles both loading indicators', async () => {
  const row = conversation('outgoing', 'pending');
  const f = fixture({ conversations: [row], inboxHasOlder: true, inboxLoading: false });
  let completeOlder, completeRefresh;
  f.api.listConversationFolder = (_folder, _userId, cursor) => new Promise(resolve => { if (cursor) completeOlder = resolve; else completeRefresh = resolve; });
  const output = render(f);
  button(output.tree, 'Load earlier conversations').props.onClick();
  f.effects[0]();
  completeOlder({ conversations: [conversation('stale-older')], hasOlder: false }); await flush();
  completeRefresh({ conversations: [row], reset: true, hasOlder: true }); await flush();
  const refreshed = render(f);
  assert.equal(button(refreshed.tree, 'Load earlier conversations').props.disabled, false);
  assert.match(refreshed.html, /aria-busy="false"/);
  assert.doesNotMatch(refreshed.html, /stale-older-member/);
});

test('folder empty states explain next steps without hiding older pages', () => {
  for (const [tab, title] of [['chats', 'No chats yet'], ['requests', 'No message requests'], ['closed', 'No closed conversations']]) {
    const empty = render(fixture({ tab, inboxLoading: false })).html;
    assert(empty.includes(title));
    const paged = render(fixture({ tab, inboxLoading: false, inboxHasOlder: true })).html;
    assert.match(paged, /on this page/);
    assert.match(paged, /Load earlier conversations to check this folder’s older history/);
    assert.match(paged, /Load earlier conversations<\/button>/);
    assert.doesNotMatch(paged, /No chats yet/);
  }
});

test('Chats, Requests and Closed render only the matching conversation rows', () => {
  const conversations = [conversation('accepted'), conversation('outgoing', 'pending'), conversation('incoming', 'pending', bob), conversation('blocked', 'blocked'), conversation('declined', 'declined')];
  for (const [tab, present, absent] of [
    ['chats', ['accepted', 'outgoing'], ['incoming', 'blocked', 'declined']],
    ['requests', ['incoming'], ['accepted', 'outgoing', 'blocked', 'declined']],
    ['closed', ['blocked', 'declined'], ['accepted', 'outgoing', 'incoming']],
  ]) {
    const { html } = render(fixture({ conversations, tab, inboxLoading: false, folderCounts: { chats: 2, requests: 1, closed: 2 } }));
    for (const id of present) assert(html.includes(`u/${id}-member`));
    for (const id of absent) assert(!html.includes(`u/${id}-member`));
    assert.match(html, /aria-label="requests conversation count"[^>]*>1<\/span>/);
    assert.match(html, /Choose a conversation/);
  }
});

test('folder totals remain exact beyond fifty rows while unread counts are separately labeled', () => {
  const rows = Array.from({ length: 50 }, (_, i) => conversation(`chat-${i}`));
  rows[0].unread_count = 12;
  const { html } = render(fixture({ conversations: rows, inboxLoading: false, inboxHasOlder: true, folderCounts: { chats: 253, requests: 72, closed: 19 } }));
  assert.match(html, /aria-label="chats conversation count"[^>]*>253<\/span>/);
  assert.match(html, /aria-label="requests conversation count"[^>]*>72<\/span>/);
  assert.match(html, /50 of 253 conversations shown/);
  assert.match(html, /aria-label="12 unread messages"/);
  assert.match(html, />12 unread<\/span>/);
  assert.doesNotMatch(html, /72\+/);
});

test('folder selection queries matching rows directly, not the global first fifty', async () => {
  const f = fixture({ conversations: [conversation('chat')], inboxLoading: false, folderCounts: { chats: 253, requests: 1, closed: 0 } });
  f.api.getConversationCounts = async () => ({ chats: 253, requests: 1, closed: 0 });
  f.api.listConversationFolder = async (folder, userId) => {
    assert.equal(folder, 'requests'); assert.equal(userId, alice);
    return { conversations: [conversation('old-request', 'pending', bob)], hasOlder: false };
  };
  button(render(f).tree, 'requests').props.onClick();
  render(f); f.effects[0](); await flush();
  const { html } = render(f);
  assert.match(html, /u\/old-request-member/);
  assert.match(html, /1 of 1 requests shown/);
  assert.doesNotMatch(html, /u\/chat-member|Load earlier conversations/);
});

test('conversation total is distinct from visible message count and full history remains pageable', () => {
  const row = conversation('accepted');
  const messages = Array.from({ length: 50 }, (_, i) => message(`body-${i}`));
  const { html } = render(fixture({ conversations: [row], activeId: row.id, messages, messageTotal: 152, hasOlder: true, inboxLoading: false }));
  assert.match(html, /50 of 152 messages shown/);
  assert.match(html, /Load earlier messages/);
  assert.equal((html.match(/class="whitespace-pre-wrap break-words"/g) ?? []).length, 50);
  const full = render(fixture({ conversations: [row], activeId: row.id, messages: [...messages, message('last')], messageTotal: 51, hasOlder: false, inboxLoading: false })).html;
  assert.match(full, /51 of 51 messages shown/);
  assert.doesNotMatch(full, /Load earlier messages/);
});

test('a stale failed history refresh cannot erase a newer exact message count', async () => {
  const row = conversation('accepted');
  const f = fixture({ conversations: [row], activeId: row.id, inboxLoading: false });
  const previousDocument = globalThis.document;
  globalThis.document = { visibilityState: 'hidden' };
  let rejectFirst, refreshes = 0, cleanup;
  f.api.refreshMessages = () => ++refreshes === 1 ? new Promise((_resolve, reject) => { rejectFirst = reject; })
    : Promise.resolve({ messages: [message('newest')], reset: true, hasOlder: false });
  f.api.getConversationMessageCount = async () => 1;
  try {
    render(f); cleanup = f.effects[2]();
    f.subscriptions.find(item => item.topics.includes('conversation:accepted')).callback(); await flush();
    assert.match(render(f).html, /1 of 1 messages shown/);
    rejectFirst(new Error('obsolete refresh failure')); await flush();
    const { html } = render(f);
    assert.match(html, /1 of 1 messages shown/);
    assert.doesNotMatch(html, /obsolete refresh failure/);
    assert.equal(f.state[stateNames.indexOf('messagesLoading')], false);
  } finally { cleanup?.(); globalThis.document = previousDocument; }
});

test('read receipt failure preserves successfully loaded history and its exact count', async () => {
  const row = conversation('accepted');
  const f = fixture({ conversations: [row], activeId: row.id, inboxLoading: false });
  const previousDocument = globalThis.document;
  globalThis.document = { visibilityState: 'visible' };
  f.api.refreshMessages = async () => ({ messages: [message('received', bob)], reset: true, hasOlder: false });
  f.api.getConversationMessageCount = async () => 1;
  f.api.markConversationRead = async () => { throw new Error('Internal receipt failure'); };
  let cleanup;
  try {
    render(f); cleanup = f.effects[2](); await flush();
    const { html } = render(f);
    assert.match(html, /1 of 1 messages shown/);
    assert.match(html, /received text/);
    assert.match(html, /Messages loaded, but read receipts could not be updated/);
    assert.doesNotMatch(html, /Internal receipt failure/);
    assert.equal(f.state[stateNames.indexOf('messagesLoading')], false);
    assert.equal(f.calls.filter(([name]) => name === 'markConversationRead').length, 1);
  } finally { cleanup?.(); globalThis.document = previousDocument; }
});

test('reading an older page refreshes the inbox unread badge without losing the history total', async () => {
  const row = { ...conversation('accepted'), unread_count: 1 };
  const f = fixture({ conversations: [row], activeId: row.id, messages: [message('newest')], messageTotal: 2, hasOlder: true, inboxLoading: false });
  const previousDocument = globalThis.document;
  globalThis.document = { visibilityState: 'visible' };
  f.api.listMessages = async () => [message('earlier', bob)];
  f.api.markConversationRead = async () => {};
  f.api.listConversationFolder = async () => ({ conversations: [{ ...row, unread_count: 0 }], hasOlder: false });
  f.api.getConversationCounts = async () => ({ chats: 1, requests: 0, closed: 0 });
  try {
    button(render(f).tree, 'Load earlier messages').props.onClick(); await flush();
    const { html } = render(f);
    assert.match(html, /2 of 2 messages shown/);
    assert.doesNotMatch(html, /aria-label="1 unread messages"|Load earlier messages/);
    assert.equal(f.calls.filter(([name]) => name === 'listConversationFolder').length, 1);
    assert.equal(f.calls.filter(([name]) => name === 'markConversationRead').length, 1);
  } finally { globalThis.document = previousDocument; }
});

test('pending requests require acceptance; closed conversations cannot send', () => {
  const incoming = conversation('incoming', 'pending', bob);
  const request = render(fixture({ conversations: [incoming], activeId: incoming.id, inboxLoading: false }));
  assert(button(request.tree, 'Accept request'));
  assert(button(request.tree, 'Decline'));
  assert(!button(request.tree, 'Send message'));
  for (const status of ['blocked', 'declined']) {
    const row = conversation(status, status);
    const output = render(fixture({ conversations: [row], activeId: row.id, inboxLoading: false }));
    assert(!button(output.tree, 'Send message'));
    assert(!button(output.tree, 'Block'));
    assert.match(output.html, status === 'blocked' ? /No more messages can be sent/ : /request was declined/);
  }
});

test('outgoing requests allow one introduction and loaded accepted chats allow replies', () => {
  const pending = conversation('outgoing', 'pending');
  const values = { conversations: [pending], activeId: pending.id, body: 'Hello', inboxLoading: false };
  assert.equal(button(render(fixture(values)).tree, 'Send message').props.disabled, false);
  assert.equal(button(render(fixture({ ...values, messages: [message('introduction')] })).tree, 'Send message').props.disabled, true);
  assert.equal(button(render(fixture({ ...values, messagesLoading: true })).tree, 'Send message').props.disabled, true);
  const accepted = conversation('accepted');
  assert.equal(button(render(fixture({ ...values, conversations: [accepted], activeId: accepted.id, messages: [message('earlier')] })).tree, 'Send message').props.disabled, false);
});

test('read receipts and report controls display for the correct sender', () => {
  const row = conversation('accepted');
  const { html } = render(fixture({ conversations: [row], activeId: row.id, messages: [message('own-sent'), message('own-read', alice, { read_at: '2026-01-01' }), message('received', bob)], inboxLoading: false }));
  assert.match(html, /· Sent/);
  assert.match(html, /· Read/);
  assert.match(html, /data-report-target="received"/);
  assert.doesNotMatch(html, /data-report-target="own-/);
});

test('late author-link lookup never overrides an explicitly chosen folder or sends a request', async () => {
  const f = fixture({ inboxLoading: false });
  let complete;
  f.api.getMessageEntry = () => new Promise(resolve => { complete = resolve; });
  const props = { recipientUsername: 'bob-member', recipientMemberId: bob };
  let output = render(f, props); f.effects[1]();
  button(output.tree, 'closed').props.onClick();
  complete({ member: { id: bob, username: 'bob-member', avatar_seed: 'bob' }, conversation: conversation('existing') });
  await flush(); output = render(f, props);
  assert.equal(f.state[stateNames.indexOf('tab')], 'closed');
  assert.equal(f.state[stateNames.indexOf('activeId')], '');
  assert.match(output.html, /Member found: u\/bob-member/);
  assert.deepEqual(f.calls.map(([name]) => name), ['getMessageEntry']);
});

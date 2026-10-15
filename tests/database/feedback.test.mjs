import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111';
const member = '22222222-2222-4222-8222-222222222222';
const moderator = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
let target;
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const submit = (id = requestId, category = 'idea', message = 'Please improve the experience filter.', section = 'experiences') => scalar('select public.feedback_submit($1,$2,$3,$4)', [id, category, message, section]);
const review = (action, version = 1, plan = '') => scalar('select public.feedback_review($1,$2,$3,$4)', [target, version, action, plan]);
async function asUser(user, fn, role = 'authenticated') {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user ?? '']);
    await db.exec(`set local role ${role}`);
    return await fn();
  } finally { await db.exec('rollback'); }
}
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    create schema private; grant usage on schema private to authenticated;
    create table private.community_suspensions(user_id uuid primary key);
    create table private.community_moderators(user_id uuid primary key);
    create table private.community_rate_windows(user_id uuid,action text,window_start timestamptz,used integer,primary key(user_id,action));`);
  const existing = await readFile(new URL('../../supabase/migrations/20260910055528_launch_safety_and_moderation.sql', import.meta.url), 'utf8');
  await db.exec(existing.slice(existing.indexOf('create function private.community_consume('), existing.indexOf('create function private.community_write_guard()')));
  await db.exec('revoke all on function private.community_consume(text,integer,integer) from public,anon,authenticated;');
  await db.exec(await readFile(new URL('../../supabase/migrations/20261013191116_private_owner_feedback.sql', import.meta.url), 'utf8'));
  await db.query('insert into auth.users values($1),($2),($3)', [owner, member, moderator]);
  await db.query('insert into private.feedback_owner(user_id) values($1)', [owner]);
  await db.query('insert into private.community_moderators values($1)', [moderator]);
  target = await scalar(`insert into private.feedback_items(submitter_id,request_id,category,message,section)
    values($1,$2,'idea','Seeded owner-only suggestion.','home') returning id`, [member, crypto.randomUUID()]);
});
after(() => db.close());

for (const role of ['anon', 'authenticated', 'service_role']) {
  for (const table of ['feedback_owner', 'feedback_items', 'feedback_events']) {
    test(`${role} cannot directly read ${table}`, () => asUser(member, async () => {
      await assert.rejects(() => db.query(`select * from private.${table}`), /permission denied/);
    }, role));
  }
}
for (const rpc of ['feedback_is_owner()', 'feedback_submit(null,null,null,null)', 'feedback_inbox()', 'feedback_review(null,1,null)', 'feedback_history(null)']) {
  test(`anonymous API cannot execute ${rpc}`, () => asUser(null, async () => {
    await assert.rejects(() => db.query(`select public.${rpc}`), /permission denied/);
  }, 'anon'));
}
const feedbackRpcs = [
  ['feedback_is_owner()', 'feedback_is_owner()'],
  ['feedback_submit(uuid,text,text,text)', 'feedback_submit(null,null,null,null)'],
  ['feedback_inbox(text,timestamptz,uuid)', 'feedback_inbox(null,null,null)'],
  ['feedback_review(uuid,integer,text,text)', "feedback_review(null,1,'approve','')"],
  ['feedback_history(uuid)', 'feedback_history(null)'],
];
for (const schema of ['public', 'private']) {
  for (const [signature, call] of feedbackRpcs) {
    test(`service_role has no execute privilege on ${schema}.${signature}`, async () => {
      // Check the actual function ACL as well as the call: a missing schema
      // USAGE privilege alone must not conceal an accidental EXECUTE grant.
      assert.equal(await scalar("select has_function_privilege('service_role',$1,'EXECUTE')", [`${schema}.${signature}`]), false);
      await asUser(owner, async () => {
        await assert.rejects(() => db.query(`select ${schema}.${call}`), /permission denied/);
      }, 'service_role');
    });
  }
  test(`authenticated account without a user ID is not an owner via ${schema}`, () => asUser(null, async () => {
    assert.equal(await scalar(`select ${schema}.feedback_is_owner()`), false);
  }));
  for (const [, call] of feedbackRpcs.slice(1)) {
    test(`authenticated account without a user ID cannot call ${schema}.${call}`, () => asUser(null, async () => {
      await assert.rejects(() => db.query(`select ${schema}.${call}`), /Sign in to send feedback|Owner access required/);
    }));
  }
}
for (const who of [member, moderator]) {
  test(`${who === member ? 'member' : 'moderator'} cannot read owner inbox or become owner`, () => asUser(who, async () => {
    assert.equal(await scalar('select public.feedback_is_owner()'), false);
    await assert.rejects(() => db.query('select public.feedback_inbox()'), /Owner access required/);
  }));
  test(`${who} cannot read history`, () => asUser(who, async () => {
    await assert.rejects(() => db.query('select public.feedback_history($1)', [target]), /Owner access required/);
  }));
  test(`${who} cannot review feedback by guessing its ID`, () => asUser(who, async () => {
    await assert.rejects(() => review('approve'), /Owner access required/);
  }));
  for (const rpc of ['feedback_inbox(null,null,null)', 'feedback_history(null)', "feedback_review(null,1,'approve','')"]) {
    test(`${who === member ? 'member' : 'moderator'} cannot bypass the wrapper with private.${rpc}`, () => asUser(who, async () => {
      await assert.rejects(() => db.query(`select private.${rpc}`), /Owner access required/);
    }));
  }
}
test('no user can self-enroll as owner', () => asUser(member, async () => {
  await assert.rejects(() => db.query('insert into private.feedback_owner(user_id) values($1)', [member]), /permission denied/);
}));
for (const [action, sql] of [
  ['replace', 'update private.feedback_owner set user_id=$1'],
  ['remove', 'delete from private.feedback_owner where user_id=$1'],
]) {
  test(`a member cannot ${action} the configured owner`, () => asUser(member, async () => {
    await assert.rejects(() => db.query(sql, [action === 'replace' ? member : owner]), /permission denied/);
  }));
}
test('there can only be one owner', async () => {
  await assert.rejects(() => db.query('insert into private.feedback_owner(user_id) values($1)', [member]), /duplicate key/);
});
test('forged user metadata does not grant owner access', () => asUser(member, async () => {
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: member, user_metadata: { owner: true, role: 'admin', email: 'owner@example.com' } })]);
  assert.equal(await scalar('select public.feedback_is_owner()'), false);
}));
test('owner has no direct write bypass', () => asUser(owner, async () => {
  await assert.rejects(() => db.query("update private.feedback_items set status='approved'"), /permission denied/);
}));
test('submit is private, trims message, and is idempotent', () => asUser(member, async () => {
  const first = await submit();
  assert.equal(first, await submit());
  assert.match(first, /^[0-9a-f-]{36}$/);
}));
test('a retry ID cannot be reused for different content', () => asUser(member, async () => {
  await submit();
  await assert.rejects(() => submit(requestId, 'bug'), /request was already used/);
}));
test('rate limit is enforced per account and duplicate retries do not use quota', () => asUser(member, async () => {
  await submit(); for (let i = 0; i < 8; i++) await submit();
  for (let i = 0; i < 4; i++) await submit(crypto.randomUUID());
  await assert.rejects(() => submit(crypto.randomUUID()), /Too many requests/);
}));
for (const args of [[null], [requestId, 'admin'], [requestId, 'idea', 'short'], [requestId, 'idea', 'x'.repeat(3001)], [requestId, 'idea', 'Long enough text here', 'https://secret.example/?token=secret']]) {
  test(`server rejects malformed feedback ${JSON.stringify(args).slice(0,80)}`, () => asUser(member, async () => {
    await assert.rejects(() => submit(...args), /Check your feedback fields/);
  }));
}
test('suspensions prevent submitting and owner access', async () => {
  await db.exec('begin');
  try {
    await db.query('insert into private.community_suspensions values($1)', [owner]);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
    await db.exec('set local role authenticated');
    assert.equal(await scalar('select public.feedback_is_owner()'), false);
    await assert.rejects(() => submit(), /unavailable for this account/);
  } finally { await db.exec('rollback'); }
});
test('unconfigured owner fails closed rather than collecting unattended submissions', async () => {
  await db.exec('begin');
  try {
    await db.exec('delete from private.feedback_owner');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [member]);
    await db.exec('set local role authenticated');
    await assert.rejects(() => submit(), /not available yet/);
  } finally { await db.exec('rollback'); }
});
for (const schema of ['public', 'private']) {
  for (const rpc of ['feedback_inbox(null,null,null)', 'feedback_history(null)', "feedback_review(null,1,'approve','')"]) {
    test(`owner revocation immediately blocks ${schema}.${rpc} without refreshing claims`, async () => {
      await db.exec('begin');
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
        assert.equal(await scalar('select public.feedback_is_owner()'), true);
        await db.exec('delete from private.feedback_owner');
        await db.exec('set local role authenticated');
        assert.equal(await scalar('select public.feedback_is_owner()'), false);
        await assert.rejects(() => db.query(`select ${schema}.${rpc}`), /Owner access required/);
      } finally { await db.exec('rollback'); }
      assert.equal(await scalar('select user_id from private.feedback_owner'), owner);
    });
  }
}
test('owner inbox omits submitter identity and request tokens', () => asUser(owner, async () => {
  assert.equal(await scalar('select public.feedback_is_owner()'), true);
  const items = await scalar('select public.feedback_inbox()');
  assert.equal(items.length, 1); assert.equal(items[0].id, target);
  assert(!('submitter_id' in items[0])); assert(!('request_id' in items[0]));
}));
test('owner inbox uses bounded keyset pagination across timestamp ties', async () => {
  await db.exec('begin');
  try {
    await db.query(`insert into private.feedback_items(submitter_id,request_id,category,message,section)
      select $1,gen_random_uuid(),'idea','Pagination fixture suggestion','home' from generate_series(1,54)`, [member]);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
    await db.exec('set local role authenticated');
    let cursor = null; const ids = [];
    for (let page = 0; page < 4; page++) {
      const rows = await scalar('select public.feedback_inbox(null,$1,$2)', [cursor?.created_at ?? null, cursor?.id ?? null]);
      assert(rows.length <= 21); ids.push(...rows.slice(0,20).map(row => row.id));
      if (rows.length < 21) break;
      cursor = rows[19];
    }
    assert.equal(ids.length, 55); assert.equal(new Set(ids).size,55);
  } finally { await db.exec('rollback'); }
});
test('review lifecycle records version-specific approval and revokes it when plan changes', () => asUser(owner, async () => {
  await review('review');
  await review('save_plan', 2, 'Add a clearer filter; test keyboard use; rollback the UI commit.');
  await review('approve', 3);
  let item = (await scalar('select public.feedback_inbox()'))[0];
  assert.equal(item.status,'approved'); assert.equal(item.approved_plan_version,1); assert(item.approved_at);
  await review('save_plan', 4, 'Revised filter plan with tests, risk checks, and a rollback.');
  item = (await scalar('select public.feedback_inbox()'))[0];
  assert.equal(item.status,'planned'); assert.equal(item.plan_version,2); assert.equal(item.approved_at,null); assert.equal(item.approved_plan_version,null);
  await review('approve', 5); await review('complete', 6);
  item = (await scalar('select public.feedback_inbox()'))[0];
  assert.equal(item.status,'done');
  const events = await scalar('select public.feedback_history($1)',[target]);
  assert.equal(events.length,6); assert.equal(events[0].action,'complete'); assert(!('actor_id' in events[0]));
  await review('reopen', 7); assert.equal((await scalar('select public.feedback_inbox()'))[0].approved_at,null);
}));
for (const action of ['approve','complete','deploy']) test(`cannot skip plan/review gates with ${action}`, () => asUser(owner, async () => {
  await assert.rejects(() => review(action), /Save a plan|Approve the current plan|Invalid review action/);
}));
test('concurrent stale review cannot overwrite a newer decision', () => asUser(owner, async () => {
  await review('review');
  await assert.rejects(() => review('decline',1), /Feedback changed/);
}));
test('review filter is applied on server', () => asUser(owner, async () => {
  await review('decline');
  assert.equal((await scalar("select public.feedback_inbox('new')")).length,0);
  assert.equal((await scalar("select public.feedback_inbox('declined')")).length,1);
}));

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const feedbackSource = await readFile(new URL('../../src/lib/feedback.ts',import.meta.url),'utf8');
const feedbackUrl = moduleUrl(transpile(feedbackSource.replace("import { getSupabase } from './supabase/client';", 'const getSupabase=()=>globalThis.__feedbackBackend;')));
const feedback = await import(feedbackUrl);
test('section context excludes query secrets, private IDs and external URLs', () => {
  for (const [input, expected] of [['/','home'],['/questions/private-id?q=case#secret','questions'],['/messages/secret-id','messages'],['/account/recovery?token=secret','account'],['https://external.example/','general'],['//evil.example','general'],['/unknown/private','general'],['/privacy','policies']]) assert.equal(feedback.feedbackSection(input),expected);
});
test('errors never render raw database, credential or infrastructure text', () => {
  assert(!feedback.feedbackError({message:'postgres://password-secret'}).includes('password-secret'));
  assert(feedback.feedbackError({code:'40001'}).includes('another tab'));
});
test('client RPC sends only whitelisted feedback fields with a timeout', async () => {
  let input;
  globalThis.__feedbackBackend={rpc(name,args){input={name,args}; return {async abortSignal(signal){assert(signal instanceof AbortSignal);return {data:requestId,error:null};}};}};
  try {
    assert.equal(await feedback.sendFeedback(requestId,'idea','  useful message  ','home'),requestId);
    assert.deepEqual(input,{name:'feedback_submit',args:{client_request_id:requestId,feedback_category:'idea',feedback_message:'useful message',page_section:'home'}});
  } finally {delete globalThis.__feedbackBackend;}
});
test('client pages twenty visible rows using a lookahead cursor', async () => {
  globalThis.__feedbackBackend={rpc(){return {async abortSignal(){return {data:Array.from({length:21},(_,i)=>({id:String(i),created_at:'2026-10-13'})),error:null};}};}};
  try {const page=await feedback.getFeedbackInbox('');assert.equal(page.items.length,20);assert(page.more);assert.equal(page.cursor.id,'19');}
  finally {delete globalThis.__feedbackBackend;}
});
const deps={
  react:import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'lucide-react':import.meta.resolve('lucide-react'),
  'next/link':moduleUrl(`import React from ${JSON.stringify(import.meta.resolve('react'))};export default function Link(props){return React.createElement('a',props,props.children);}`),
  'next/navigation':moduleUrl("export const usePathname=()=>'/news';"),
  './AuthProvider':moduleUrl('export const useAuth=()=>globalThis.__feedbackAuth;'),
  '@/lib/feedback':feedbackUrl,
};
function componentModule(source, dependencies = deps) {
  let compiled = transpile(source);
  for (const [key, value] of Object.entries(dependencies)) compiled = compiled.replaceAll(`from '${key}'`, `from ${JSON.stringify(value)}`).replaceAll(`from "${key}"`, `from ${JSON.stringify(value)}`);
  return moduleUrl(compiled);
}
const formSource = await readFile(new URL('../../src/components/FeedbackForm.tsx',import.meta.url),'utf8');
const formUrl = componentModule(formSource);
const {FeedbackForm}=await import(formUrl);
function assertNeutralFeedbackCopy(text) {
  // Keep the sensitive-data warning and privacy disclosure; prohibit the
  // unnecessary ownership/private labels in rendered copy and metadata.
  const normalized = text.replace(/private conversations/gi, 'conversations');
  assert.doesNotMatch(normalized, /\bowner\b|\bprivate(?:ly)?\b/i);
}
test('guest feedback entry offers login and a no-account help fallback',()=>{
  globalThis.__feedbackAuth={user:null,loading:false,demoMode:false};
  try {
    const html=renderToStaticMarkup(React.createElement(FeedbackForm));
    assert(html.includes('/login?next=%2Ffeedback#sign-in'));assert(html.includes('/contact'));assert(!html.includes('<textarea'));
    assertNeutralFeedbackCopy(html.replace(/<[^>]*>/g, ' '));
  } finally { delete globalThis.__feedbackAuth; }
});
test('signed-in form has limits, privacy disclosure and no owner controls',()=>{
  globalThis.__feedbackAuth={user:{id:member},loading:false,demoMode:false};
  try {
    const html=renderToStaticMarkup(React.createElement(FeedbackForm,{section:'messages'}));
    assert(html.includes('maxLength="3000"'));assert(html.includes('/feedback/privacy'));assert(html.includes('Include section:'));
    assert(html.includes('Send Feedback'));assert(html.includes('private conversations'));
    assert(!html.includes('Approve'));assert(!html.includes('owner/feedback'));
    assertNeutralFeedbackCopy(html.replace(/<[^>]*>/g, ' '));
  } finally { delete globalThis.__feedbackAuth; }
});
test('feedback receipt confirms submission without ownership or privacy marketing', async () => {
  // Exercise the real receipt branch with only its initial state preloaded.
  // No network submission or live user record is needed for this presentation test.
  const receiptSource = formSource.replace("const [receipt, setReceipt] = useState('');", `const [receipt, setReceipt] = useState('${requestId}');`);
  assert.notEqual(receiptSource, formSource, 'Receipt preload must match the component state declaration');
  const { FeedbackForm: ReceiptForm } = await import(componentModule(receiptSource));
  globalThis.__feedbackAuth = { user: { id: member }, loading: false, demoMode: false };
  try {
    const html = renderToStaticMarkup(React.createElement(ReceiptForm));
    assert(html.includes('Thanks for helping us improve'));assert(html.includes(requestId));assert(!html.includes('<textarea'));
    assertNeutralFeedbackCopy(html.replace(/<[^>]*>/g, ' '));
  } finally { delete globalThis.__feedbackAuth; }
});
const feedbackUiFiles = [
  'src/components/FeedbackForm.tsx', 'src/components/FeedbackLauncher.tsx', 'src/components/FeedbackInbox.tsx',
  'src/app/feedback/page.tsx', 'src/app/feedback/privacy/page.tsx', 'src/app/owner/feedback/page.tsx',
];
for (const file of feedbackUiFiles) {
  test(`${file} has neutral feedback labels, tooltips, receipts and metadata`, async () => {
    const source = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visibleCopy = [];
    function visit(node) {
      if (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        // Routes/imports and authorization identifiers are implementation, not
        // display copy. AST traversal also excludes explanatory code comments.
        if (!/^(?:\/|\.|@)/.test(node.text)) visibleCopy.push(node.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
    assertNeutralFeedbackCopy(visibleCopy.join(' '));
  });
}
test('feedback launcher tooltip and signed-out inbox render neutral labels', async () => {
  const launcherSource = await readFile(new URL('../../src/components/FeedbackLauncher.tsx', import.meta.url), 'utf8');
  const inboxSource = await readFile(new URL('../../src/components/FeedbackInbox.tsx', import.meta.url), 'utf8');
  const { FeedbackLauncher } = await import(componentModule(launcherSource, { ...deps, './FeedbackForm': formUrl }));
  const { FeedbackInbox } = await import(componentModule(inboxSource));
  globalThis.__feedbackAuth = { user: null, loading: false, demoMode: false };
  try {
    const launcherHtml = renderToStaticMarkup(React.createElement(FeedbackLauncher));
    assert.match(launcherHtml, /title="Send feedback"/i);
    const inboxHtml = renderToStaticMarkup(React.createElement(FeedbackInbox));
    assert(inboxHtml.includes('Feedback Inbox'));
    assertNeutralFeedbackCopy(launcherHtml.replace(/<[^>]*>/g, ' '));
    assertNeutralFeedbackCopy(inboxHtml.replace(/<[^>]*>/g, ' '));
  } finally { delete globalThis.__feedbackAuth; }
});

test('feedback and owner pages stay uncached and unindexed even after public launch', async () => {
  const stub = moduleUrl('export class NextResponse extends Response { static next(){return new NextResponse(null);} }');
  const source = transpile(await readFile(new URL('../../src/middleware.ts',import.meta.url),'utf8')).replace("'next/server'",JSON.stringify(stub));
  const {middleware} = await import(moduleUrl(source));
  const saved = { APP_ENV:process.env.APP_ENV, PUBLIC_LAUNCH_APPROVED:process.env.PUBLIC_LAUNCH_APPROVED };
  try {
    process.env.APP_ENV='production';process.env.PUBLIC_LAUNCH_APPROVED='true';
    for(const path of ['/feedback','/feedback/privacy','/owner/feedback']) {
      const response=middleware({nextUrl:new URL(`https://visathreads.com${path}`)});
      assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
      assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');
    }
  } finally {for(const [key,value] of Object.entries(saved)) {if(value===undefined) delete process.env[key];else process.env[key]=value;}}
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Execute the real TSX event handlers with deterministic hooks and fake network
// boundaries. These are component interaction tests, not a hosted browser test.
const require = createRequire(import.meta.url);
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const realModule = (name) => pathToFileURL(require.resolve(name)).href;
const hooks = dataUrl(`
  export function useState(value) { return globalThis.__communityHarness.useState(value); }
  export function useRef(value) { return globalThis.__communityHarness.useRef(value); }
  export function useEffect(fn, deps) { return globalThis.__communityHarness.useEffect(fn, deps); }
  export function useMemo(fn, deps) { return globalThis.__communityHarness.useMemo(fn, deps); }
  export function useCallback(fn, deps) { return useMemo(() => fn, deps); }
`);
const jsx = realModule('react/jsx-runtime');
const links = dataUrl(`import {jsx} from ${JSON.stringify(jsx)}; export default function Link(props){ return jsx('a',props); }`);
const navigation = dataUrl(`
  export function useRouter(){return {push:(url)=>globalThis.__communityHarness.pushes.push(url),refresh:()=>{}};}
  export function useSearchParams(){return new URLSearchParams(globalThis.__communityHarness.search);}
  export function useParams(){return globalThis.__communityHarness.params;}
`);
const auth = dataUrl('export function useAuth(){return globalThis.__communityHarness.auth;}');
const dependencies = {
  'react/jsx-runtime': jsx, react: hooks, 'next/link': links, 'next/navigation': navigation,
  './AuthProvider': auth, '@/components/AuthProvider': auth,
  './RelatedQuestions': dataUrl('export function RelatedQuestions(){return null;}'),
  './QuestionCard': dataUrl(`import {jsx} from ${JSON.stringify(jsx)}; export function QuestionCard({question}){return jsx('article',{'data-question-id':question.id,children:question.title});}`),
  '@/lib/realtime': dataUrl('export function subscribeLive(){return ()=>{};}'),
};

async function compile(path, overrides = {}) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const imports = { ...dependencies, ...overrides };
  const output = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText.replace(/(from\s+)(['"])([^'"]+)\2/g, (match, prefix, _quote, name) => {
    if (name === 'lucide-react') {
      const declaration = source.match(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/);
      assert(declaration, 'Expected named lucide imports');
      return prefix + JSON.stringify(dataUrl(`function Icon(){return null;} export {${declaration[1].split(',').map((n) => `Icon as ${n.trim()}`).join(',')}};`));
    }
    assert(imports[name], `Unmapped dependency ${name} in ${path}`);
    return prefix + JSON.stringify(imports[name]);
  });
  return dataUrl(output);
}

class Harness {
  slots = []; index = 0; effects = []; dirty = true; pushes = []; search = ''; params = {};
  auth = { user: { id: 'member-a' }, profile: { username: 'fixture_member' }, loading: false, demoMode: false };
  calls = []; handlers = {}; cleanups = [];
  useState(initial) {
    const id = this.index++;
    if (!(id in this.slots)) this.slots[id] = typeof initial === 'function' ? initial() : initial;
    return [this.slots[id], (next) => { this.slots[id] = typeof next === 'function' ? next(this.slots[id]) : next; this.dirty = true; }];
  }
  useRef(initial) {
    const id = this.index++;
    return this.slots[id] ??= { current: initial };
  }
  useMemo(fn, deps) {
    const id = this.index++;
    if (!this.slots[id] || !same(this.slots[id].deps, deps)) this.slots[id] = { deps, value: fn() };
    return this.slots[id].value;
  }
  useEffect(fn, deps) {
    const id = this.index++;
    if (!this.slots[id] || !same(this.slots[id].deps, deps)) {
      this.slots[id]?.cleanup?.();
      const slot = this.slots[id] = { deps };
      this.effects.push(() => { slot.cleanup = fn(); });
    }
  }
  render(component = this.component, props = this.props) {
    this.component = component; this.props = props; this.index = 0; this.dirty = false;
    globalThis.__communityHarness = this;
    this.tree = component(props);
    return this.tree;
  }
  async settle() {
    for (let i = 0; i < 10; i++) {
      for (const effect of this.effects.splice(0)) effect();
      await new Promise((resolve) => setTimeout(resolve, 2));
      if (!this.dirty && !this.effects.length) return;
      this.render();
    }
    assert.fail('Component did not settle');
  }
  close() { for (const slot of this.slots) slot?.cleanup?.(); delete globalThis.__communityHarness; }
  async invoke(name, args) { this.calls.push({ name, args }); return this.handlers[name]?.(...args); }
}
function same(a, b) { return a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i])); }
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...nodes(node.props?.children)];
}
function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  return textOf(node.props?.children);
}
function byText(h, type, text) {
  const matches = nodes(h.tree).filter((node) => node.type === type && textOf(node).includes(text));
  assert.equal(matches.length, 1, `Expected one ${type} containing ${text}, found ${matches.length}`);
  return matches[0];
}
function field(h, labelText) {
  const labels = nodes(h.tree).filter((node) => node.type === 'label' && textOf(node).includes(labelText));
  assert.equal(labels.length, 1, `Expected one field label containing ${labelText}`);
  const input = nodes(labels[0]).find((node) => ['input', 'textarea', 'select'].includes(node.type));
  assert(input, `Expected input for ${labelText}`);
  return input;
}
function change(h, labelText, value) { field(h, labelText).props.onChange({ target: { value } }); h.render(); }
const event = () => ({ preventDefault() {} });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

const groupMethods = ['listCommunities', 'listMyCommunitiesPage', 'getMembershipForCommunity', 'getMembershipsForCommunities', 'getCommunityById', 'getCommunityBySlug', 'createCommunity', 'joinCommunity', 'leaveCommunity', 'listCommunityQuestions'];
dependencies['@/lib/groups'] = dataUrl(groupMethods.map((name) => `export async function ${name}(...args){return globalThis.__communityHarness.invoke(${JSON.stringify(name)},args);}`).join('\n'));
dependencies['@/lib/community'] = dataUrl('export async function createQuestion(...args){return globalThis.__communityHarness.invoke("createQuestion",args);}');
dependencies['@/lib/post-presentation'] = await compile('../src/lib/post-presentation.ts');
dependencies['@/lib/post-categories'] = await compile('../src/lib/post-categories.ts');
dependencies['@/lib/tagging'] = await compile('../src/lib/tagging.ts');
dependencies['./SafetyNotice'] = await compile('../src/components/SafetyNotice.tsx');
const { AskQuestionForm } = await import(await compile('../src/components/AskQuestionForm.tsx'));
const group = { id: 'group-a', slug: 'h1b-careers', display_name: 'H1B careers', description: 'Work visa questions and shared experience.', category: 'Work visas', country: 'United States', is_public: true, member_count: 2, rules: ['Be respectful.'], created_by: 'owner-a', created_at: '2026-10-06T01:00:00Z' };
function createHarness(search = '') {
  const h = new Harness();
  h.search = search;
  globalThis.window = { location: { search } };
  h.handlers.listMyCommunitiesPage = async () => ({ communities: [group], nextCursor: null });
  h.handlers.getCommunityById = async (id) => id === group.id ? group : null;
  h.handlers.getMembershipForCommunity = async (userId, id) => userId === 'member-a' && id === group.id ? { community_id: id, role: 'member', is_active: true } : null;
  h.handlers.createQuestion = async () => 'created-question';
  return h;
}
const publish = (h) => nodes(h.tree).find((n) => n.type === 'form').props.onSubmit(event());
function fillQuestion(h) {
  change(h, 'Question Title', ' What documents for my H1B transfer? ');
  change(h, 'Situation and Timeline', ' I am changing employers and need to understand the required transfer documents. ');
}

test('question form preserves the selected community, real actor and suggested tags on publish', async () => {
  const h = createHarness('?community=group-a');
  try {
    h.render(AskQuestionForm); await h.settle(); fillQuestion(h);
    assert.equal(field(h, 'Community').props.value, group.id);
    await publish(h); await h.settle();
    const call = h.calls.find((c) => c.name === 'createQuestion');
    assert.equal(call.args[0], 'member-a');
    assert.equal(call.args[1].community_id, group.id);
    assert.equal(call.args[1].title, 'What documents for my H1B transfer?');
    assert(call.args[1].tags.includes('h1b'));
    assert.deepEqual(h.pushes, ['/questions/created-question']);
  } finally { h.close(); }
});
test('General Questions omit community_id and are available without membership', async () => {
  const h = createHarness(); h.handlers.listMyCommunitiesPage = async () => ({ communities: [], nextCursor: null });
  try {
    h.render(AskQuestionForm); await h.settle(); fillQuestion(h); await publish(h);
    const input = h.calls.find((c) => c.name === 'createQuestion').args[1];
    assert.equal(Object.hasOwn(input, 'community_id'), false);
    assert.deepEqual(h.pushes, ['/questions/created-question']);
  } finally { h.close(); }
});
test('a selected community without membership cannot be published, even by invoking submit directly', async () => {
  const h = createHarness('?community=unknown-group');
  try {
    h.render(AskQuestionForm); await h.settle(); fillQuestion(h); await publish(h); h.render();
    assert.equal(h.calls.filter((c) => c.name === 'createQuestion').length, 0);
    assert.match(textOf(h.tree), /Join this community before posting/);
    assert.deepEqual(h.pushes, []);
  } finally { h.close(); }
});
test('a failed membership lookup blocks community posting and exposes a working retry', async () => {
  const h = createHarness('?community=group-a');
  h.handlers.getMembershipForCommunity = async () => { throw new Error('Offline'); };
  try {
    h.render(AskQuestionForm); await h.settle(); await publish(h); h.render();
    assert.equal(h.calls.filter((c) => c.name === 'createQuestion').length, 0);
    assert.match(textOf(h.tree), /could not be checked/);
    h.handlers.getMembershipForCommunity = async (_userId, id) => ({ community_id: id, role: 'member', is_active: true });
    byText(h, 'button', 'Retry').props.onClick(); h.render(); await h.settle();
    assert.doesNotMatch(textOf(h.tree), /could not be checked/);
    fillQuestion(h); await publish(h);
    assert.equal(h.calls.filter((c) => c.name === 'createQuestion').length, 1);
  } finally { h.close(); }
});
test('guest submission retains the community through the login return URL', async () => {
  const h = createHarness('?community=group-a'); h.auth.user = null;
  try {
    h.render(AskQuestionForm); await h.settle(); await publish(h);
    assert.deepEqual(h.pushes, ['/login?next=%2Fask%3Fcommunity%3Dgroup-a']);
    assert.equal(h.calls.length, 0);
  } finally { h.close(); }
});
test('question submit rejects a duplicate click while pending and permits retry after failure', async () => {
  const h = createHarness('?community=group-a'), pending = deferred();
  h.handlers.createQuestion = () => pending.promise;
  try {
    h.render(AskQuestionForm); await h.settle(); fillQuestion(h);
    const first = publish(h), second = publish(h);
    assert.equal(h.calls.filter((c) => c.name === 'createQuestion').length, 1);
    pending.reject(new Error('Publication failed')); await Promise.all([first, second]); h.render();
    assert.match(textOf(h.tree), /Publication failed/);
    h.handlers.createQuestion = async () => 'retry-question';
    await publish(h);
    assert.equal(h.calls.filter((c) => c.name === 'createQuestion').length, 2);
    assert.deepEqual(h.pushes, ['/questions/retry-question']);
  } finally { h.close(); }
});
test('question submission stays locked after success until navigation unmounts the form', async () => {
  const h = createHarness();
  try {
    h.render(AskQuestionForm); await h.settle(); fillQuestion(h);
    await publish(h); h.render(); await publish(h);
    assert.equal(h.calls.filter((c) => c.name === 'createQuestion').length, 1);
    assert.equal(byText(h, 'button', 'Publishing').props.disabled, true);
    assert.deepEqual(h.pushes, ['/questions/created-question']);
  } finally { h.close(); }
});
test('an old account membership response cannot authorize a newly signed-in account', async () => {
  const h = createHarness('?community=group-a'), old = deferred();
  h.handlers.getMembershipForCommunity = (userId) => userId === 'member-a' ? old.promise : null;
  try {
    h.render(AskQuestionForm); await h.settle();
    h.auth = { ...h.auth, user: { id: 'member-b' } }; h.render(); await h.settle();
    old.resolve({ community_id: group.id, role: 'member', is_active: true }); await h.settle();
    await publish(h); h.render();
    assert.equal(h.calls.filter((c) => c.name === 'createQuestion').length, 0);
    assert.match(textOf(h.tree), /Join this community before posting/);
  } finally { h.close(); }
});
test('the question community selector stays bounded and preserves a valid selection outside the current page', async () => {
  const h = createHarness('?community=group-a');
  const first = Array.from({ length: 24 }, (_, i) => ({ ...group, id: `first-${i}`, slug: `first-${i}`, display_name: `First ${i}` }));
  const second = Array.from({ length: 24 }, (_, i) => ({ ...group, id: `second-${i}`, slug: `second-${i}`, display_name: `Second ${i}` }));
  h.handlers.listMyCommunitiesPage = async ({ after }) => ({ communities: after ? second : first, nextCursor: after ? null : 'first-23' });
  try {
    h.render(AskQuestionForm); await h.settle();
    assert.equal(nodes(field(h, 'Community')).filter(n => n.type === 'option').length, 26);
    const next = byText(h, 'button', 'Next communities'); next.props.onClick(); next.props.onClick(); h.render(); await h.settle();
    assert.equal(h.calls.filter(c => c.name === 'listMyCommunitiesPage').length, 2);
    assert.equal(nodes(field(h, 'Community')).filter(n => n.type === 'option').length, 26);
    assert.equal(field(h, 'Community').props.value, group.id);
    assert.match(textOf(field(h, 'Community')), /Second 0/); assert.doesNotMatch(textOf(field(h, 'Community')), /First 0/);
    byText(h, 'button', 'Previous communities').props.onClick(); h.render(); await h.settle();
    assert.match(textOf(field(h, 'Community')), /First 0/);
    assert.equal(h.calls.filter(c => c.name === 'getMembershipForCommunity').length, 1);
    fillQuestion(h); await publish(h);
    assert.equal(h.calls.find(c => c.name === 'createQuestion').args[1].community_id, group.id);
  } finally { h.close(); }
});
test('community selector search is server-filtered, while directory failure does not invalidate a checked selection', async () => {
  const h = createHarness('?community=group-a');
  try {
    h.render(AskQuestionForm); await h.settle();
    change(h, 'Search your communities', 'Canada'); await h.settle();
    await new Promise(resolve => setTimeout(resolve, 260)); await h.settle();
    assert.equal(h.calls.filter(c => c.name === 'listMyCommunitiesPage').at(-1).args[0].search, 'Canada');
    h.handlers.listMyCommunitiesPage = async () => { throw new Error('Directory offline'); };
    change(h, 'Search your communities', ''); await h.settle();
    assert.match(textOf(h.tree), /could not be loaded/);
    fillQuestion(h); await publish(h);
    assert.equal(h.calls.find(c => c.name === 'createQuestion').args[1].community_id, group.id);
  } finally { h.close(); }
});
test('an old account publishing result cannot redirect the newly signed-in account', async () => {
  const h = createHarness(), pending = deferred(); h.handlers.createQuestion = () => pending.promise;
  try {
    h.render(AskQuestionForm); await h.settle(); fillQuestion(h); const submission = publish(h);
    h.auth = { ...h.auth, user: { id: 'member-b' } }; h.render(); await h.settle();
    pending.resolve('old-account-question'); await submission; await h.settle();
    assert.deepEqual(h.pushes, []);
    assert.equal(byText(h, 'button', 'Publish Question').props.disabled, false);
  } finally { h.close(); }
});

const supabaseStub = dataUrl('export const isSupabaseConfigured=true; export const getSupabase=()=>globalThis.__communityClient;');
const groups = await import(await compile('../src/lib/groups.ts', { './supabase/client': supabaseStub }));
const realId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const draft = { slug: ' h1b-careers ', display_name: ' H1B Careers ', description: ' Shared information on H1B work visa cases. ', country: ' United States ', category: 'Work visas', rules: [' Be respectful. ', ''] };
function fakeClient(respond = () => ({ data: [], error: null })) {
  const requests = [];
  const client = {
    from(table) {
      const request = { table, operations: [] }; requests.push(request);
      const query = { then: (resolve, reject) => Promise.resolve().then(() => respond(request)).then(resolve, reject) };
      for (const name of ['select', 'order', 'limit', 'or', 'eq', 'ilike', 'gt', 'in', 'abortSignal', 'maybeSingle', 'neq', 'contains']) {
        query[name] = (...args) => { request.operations.push({ name, args }); return query; };
      }
      return query;
    },
    rpc(name, args) { const request = { rpc: name, args, operations: [] }; requests.push(request); const query = { then: (resolve, reject) => Promise.resolve().then(() => respond(request)).then(resolve, reject), abortSignal(signal) { request.operations.push({ name: 'abortSignal', args: [signal] }); return query; } }; return query; },
  };
  globalThis.__communityClient = client;
  return requests;
}

test('community validation normalizes names and rules and rejects invalid boundaries', () => {
  assert.deepEqual(groups.validateCommunity(draft), { slug: 'h1b-careers', display_name: 'H1B Careers', description: 'Shared information on H1B work visa cases.', country: 'United States', category: 'Work visas', rules: ['Be respectful.'] });
  for (const patch of [
    { slug: 'ab' }, { slug: 'x'.repeat(41) }, { slug: 'bad--address' }, { slug: 'bad/address' },
    { display_name: 'ab' }, { display_name: 'x'.repeat(81) }, { description: 'too short' },
    { description: 'x'.repeat(501) }, { country: '' }, { country: 'x'.repeat(81) }, { category: 'Unknown' },
    { rules: Array(6).fill('Rule') }, { rules: ['x'.repeat(201)] },
  ]) assert.throws(() => groups.validateCommunity({ ...draft, ...patch }));
});
test('directory query is bounded, ordered, cancellable and uses the last returned row as cursor', async () => {
  const data = Array.from({ length: 25 }, (_, i) => ({ ...group, slug: `community-${String(i).padStart(3, '0')}` }));
  const requests = fakeClient(() => ({ data, error: null }));
  const signal = new AbortController().signal;
  const result = await groups.listCommunities({ search: ' H1B   Careers ', category: 'Work visas', country: 'United', after: 'community-aaa', signal });
  assert.equal(result.communities.length, 24); assert.equal(result.nextCursor, 'community-023');
  assert.equal(requests[0].table, 'community_directory');
  assert(requests[0].operations.some((op) => op.name === 'limit' && op.args[0] === 25));
  assert(requests[0].operations.some((op) => op.name === 'gt' && op.args[0] === 'slug' && op.args[1] === 'community-aaa'));
  assert(requests[0].operations.some((op) => op.name === 'or' && op.args[0] === 'display_name.ilike.%H1B Careers%,slug.ilike.%H1B Careers%'));
  assert(requests[0].operations.some((op) => op.name === 'abortSignal' && op.args[0] === signal));
});
test('directory search rejects PostgREST operators supplied by the user', async () => {
  for (const search of ['x%,id.neq.null', 'x)or(id.eq.1', '*', 'quoted"', 'x_y', 'x\\']) {
    const requests = fakeClient();
    await assert.rejects(() => groups.listCommunities({ search }));
    assert.equal(requests.length, 0);
  }
});
test('group questions are scoped to one community with a stable timestamp/id cursor', async () => {
  const created_at = '2026-10-06T01:00:00.000Z';
  const rows = Array.from({ length: 21 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, created_at }));
  const requests = fakeClient(() => ({ data: rows, error: null }));
  const result = await groups.listCommunityQuestions(realId, { after: { id: otherId, created_at } });
  assert.equal(result.questions.length, 20);
  assert.deepEqual(result.nextCursor, { id: rows[19].id, created_at });
  assert.equal(requests[0].rpc, 'community_group_question_page');
  assert.deepEqual(requests[0].args, { target_community: realId, before_time: created_at, before_id: otherId, filter_tag: '' });
});
test('invalid IDs and pagination input cannot be embedded into database filters', async () => {
  fakeClient();
  for (const call of [() => groups.joinCommunity('bad-id'), () => groups.leaveCommunity('bad-id'), () => groups.getCommunityById('bad-id'),
    () => groups.listCommunityQuestions(realId, { after: { id: otherId, created_at: '2026-10-06T01:00:00Z),id.neq.null' } }),
    () => groups.listCommunityQuestions(realId, { after: { id: 'x,other_id', created_at: '2026-10-06T01:00:00Z' } })]) await assert.rejects(call);
});
test('create/join/leave RPCs send no browser-selected owner, role or account identity', async () => {
  const requests = fakeClient((request) => ({ data: request.rpc === 'create_public_community' ? realId : null, error: null }));
  assert.equal(await groups.createCommunity(draft), realId);
  await groups.joinCommunity(realId); await groups.leaveCommunity(realId);
  assert.deepEqual(requests.map((r) => r.rpc), ['create_public_community', 'join_public_community', 'leave_public_community']);
  assert.deepEqual(requests[0].args, { community_slug: 'h1b-careers', community_name: 'H1B Careers', community_description: 'Shared information on H1B work visa cases.', community_country: 'United States', community_category: 'Work visas', community_rules: ['Be respectful.'] });
  assert.deepEqual(requests[1].args, { target_community: realId }); assert.deepEqual(requests[2].args, { target_community: realId });
});
test('duplicate creation and unavailable migrations expose useful errors without database internals', async () => {
  for (const [code, expected] of [['23505', /already taken/], ['PGRST202', /not available on this environment/], ['42501', /account cannot/]]) {
    fakeClient(() => ({ data: null, error: { code, message: 'database secret sentinel' } }));
    await assert.rejects(() => groups.createCommunity(draft), (error) => expected.test(error.message) && !error.message.includes('sentinel'));
  }
  fakeClient(() => ({ data: 'not-a-community-id', error: null }));
  await assert.rejects(() => groups.createCommunity(draft), /Check your communities before retrying/);
});
test('own community browsing requests one bounded server page without supplying an account ID', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ ...group, slug: `community-${String(i).padStart(3, '0')}` }));
  const requests = fakeClient(() => ({ data: rows, error: null }));
  const signal = new AbortController().signal;
  const result = await groups.listMyCommunitiesPage({ search: ' Canada ', category: 'Study', country: ' Canada ', after: 'before-page', limit: 20000, signal });
  assert.equal(requests.length, 1); assert.equal(result.communities.length, 24); assert.equal(result.nextCursor, rows[23].slug);
  assert.equal(requests[0].rpc, 'my_community_directory_page');
  assert.deepEqual(requests[0].args, { query_text: 'Canada', filter_category: 'Study', filter_country: 'Canada', after_slug: 'before-page', result_limit: 24 });
  assert.equal(requests[0].operations[0].args[0], signal);
});
test('membership lookups read only current page IDs and reject unbounded input', async () => {
  const ids = Array.from({ length: 25 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const requests = fakeClient(() => ({ data: [{ community_id: ids[0], role: 'member', is_active: true }], error: null }));
  const rows = await groups.getMembershipsForCommunities(realId, ids.slice(0, 24));
  assert.equal(rows.length, 1); assert.equal(requests.length, 1);
  assert.equal(requests[0].table, 'community_members');
  assert(requests[0].operations.some(op => op.name === 'limit' && op.args[0] === 24));
  assert(requests[0].operations.some(op => op.name === 'eq' && op.args[0] === 'user_id' && op.args[1] === realId));
  assert(requests[0].operations.some(op => op.name === 'in' && op.args[0] === 'community_id' && op.args[1].length === 24));
  await assert.rejects(() => groups.getMembershipsForCommunities(realId, ids), /one page/);
  assert.equal(requests.length, 1);
  assert.deepEqual(await groups.getMembershipsForCommunities(realId, []), []); assert.equal(requests.length, 1);
  const membership = await groups.getMembershipForCommunity(realId, ids[0]);
  assert.equal(membership.community_id, ids[0]);
  assert.deepEqual(requests[1].operations.find(op => op.name === 'in').args, ['community_id', [ids[0]]]);
});

const completeGroupMethods = groupMethods;
dependencies['@/lib/groups'] = dataUrl(`export {COMMUNITY_CATEGORIES,validateCommunity} from ${JSON.stringify(await compile('../src/lib/groups.ts', { './supabase/client': supabaseStub }))};\n` + completeGroupMethods.map((name) => `export async function ${name}(...args){return globalThis.__communityHarness.invoke(${JSON.stringify(name)},args);}`).join('\n'));
const { ExploreCommunities } = await import(await compile('../src/components/ExploreCommunities.tsx'));
function exploreHarness() {
  const h = createHarness();
  h.handlers.listCommunities = async () => ({ communities: [group], nextCursor: null });
  h.handlers.getMembershipsForCommunities = async () => [];
  h.handlers.getCommunityById = async () => group;
  h.handlers.listMyCommunitiesPage = async () => ({ communities: [], nextCursor: null });
  return h;
}
function buttonLabel(h, label) {
  const result = nodes(h.tree).find((n) => n.type === 'button' && n.props['aria-label'] === label);
  assert(result, `Expected button with aria-label ${label}`); return result;
}
test('Explore guest can browse groups and Join leads to login with the correct return location', async () => {
  const h = exploreHarness(); h.auth.user = null;
  try {
    h.render(ExploreCommunities); await h.settle();
    assert.match(textOf(h.tree), /H1B careers/);
    const destinations = nodes(h.tree).map((n) => n.props?.href).filter(Boolean);
    assert(destinations.includes('/communities/new') || destinations.includes('/login?next=%2Fcommunities%2Fnew'));
    assert(destinations.includes('/news')); assert(destinations.includes('/tags')); assert(destinations.includes('/c/h1b-careers'));
    buttonLabel(h, 'Join H1B careers').props.onClick();
    assert.deepEqual(h.pushes, ['/login?next=%2Fc%2Fh1b-careers']);
    assert.equal(h.calls.filter((c) => ['joinCommunity', 'leaveCommunity', 'getMembershipsForCommunities'].includes(c.name)).length, 0);
  } finally { h.close(); }
});
test('Explore join and leave update the rendered membership and suppress duplicate in-flight clicks', async () => {
  const h = exploreHarness(), pending = deferred(); h.handlers.joinCommunity = () => pending.promise;
  try {
    h.render(ExploreCommunities); await h.settle();
    const join = buttonLabel(h, 'Join H1B careers'); join.props.onClick(); join.props.onClick();
    assert.equal(h.calls.filter((c) => c.name === 'joinCommunity').length, 1);
    h.render(); assert.equal(buttonLabel(h, 'Join H1B careers').props.disabled, true);
    pending.resolve(); await h.settle();
    assert.equal(buttonLabel(h, 'Leave H1B careers').props.disabled, false);
    buttonLabel(h, 'Leave H1B careers').props.onClick(); await h.settle();
    assert.equal(h.calls.filter((c) => c.name === 'leaveCommunity').length, 1);
    assert(buttonLabel(h, 'Join H1B careers'));
  } finally { h.close(); }
});
test('Explore ownership and membership read failures prevent accidental mutations', async () => {
  const h = exploreHarness();
  h.handlers.getMembershipsForCommunities = async () => [{ community_id: group.id, role: 'owner', is_active: true }];
  try {
    h.render(ExploreCommunities); await h.settle();
    const owner = byText(h, 'button', 'Owner'); assert.equal(owner.props.disabled, true); owner.props.onClick(); await h.settle();
    assert.equal(h.calls.filter((c) => c.name === 'leaveCommunity').length, 0);
  } finally { h.close(); }
  const failed = exploreHarness(); failed.handlers.getMembershipsForCommunities = async () => { throw new Error('Membership unavailable'); };
  try {
    failed.render(ExploreCommunities); await failed.settle();
    const join = buttonLabel(failed, 'Join H1B careers'); assert.equal(join.props.disabled, true); join.props.onClick();
    assert.equal(failed.calls.filter((c) => c.name === 'joinCommunity').length, 0);
    failed.handlers.getMembershipsForCommunities = async () => [];
    byText(failed, 'button', 'Retry memberships').props.onClick(); failed.render(); await failed.settle();
    assert.equal(buttonLabel(failed, 'Join H1B careers').props.disabled, false);
  } finally { failed.close(); }
});
test('Explore failed joins show an error without claiming membership and allow a retry', async () => {
  const h = exploreHarness(); h.handlers.joinCommunity = async () => { throw new Error('Join request failed'); };
  try {
    h.render(ExploreCommunities); await h.settle();
    buttonLabel(h, 'Join H1B careers').props.onClick(); await h.settle();
    assert.match(textOf(h.tree), /Join request failed/); assert.equal(buttonLabel(h, 'Join H1B careers').props.disabled, false);
    h.handlers.joinCommunity = async () => {};
    buttonLabel(h, 'Join H1B careers').props.onClick(); await h.settle();
    assert(buttonLabel(h, 'Leave H1B careers')); assert.doesNotMatch(textOf(h.tree), /Join request failed/);
  } finally { h.close(); }
});
test('Explore My Communities uses active memberships and the empty state returns to browsing', async () => {
  const h = exploreHarness();
  try {
    h.render(ExploreCommunities); await h.settle();
    byText(h, 'button', 'My Communities').props.onClick(); h.render(); await h.settle();
    assert.match(textOf(h.tree), /Find your first community/);
    assert.equal(h.calls.filter((c) => c.name === 'listMyCommunitiesPage').length, 1);
    byText(h, 'button', 'Explore all communities').props.onClick(); h.render(); await h.settle();
    assert.match(textOf(h.tree), /H1B careers/);
  } finally { h.close(); }
});
test('Explore ignores an old account mutation after the current account changes', async () => {
  const h = exploreHarness(), oldJoin = deferred(); h.handlers.joinCommunity = () => oldJoin.promise;
  try {
    h.render(ExploreCommunities); await h.settle();
    buttonLabel(h, 'Join H1B careers').props.onClick();
    h.auth = { ...h.auth, user: { id: 'member-b' } }; h.render(); await h.settle();
    oldJoin.resolve(); await h.settle();
    assert(buttonLabel(h, 'Join H1B careers'));
    assert.equal(nodes(h.tree).some((n) => n.type === 'button' && n.props['aria-label'] === 'Leave H1B careers'), false);
  } finally { h.close(); }
});
test('Explore holds one page of cards and reads only visible memberships across thousands of communities', async () => {
  const h = exploreHarness();
  h.handlers.listCommunities = async ({ after }) => {
    const offset = after ? Number(after.split('-')[1]) + 1 : 0;
    return { communities: Array.from({ length: 24 }, (_, i) => ({ ...group, id: `group-${offset + i}`, slug: `community-${offset + i}`, display_name: `Community ${offset + i}` })), nextCursor: offset + 24 < 10000 ? `community-${offset + 23}` : null };
  };
  try {
    h.render(ExploreCommunities); await h.settle();
    for (let page = 1; page <= 3; page++) {
      assert.equal(nodes(h.tree).filter(n => n.type === 'article').length, 24);
      assert.equal(h.calls.filter(c => c.name === 'getMembershipsForCommunities').at(-1).args[1].length, 24);
      const next = byText(h, 'button', 'Next communities'); next.props.onClick(); next.props.onClick(); h.render(); await h.settle();
    }
    assert.equal(h.calls.filter(c => c.name === 'listCommunities').length, 4);
    assert.equal(nodes(h.tree).filter(n => n.type === 'article').length, 24);
    assert.match(textOf(h.tree), /Community 72/); assert.doesNotMatch(textOf(h.tree), /Community 0\s/);
    byText(h, 'button', 'Previous communities').props.onClick(); h.render(); await h.settle();
    assert.match(textOf(h.tree), /Community 48/);
    byText(h, 'button', 'First page').props.onClick(); h.render(); await h.settle();
    assert.match(textOf(h.tree), /Community 0\s/);
  } finally { h.close(); }
});
test('Explore My Communities passes category filters to its bounded page endpoint', async () => {
  const h = exploreHarness();
  try {
    h.render(ExploreCommunities); await h.settle();
    byText(h, 'button', 'My Communities').props.onClick(); h.render(); await h.settle();
    const category = nodes(h.tree).find(n => n.type === 'select' && n.props['aria-label'] === 'Community category');
    category.props.onChange({ target: { value: 'Study' } }); h.render(); await h.settle();
    const request = h.calls.filter(c => c.name === 'listMyCommunitiesPage').at(-1);
    assert.equal(request.args[0].category, 'Study'); assert.equal(request.args[0].after, null);
    assert.equal(h.calls.filter(c => c.name === 'listCommunities').length, 1);
  } finally { h.close(); }
});

dependencies['@/lib/supabase/client'] = supabaseStub;
const { CreateCommunity } = await import(await compile('../src/components/CreateCommunity.tsx'));
function newCommunityHarness() {
  const h = exploreHarness();
  h.handlers.getCommunityBySlug = async () => null;
  h.handlers.createCommunity = async () => realId;
  return h;
}
function fillCommunity(h) {
  change(h, 'Community Name', 'Canada study permits');
  change(h, 'Description', 'Ask questions about Canadian study permits and share the steps that helped you.');
}
test('Start a Community normalizes the address, preserves rules and navigates after successful creation', async () => {
  const h = newCommunityHarness();
  try {
    h.render(CreateCommunity); await h.settle(); fillCommunity(h);
    assert.equal(field(h, 'Community Address').props.value, 'canada-study-permits');
    await publish(h); await h.settle();
    const creation = h.calls.find((c) => c.name === 'createCommunity');
    assert.equal(creation.args[0].slug, 'canada-study-permits');
    assert.equal(creation.args[0].display_name, 'Canada study permits');
    assert.equal(creation.args[0].country, 'United States');
    assert.equal(creation.args[0].rules.length, 2);
    assert.deepEqual(h.pushes, ['/c/canada-study-permits']);
  } finally { h.close(); }
});
test('an existing exact community address exposes the join destination and never creates a duplicate', async () => {
  const h = newCommunityHarness(); h.handlers.getCommunityBySlug = async () => ({ ...group, slug: 'canada-study-permits' });
  try {
    h.render(CreateCommunity); await h.settle(); fillCommunity(h); await publish(h); h.render();
    assert.equal(h.calls.filter((c) => c.name === 'createCommunity').length, 0);
    assert.match(textOf(h.tree), /address already exists/);
    assert(nodes(h.tree).some((n) => n.props?.href === '/c/canada-study-permits'));
    assert.equal(byText(h, 'button', 'Create Community').props.disabled, false);
  } finally { h.close(); }
});
test('community validation rejects an invalid draft before any create request', async () => {
  const h = newCommunityHarness();
  try {
    h.render(CreateCommunity); await h.settle();
    change(h, 'Community Name', 'ab');
    await publish(h); h.render();
    assert.equal(h.calls.filter((c) => ['createCommunity', 'getCommunityBySlug'].includes(c.name)).length, 0);
    assert.match(textOf(h.tree), /3–40/);
  } finally { h.close(); }
});
test('community create suppresses duplicate submissions during the address lookup', async () => {
  const h = newCommunityHarness(), preflight = deferred(); h.handlers.getCommunityBySlug = () => preflight.promise;
  try {
    h.render(CreateCommunity); await h.settle(); fillCommunity(h);
    const first = publish(h), second = publish(h);
    assert.equal(h.calls.filter((c) => c.name === 'getCommunityBySlug').length, 1);
    preflight.resolve(null); await Promise.all([first, second]); await h.settle();
    assert.equal(h.calls.filter((c) => c.name === 'createCommunity').length, 1);
    assert.deepEqual(h.pushes, ['/c/canada-study-permits']);
  } finally { h.close(); }
});
test('community creation preserves the guest return URL without writing', async () => {
  const h = newCommunityHarness(); h.auth.user = null;
  try {
    h.render(CreateCommunity); await h.settle(); await publish(h);
    assert.deepEqual(h.pushes, ['/login?next=%2Fcommunities%2Fnew']);
    assert.equal(h.calls.length, 0);
  } finally { h.close(); }
});
test('community creation cancels when the account changes during the duplicate check', async () => {
  const h = newCommunityHarness(), preflight = deferred(); h.handlers.getCommunityBySlug = () => preflight.promise;
  try {
    h.render(CreateCommunity); await h.settle(); fillCommunity(h);
    const pending = publish(h);
    h.auth = { ...h.auth, user: { id: 'member-b' } }; h.render(); await h.settle();
    preflight.resolve(null); await pending; await h.settle();
    assert.equal(h.calls.filter((c) => c.name === 'createCommunity').length, 0);
    assert.deepEqual(h.pushes, []);
  } finally { h.close(); }
});
test('failed community creation preserves the draft and permits retry', async () => {
  const h = newCommunityHarness(); h.handlers.createCommunity = async () => { throw new Error('Creation failed'); };
  try {
    h.render(CreateCommunity); await h.settle(); fillCommunity(h); await publish(h); h.render();
    assert.match(textOf(h.tree), /Creation failed/);
    assert.equal(field(h, 'Community Name').props.value, 'Canada study permits');
    assert.equal(byText(h, 'button', 'Create Community').props.disabled, false);
    h.handlers.createCommunity = async () => realId; await publish(h);
    assert.equal(h.calls.filter((c) => c.name === 'createCommunity').length, 2);
    assert.deepEqual(h.pushes, ['/c/canada-study-permits']);
  } finally { h.close(); }
});
test('an unconfigured environment disables community creation and rejects direct service writes', async () => {
  const unavailableClient = dataUrl('export const isSupabaseConfigured=false; export function getSupabase(){throw new Error("No client expected");}');
  const { CreateCommunity: DisconnectedCreate } = await import(await compile('../src/components/CreateCommunity.tsx', { '@/lib/supabase/client': unavailableClient }));
  const unavailableGroups = await import(await compile('../src/lib/groups.ts', { './supabase/client': unavailableClient }));
  const h = newCommunityHarness();
  try {
    h.render(DisconnectedCreate); await h.settle();
    assert.match(textOf(h.tree), /Community creation is disabled here/);
    assert.equal(byText(h, 'button', 'Create Community').props.disabled, true);
    await publish(h); h.render();
    assert.equal(h.calls.length, 0);
    await assert.rejects(() => unavailableGroups.createCommunity(draft), /service is connected/);
    await assert.rejects(() => unavailableGroups.joinCommunity(realId), /service is connected/);
  } finally { h.close(); }
});

const { CommunityPage } = await import(await compile('../src/components/CommunityPage.tsx'));
const fixtureQuestion = { id: realId, title: 'Which documents should I prepare?', tags: ['documents'], created_at: '2026-10-06T01:00:00Z' };
function communityPageHarness() {
  const h = exploreHarness();
  h.handlers.getMembershipForCommunity = async () => null;
  h.handlers.getCommunityBySlug = async () => group;
  h.handlers.listCommunityQuestions = async () => ({ questions: [fixtureQuestion], nextCursor: null });
  return h;
}
test('community detail shows its rules and questions, and join enables a correctly scoped Ask link', async () => {
  const h = communityPageHarness();
  try {
    h.render(CommunityPage, { slug: group.slug }); await h.settle();
    assert.match(textOf(h.tree), /H1B careers/); assert.match(textOf(h.tree), /Be respectful/);
    const question = nodes(h.tree).find((n) => n.props?.question); assert.equal(question.props.question.id, realId);
    const query = h.calls.find((c) => c.name === 'listCommunityQuestions'); assert.equal(query.args[0], group.id);
    byText(h, 'button', 'Join community').props.onClick(); await h.settle();
    assert(nodes(h.tree).some((n) => n.props?.href === `/ask?community=${group.id}`));
    assert(byText(h, 'button', 'Leave community'));
  } finally { h.close(); }
});
test('community detail pagination, refresh and tag filters keep the selected community', async () => {
  const h = communityPageHarness(), cursor = { id: realId, created_at: fixtureQuestion.created_at };
  h.handlers.listCommunityQuestions = async (_id, options) => ({ questions: options.after ? [{ ...fixtureQuestion, id: otherId }] : [fixtureQuestion], nextCursor: options.after ? null : cursor });
  try {
    h.render(CommunityPage, { slug: group.slug }); await h.settle();
    byText(h, 'button', 'Next questions').props.onClick(); h.render(); await h.settle();
    assert.equal(nodes(h.tree).filter((n) => n.props?.question).length, 1);
    assert.equal(nodes(h.tree).find((n) => n.props?.question).props.question.id, otherId);
    assert.deepEqual(h.calls.filter((c) => c.name === 'listCommunityQuestions').at(-1).args[1].after, cursor);
    nodes(h.tree).find((n) => n.props?.question).props.onTagSelect('documents'); h.render(); await h.settle();
    const filterRequest = h.calls.filter((c) => c.name === 'listCommunityQuestions').at(-1);
    assert.equal(filterRequest.args[0], group.id); assert.equal(filterRequest.args[1].after, null); assert.equal(filterRequest.args[1].tag, 'documents');
    byText(h, 'button', 'Clear filter').props.onClick(); h.render(); await h.settle();
    assert.equal(h.calls.filter((c) => c.name === 'listCommunityQuestions').at(-1).args[1].tag, '');
    const previousCount = h.calls.filter((c) => c.name === 'listCommunityQuestions').length;
    byText(h, 'button', 'Refresh').props.onClick(); h.render(); await h.settle();
    assert.equal(h.calls.filter((c) => c.name === 'listCommunityQuestions').length, previousCount + 1);
  } finally { h.close(); }
});
test('community detail distinguishes unavailable communities from retryable read failures', async () => {
  const h = communityPageHarness(); h.handlers.getCommunityBySlug = async () => { throw new Error('Service offline'); };
  try {
    h.render(CommunityPage, { slug: group.slug }); await h.settle();
    assert.match(textOf(h.tree), /Service offline/); assert.equal(h.calls.filter((c) => c.name === 'listCommunityQuestions').length, 0);
    h.handlers.getCommunityBySlug = async () => null;
    byText(h, 'button', 'Retry').props.onClick(); h.render(); await h.settle();
    assert.match(textOf(h.tree), /Community unavailable/);
    assert.equal(nodes(h.tree).filter((n) => n.type === 'button').length, 0);
  } finally { h.close(); }
});
test('community detail does not show fake questions when the feed fails, and retry works', async () => {
  const h = communityPageHarness(); h.handlers.listCommunityQuestions = async () => { throw new Error('Questions unavailable'); };
  try {
    h.render(CommunityPage, { slug: group.slug }); await h.settle();
    assert.match(textOf(h.tree), /Questions unavailable/); assert.equal(nodes(h.tree).filter((n) => n.props?.question).length, 0);
    h.handlers.listCommunityQuestions = async () => ({ questions: [], nextCursor: null });
    byText(h, 'button', 'Retry').props.onClick(); h.render(); await h.settle();
    assert.match(textOf(h.tree), /Start the first conversation/); assert.doesNotMatch(textOf(h.tree), /Questions unavailable/);
  } finally { h.close(); }
});
test('community detail ignores a join completion after navigation to another community', async () => {
  const h = communityPageHarness(), pending = deferred();
  const nextGroup = { ...group, id: 'group-b', slug: 'study-canada', display_name: 'Study Canada' };
  h.handlers.getCommunityBySlug = async (slug) => slug === group.slug ? group : nextGroup;
  h.handlers.joinCommunity = () => pending.promise;
  try {
    h.render(CommunityPage, { slug: group.slug }); await h.settle();
    byText(h, 'button', 'Join community').props.onClick();
    h.render(CommunityPage, { slug: nextGroup.slug }); await h.settle();
    pending.resolve(); await h.settle();
    assert.match(textOf(h.tree), /Study Canada/); assert.doesNotMatch(textOf(h.tree), /H1B careers/);
    assert.equal(byText(h, 'button', 'Join community').props.disabled, false);
  } finally { h.close(); }
});


test('My Communities route opens joined groups without first querying the public directory', async () => {
  const h = exploreHarness();
  h.handlers.listMyCommunitiesPage = async () => ({ communities: [group], nextCursor: null });
  try {
    h.render(ExploreCommunities, { initialTab: 'mine' }); await h.settle();
    assert.equal(h.calls.filter((c) => c.name === 'listMyCommunitiesPage').length, 1);
    assert.equal(h.calls.filter((c) => c.name === 'listCommunities').length, 0);
    assert.equal(byText(h, 'button', 'My Communities').props['aria-pressed'], true);
    assert.match(textOf(h.tree), /H1B careers/);
  } finally { h.close(); }
});

test('My Communities guest entry preserves its login destination and makes no member request', async () => {
  const h = exploreHarness(); h.auth.user = null;
  try {
    h.render(ExploreCommunities, { initialTab: 'mine' }); await h.settle();
    assert(nodes(h.tree).some((n) => n.props?.href === '/login?next=%2Fmy-communities'));
    assert.equal(h.calls.filter((c) => ['listMyCommunitiesPage', 'getMembershipsForCommunities'].includes(c.name)).length, 0);
  } finally { h.close(); }
});

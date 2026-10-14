import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';

process.env.NEXT_PUBLIC_SITE_URL = 'https://visathreads.com';

// Run the real component handlers; only hooks, identity and network are fake.
const dataUrl = (text) => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const source = await readFile(new URL('../src/components/AssistantPanel.tsx', import.meta.url), 'utf8');
const dependencies = {
  react: dataUrl(['useState', 'useRef', 'useEffect'].map(name => `export function ${name}(...args){return globalThis.__assistantHarness.${name}(...args);}`).join('\n')),
  'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'),
  'next/navigation': dataUrl('export function usePathname(){return globalThis.__assistantHarness.pathname;}'),
  './AuthProvider': dataUrl('export function useAuth(){return globalThis.__assistantHarness.auth;}'),
  '@/lib/supabase/client': dataUrl('export function getSupabase(){return {auth:{getSession:()=>globalThis.__assistantHarness.session()}};}'),
  'lucide-react': dataUrl('function Icon(){return null;} export {Icon as ChevronDown,Icon as Clock3,Icon as MessageSquareText,Icon as Sparkles};'),
};
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/(from\s+)(['"])([^'"]+)\2/g, (_match, prefix, _quote, name) => {
  assert(dependencies[name], `Unmapped dependency ${name}`);
  return prefix + JSON.stringify(dependencies[name]);
});
const { AssistantPanel } = await import(dataUrl(compiled));
const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
const defer = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const fixture = (overrides = {}) => ({ status: 'answered', claims: [{ text: 'Members reported document requests.', evidence: [{ sourceId: 'reply-a', quote: 'They asked for documents.' }] }], disagreements: [], unanswered: [], sources: [{ id: 'reply-a', kind: 'reply', questionId: 'post-a', communityId: 'community-a', title: 'Documents at interview', body: 'They asked for documents.', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z', url: '/questions/post-a#answer-reply-a', provenance: 'member' }], coverage: { sourceCount: 1, partial: false, since: '2026-10-01T00:00:00Z', until: '2026-10-02T00:00:00Z' }, generatedAt: '2026-10-02T00:00:00Z', cached: false, notice: 'Community experience, not official guidance.', ...overrides });

class Harness {
  slots = []; index = 0; effects = []; dirty = false; calls = []; storage = new Map();
  auth = { user: { id: 'user-a' }, loading: false, demoMode: false };
  pathname = '/questions/post-a';
  availability = { posts: true, communities: true, catchup: true };
  post = async () => reply(fixture());
  session = async () => ({ data: { session: { access_token: 'fixture-token', user: { id: this.auth.user?.id } } }, error: null });
  constructor() {
    this.oldFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      this.calls.push({ url, ...options, body: options.body && JSON.parse(options.body) });
      return options.method === 'POST' ? this.post(options) : reply(this.availability);
    };
    globalThis.window = { localStorage: { getItem: key => this.storage.get(key) ?? null, setItem: (key, value) => this.storage.set(key, value) } };
  }
  useState(initial) { const index = this.index++; if (!(index in this.slots)) this.slots[index] = typeof initial === 'function' ? initial() : initial; return [this.slots[index], value => { const next = typeof value === 'function' ? value(this.slots[index]) : value; if (!Object.is(next, this.slots[index])) { this.slots[index] = next; this.dirty = true; } }]; }
  useRef(initial) { return this.slots[this.index++] ??= { current: initial }; }
  useEffect(fn, deps) { const index = this.index++; if (!same(this.slots[index]?.deps, deps)) { this.slots[index]?.cleanup?.(); const slot = this.slots[index] = { deps }; this.effects.push(() => { slot.cleanup = fn(); }); } }
  render(props = this.props ?? { scope: { kind: 'post', id: 'post-a' }, defaultOpen: true }) { this.props = props; this.index = 0; this.dirty = false; globalThis.__assistantHarness = this; this.tree = AssistantPanel(props); }
  async settle() { for (let round = 0; round < 15; round++) { for (const effect of this.effects.splice(0)) effect(); await new Promise(resolve => setTimeout(resolve, 1)); if (!this.dirty && !this.effects.length) return; this.render(); } assert.fail('Assistant did not settle'); }
  close() { for (const slot of this.slots) slot?.cleanup?.(); globalThis.fetch = this.oldFetch; delete globalThis.__assistantHarness; delete globalThis.window; }
}
function nodes(node) { if (Array.isArray(node)) return node.flatMap(nodes); if (!node || typeof node !== 'object') return []; if (typeof node.type === 'function') return nodes(node.type(node.props)); return [node, ...nodes(node.props?.children)]; }
function textOf(node) { if (Array.isArray(node)) return node.map(textOf).join(' '); if (node == null || typeof node === 'boolean') return ''; if (typeof node !== 'object') return String(node); return textOf(typeof node.type === 'function' ? node.type(node.props) : node.props?.children); }
function button(h, label) { const value = nodes(h.tree).find(node => node.type === 'button' && textOf(node).trim() === label); assert(value, `Missing button ${label}`); return value; }
function changeQuestion(h, value) { nodes(h.tree).find(node => node.type === 'textarea').props.onChange({ target: { value } }); h.render(); }
function choose(h, label) { button(h, label).props.onClick(); h.render(); }
function submit(h) { const promise = nodes(h.tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); h.render(); return promise; }

test('dev has no assistant UI or requests even when availability reports enabled', async () => {
  const h = new Harness();
  process.env.NEXT_PUBLIC_SITE_URL = 'https://visa-central.com';
  try {
    h.render(); await h.settle();
    assert.equal(h.tree, null);
    assert.equal(h.calls.length, 0);
  } finally { h.close(); process.env.NEXT_PUBLIC_SITE_URL = 'https://visathreads.com'; }
});

test('anonymous sign-in returns to the post, demo never contacts the assistant', async () => {
  const h = new Harness(); h.auth.user = null;
  try { h.render(); await h.settle(); assert.equal(nodes(h.tree).find(node => node.type === 'a').props.href, '/login?next=%2Fquestions%2Fpost-a#sign-in'); assert(!nodes(h.tree).some(node => node.type === 'form')); } finally { h.close(); }
  const demo = new Harness(); demo.auth.demoMode = true;
  try { demo.render(); await demo.settle(); assert.match(textOf(demo.tree), /unavailable in the local preview/); assert.equal(demo.calls.length, 0); } finally { demo.close(); }
});

test('post rollout enables global post questions while community and catch-up remain gated', async () => {
  const h = new Harness(); h.availability = { posts: true, communities: false, catchup: false };
  try {
    h.render({ scope: { kind: 'public' }, defaultOpen: true }); await h.settle(); assert(button(h, 'Get answer')); assert(!textOf(h.tree).includes('Catch me up'));
    h.render({ scope: { kind: 'community', id: 'community-a' }, defaultOpen: true }); await h.settle(); assert.match(textOf(h.tree), /later rollout/); assert(!nodes(h.tree).some(node => node.type === 'form'));
  } finally { h.close(); }
});

test('bounded questions use the current bearer token and never submit client evidence', async () => {
  const h = new Harness();
  try {
    h.render(); await h.settle();
    for (let i = 0; i < 5; i++) { changeQuestion(h, `Question number ${i}`); await submit(h); await h.settle(); }
    const calls = h.calls.filter(call => call.method === 'POST');
    assert.equal(calls[0].headers.Authorization, 'Bearer fixture-token');
    assert.deepEqual(calls[0].body, { mode: 'ask', scope: { kind: 'post', id: 'post-a' }, question: 'Question number 0' });
    assert.deepEqual(calls[4].body.previousQuestions, ['Question number 1', 'Question number 2', 'Question number 3']);
    assert.equal(h.storage.size, 0, 'Chat contents must not be persisted');
    choose(h, 'Start a new question'); changeQuestion(h, 'A fresh topic'); await submit(h); await h.settle();
    assert.equal(h.calls.at(-1).body.previousQuestions, undefined);
  } finally { h.close(); }
});

test('evidence renders as escaped text with dates and only internal discussion links', async () => {
  const h = new Harness(); h.post = async () => reply(fixture({ claims: [{ text: '<img src=x onerror=alert(1)>', evidence: [{ sourceId: 'reply-a', quote: '<script>danger()</script>' }, { sourceId: 'bad', quote: 'bad' }] }], sources: [...fixture().sources, { ...fixture().sources[0], id: 'bad', url: 'javascript:alert(1)' }], coverage: { sourceCount: 2, partial: true } }));
  try {
    h.render(); await h.settle(); changeQuestion(h, 'What happened?'); await submit(h); await h.settle();
    const html = renderToStaticMarkup(h.tree);
    assert.match(html, /&lt;img/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script|javascript:/);
    assert.match(html, /href="\/questions\/post-a#answer-reply-a"/); assert.match(textOf(h.tree), /Partial coverage/); assert.match(textOf(h.tree), /2026-10-01 10:00 UTC/);
  } finally { h.close(); }
});

test('editing cancels the active request, duplicate submits and late results cannot leak', async () => {
  const h = new Harness(), pending = defer(); h.post = () => pending.promise;
  try {
    h.render(); await h.settle(); changeQuestion(h, 'Old question'); const first = submit(h); void submit(h); await h.settle();
    assert.equal(h.calls.filter(call => call.method === 'POST').length, 1);
    const active = h.calls.at(-1); changeQuestion(h, 'New question'); assert.equal(active.signal.aborted, true);
    pending.resolve(reply(fixture())); await first; await h.settle(); assert.doesNotMatch(textOf(h.tree), /Members reported/);
    assert.equal(button(h, 'Get answer').props.disabled, false);
  } finally { h.close(); }
});

test('changing identity or scope clears response and prior user questions', async () => {
  const h = new Harness();
  try {
    h.render(); await h.settle(); changeQuestion(h, 'What happened?'); await submit(h); await h.settle(); assert.match(textOf(h.tree), /Members reported/);
    h.auth.user = { id: 'user-b' }; h.render(); assert.doesNotMatch(textOf(h.tree), /Members reported/); await h.settle();
    assert.equal(nodes(h.tree).find(node => node.type === 'textarea').props.value, '');
    changeQuestion(h, 'New user question'); await submit(h); await h.settle(); assert.equal(h.calls.at(-1).body.previousQuestions, undefined);
    h.render({ scope: { kind: 'post', id: 'post-b' }, defaultOpen: true }); await h.settle(); assert.doesNotMatch(textOf(h.tree), /Members reported/);
  } finally { h.close(); }
});

test('catch-up first visit is explicit; only complete answered intervals advance an identity-scoped checkpoint', async () => {
  const h = new Harness();
  try {
    h.render({ scope: { kind: 'community', id: 'community-a' }, defaultOpen: true }); await h.settle(); choose(h, 'Catch me up');
    let select = nodes(h.tree).find(node => node.type === 'select'); select.props.onChange({ target: { value: 'last' } }); h.render();
    assert.match(textOf(h.tree), /No previous catch-up/); assert.equal(button(h, 'Create catch-up').props.disabled, true);
    select.props.onChange({ target: { value: 'week' } }); h.render();
    h.post = async () => reply(fixture({ coverage: { ...fixture().coverage, partial: true } })); await submit(h); await h.settle(); assert.equal(h.storage.size, 0);
    h.post = async () => reply(fixture({ status: 'insufficient' })); await submit(h); await h.settle(); assert.equal(h.storage.size, 0);
    h.post = async () => reply(fixture()); await submit(h); await h.settle();
    assert.equal(h.storage.get('visathreads:assistant-catchup:v1:user-a:community:community-a'), '2026-10-02T00:00:00.000Z');
    select = nodes(h.tree).find(node => node.type === 'select'); select.props.onChange({ target: { value: 'last' } }); h.render(); await submit(h); await h.settle();
    assert.equal(h.calls.at(-1).body.since, '2026-10-02T00:00:00.000Z');
    h.auth.user = { id: 'user-b' }; h.render(); await h.settle(); choose(h, 'Catch me up'); nodes(h.tree).find(node => node.type === 'select').props.onChange({ target: { value: 'last' } }); h.render(); assert.match(textOf(h.tree), /No previous catch-up/);
  } finally { h.close(); }
});

test('catch-up defaults to 24 hours and maps each explicit interval to the requested start time', async () => {
  const h = new Harness(); const realNow = Date.now; const now = Date.parse('2026-10-13T18:00:00Z'); Date.now = () => now;
  h.post = async () => reply(fixture({ status: 'insufficient' }));
  try {
    h.render({ scope: { kind: 'community', id: 'community-a' }, defaultOpen: true }); await h.settle(); choose(h, 'Catch me up');
    assert.equal(nodes(h.tree).find(node => node.type === 'select').props.value, 'day');
    for (const [period, hours] of [['hour', 1], ['six-hours', 6], ['day', 24], ['week', 168]]) {
      nodes(h.tree).find(node => node.type === 'select').props.onChange({ target: { value: period } }); h.render();
      await submit(h); await h.settle();
      assert.equal(h.calls.at(-1).body.mode, 'catchup');
      assert.equal(h.calls.at(-1).body.since, new Date(now - hours * 3600000).toISOString());
    }
  } finally { Date.now = realNow; h.close(); }
});

test('session identity mismatches make no generation request and provider errors stay private', async () => {
  const h = new Harness();
  try {
    h.render(); await h.settle(); changeQuestion(h, 'What happened?');
    h.session = async () => ({ data: { session: { access_token: 'other', user: { id: 'other' } } } }); await submit(h); await h.settle();
    assert.equal(h.calls.filter(call => call.method === 'POST').length, 0); assert.match(textOf(h.tree), /session has expired/);
    h.session = async () => ({ data: { session: { access_token: 'fixture', user: { id: 'user-a' } } } }); h.post = async () => reply({ error: 'Supabase private credentials sentinel' }, 429);
    await submit(h); await h.settle(); assert.match(textOf(h.tree), /assistant limit/); assert.doesNotMatch(textOf(h.tree), /Supabase|sentinel/);
  } finally { h.close(); }
});

test('catch-up refuses a checkpoint older than 31 days instead of silently omitting time', async () => {
  const h = new Harness(); h.storage.set('visathreads:assistant-catchup:v1:user-a:community:community-a', new Date(Date.now() - 32 * 86400000).toISOString());
  try {
    h.render({ scope: { kind: 'community', id: 'community-a' }, defaultOpen: true }); await h.settle(); choose(h, 'Catch me up');
    nodes(h.tree).find(node => node.type === 'select').props.onChange({ target: { value: 'last' } }); h.render();
    assert.match(textOf(h.tree), /older than 31 days/); assert.equal(button(h, 'Create catch-up').props.disabled, true);
    await submit(h); await h.settle(); assert.equal(h.calls.filter(call => call.method === 'POST').length, 0);
  } finally { h.close(); }
});

test('unmount aborts generation before an old result can be displayed', async () => {
  const h = new Harness(), pending = defer(); h.post = () => pending.promise;
  h.render(); await h.settle(); changeQuestion(h, 'What happened?'); const work = submit(h); await h.settle();
  const signal = h.calls.at(-1).signal; h.close(); assert.equal(signal.aborted, true); pending.resolve(reply(fixture())); await work;
});

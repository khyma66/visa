import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const jsx = pathToFileURL(require.resolve('react/jsx-runtime')).href;
const hooks = dataUrl(['useState', 'useEffect', 'useMemo', 'useRef'].map((name) => `export function ${name}(...args){return globalThis.__feedHarness.${name}(...args);}`).join('\n'));
const source = await readFile(new URL('../src/components/CommunityHome.tsx', import.meta.url), 'utf8');
const icons = source.match(/import\s*\{([^}]+)\}\s*from\s*'lucide-react'/)[1].split(',').map((name) => name.trim());
const presentationSource = ts.transpileModule(await readFile(new URL('../src/lib/post-presentation.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const dependencies = {
  './AdvertisementSlot': dataUrl('export const AdvertisementSlot=()=>null,FeedAdvertisementSlot=()=>null;'),
  '@/lib/post-presentation': dataUrl(presentationSource),
  react: hooks,
  'react/jsx-runtime': jsx,
  'next/link': dataUrl(`import {jsx} from ${JSON.stringify(jsx)}; export default function Link(props){return jsx('a',props);}`),
  'next/navigation': dataUrl('export function useSearchParams(){return new URLSearchParams(globalThis.__feedHarness.search);}'),
  'lucide-react': dataUrl(`function Icon(){return null;} export {${icons.map((name) => `Icon as ${name}`).join(',')}};`),
  '@/lib/post-categories': dataUrl('export const EXPERIENCE_CATEGORIES=["Other"],VISA_TYPES=["H1B","Other"];'),
  '@/lib/community': dataUrl('export async function getCommunitySource(){return {};} export async function getQuestionPage(options){const h=globalThis.__feedHarness;h.calls.push(options);return h.getPage(options);}'),
  '@/lib/realtime': dataUrl('export function subscribeLive(){return ()=>{};}'),
  './AuthProvider': dataUrl('export function useAuth(){return globalThis.__feedHarness.auth ?? {user:null,demoMode:true};}'),
  './QuestionCard': dataUrl('export function QuestionCard(){return null;}'),
  './RelatedQuestions': dataUrl('export function RelatedQuestions(){return null;}'),
};
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/(from\s+)(['"])([^'"]+)\2/g, (_match, prefix, _quote, name) => {
  assert(dependencies[name], `Unmapped dependency ${name}`);
  return prefix + JSON.stringify(dependencies[name]);
});
dependencies['@/lib/post-categories'] = dataUrl('export const EXPERIENCE_CATEGORIES=["Other"],VISA_TYPES=["H1B","Other"];');
const { CommunityHome } = await import(dataUrl(compiled));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
const question = (id, overrides = {}) => ({ id, author_id: 'author', author_username: 'member', author_avatar_seed: 'member', title: `${id} visa question`, body: 'H1B visa documents and interview appointment', destination_country: 'US', visa_type: 'H1B', tags: ['documents'], created_at: '2026-10-08T01:00:00Z', vote_score: 1, answer_count: 0, post_kind: 'question', ...overrides });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

// Exercise the actual hook state and event handlers without a hosted service.
class Harness {
  slots = []; index = 0; effects = []; dirty = false; calls = []; writes = [];
  constructor(search = '') {
    this.search = search;
    this.storage = new Map();
    this.getPage = async () => ({ questions: [question('first')], more: false });
    globalThis.window = {
      location: { href: `https://visa.test/${search}` },
      localStorage: { getItem: key => this.storage.get(key) ?? null, setItem: (key, value) => this.storage.set(key, value) },
      history: { state: { __NA: true }, replaceState: (state, _title, url) => { this.writes.push({ state, url: String(url) }); this.search = new URL(url).search; window.location.href = String(url); } },
    };
    globalThis.document = { getElementById: () => null };
  }
  useState(initial) {
    const index = this.index++;
    if (!(index in this.slots)) this.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [this.slots[index], (next) => { const value = typeof next === 'function' ? next(this.slots[index]) : next; if (!Object.is(value, this.slots[index])) { this.slots[index] = value; this.dirty = true; } }];
  }
  useRef(initial) { return this.slots[this.index++] ??= { current: initial }; }
  useMemo(fn, deps) {
    const index = this.index++;
    if (!same(this.slots[index]?.deps, deps)) this.slots[index] = { deps, value: fn() };
    return this.slots[index].value;
  }
  useEffect(fn, deps) {
    const index = this.index++;
    if (!same(this.slots[index]?.deps, deps)) {
      this.slots[index]?.cleanup?.();
      const slot = this.slots[index] = { deps };
      this.effects.push(() => { slot.cleanup = fn(); });
    }
  }
  render(props = this.props) { this.props = props; this.index = 0; this.dirty = false; globalThis.__feedHarness = this; this.tree = CommunityHome(props); }
  async settle() {
    for (let round = 0; round < 20; round++) {
      for (const effect of this.effects.splice(0)) effect();
      await wait(2);
      if (!this.dirty && !this.effects.length) return;
      this.render();
    }
    assert.fail('Feed did not settle');
  }
  async flush() { await this.settle(); await wait(220); await this.settle(); }
  close() { for (const slot of this.slots) slot?.cleanup?.(); delete globalThis.__feedHarness; delete globalThis.window; delete globalThis.document; }
}
function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.props?.children)] : []; }
function textOf(node) { return Array.isArray(node) ? node.map(textOf).join(' ') : node == null || typeof node === 'boolean' ? '' : typeof node === 'object' ? textOf(node.props?.children) : String(node); }
function button(h, label) { const result = nodes(h.tree).find((node) => node.type === 'button' && textOf(node).trim() === label); assert(result, `Missing ${label} button`); return result; }
function search(h, value) { const input = nodes(h.tree).find((node) => node.type === 'input'); input.props.onChange({ target: { value } }); h.render(); }
function ids(h) { return nodes(h.tree).filter((node) => node.props?.question).map((node) => node.props.question.id); }

test('initial feed and sort clicks start fetching without the search debounce', async () => {
  const h = new Harness();
  try {
    h.render(); await h.settle();
    assert.equal(h.calls.length, 1, 'Initial data starts without waiting 200ms');
    button(h, 'Top').props.onClick(); h.render(); await h.settle();
    assert.equal(h.calls.at(-1).sort, 'score', 'Sort clicks do not wait for a typing timer');
  } finally { h.close(); }
});

test('home page offers Ask a Question to everyone and requires sign-in before composing', async () => {
  const h = new Harness(); h.getPage = async () => ({ questions: [], more: false });
  try {
    h.render(); await h.settle();
    const signedOut = nodes(h.tree).filter(node => node.props?.href === '/login?next=%2Fask#sign-in' && textOf(node).includes('Ask a Question'));
    assert.equal(signedOut.length, 2, 'Both the main and empty-state actions remain visible');
    h.auth = { user: { id: 'member-a' }, demoMode: false };
    h.render();
    assert(nodes(h.tree).some(node => node.props.href === '/ask' && textOf(node).includes('Ask a Question')));
  } finally { h.close(); }
});

test('desktop feed separator resizes both panels with pointer and keyboard and remembers the width', async () => {
  const h = new Harness();
  h.storage.set('visathreads:discovery-panel-width:v1', '420');
  try {
    h.render(); await h.settle();
    const separator = () => nodes(h.tree).find(node => node.props?.role === 'separator');
    assert.equal(separator().props['aria-valuenow'], 420);
    assert.equal(nodes(h.tree).find(node => node.props?.className === 'home-feed-layout').props.style['--discovery-width'], '420px');
    const target = { setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} };
    separator().props.onPointerDown({ button: 0, pointerId: 7, clientX: 500, preventDefault() {}, currentTarget: target });
    separator().props.onPointerMove({ pointerId: 7, clientX: 440 });
    h.render();
    assert.equal(separator().props['aria-valuenow'], 480);
    separator().props.onPointerUp({ pointerId: 7, currentTarget: target });
    assert.equal(h.storage.get('visathreads:discovery-panel-width:v1'), '480');
    separator().props.onKeyDown({ key: 'ArrowRight', preventDefault() {} });
    h.render();
    assert.equal(separator().props['aria-valuenow'], 456);
    separator().props.onDoubleClick(); h.render();
    assert.equal(separator().props['aria-valuenow'], 300);
  } finally { h.close(); }
});

test('sort selection responds immediately and keeps loaded cards visible while fresh results arrive', async () => {
  const h = new Harness(), top = deferred();
  h.getPage = ({ sort }) => sort === 'score' ? top.promise : Promise.resolve({ questions: [question('newest'), question('popular', { vote_score: 10, created_at: '2026-10-01T01:00:00Z' })], more: false });
  try {
    h.render(); await h.settle();
    assert.deepEqual(ids(h), ['newest', 'popular']);
    button(h, 'Top').props.onClick(); h.render();
    assert.equal(button(h, 'Top').props['aria-pressed'], true, 'Selection feedback is not tied to network completion');
    assert.deepEqual(ids(h), ['popular', 'newest'], 'Loaded posts are sorted in the same render as selection');
    await h.settle();
    assert.equal(h.calls.at(-1).sort, 'score');
    assert.deepEqual(ids(h), ['popular', 'newest'], 'Do not replace usable cards with a loading skeleton');
    assert.match(textOf(h.tree), /Updating results…/);
    assert(!nodes(h.tree).some(node => node.props?.['aria-label'] === 'Loading questions'));
    assert.equal(nodes(h.tree).find(node => node.props?.id === 'question-list').props['aria-busy'], true);
    top.resolve({ questions: [question('fresh-top', { vote_score: 99 })], more: false }); await h.settle();
    assert.deepEqual(ids(h), ['fresh-top']);
    assert.doesNotMatch(textOf(h.tree), /Updating results/);
    assert.equal(nodes(h.tree).find(node => node.props?.id === 'question-list').props['aria-busy'], false);
  } finally { h.close(); }
});

test('active sort clicks and hover do not create redundant requests or history writes', async () => {
  const h = new Harness();
  try {
    h.render(); await h.settle();
    const calls = h.calls.length, writes = h.writes.length;
    for (const label of ['New', 'Active', 'Top', 'Unanswered']) {
      const tab = button(h, label);
      assert.equal(tab.props.type, 'button');
      assert.equal(tab.props.onMouseEnter, undefined, 'Hover should be immediate CSS feedback, not a data request');
      assert.equal(tab.props.onPointerEnter, undefined);
      assert.match(tab.props.className, /feed-sort-button/);
    }
    button(h, 'New').props.onClick(); h.render(); await h.settle();
    assert.equal(h.calls.length, calls);
    assert.equal(h.writes.length, writes);
  } finally { h.close(); }
});

test('a changed search does not show the previous filter as refreshed results', async () => {
  const h = new Harness(), next = deferred();
  h.getPage = ({ search }) => search ? next.promise : Promise.resolve({ questions: [question('old-filter')], more: false });
  try {
    h.render(); await h.settle();
    search(h, 'documents'); await h.flush();
    assert.deepEqual(ids(h), []);
    assert.match(textOf(h.tree), /Loading questions/);
    assert.doesNotMatch(textOf(h.tree), /Updating results/);
    next.resolve({ questions: [question('new-filter')], more: false }); await h.settle();
    assert.deepEqual(ids(h), ['new-filter']);
  } finally { h.close(); }
});

test('rapid sort changes reject a late response and do not prematurely declare Unanswered empty', async () => {
  const h = new Harness(), top = deferred(), unanswered = deferred();
  h.getPage = ({ sort }) => sort === 'score' ? top.promise : sort === 'unanswered' ? unanswered.promise : Promise.resolve({ questions: [question('answered', { answer_count: 2 })], more: false });
  try {
    h.render(); await h.settle();
    button(h, 'Top').props.onClick(); h.render(); await h.settle();
    button(h, 'Unanswered').props.onClick(); h.render(); await h.settle();
    assert.equal(button(h, 'Unanswered').props['aria-pressed'], true);
    assert.deepEqual(ids(h), []);
    assert.match(textOf(h.tree), /Updating results…/);
    assert.doesNotMatch(textOf(h.tree), /No matching questions|0 posts shown/);
    top.resolve({ questions: [question('stale-top')], more: false }); await h.settle();
    assert.deepEqual(ids(h), []);
    unanswered.resolve({ questions: [question('fresh-unanswered')], more: false }); await h.settle();
    assert.deepEqual(ids(h), ['fresh-unanswered']);
    assert.doesNotMatch(textOf(h.tree), /Updating results/);
  } finally { h.close(); }
});

test('failed refresh clears stale rows, keeps errors generic and allows retry', async () => {
  const h = new Harness(), top = deferred();
  h.getPage = ({ sort }) => sort === 'score' ? top.promise : Promise.resolve({ questions: [question('initial')], more: false });
  try {
    h.render(); await h.settle();
    button(h, 'Top').props.onClick(); h.render(); await h.settle();
    assert.deepEqual(ids(h), ['initial']);
    top.reject(new Error('Supabase secret sentinel')); await h.settle();
    assert.deepEqual(ids(h), []);
    assert.match(textOf(h.tree), /Questions could not be loaded/);
    assert.doesNotMatch(textOf(h.tree), /Supabase|sentinel|Updating results/);
    h.getPage = async () => ({ questions: [question('recovered')], more: false });
    button(h, 'Retry').props.onClick(); h.render(); await h.settle();
    assert.deepEqual(ids(h), ['recovered']);
  } finally { h.close(); }
});
function select(h, label, value) {
  const control = nodes(h.tree).find(node => node.type === 'select' && node.props['aria-label'] === label);
  assert(control, `Missing ${label} selector`);
  control.props.onChange({ target: { value } }); h.render();
}

test('feed restores header search, tag, visa and sort from the URL', async () => {
  const h = new Harness('?q=documents&tag=documents&visa=H1B&sort=score');
  try {
    h.render(); await h.flush();
    assert.deepEqual(h.calls.at(-1), { search: 'documents', tag: 'documents', visaType: 'H1B', sort: 'score', experience: false, category: '' });
    assert.equal(nodes(h.tree).find((node) => node.type === 'input').props.value, 'documents');
    assert.equal(button(h, 'Top').props['aria-pressed'], true);
  } finally { h.close(); }
});

test('feed controls publish clean framework-aware query state and clear filters', async () => {
  const h = new Harness();
  try {
    h.render(); await h.flush(); search(h, 'documents'); await h.flush();
    button(h, 'Top').props.onClick(); h.render(); await h.flush();
    assert.equal(new URLSearchParams(h.search).get('q'), 'documents');
    assert.equal(new URLSearchParams(h.search).get('sort'), 'score');
    assert(h.writes.every((write) => write.state === null), 'Do not pass app-owned Next history state when changing query parameters');
    button(h, 'Clear Filters').props.onClick(); h.render(); await h.flush();
    assert.equal(h.search, '');
    assert.deepEqual(h.calls.at(-1), { search: '', tag: '', visaType: '', sort: 'newest', experience: false, category: '' });
  } finally { h.close(); }
});

test('same-page query navigation restores controls and invalid sorts fall back to New', async () => {
  const h = new Harness();
  try {
    h.render(); await h.flush();
    h.search = '?q=interview&sort=unknown'; h.render(); await h.flush();
    assert.equal(h.calls.at(-1).search, 'interview'); assert.equal(h.calls.at(-1).sort, 'newest');
    assert.equal(nodes(h.tree).find((node) => node.type === 'input').props.value, 'interview');
  } finally { h.close(); }
});
test('experience category links restore filters without incompatible question-type controls', async () => {
  const h = new Harness('?category=Other&type=question');
  h.getPage = async () => ({ questions: [question('story', {post_kind:'experience',experience_category:'Other'}), question('normal')], more:false });
  try {
    h.render({experience:true}); await h.flush();
    assert.equal(h.calls.at(-1).category, 'Other'); assert.deepEqual(ids(h), ['story']);
    assert(!nodes(h.tree).some(node => node.props?.['aria-label'] === 'Post type'));
    button(h, 'Clear Filters').props.onClick(); h.render(); await h.flush();
    assert.equal(h.search, ''); assert.equal(h.calls.at(-1).category, '');
  } finally { h.close(); }
});

test('feed service errors hide provider details and expose a working retry', async () => {
  const h = new Harness(); h.getPage = async () => { throw new Error('Supabase internal secret sentinel'); };
  try {
    h.render(); await h.flush();
    assert.match(textOf(h.tree), /Questions could not be loaded/);
    assert.doesNotMatch(textOf(h.tree), /Supabase|sentinel/);
    h.getPage = async () => ({ questions: [question('recovered')], more: false });
    button(h, 'Retry').props.onClick(); h.render(); await h.flush();
    assert.deepEqual(ids(h), ['recovered']); assert.doesNotMatch(textOf(h.tree), /could not be loaded/);
  } finally { h.close(); }
});

test('an old search response cannot replace a newer feed', async () => {
  const h = new Harness(), old = deferred();
  h.getPage = ({ search }) => search ? Promise.resolve({ questions: [question('new-search')], more: false }) : old.promise;
  try {
    h.render(); await h.flush(); search(h, 'documents'); await h.flush();
    old.resolve({ questions: [question('old-search')], more: false }); await h.settle();
    assert.deepEqual(ids(h), ['new-search']);
  } finally { h.close(); }
});

test('load more rejects double clicks and stale results after a filter change', async () => {
  const h = new Harness(), older = deferred();
  h.getPage = ({ search, before }) => before ? older.promise : Promise.resolve({ questions: [question(search ? 'filtered' : 'first')], more: !search, cursor: question('first') });
  try {
    h.render(); await h.flush();
    const more = button(h, 'Load more questions'); more.props.onClick(); more.props.onClick();
    assert.equal(h.calls.filter((call) => call.before).length, 1);
    search(h, 'documents'); await h.flush();
    older.resolve({ questions: [question('stale-older')], more: false }); await h.settle();
    assert.deepEqual(ids(h), ['filtered']);
  } finally { h.close(); }
});

test('an empty post-type filter keeps the next server page available', async () => {
  const h = new Harness();
  h.getPage = async () => ({ questions: [question('question-only')], more: true, cursor: question('question-only') });
  try {
    h.render({ initialKind: 'discussion' }); await h.flush();
    assert.deepEqual(ids(h), []); assert.match(textOf(h.tree), /No matching questions/);
    assert(button(h, 'Load more questions'));
    assert.equal(nodes(h.tree).find((node) => node.props?.['aria-label'] === 'Post type').props.value, 'discussion');
  } finally { h.close(); }
});

test('origin URL state restores and filters member and archive rows independently of topic tags', async () => {
  const rows = [question('member'), question('source-archive', { source: 'apify' }), question('apify-legacy')];
  for (const [origin, expected] of [['member', ['member']], ['archive', ['source-archive', 'apify-legacy']]]) {
    const h = new Harness(`?origin=${origin}&tag=documents`);
    h.getPage = async () => ({ questions: rows, more: false });
    try {
      h.render(); await h.flush();
      assert.equal(h.calls.at(-1).origin, origin);
      assert.equal(h.calls.at(-1).tag, 'documents');
      assert.equal(nodes(h.tree).find(node => node.props?.['aria-label'] === 'Post origin').props.value, origin);
      assert.deepEqual([...ids(h)].sort(), expected.sort());
      for (const node of nodes(h.tree).filter(node => node.props?.question)) assert.deepEqual(node.props.question.tags, ['documents']);
      assert(!rows.some(row => row.tags.includes('archive') || row.tags.includes('member')));
    } finally { h.close(); }
  }
});

test('origin controls preserve other filters and Clear Filters removes the source parameter', async () => {
  const h = new Harness('?q=documents&tag=documents&visa=H1B&origin=archive&sort=score');
  h.getPage = async () => ({ questions: [question('member'), question('apify-archive')], more: false });
  try {
    h.render(); await h.flush();
    select(h, 'Post origin', 'member'); await h.flush();
    assert.deepEqual(Object.fromEntries(new URLSearchParams(h.search)), { q: 'documents', tag: 'documents', visa: 'H1B', origin: 'member', sort: 'score' });
    assert.equal(h.calls.at(-1).origin, 'member'); assert.deepEqual(ids(h), ['member']);
    select(h, 'Post origin', ''); await h.flush();
    assert.equal(new URLSearchParams(h.search).has('origin'), false);
    assert.equal(Object.hasOwn(h.calls.at(-1), 'origin'), false);
    select(h, 'Post origin', 'archive'); await h.flush();
    button(h, 'Clear Filters').props.onClick(); h.render(); await h.flush();
    assert.equal(h.search, '');
    assert.equal(nodes(h.tree).find(node => node.props?.['aria-label'] === 'Post origin').props.value, '');
    assert.equal(Object.hasOwn(h.calls.at(-1), 'origin'), false);
  } finally { h.close(); }
});

test('same-page origin navigation restores the source selector and rejects unknown sources', async () => {
  const h = new Harness('?origin=member');
  h.getPage = async () => ({ questions: [question('member'), question('apify-archive')], more: false });
  try {
    h.render(); await h.flush();
    h.search = '?origin=archive'; h.render(); await h.flush();
    assert.equal(h.calls.at(-1).origin, 'archive'); assert.deepEqual(ids(h), ['apify-archive']);
    h.search = '?origin=not-a-source'; h.render(); await h.flush();
    assert.equal(Object.hasOwn(h.calls.at(-1), 'origin'), false);
    assert.equal(nodes(h.tree).find(node => node.props?.['aria-label'] === 'Post origin').props.value, '');
    assert.equal(ids(h).length, 2);
  } finally { h.close(); }
});

test('loaded page ranges match twenty visible cards then the final twenty-first card', async () => {
  const h = new Harness();
  h.getPage = async () => ({ questions: Array.from({ length: 21 }, (_, index) => question(`member-${String(index).padStart(2, '0')}`)), more: true, cursor: question('cursor') });
  try {
    h.render(); await h.flush();
    const firstPage = ids(h);
    assert.equal(firstPage.length, 20);
    assert.match(textOf(h.tree), /Showing 1–20 of 21 loaded · More available/);
    assert.equal(button(h, 'Previous').props.disabled, true);
    button(h, 'Next').props.onClick(); h.render(); await h.settle();
    assert.equal(ids(h).length, 1);
    assert(!firstPage.includes(ids(h)[0]));
    assert.match(textOf(h.tree), /Showing 21–21 of 21 loaded · More available/);
    assert.equal(button(h, 'Next').props.disabled, true);
    assert.equal(nodes(h.tree).find(node => node.props?.['aria-label'] === 'Page 2').props['aria-current'], 'page');
    button(h, 'Previous').props.onClick(); h.render(); await h.settle();
    assert.deepEqual(ids(h), firstPage);
    assert.equal(h.calls.length, 1, 'Local pages should not refetch an already loaded page');
  } finally { h.close(); }
});

test('origin changes discard stale older pages and pass the new source to pagination', async () => {
  const h = new Harness(), older = deferred();
  h.getPage = ({ origin, before }) => before ? older.promise : Promise.resolve({ questions: [question(origin === 'archive' ? 'apify-current' : 'member')], more: origin !== 'archive', cursor: question('member') });
  try {
    h.render(); await h.flush();
    select(h, 'Post origin', 'member'); await h.flush();
    button(h, 'Load more questions').props.onClick();
    assert.equal(h.calls.at(-1).origin, 'member'); assert(h.calls.at(-1).before);
    select(h, 'Post origin', 'archive'); await h.flush();
    older.resolve({ questions: [question('apify-stale')], more: false }); await h.settle();
    assert.deepEqual(ids(h), ['apify-current']);
    assert.equal(h.calls.at(-1).origin, 'archive');
    assert.doesNotMatch(textOf(h.tree), /Load more questions|Loading questions/);
  } finally { h.close(); }
});

test('archive provenance keeps legacy source-less records subject to local search', async () => {
  const h = new Harness('?origin=archive&q=interview');
  h.auth = { user: null, demoMode: false };
  h.getPage = async () => ({ questions: [question('apify-matching'), question('apify-unrelated', { title: 'H1B renewal', body: 'Filing documents only' })], more: false });
  try {
    h.render(); await h.flush();
    assert.deepEqual(ids(h), ['apify-matching']);
    assert.equal(h.calls.at(-1).search, 'interview');
  } finally { h.close(); }
});

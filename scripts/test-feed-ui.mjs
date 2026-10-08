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
  '@/lib/post-presentation': dataUrl(presentationSource),
  react: hooks,
  'react/jsx-runtime': jsx,
  'next/link': dataUrl(`import {jsx} from ${JSON.stringify(jsx)}; export default function Link(props){return jsx('a',props);}`),
  'next/navigation': dataUrl('export function useSearchParams(){return new URLSearchParams(globalThis.__feedHarness.search);}'),
  'lucide-react': dataUrl(`function Icon(){return null;} export {${icons.map((name) => `Icon as ${name}`).join(',')}};`),
  '@/lib/post-categories': dataUrl('export const EXPERIENCE_CATEGORIES=["Other"],VISA_TYPES=["H1B","Other"];'),
  '@/lib/community': dataUrl('export async function getCommunitySource(){return {};} export async function getQuestionPage(options){const h=globalThis.__feedHarness;h.calls.push(options);return h.getPage(options);}'),
  '@/lib/realtime': dataUrl('export function subscribeLive(){return ()=>{};}'),
  './AuthProvider': dataUrl('export function useAuth(){return {user:null,demoMode:true};}'),
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
    this.getPage = async () => ({ questions: [question('first')], more: false });
    globalThis.window = {
      location: { href: `https://visa.test/${search}` },
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

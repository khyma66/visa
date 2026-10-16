import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';

process.env.NEXT_PUBLIC_SITE_URL = 'https://visathreads.com';

// Run the real component handlers; only hooks, identity and network are fake.
const dataUrl = (text) => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const source = await readFile(new URL('../src/components/AssistantPanel.tsx', import.meta.url), 'utf8');
const context = dataUrl(ts.transpileModule(await readFile(new URL('../src/lib/assistant-context.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
const dependencies = {
  '@/lib/assistant-context': context,
  react: dataUrl(['useState', 'useRef', 'useEffect'].map(name => `export function ${name}(...args){return globalThis.__assistantHarness.${name}(...args);}`).join('\n')),
  'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'),
  'next/navigation': dataUrl('export function usePathname(){return globalThis.__assistantHarness.pathname;}'),
  './AuthProvider': dataUrl('export function useAuth(){return globalThis.__assistantHarness.auth;}'),
  '@/lib/supabase/client': dataUrl('export function getSupabase(){return {auth:{getSession:()=>globalThis.__assistantHarness.session()}};}'),
  'lucide-react': dataUrl('function Icon(){return null;} export {Icon as ChevronDown,Icon as Clock3,Icon as ArrowUp,Icon as Square,Icon as Sparkles};'),
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
function visibleTextOf(node) { if (Array.isArray(node)) return node.map(visibleTextOf).join(' '); if (node == null || typeof node === 'boolean') return ''; if (typeof node !== 'object') return String(node); if (typeof node.type === 'function') return visibleTextOf(node.type(node.props)); if (node.type === 'details' && !node.props.open) return visibleTextOf(nodes(node.props.children).find(child => child.type === 'summary')); return visibleTextOf(node.props?.children); }
function button(h, label) { const value = nodes(h.tree).find(node => node.type === 'button' && (node.props['aria-label'] ?? textOf(node).trim()) === label); assert(value, `Missing button ${label}`); return value; }
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
    h.render({ scope: { kind: 'public' }, defaultOpen: true }); await h.settle(); assert(button(h, 'Send message')); assert(!textOf(h.tree).includes('Catch me up'));
    h.render({ scope: { kind: 'community', id: 'community-a' }, defaultOpen: true }); await h.settle(); assert.match(textOf(h.tree), /unavailable here/); assert(!nodes(h.tree).some(node => node.type === 'form'));
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
    assert.deepEqual(calls[4].body.previousQuestions, ['Question number 3']);
    assert.equal(h.storage.size, 0, 'Chat contents must not be persisted');
    choose(h, 'New chat'); changeQuestion(h, 'A fresh topic'); await submit(h); await h.settle();
    assert.equal(h.calls.at(-1).body.previousQuestions, undefined);
  } finally { h.close(); }
});

test('the topic anchor survives more than twenty short follow-ups and resets for an explicit new topic', async () => {
  const h = new Harness();
  const anchor = 'What did members report about H-1B stamping in Chennai?';
  try {
    h.render({ scope: { kind: 'public' }, defaultOpen: true }); await h.settle();
    for (const prompt of [anchor, 'What happened next?', ...Array(22).fill('Why?'), 'How long?']) {
      changeQuestion(h, prompt); await submit(h); await h.settle();
    }
    assert.equal(h.calls.at(-1).body.previousQuestions[0], anchor);
    assert(h.calls.at(-1).body.previousQuestions.length <= 3);
    assert.equal(nodes(h.tree).filter(node => node.props?.['aria-label'] === 'Your message').length, 20);
    changeQuestion(h, 'New topic: Schengen passport delivery?'); await submit(h); await h.settle();
    assert.equal(h.calls.at(-1).body.previousPosts, undefined);
    changeQuestion(h, 'How long?'); await submit(h); await h.settle();
    assert.deepEqual(h.calls.at(-1).body.previousQuestions, ['New topic: Schengen passport delivery?']);
    choose(h, 'New chat'); changeQuestion(h, 'Why?'); await submit(h); await h.settle();
    assert.equal(h.calls.at(-1).body.previousQuestions, undefined);
    assert.equal(h.calls.at(-1).body.previousPosts, undefined);
  } finally { h.close(); }
});

test('ordinal follow-ups send displayed post order as IDs only, never source text or assistant claims', async () => {
  const h = new Harness();
  const posts = ['first', 'second'].map(name => ({ questionId: `apify-${name}`, sourceId: `q:apify-${name}`, title: `Post ${name}`, excerpt: 'Sensitive source text stays out of the follow-up request.', url: `/questions/apify-${name}`, createdAt: '2026-10-01T10:00:00Z' }));
  h.post = async () => reply(fixture({ kind: 'posts', posts, sources: [], claims: [] }));
  try {
    h.render({ scope: { kind: 'public' }, defaultOpen: true }); await h.settle();
    changeQuestion(h, 'Find posts about Chennai stamping'); await submit(h); await h.settle();
    changeQuestion(h, 'Explain the second post.'); await submit(h); await h.settle();
    assert.deepEqual(h.calls.at(-1).body.previousPosts, posts.map(({ questionId, sourceId }) => ({ questionId, sourceId })));
    assert.doesNotMatch(JSON.stringify(h.calls.at(-1).body), /Sensitive source text|Post first|Post second/);
    changeQuestion(h, 'When did Schengen passports arrive?'); await submit(h); await h.settle();
    assert.equal(h.calls.at(-1).body.previousPosts, undefined);
  } finally { h.close(); }
});

test('selected-post focus persists past transcript rollover and resets on new topics or broader searches', async () => {
  const h = new Harness(); let requests = 0;
  const selected = { questionId: 'apify-two', sourceId: 'q:apify-two' };
  const posts = ['one', 'two'].map(name => ({ questionId: `apify-${name}`, sourceId: `q:apify-${name}`, title: 'Chennai stamping', excerpt: 'My appointment completed after seven days.', url: `/questions/apify-${name}`, createdAt: '2026-10-01T10:00:00Z' }));
  h.post = async () => ++requests === 1 ? reply(fixture({ kind: 'posts', posts, sources: [], claims: [] }))
    : reply(fixture({ claims: [{ text: 'A member wrote: seven days.', evidence: [{ sourceId: selected.sourceId, quote: 'My appointment completed after seven days.' }] }], sources: [{ ...fixture().sources[0], id: selected.sourceId, questionId: selected.questionId }] }));
  try {
    h.render({ scope: { kind: 'public' }, defaultOpen: true }); await h.settle();
    for (const prompt of ['Find posts about Chennai stamping', 'Explain the second post.', 'How long?', ...Array(21).fill('Why?')]) {
      changeQuestion(h, prompt); await submit(h); await h.settle();
      if (requests > 1) assert.deepEqual(h.calls.at(-1).body.focusedPost, selected);
    }
    changeQuestion(h, 'Show more posts'); await submit(h); await h.settle();
    assert.equal(h.calls.at(-1).body.focusedPost, undefined);
    changeQuestion(h, 'New topic: How did the first post-interview update look for Schengen?'); await submit(h); await h.settle();
    assert.equal(h.calls.at(-1).body.focusedPost, undefined); assert.equal(h.calls.at(-1).body.previousPosts, undefined);
    changeQuestion(h, 'How long?'); await submit(h); await h.settle();
    assert.equal(h.calls.at(-1).body.focusedPost, undefined);
    assert.deepEqual(h.calls.at(-1).body.previousQuestions, ['New topic: How did the first post-interview update look for Schengen?']);
  } finally { h.close(); }
});

test('repeated more requests carry a bounded seen-post exclusion list instead of cycling back to old results', async () => {
  const h = new Harness(); let page = 0;
  h.post = async () => {
    const questionId = `apify-page-${page++}`;
    return reply(fixture({ kind: 'posts', posts: [{ questionId, sourceId: `q:${questionId}`, title: 'Chennai stamping', excerpt: 'My stamping appointment was Monday.', url: `/questions/${questionId}`, createdAt: '2026-10-01T10:00:00Z' }], sources: [], claims: [] }));
  };
  try {
    h.render({ scope: { kind: 'public' }, defaultOpen: true }); await h.settle();
    for (const prompt of ['Find posts about Chennai stamping', 'Show more posts', 'Show me more posts']) { changeQuestion(h, prompt); await submit(h); await h.settle(); }
    assert.deepEqual(h.calls.at(-1).body.seenPostIds, ['apify-page-0', 'apify-page-1']);
    assert.deepEqual(h.calls.at(-1).body.previousPosts, [{ questionId: 'apify-page-1', sourceId: 'q:apify-page-1' }]);
    assert.equal(h.storage.size, 0);
  } finally { h.close(); }
});

test('evidence renders as escaped text with dates and only internal discussion links', async () => {
  const h = new Harness(); h.post = async () => reply(fixture({ claims: [{ text: '<img src=x onerror=alert(1)>', evidence: [{ sourceId: 'reply-a', quote: '<script>danger()</script>' }, { sourceId: 'bad', quote: 'bad' }] }], sources: [...fixture().sources, { ...fixture().sources[0], id: 'bad', url: 'javascript:alert(1)' }], coverage: { sourceCount: 2, partial: true } }));
  try {
    h.render(); await h.settle(); changeQuestion(h, 'What happened?'); await submit(h); await h.settle();
    const html = renderToStaticMarkup(h.tree);
    assert.match(html, /&lt;img/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script|javascript:/);
    assert.match(html, /href="\/questions\/post-a#answer-reply-a"/); assert.match(visibleTextOf(h.tree), /I could only review part of these discussions/); assert.match(textOf(h.tree), /2026-10-01 10:00 UTC/);
    assert.match(visibleTextOf(h.tree), /Sources · 1/); assert.doesNotMatch(textOf(h.tree), /Partial coverage/);
  } finally { h.close(); }
});

test('complete answers keep evidence metadata in collapsed sources without a coverage warning', async () => {
  const h = new Harness();
  h.post = async () => reply(fixture({ sources: [{ ...fixture().sources[0], provenance: 'archive' }] }));
  try {
    h.render(); await h.settle(); changeQuestion(h, 'What documents were requested?'); await submit(h); await h.settle();
    const response = nodes(h.tree).find(node => node.props['aria-label'] === 'Assistant response');
    assert.match(visibleTextOf(response), /Members reported document requests/);
    assert.match(visibleTextOf(response), /\[1\]|Sources · 1/);
    assert.doesNotMatch(visibleTextOf(response), /Imported community|source checked|2026-10-01|only review part|Partial coverage/);
    const details = nodes(response).find(node => node.type === 'details');
    assert(!details.props.open);
    assert.match(textOf(details), /Imported community\s+reply/);
    assert.match(textOf(details), /1\s+source\s+checked/);
    assert.match(textOf(details), /They asked for documents/);
    assert.match(renderToStaticMarkup(details), /href="\/questions\/post-a#answer-reply-a"/);
  } finally { h.close(); }
});

test('incomplete catch-up explains the limitation visibly and keeps the saved position', async () => {
  const h = new Harness();
  const storageKey = 'visathreads:assistant-catchup:v1:user-a:community:community-a';
  h.storage.set(storageKey, '2026-10-01T00:00:00.000Z');
  h.post = async () => reply(fixture({ coverage: { ...fixture().coverage, partial: true } }));
  try {
    h.render({ scope: { kind: 'community', id: 'community-a' }, defaultOpen: true }); await h.settle();
    choose(h, 'Catch me up'); await submit(h); await h.settle();
    const response = nodes(h.tree).find(node => node.props['aria-label'] === 'Assistant response');
    assert.match(visibleTextOf(response), /I could only review part of this time range/);
    assert.match(visibleTextOf(response), /your last catch-up hasn’t advanced/);
    assert.doesNotMatch(visibleTextOf(response), /Checkpoint|Partial coverage/);
    assert.equal(h.storage.get(storageKey), '2026-10-01T00:00:00.000Z');
  } finally { h.close(); }
});

test('related perspectives preserve the reviewed narrative, quotes and inline citations', async () => {
  const quotes = ['At my visit, staff allowed phones inside the venue.', 'I was asked to leave my phone outside.'];
  const sources = ['one', 'two'].map((name, index) => ({ ...fixture().sources[0], id: `q:apify-report-${name}`, kind: 'question',
    questionId: `apify-report-${name}`, communityId: null, body: quotes[index], url: `/questions/apify-report-${name}` }));
  const evidence = sources.map((item, index) => ({ sourceId: item.id, quote: quotes[index] }));
  const result = fixture({ sources,
    claims: [{ text: 'One visitor reported that phones were allowed.', evidence: [evidence[0]] }],
    disagreements: [{ text: 'Another visitor was asked to leave their phone outside. These visits may have had different circumstances.', evidence }],
  });
  const h = new Harness(); h.post = async () => reply(result);
  try {
    h.render({ scope: { kind: 'public' }, defaultOpen: true }); await h.settle();
    changeQuestion(h, 'What did these visitors report about phones?'); await submit(h); await h.settle();
    assert.match(visibleTextOf(h.tree), /One visitor reported that phones were allowed/);
    assert.match(visibleTextOf(h.tree), /Related perspectives/);
    assert.match(visibleTextOf(h.tree), /These visits may have had different circumstances/);
    assert.doesNotMatch(visibleTextOf(h.tree), /A discussion excerpt|Compare source excerpts/);
    assert.deepEqual(nodes(h.tree).filter(node => node.type === 'blockquote').map(node => textOf(node).replace(/[“”]/g, '').trim()), quotes);
    for (const item of sources) assert(nodes(h.tree).some(node => node.type === 'a' && node.props.href === item.url));
  } finally { h.close(); }
});

test('ranked source selection explains its scope in source details without a missing-data banner', async () => {
  const h = new Harness();
  h.post = async () => reply(fixture({ coverage: { sourceCount: 1, partial: true, reasons: ['retrieval-limit', 'context-limit'] } }));
  try {
    h.render(); await h.settle(); changeQuestion(h, 'What documents were requested?'); await submit(h); await h.settle();
    const response = nodes(h.tree).find(node => node.props['aria-label'] === 'Assistant response');
    assert.doesNotMatch(visibleTextOf(response), /only review part|Partial coverage|selection of|discussion text/);
    const details = nodes(response).find(node => node.type === 'details');
    assert.match(textOf(details), /selection of relevant matching discussions/);
    assert.match(textOf(details), /Only part of the available discussion text could be reviewed/);
  } finally { h.close(); }
});

test('missing imported replies remain visible and original-poster replies are attributed in sources', async () => {
  const h = new Harness();
  h.post = async () => reply(fixture({
    sources: [{ ...fixture().sources[0], provenance: 'archive', speakerRole: 'original-poster' }],
    coverage: { sourceCount: 1, partial: true, reasons: ['retrieval-limit', 'missing-replies'] },
  }));
  try {
    h.render(); await h.settle(); changeQuestion(h, 'Can you explain this reply?'); await submit(h); await h.settle();
    const response = nodes(h.tree).find(node => node.props['aria-label'] === 'Assistant response');
    assert.match(visibleTextOf(response), /Some replies were not included in the imported discussion/);
    assert.doesNotMatch(visibleTextOf(response), /Original poster|Partial coverage/);
    assert.match(textOf(nodes(response).find(node => node.type === 'details')), /Imported community\s+reply\s+· Original poster/);
  } finally { h.close(); }
});

test('post search shows linked excerpts immediately with compact expandable results', async () => {
  const h=new Harness();
  const posts=Array.from({length:10},(_,i)=>({questionId:`post-${i}`,sourceId:`q:post-${i}`,title:`Stamping delay ${i}`,excerpt:'Passport still pending <script>unsafe()</script>',url:`/questions/post-${i}`,createdAt:'2026-10-01T10:00:00Z'}));
  h.post=async()=>reply(fixture({kind:'posts',posts:[...posts,{...posts[0],questionId:'unsafe',url:'javascript:alert(1)'}],claims:[],sources:[],coverage:{sourceCount:10,partial:true}}));
  try {
    h.render({scope:{kind:'public'},defaultOpen:true});await h.settle();changeQuestion(h,'give all posts related to stamping delay');await submit(h);await h.settle();
    assert.match(textOf(h.tree),/Found 10 matching posts/);assert.match(textOf(h.tree),/Show 2 more posts/);
    assert.match(textOf(h.tree),/More posts may match/);assert.doesNotMatch(textOf(h.tree),/Thinking|verify the sources/);
    const html=renderToStaticMarkup(h.tree);assert.match(html,/href="\/questions\/post-0"/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/javascript:|<script>/);
    assert.equal(nodes(h.tree).filter(node=>node.type==='li').length,10);
  } finally { h.close(); }
});

test('empty post search gives a useful no-match message and accepts another question', async () => {
  const h=new Harness();h.post=async()=>reply(fixture({kind:'posts',status:'insufficient',posts:[],claims:[],sources:[]}));
  try {
    h.render({scope:{kind:'public'},defaultOpen:true});await h.settle();changeQuestion(h,'find posts about an unknown topic');await submit(h);await h.settle();
    assert.match(textOf(h.tree),/No matching posts found/);assert.doesNotMatch(textOf(h.tree),/No answer received|Try again/);
    changeQuestion(h,'find posts about stamping');assert.equal(button(h,'Send message').props.disabled,false);
  } finally { h.close(); }
});

test('stop cancels the active request, restores the draft, and rejects duplicate submits and late results', async () => {
  const h = new Harness(), pending = defer(); h.post = () => pending.promise;
  try {
    h.render(); await h.settle(); changeQuestion(h, 'Old question'); const first = submit(h); void submit(h); await h.settle();
    assert.equal(h.calls.filter(call => call.method === 'POST').length, 1);
    assert.match(textOf(h.tree), /Thinking/);
    assert.equal(nodes(h.tree).find(node => node.type === 'textarea').props.disabled, true);
    const active = h.calls.at(-1); choose(h, 'Stop response'); assert.equal(active.signal.aborted, true);
    assert.equal(nodes(h.tree).find(node => node.type === 'textarea').props.value, 'Old question');
    changeQuestion(h, 'New question');
    pending.resolve(reply(fixture())); await first; await h.settle(); assert.doesNotMatch(textOf(h.tree), /Members reported/);
    assert.equal(button(h, 'Send message').props.disabled, false);
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

test('catch-up is community-only and summary is post-only even when every feature is enabled', async () => {
  const h = new Harness();
  try {
    for (const [scope, catchup, summary] of [[{ kind: 'public' }, false, false], [{ kind: 'post', id: 'post-a' }, false, true], [{ kind: 'community', id: 'community-a' }, true, false]]) {
      h.render({ scope, defaultOpen: true }); await h.settle();
      const labels = nodes(h.tree).filter(node => node.type === 'button').map(textOf);
      assert.equal(labels.some(label => label.trim() === 'Catch me up'), catchup);
      assert.equal(labels.some(label => label.trim() === 'Summarize'), summary);
    }
  } finally { h.close(); }
});

test('chat keeps ordered user and assistant messages while the next question is drafted', async () => {
  const h = new Harness();
  try {
    h.render(); await h.settle();
    changeQuestion(h, 'What documents were requested?'); await submit(h); await h.settle();
    assert.equal(nodes(h.tree).find(node => node.type === 'textarea').props.value, '');
    changeQuestion(h, 'Were originals required?');
    assert.match(textOf(h.tree), /Members reported document requests/);
    h.post = async () => reply(fixture({ claims: [{ text: 'The post does not specify originals.', evidence: [{ sourceId: 'reply-a', quote: 'They asked for documents.' }] }] }));
    await submit(h); await h.settle();
    const log = nodes(h.tree).find(node => node.props.role === 'log');
    const text = textOf(log);
    assert(text.indexOf('What documents were requested?') < text.indexOf('Members reported document requests.'));
    assert(text.indexOf('Members reported document requests.') < text.indexOf('Were originals required?'));
    assert(text.indexOf('Were originals required?') < text.indexOf('The post does not specify originals.'));
    assert.deepEqual(h.calls.at(-1).body.previousQuestions, ['What documents were requested?']);
    const details = nodes(h.tree).filter(node => node.type === 'details');
    assert(details.length >= 2);
    assert(details.every(node => !node.props.open), 'Citation quotes should be collapsed by default');
    choose(h, 'Summarize'); choose(h, 'Ask');
    assert.match(textOf(h.tree), /The post does not specify originals/);
  } finally { h.close(); }
});

test('failed answers preserve the draft and retry the same turn without repeating prior context', async () => {
  const h = new Harness(); h.post = async () => reply({ error: 'private upstream detail' }, 502);
  try {
    h.render(); await h.settle(); changeQuestion(h, 'What documents were requested?'); await submit(h); await h.settle();
    assert.equal(nodes(h.tree).find(node => node.type === 'textarea').props.value, 'What documents were requested?');
    assert.equal(button(h, 'Retry answer').props.disabled, false);
    assert.doesNotMatch(textOf(h.tree), /private upstream/);
    h.post = async () => reply(fixture()); await submit(h); await h.settle();
    assert.equal(nodes(h.tree).filter(node => node.props['aria-label'] === 'Your message').length, 1);
    assert.equal(h.calls.at(-1).body.previousQuestions, undefined);
    assert.match(textOf(h.tree), /Members reported document requests/);
  } finally { h.close(); }
});

test('Enter submits, Shift+Enter adds a line, and composition does not submit', async () => {
  const h = new Harness(); let submitted = 0, prevented = 0;
  try {
    h.render(); await h.settle(); changeQuestion(h, 'What documents were requested?');
    const textarea = nodes(h.tree).find(node => node.type === 'textarea');
    const event = { key: 'Enter', shiftKey: false, keyCode: 13, nativeEvent: { isComposing: false }, preventDefault() { prevented++; }, currentTarget: { form: { requestSubmit() { submitted++; } } } };
    textarea.props.onKeyDown({ ...event, shiftKey: true });
    textarea.props.onKeyDown({ ...event, nativeEvent: { isComposing: true } });
    textarea.props.onKeyDown({ ...event, keyCode: 229 });
    assert.equal(submitted, 0); assert.equal(prevented, 0);
    textarea.props.onKeyDown(event);
    assert.equal(submitted, 1); assert.equal(prevented, 1);
    changeQuestion(h, 'a');
    nodes(h.tree).find(node => node.type === 'textarea').props.onKeyDown(event);
    assert.equal(submitted, 1, 'Too-short questions must not submit');
  } finally { h.close(); }
});

test('account and scope switches abort pending requests and hide drafts before effects run', async () => {
  for (const switchKind of ['account', 'scope']) {
    const h = new Harness(), pending = defer(); h.post = () => pending.promise;
    try {
      h.render(); await h.settle(); changeQuestion(h, 'Private old question'); const work = submit(h); await h.settle();
      const active = h.calls.at(-1);
      if (switchKind === 'account') { h.auth.user = { id: 'user-b' }; h.render(); }
      else h.render({ scope: { kind: 'post', id: 'post-b' }, defaultOpen: true });
      assert.doesNotMatch(textOf(h.tree), /Private old question/);
      assert.equal(nodes(h.tree).find(node => node.type === 'textarea').props.value, '');
      await h.settle(); assert.equal(active.signal.aborted, true);
      pending.resolve(reply(fixture())); await work; await h.settle();
      assert.doesNotMatch(textOf(h.tree), /Members reported/);
      h.post = async () => reply(fixture()); changeQuestion(h, 'A fresh question'); await submit(h); await h.settle();
      assert.equal(h.calls.at(-1).body.previousQuestions, undefined);
    } finally { h.close(); }
  }
});

test('empty community catch-up shows the server explanation once without unrelated visa advice', async () => {
  const h = new Harness();
  const explanation = 'No new posts or replies in this community during that time range.';
  h.post = async () => reply(fixture({ status: 'insufficient', claims: [], unanswered: [explanation], sources: [], coverage: { sourceCount: 0, partial: false } }));
  try {
    h.render({ scope: { kind: 'community', id: 'community-a' }, defaultOpen: true }); await h.settle();
    choose(h, 'Catch me up'); await submit(h); await h.settle();
    const response = nodes(h.tree).find(node => node.props['aria-label'] === 'Assistant response');
    assert.equal(textOf(response).split(explanation).length - 1, 1);
    assert.doesNotMatch(textOf(response), /Still unclear|visa type|location/);
    assert.equal(h.storage.size, 0);
  } finally { h.close(); }
});

test('unsupported questions display the server explanation rather than duplicating uncertainty', async () => {
  const h = new Harness();
  const explanation = 'I couldn’t find a supported answer in these discussions. Try a more specific question.';
  h.post = async () => reply(fixture({ status: 'insufficient', claims: [], unanswered: [explanation] }));
  try {
    h.render(); await h.settle(); changeQuestion(h, 'Is my visa guaranteed?'); await submit(h); await h.settle();
    const response = nodes(h.tree).find(node => node.props['aria-label'] === 'Assistant response');
    assert.equal(textOf(response).split(explanation).length - 1, 1);
    assert.doesNotMatch(textOf(response), /Still unclear/);
  } finally { h.close(); }
});

test('source verification and changed-discussion failures explain retry while retaining the question', async () => {
  for (const [status, explanation] of [[502, 'I couldn’t verify the sources for that answer. Try again.'], [409, 'This discussion changed. Try again for the latest answer.']]) {
    const h = new Harness(); h.post = async () => reply({ error: 'private provider diagnostic' }, status);
    try {
      h.render(); await h.settle(); changeQuestion(h, 'How long did it take?'); await submit(h); await h.settle();
      const alert = nodes(h.tree).find(node => node.props.role === 'alert');
      assert.equal(textOf(alert).trim(), explanation);
      assert.equal(nodes(h.tree).find(node => node.type === 'textarea').props.value, 'How long did it take?');
      assert.equal(button(h, 'Retry answer').props.disabled, false);
      assert.doesNotMatch(textOf(h.tree), /private provider diagnostic/);
    } finally { h.close(); }
  }
});

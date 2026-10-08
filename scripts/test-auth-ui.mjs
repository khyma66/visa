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
  export function useState(value) { return globalThis.__authHarness.useState(value); }
  export function useRef(value) { return globalThis.__authHarness.useRef(value); }
  export function useEffect(fn, deps) { return globalThis.__authHarness.useEffect(fn, deps); }
  export function useMemo(fn, deps) { return globalThis.__authHarness.useMemo(fn, deps); }
  export function useCallback(fn, deps) { return useMemo(() => fn, deps); }
`);
const jsx = realModule('react/jsx-runtime');
const links = dataUrl(`import {jsx} from ${JSON.stringify(jsx)}; export default function Link(props){ return jsx('a',props); }`);
const navigation = dataUrl(`
  export function useRouter(){throw new Error("Auth entry must not depend on the client router");}
  export function usePathname(){return globalThis.__authHarness.pathname ?? '/questions/example';}
  export function useSearchParams(){return new URLSearchParams(globalThis.__authHarness.search);}
  export function useParams(){return globalThis.__authHarness.params;}
`);
const auth = dataUrl('export function useAuth(){return globalThis.__authHarness.auth;}');
const dependencies = {
  'react/jsx-runtime': jsx, react: hooks, 'next/link': links, 'next/navigation': navigation,
  './AuthProvider': auth, '@/components/AuthProvider': auth,
  './Avatar': dataUrl('export function Avatar(){return null;}'),
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
    globalThis.__authHarness = this;
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
  close() { for (const slot of this.slots) slot?.cleanup?.(); delete globalThis.__authHarness; delete globalThis.window; }
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

dependencies['@/lib/auth-flow'] = await compile('../src/lib/auth-flow.ts');
dependencies['@/lib/supabase/client'] = dataUrl('export function getAuthMethods(...args){return globalThis.__authHarness.invoke("getAuthMethods", args);}');
const { AuthForm } = await import(await compile('../src/components/AuthForm.tsx'));
dependencies['./CommunityNavigation'] = await compile('../src/components/CommunityNavigation.tsx');
const { CommunityNavigation } = await import(dependencies['./CommunityNavigation']);
const { SiteHeader } = await import(await compile('../src/components/SiteHeader.tsx'));
function setup({ loading = false, user = null, search = '', signup = false } = {}) {
  const h = new Harness();
  h.auth = { user, loading, profile: null, demoMode: false };
  for (const method of ['requestCode', 'verifyCode', 'login', 'signInWithProvider']) h.auth[method] = (...args) => h.invoke(method, args);
  h.handlers.getAuthMethods = async () => ({ google: true });
  h.replacements = []; h.cleanUrls = []; h.timers = new Map(); h.reloads = 0;
  let timerId = 0;
  globalThis.window = {
    location: { origin: 'https://visathreads.example', search, hash: '', replace: url => h.replacements.push(url), reload: () => h.reloads++ },
    history: { replaceState: (_state, _title, url) => h.cleanUrls.push(url) },
    setTimeout: (fn, ms) => { h.timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout: id => h.timers.delete(id),
  };
  h.render(AuthForm, { signup });
  return h;
}

test('header Log in is a document link directly to the sign-in section', async () => {
  const h = setup();
  try {
    h.render(SiteHeader);
    const link = byText(h, 'a', 'Log in');
    assert.equal(link.props.href, '/login#sign-in');
    assert.equal(link.props.onClick, undefined);
  } finally { h.close(); }
});

test('header search is a bounded native GET form, and mobile menu has an accessible label', () => {
  const h = setup();
  try {
    h.render(SiteHeader);
    const form = nodes(h.tree).find(n => n.type === 'form' && n.props.role === 'search');
    assert.equal(form.props.action, '/');
    assert.equal(form.props.method, 'get');
    const input = nodes(form).find(n => n.type === 'input');
    assert.equal(input.props.name, 'q');
    assert.equal(input.props.maxLength, 200);
    assert(nodes(h.tree).some(n => n.type === 'summary' && n.props['aria-label'] === 'Open navigation'));
  } finally { h.close(); }
});

test('shared navigation retains working community, feed, tags and messaging destinations', () => {
  const h = setup();
  try {
    h.render(CommunityNavigation, {});
    const hrefs = nodes(h.tree).map(n => n.props?.href).filter(Boolean);
    for (const href of ['/', '/?sort=score', '/explore', '/news', '/tags', '/messages', '/my-communities', '/communities/new']) {
      assert(hrefs.includes(href), `Missing navigation to ${href}`);
    }
    assert.equal(nodes(h.tree).find(n => n.type === 'nav').props['aria-label'], 'Main navigation');
    h.render(CommunityNavigation, { mobile: true });
    assert.equal(nodes(h.tree).find(n => n.type === 'nav').props['aria-label'], 'Mobile navigation');
  } finally { h.close(); }
});

test('Popular selection reflects URL sort and mobile Escape restores the navigation trigger', () => {
  const h = setup();
  try {
    h.pathname = '/'; h.search = '?sort=score';
    h.render(CommunityNavigation, {});
    let selected = nodes(h.tree).filter(n => n.props?.['aria-current'] === 'page');
    assert.equal(selected.length, 1);
    assert.equal(selected[0].props.href, '/?sort=score');
    h.search = ''; h.render();
    selected = nodes(h.tree).filter(n => n.props?.['aria-current'] === 'page');
    assert.equal(selected[0].props.href, '/');
  } finally { h.close(); }
  const header = setup();
  try {
    header.slots = []; header.effects = [];
    header.render(SiteHeader);
    const menu = nodes(header.tree).find(n => n.type === 'details');
    let focused = false;
    menu.props.ref.current = { open: true, querySelector: () => ({ focus: () => { focused = true; } }) };
    menu.props.onKeyDown({ key: 'Escape' });
    assert.equal(menu.props.ref.current.open, false);
    assert.equal(focused, true);
  } finally { header.close(); }
});

test('initial session loading still renders Google and email before the introduction', async () => {
  const h = setup({ loading: true });
  try {
    assert.equal(nodes(h.tree).find(n => n.type === 'section').props.id, 'sign-in');
    assert.equal(byText(h, 'button', 'Continue with Google').props.disabled, true);
    assert.equal(field(h, 'Email address').props.disabled, true);
    await h.settle();
    assert.equal(h.calls.filter(c => c.name === 'requestCode').length, 0);
    byText(h, 'button', 'Continue with Google').props.onClick();
    assert.equal(h.calls.filter(c => c.name === 'signInWithProvider').length, 0);
    const delayed = [...h.timers.values()].find(t => t.ms === 8000);
    assert(delayed); delayed.fn(); h.render();
    byText(h, 'button', 'Reload sign-in').props.onClick();
    assert.equal(h.reloads, 1);
    h.auth.loading = false; h.render(); await h.settle();
    assert.equal(byText(h, 'button', 'Continue with Google').props.disabled, false);
    assert.equal(field(h, 'Email address').props.disabled, false);
    assert(!textOf(h.tree).includes('longer than expected'));
  } finally { h.close(); }
});

test('failed provider settings leave email usable and Retry recovers Google', async () => {
  const h = setup();
  h.handlers.getAuthMethods = async () => { throw new Error('private provider response'); };
  try {
    await h.settle();
    assert.equal(byText(h, 'button', 'Continue with Google').props.disabled, true);
    assert.equal(field(h, 'Email address').props.disabled, false);
    assert(!textOf(h.tree).includes('private provider'));
    h.handlers.getAuthMethods = async () => ({ google: true });
    byText(h, 'button', 'Retry').props.onClick(); h.render(); await h.settle();
    assert.equal(byText(h, 'button', 'Continue with Google').props.disabled, false);
  } finally { h.close(); }
});

test('Google receives the safe callback and repeated clicks start only one flow', async () => {
  const h = setup({ search: '?next=%2Fmessages' });
  const pending = deferred(); h.handlers.signInWithProvider = () => pending.promise;
  try {
    await h.settle();
    const click = byText(h, 'button', 'Continue with Google').props.onClick;
    click(); click();
    const calls = h.calls.filter(c => c.name === 'signInWithProvider');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args[0], 'google');
    const callback = new URL(calls[0].args[2]);
    assert.equal(callback.origin, 'https://visathreads.example');
    assert.equal(callback.pathname, '/login');
    assert.equal(callback.searchParams.get('next'), '/messages');
    pending.reject(new Error('Supabase private provider error')); await h.settle();
    assert(textOf(h.tree).includes('We couldn’t complete sign-in'));
    assert(!textOf(h.tree).includes('Supabase'));
  } finally { h.close(); }
});

test('email code flow shows VisaThreads and retains its return destination', async () => {
  const h = setup({ search: '?next=%2Fmy-communities' });
  try {
    await h.settle(); change(h, 'Email address', 'fixture@example.invalid');
    nodes(h.tree).find(n => n.type === 'form').props.onSubmit(event()); await h.settle();
    const call = h.calls.find(c => c.name === 'requestCode');
    assert.equal(new URL(call.args[1]).searchParams.get('next'), '/my-communities');
    assert(textOf(h.tree).includes('VisaThreads sign-in email'));
    assert(field(h, 'Sign-in code'));
    assert(byText(h, 'button', 'Resend in 60s').props.disabled);
  } finally { h.close(); }
});

test('password is an available alternative and provider failure does not block it', async () => {
  const h = setup();
  h.handlers.getAuthMethods = async () => { throw new Error('offline'); };
  try {
    await h.settle(); byText(h, 'button', 'Use a password instead').props.onClick(); h.render();
    change(h, 'Email address', 'fixture@example.invalid'); change(h, 'Password', 'fixture-only-password');
    nodes(h.tree).find(n => n.type === 'form').props.onSubmit(event()); await h.settle();
    assert.equal(h.calls.filter(c => c.name === 'login').length, 1);
    assert.equal(field(h, 'Password').props.value, '');
  } finally { h.close(); }
});

test('an authenticated account returns even while its public profile is loading', async () => {
  const h = setup({ loading: true, user: { id: 'fixture-user' }, search: '?next=%2Fmessages' });
  try { await h.settle(); assert.deepEqual(h.replacements, ['/messages']); }
  finally { h.close(); }
});

test('authenticated redirects reject offsite return paths', async () => {
  const h = setup({ user: { id: 'fixture-user' }, search: '?next=%2F%2Fevil.invalid' });
  try { await h.settle(); assert.deepEqual(h.replacements, ['/']); }
  finally { h.close(); }
});

test('signup still sends a verified user to password setup', async () => {
  const h = setup({ signup: true, user: { id: 'fixture-user' } });
  try { await h.settle(); assert.deepEqual(h.replacements, ['/account/update-password?setup=1']); }
  finally { h.close(); }
});

test('cancelled callbacks remove provider error details and preserve a safe retry', async () => {
  const h = setup({ search: '?auth=callback&error=provider_error&error_description=Supabase-details&next=%2Fmessages' });
  try {
    await h.settle();
    assert.deepEqual(h.cleanUrls, ['/login?next=%2Fmessages#sign-in']);
    assert(textOf(h.tree).includes('Sign-in wasn’t completed'));
    assert(!textOf(h.tree).includes('Supabase'));
  } finally { h.close(); }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Runs the real home rail and intake-group client against a fake PostgREST
// builder with deterministic hooks. No hosted database or browser is used.
const require = createRequire(import.meta.url);
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const jsx = pathToFileURL(require.resolve('react/jsx-runtime')).href;
const hooks = dataUrl(['useState', 'useEffect', 'useMemo'].map((name) => `export function ${name}(...args){return globalThis.__panel.${name}(...args);}`).join('\n'));
const transpile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function link(source, dependencies) {
  return dataUrl(transpile(source).replace(/(from\s+)(['"])([^'"]+)\2/g, (_match, prefix, _quote, name) => {
    if (name === 'lucide-react') {
      const names = source.match(/import\s*\{([^}]+)\}\s*from\s*'lucide-react'/)[1].split(',').map((item) => item.trim());
      return prefix + JSON.stringify(dataUrl(`function Icon(){return null;} export {${names.map((item) => `Icon as ${item}`).join(',')}};`));
    }
    assert(dependencies[name], `Unmapped dependency ${name}`);
    return prefix + JSON.stringify(dependencies[name]);
  }));
}
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
// A chainable stand-in for the Supabase query builder that records every call.
const supabase = dataUrl(`export const isSupabaseConfigured=true;
  export function getSupabase(){const h=globalThis.__panel;return {
    from(table){const q={table,ops:[]};const chain=new Proxy({}, {get(_t,key){
      if(key==='then'){const result=h.onSelect(q);return (yes,no)=>Promise.resolve(result).then(yes,no);}
      return (...args)=>{q.ops.push([key,...args]);return chain;};}});h.selects.push(q);return chain;},
    async rpc(name,args){h.rpcs.push({name,args});return h.onRpc(name,args);}};}`);
const lib = link(await read('../src/lib/intake-groups.ts'), { './supabase/client': supabase });
const { upcomingIntakes, normalizeUniversity } = await import(lib);
const categories = dataUrl(transpile(await read('../src/lib/post-categories.ts')));
const { VISA_TYPES } = await import(categories);
const panelSource = await read('../src/components/HomeSidePanel.tsx');
const { HomeSidePanel, VisaGroups, VisaExperiences } = await import(link(panelSource, {
  react: hooks, 'react/jsx-runtime': jsx,
  'next/link': dataUrl(`import {jsx} from ${JSON.stringify(jsx)}; export default function Link(props){return jsx('a',props);}`),
  'next/navigation': dataUrl('export function usePathname(){return globalThis.__panel.pathname;} export function useSearchParams(){return new URLSearchParams(globalThis.__panel.search);}'),
  './AuthProvider': dataUrl('export function useAuth(){return globalThis.__panel.auth;}'),
  '@/lib/post-categories': categories, '@/lib/intake-groups': lib,
  './HomeSidePanel.module.css': dataUrl('export default {panel:"panel",groups:"groups",groupList:"groupList",experiences:"experiences",related:"related"};'),
}));

const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
const wait = (ms = 2) => new Promise((resolve) => setTimeout(resolve, ms));
const member = '11111111-1111-4111-8111-111111111111';
const group = (university, slug, count = 3) => ({ id: `22222222-2222-4222-8222-${String(count).padStart(12, '0')}`, slug, display_name: university.replace(/\W/g, ''), university, member_count: count });
class Harness {
  slots = []; index = 0; effects = []; dirty = false; selects = []; rpcs = [];
  pathname = '/us/en'; search = 'visa=H-1B&sort=score'; auth = { user: { id: member } };
  onSelect = () => ({ data: [], error: null });
  onRpc = () => ({ data: null, error: { message: 'unexpected' } });
  useState(initial) {
    const index = this.index++;
    if (!(index in this.slots)) this.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [this.slots[index], (next) => { const value = typeof next === 'function' ? next(this.slots[index]) : next; if (!Object.is(value, this.slots[index])) { this.slots[index] = value; this.dirty = true; } }];
  }
  useMemo(fn, deps) { const index = this.index++; if (!same(this.slots[index]?.deps, deps)) this.slots[index] = { deps, value: fn() }; return this.slots[index].value; }
  useEffect(fn, deps) {
    const index = this.index++;
    if (!same(this.slots[index]?.deps, deps)) { this.slots[index]?.cleanup?.(); const slot = this.slots[index] = { deps }; this.effects.push(() => { slot.cleanup = fn(); }); }
  }
  render(component = this.component, props = this.props) { this.component = component; this.props = props; this.index = 0; this.dirty = false; globalThis.__panel = this; this.tree = component(props); return this.tree; }
  async settle() {
    for (let round = 0; round < 20; round++) {
      for (const effect of this.effects.splice(0)) effect();
      await wait();
      if (!this.dirty && !this.effects.length) return;
      this.render();
    }
    assert.fail('Panel did not settle');
  }
  close() { for (const slot of this.slots) slot?.cleanup?.(); delete globalThis.__panel; }
}
function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.props?.children)] : []; }
function textOf(node) { return Array.isArray(node) ? node.map(textOf).join('') : node == null || typeof node === 'boolean' ? '' : typeof node === 'object' ? textOf(node.props?.children) : String(node); }
const find = (h, predicate, label) => { const result = nodes(h.tree).find(predicate); assert(result, `Missing ${label}`); return result; };
const button = (h, label) => find(h, (node) => node.type === 'button' && textOf(node).trim() === label, `${label} button`);
const form = (h) => find(h, (node) => node.type === 'form', 'form');
const field = (h) => find(h, (node) => node.type === 'input', 'university field');
async function submitUniversity(h, value) { field(h).props.onChange({ target: { value } }); h.render(); await form(h).props.onSubmit({ preventDefault() {} }); h.render(); await h.settle(); }
const pressed = (h, group) => nodes(find(h, (node) => node.props?.role === 'group' && node.props['aria-label'] === group, group)).filter((node) => node.type === 'button' && node.props['aria-pressed']).map((node) => textOf(node));
const filters = (query) => Object.fromEntries(query.ops.filter(([op]) => op === 'eq' || op === 'is').map(([, key, value]) => [key, value]));
async function click(h, label) { button(h, label).props.onClick(); h.render(); await h.settle(); }

test('upcoming intakes roll forward from the current date instead of a fixed year', () => {
  assert.deepEqual(upcomingIntakes(new Date(2026, 10, 22), 4).map((item) => item.label), ['Spring 2027', 'Fall 2027', 'Spring 2028', 'Fall 2028']);
  assert.deepEqual(upcomingIntakes(new Date(2027, 0, 15), 4).map((item) => item.label), ['Spring 2027', 'Fall 2027', 'Spring 2028', 'Fall 2028']);
  assert.deepEqual(upcomingIntakes(new Date(2027, 1, 1), 4).map((item) => item.label), ['Fall 2027', 'Spring 2028', 'Fall 2028', 'Spring 2029']);
  assert.equal(upcomingIntakes(new Date(2026, 10, 22)).length, 3, 'Three intakes fit one row in the rail');
  assert.deepEqual(upcomingIntakes(new Date(2027, 7, 30), 2).map((item) => item.key), ['fall-2027', 'spring-2028']);
  assert.equal(normalizeUniversity('  Arizona   State University '), 'Arizona State University');
  for (const bad of ['MI', '12345', '<b>x</b>', 'U'.repeat(61)]) assert.throws(() => normalizeUniversity(bad), /3–60/);
});

test('rail uses one tab strip for Groups and Experiences, then the related posts it is given', () => {
  const h = new Harness();
  try {
    const tree = h.render(HomeSidePanel, { visaType: 'H-1B', children: 'RELATED CONTENT' });
    const [top, related] = tree.props.children;
    assert.equal(top.props['aria-label'], 'Groups and experiences');
    const tabs = nodes(top).filter((node) => node.props?.role === 'tab').map((node) => textOf(node).trim());
    assert.deepEqual(tabs, ['Groups', 'Experiences']);
    const panels = nodes(top).filter((node) => node.props?.role === 'tabpanel');
    assert.equal(panels.length, 2);
    assert.equal(panels[0].props.hidden, false, 'Groups is the default tab');
    assert.equal(panels[1].props.hidden, true, 'Experiences waits for its tab');
    assert.equal(nodes(panels[0]).find((node) => node.type === VisaGroups)?.props.visaType, 'H-1B');
    assert.equal(related.props['aria-label'], 'Related posts');
    assert.equal(related.props.children, 'RELATED CONTENT');
    assert.match(related.props.className, /feed-discovery/);
  } finally { h.close(); }
});
test('every visa lists its groups; only F-1 adds Spring and Fall intakes', async () => {
  const h = new Harness();
  const intakes = upcomingIntakes(new Date(), 3);
  h.onSelect = (query) => ({ data: filters(query).group_visa_type === 'H-1B' ? [group('Stanford University', 'h1b-stanford-university-ab12', 2)] : filters(query).group_visa_type === 'F-1 / OPT' ? [group('Arizona State University', 'f1-fall27-arizona-state-ab12', 4)] : [], error: null });
  try {
    h.render(VisaGroups, { visaType: 'H-1B' }); await h.settle();
    assert.deepEqual(pressed(h, 'Group visa type'), ['H1B']);
    assert.equal(nodes(h.tree).some((node) => node.props?.role === 'group' && /intake$/.test(node.props['aria-label'] ?? '')), false, 'No intake tabs for H1B');
    assert.doesNotMatch(textOf(h.tree), /coming soon/i, 'No placeholder');
    assert.deepEqual(filters(h.selects[0]), { group_visa_type: 'H-1B', intake_term: null }, 'Non-F-1 groups are listed without an intake');
    assert.equal(find(h, (node) => typeof node.props?.href === 'string' && textOf(node).includes('Stanford University'), 'H1B group').props.href, '/us/en/c/h1b-stanford-university-ab12');
    await click(h, 'F1 / OPT');
    assert.deepEqual(pressed(h, 'F1 / OPT intake'), [intakes[0].label]);
    assert.deepEqual(filters(h.selects.at(-1)), { group_visa_type: 'F-1 / OPT', intake_term: intakes[0].term, intake_year: intakes[0].year });
    assert(h.selects.at(-1).ops.some(([op, n]) => op === 'limit' && n === 24), 'Group reads are bounded');
    await click(h, intakes[1].label);
    assert.deepEqual(filters(h.selects.at(-1)), { group_visa_type: 'F-1 / OPT', intake_term: intakes[1].term, intake_year: intakes[1].year });
    assert.match(textOf(find(h, (node) => typeof node.props?.href === 'string' && textOf(node).includes('Arizona State University'), 'F1 group')), /4 members/);
    const before = h.selects.length; await click(h, intakes[1].label);
    assert.equal(h.selects.length, before, 'Re-selecting the current intake does not refetch');
  } finally { h.close(); }
});
test('signed-in members create F-1 intake groups and university groups for other visas', async () => {
  const h = new Harness();
  const intakes = upcomingIntakes(new Date(), 3);
  const made = [];
  h.onSelect = (query) => ({ data: made.filter((item) => item.visa === filters(query).group_visa_type).map((item) => group(item.name, item.slug, 1)), error: null });
  h.onRpc = (_name, args) => { const slug = args.target_visa === 'H-1B' ? 'h1b-arizona-state-ab12' : 'f1-spring27-arizona-state-ab12'; made.push({ visa: args.target_visa, name: args.university_name, slug }); return { data: { id: '22222222-2222-4222-8222-000000000001', slug, created: true }, error: null }; };
  try {
    h.render(VisaGroups, { visaType: 'F-1 / OPT' }); await h.settle();
    await click(h, 'Create group');
    assert.equal(field(h).props.autoFocus, true); assert.equal(field(h).props.maxLength, 60);
    assert(nodes(h.tree).some((node) => node.type === 'label' && node.props.htmlFor === 'visa-group-university' && textOf(node).includes(`F1 / OPT · ${intakes[0].label}`)));
    await submitUniversity(h, 'X');
    assert.equal(h.rpcs.length, 0, 'Invalid names never reach the server');
    assert.match(textOf(h.tree), /3–60 letters/);
    field(h).props.onChange({ target: { value: 'Arizona' } }); h.render();
    assert.doesNotMatch(textOf(h.tree), /3–60 letters/, 'Typing clears the error');
    await submitUniversity(h, '  Arizona  State University ');
    assert.deepEqual(h.rpcs.at(-1), { name: 'create_intake_group', args: { target_visa: 'F-1 / OPT', target_term: intakes[0].term, target_year: intakes[0].year, university_name: 'Arizona State University', expected_user: member } });
    assert.match(textOf(h.tree), /Group created: Open Arizona State University/);
    assert(!nodes(h.tree).some((node) => node.type === 'form'), 'Form closes after success');
    await click(h, 'H1B');
    await click(h, 'Create group');
    await submitUniversity(h, 'Arizona State University');
    assert.deepEqual(h.rpcs.at(-1).args, { target_visa: 'H-1B', target_term: null, target_year: null, university_name: 'Arizona State University', expected_user: member }, 'Non-F-1 groups are created without an intake');
    assert(nodes(h.tree).some((node) => node.props?.href === '/us/en/c/h1b-arizona-state-ab12'));
  } finally { h.close(); }
});
test('an existing group is offered instead of a duplicate, and server errors stay in the form', async () => {
  const h = new Harness();
  const responses = [
    { data: { id: '22222222-2222-4222-8222-000000000009', slug: 'h1b-stanford-university-cd34', created: false }, error: null },
    { data: null, error: { code: 'P0001', message: 'Too many requests. Please try again later.' } },
  ];
  h.onRpc = () => responses.shift();
  try {
    h.render(VisaGroups, { visaType: 'H-1B' }); await h.settle();
    await click(h, 'Create group');
    await submitUniversity(h, 'Stanford University');
    assert.match(textOf(h.tree), /This group already exists: Open Stanford University/);
    await click(h, 'Create group');
    field(h).props.onChange({ target: { value: 'Another University' } }); h.render();
    await form(h).props.onSubmit({ preventDefault() {} }); h.render();
    assert.match(textOf(find(h, (node) => node.props?.role === 'alert', 'alert')), /several groups today/);
    assert.equal(field(h).props.value, 'Another University', 'Draft is kept after an error');
    await click(h, 'Cancel');
    assert(!nodes(h.tree).some((node) => node.type === 'form'));
  } finally { h.close(); }
});
test('signed-out visitors see groups and a login link that returns to the same page', async () => {
  const h = new Harness();
  h.auth = { user: null };
  try {
    h.render(VisaGroups, {}); await h.settle();
    assert.deepEqual(pressed(h, 'Group visa type'), ['F1 / OPT'], 'Defaults to the first group visa');
    const login = find(h, (node) => typeof node.props?.href === 'string' && textOf(node).includes('Create group'), 'login link');
    assert.equal(login.props.href, `/login?next=${encodeURIComponent('/us/en?visa=H-1B&sort=score')}#sign-in`);
    assert(!nodes(h.tree).some((node) => node.type === 'button' && /Create group/.test(textOf(node))));
    assert.equal(h.selects.length, 1, 'Groups are still listed for visitors');
  } finally { h.close(); }
});
test('group load failures explain the problem and retry, keeping Create available', async () => {
  const h = new Harness();
  let fail = true;
  h.onSelect = () => fail ? { data: null, error: { code: '42P01', message: 'relation missing' } } : { data: [], error: null };
  try {
    h.render(VisaGroups, {}); await h.settle();
    assert.match(textOf(h.tree), /not available on this environment yet/);
    assert(nodes(h.tree).some((node) => node.type === 'button' && textOf(node).includes('Create group')));
    fail = false; await click(h, 'Retry');
    assert.match(textOf(h.tree), /No groups yet\. Create the first one\./);
  } finally { h.close(); }
});

test('the rail puts Create group in the top-right of the Groups tab and opens the form below', async () => {
  const h = new Harness();
  try {
    let tree = h.render(HomeSidePanel, { visaType: 'H-1B', children: 'RELATED' });
    const strip = tree.props.children[0].props.children[0];
    const [tabs, action] = strip.props.children;
    assert.equal(tabs.props.role, 'tablist');
    assert.equal(textOf(action).trim(), 'Create group', 'Create sits beside the tabs on the right');
    assert.match(strip.props.className, /justify-between/);
    action.props.onClick(); tree = h.render();
    assert.equal(tree.props.children[0].props.children[0].props.children[1].props['aria-expanded'], true);
    const groups = nodes(tree).find((node) => node.type === VisaGroups);
    assert.equal(groups.props.formOpen, true, 'The rail opens the groups form');
    h.auth = { user: null }; tree = h.render();
    const login = tree.props.children[0].props.children[0].props.children[1];
    assert.equal(login.props.href, `/login?next=${encodeURIComponent('/us/en?visa=H-1B&sort=score')}#sign-in`);
  } finally { h.close(); }
});
test('experiences offer one entry per visa type linking to its filtered experiences section', () => {
  const h = new Harness();
  try {
    h.render(VisaExperiences, {});
    const links = nodes(h.tree).filter((node) => typeof node.props?.href === 'string');
    assert.equal(links.length, VISA_TYPES.length);
    for (const [index, visa] of VISA_TYPES.entries()) {
      assert.equal(links[index].props.href, `/us/en/experiences?${new URLSearchParams({ visa })}`);
      assert.equal(links[index].props['aria-label'], `${visa} experiences`);
    }
  } finally { h.close(); }
});

test('rail: Groups and Experiences size to content up to a quarter, without scrollbars; phones stack naturally', async () => {
  const css = await read('../src/components/HomeSidePanel.module.css');
  const desktop = css.slice(css.indexOf('@container post-layout (min-width: 1000px)'));
  const rule = (name) => desktop.match(new RegExp(`\\.${name} \\{([^}]+)\\}`))[1];
  assert.match(rule('top'), /flex: 0 0 auto/, 'Sized to its content');
  assert.match(rule('top'), /max-height: 25%/, 'At most a quarter of the rail');
  assert.match(rule('body'), /scrollbar-width: none/, 'No visible scrollbar');
  assert.match(desktop, /\.body::-webkit-scrollbar \{ display: none; \}/);
  assert.match(rule('related'), /flex: 1 1 0/); assert.match(rule('related'), /overflow-y: auto/);
  assert.match(rule('panel'), /height: 100%/, 'The rail fills the posts height');
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(plain.slice(0, plain.indexOf('@container')), /height|flex: 0 0/, 'Phones keep natural heights');
  assert.doesNotMatch(panelSource, /\bw-\[\d|min-w-\[\d|whitespace-nowrap|overflow-x-hidden|coming soon/i);
  const home = await read('../src/components/CommunityHome.tsx');
  assert.match(home, /related=\{<HomeSidePanel visaType=\{visaType\}><div id="home-feed-aside"/);
  assert(home.indexOf('<RelatedQuestions') > home.indexOf('<HomeSidePanel') && home.indexOf('</HomeSidePanel>') > home.indexOf('Topics in This Feed'));
});
test('home fills the viewport: title-only header, compact filters below it, scrolling post list', async () => {
  const home = await read('../src/components/CommunityHome.tsx');
  const globals = await read('../src/styles/globals.css');
  const header = home.slice(home.indexOf('<header className="home-heading'), home.indexOf('</header>'));
  assert.match(home, /<main className="page-shell home-workspace">/);
  assert.match(home, /<ResizablePostLayout fill className="home-fit min-h-0 flex-1"/);
  assert.doesNotMatch(header, /<p /, 'No description under the title');
  for (const control of ['Search visa questions', 'aria-label="Experience category"', 'aria-label="Post source"', 'aria-label="Filter by visa"', '>Experience</Link>'])
    assert(header.indexOf(control) > header.indexOf('feed-toolbar'), `${control} sits in the filters below the title`);
  assert.match(header, /lg:inline-flex"><span className="sr-only">Sort<\/span><select/, 'Desktop uses one compact sort control');
  assert.match(header, /aria-label=\{experience \? 'Sort experiences' : 'Sort questions'\} className="flex items-center gap-1 overflow-x-auto overscroll-x-contain \[scrollbar-width:none\] lg:hidden"/, 'Phones keep sort buttons in one scrolling row');
  assert.match(home, /id="question-list" aria-label="Community questions" aria-busy=\{loading\} className="mt-1\.5 min-w-0 lg:mt-1 scroll-mt-24 lg:min-h-0 lg:flex-1 lg:overflow-y-auto/, 'Only the posts scroll on desktop');
  assert.match(globals, /#main-content > \.home-workspace \{ container: home-workspace \/ inline-size;/);
  assert.match(globals, /@container home-workspace \(min-width: 1000px\) \{\s*\.home-fit \{ height: calc\(100dvh - 65px - 22px\); \}/);
});

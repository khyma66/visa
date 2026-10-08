import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const reactUrl = import.meta.resolve('react');
const dependencies = {
  'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'),
  react: asModule(`export function useState(initial){const s=globalThis.__accountPresentation;const index=s.index++;return [Object.hasOwn(s.values,index)?s.values[index]:(typeof initial==='function'?initial():initial),value=>s.updates.push([index,value])];}
    export function useRef(initial){const s=globalThis.__accountPresentation;const index=s.refIndex++;return {current:Object.hasOwn(s.refs,index)?s.refs[index]:initial};}
    export function useEffect(effect){globalThis.__accountPresentation.effects.push(effect);}`),
  'next/link': asModule(`import React from ${JSON.stringify(reactUrl)};export default props=>React.createElement('a',props,props.children);`),
  'next/navigation': asModule(`export const useSearchParams=()=>new URLSearchParams(globalThis.__accountPresentation.query);
    export const usePathname=()=>'/account';export const useRouter=()=>({replace(path){globalThis.__accountPresentation.events.push(['redirect',path]);}});`),
  'lucide-react': import.meta.resolve('lucide-react'),
  './AuthProvider': asModule('export const useAuth=()=>globalThis.__accountPresentation.auth;'),
  './CommunityNavigation': asModule('export const CommunityNavigation=()=>null;'),
  './Avatar': asModule(`import React from ${JSON.stringify(reactUrl)};export const Avatar=({name})=>React.createElement('span',{'data-public-avatar-name':name,'aria-hidden':true},'Avatar');`),
  '@/lib/supabase/client': asModule('export const getSupabase=()=>{throw new Error("Network prohibited in presentation tests");};'),
  '@/lib/account': asModule('const unavailable=()=>{throw new Error("Network prohibited in presentation tests")};export const getAccountActivity=unavailable,getAccountIdentity=unavailable,hasAccountPolicyAcceptance=unavailable,saveProfileBio=unavailable;'),
  '@/lib/policy': asModule("export const POLICY_VERSION='current-test-version';"),
};
async function load(relativePath, extra = '') {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  let code = ts.transpileModule(source + extra, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const [specifier, replacement] of Object.entries(dependencies)) code = code.replaceAll(`from '${specifier}'`, `from ${JSON.stringify(replacement)}`).replaceAll(`from "${specifier}"`, `from ${JSON.stringify(replacement)}`);
  return import(asModule(code));
}
const { AccountClient, Activity, AccountSettings } = await load('../src/components/AccountClient.tsx', '\nexport { Activity, AccountSettings };');
const { SiteHeader } = await load('../src/components/SiteHeader.tsx');
const profile = { id: 'member-one', username: 'calm-heron', avatar_seed: 'private-uuid-seed', bio: null, reputation: 7 };
function setup({ values = {}, refs = {}, query = '', auth = {} } = {}) {
  const state = { index: 0, refIndex: 0, values, refs, query, effects: [], updates: [], events: [],
    auth: { user: { id: 'member-one', email: 'private@example.invalid' }, profile, loading: false, profileLoading: false, demoMode: false, refreshProfile: async () => {}, ...auth } };
  state.auth.signOut ??= async () => { state.events.push(['signOut']); };
  globalThis.__accountPresentation = state;
  return state;
}
function render(Component = AccountClient, options = {}, props = {}) {
  setup(options);
  try { return renderToStaticMarkup(React.createElement(Component, props)); }
  finally { delete globalThis.__accountPresentation; }
}
const buttons = html => [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]);
const button = (html, label) => buttons(html).find(markup => markup.includes(label));
const links = html => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(([, href, body]) => ({ href: href.replaceAll('&amp;', '&'), label: body.replace(/<[^>]+>/g, '').trim() }));

test('signed-out account tabs require login and preserve only a recognized return destination', () => {
  for (const tab of ['profile', 'activity', 'settings', '//evil.invalid']) {
    const html = render(AccountClient, { query: `tab=${tab}`, auth: { user: null, profile: null } });
    const login = links(html).find(link => link.label === 'Log in');
    assert.equal(new URL(login.href, 'https://visathreads.com').searchParams.get('next'), `/account?tab=${tab.startsWith('//') ? 'profile' : tab}`);
    assert.doesNotMatch(html, /private@example|calm-heron|Account email|Save profile/);
  }
  assert.match(render(AccountClient, { auth: { loading: true, user: null, profile: null } }), /Loading your account/);
});

test('profile shows only public fields, real reputation and correctly escaped text', () => {
  const html = render();
  assert.match(html, /calm-heron/);
  assert.match(html, />7<\/dd>/);
  assert.match(html, /You have not added a bio yet/);
  assert.match(html, /first-name initial/);
  assert.match(html, /Your full name stays private/);
  assert.doesNotMatch(html, /private@example|private-uuid-seed|Account email/);
  assert.match(render(AccountClient, { auth: { profile: { ...profile, bio: '<script>alert("test")</script>' } } }), /&lt;script&gt;/);
  assert(links(html).some(link => link.label === 'Edit profile' && link.href === '/account?tab=settings'));
  assert(links(html).some(link => link.label === 'Messages' && link.href === '/messages'));
});

test('failed profile reads offer retry instead of endless loading or a false empty bio', () => {
  const loading = render(AccountClient, { auth: { profile: null, profileLoading: true } });
  assert.match(loading, /Loading your community profile/);
  assert.doesNotMatch(loading, /Retry profile|Your bio could not be loaded/);
  const failure = render(AccountClient, { auth: { profile: null, profileLoading: false } });
  assert.match(failure, /Retry profile/);
  assert.match(failure, /Unavailable/);
  assert.match(failure, /Your bio could not be loaded/);
  assert.doesNotMatch(failure, /Loading…|You have not added a bio yet/);
});

test('activity distinguishes loading, empty questions, empty answers and retryable errors', () => {
  assert.match(render(Activity, {}, { userId: profile.id }), /Loading your questions/);
  for (const kind of ['questions', 'answers']) {
    const html = render(Activity, { values: { 0: kind, 4: false }, refs: { 0: `${profile.id}:${kind}:0` } }, { userId: profile.id });
    assert.match(html, new RegExp(`No ${kind} yet`));
    assert.match(button(html, 'Previous'), /disabled=""/);
    assert.match(button(html, 'Next'), /disabled=""/);
    assert(links(html).some(link => link.href === (kind === 'questions' ? '/ask' : '/')));
  }
  const failed = render(Activity, { values: { 4: false, 5: 'Your activity could not be loaded. Please try again.' } }, { userId: profile.id });
  assert.match(failed, /role="alert"/);
  assert(button(failed, 'Try again'));
});

test('activity uses actual question/answer destinations and preserves pagination boundaries', () => {
  const item = { id: 'answer-one', question_id: 'question-one', body: 'Useful answer text', vote_score: 3, is_accepted: true, created_at: '2026-10-05T12:00:00Z' };
  const html = render(Activity, { values: { 0: 'answers', 1: 1, 2: [item], 3: true, 4: false }, refs: { 0: `${profile.id}:answers:1` } }, { userId: profile.id });
  assert(links(html).some(link => link.href === '/questions/question-one'));
  assert.match(html, /Accepted answer/);
  assert.match(html, /3 votes/);
  assert.doesNotMatch(button(html, 'Next'), /disabled=""/);
  assert.doesNotMatch(button(html, 'Previous'), /disabled=""/);
  assert.doesNotMatch(html, /private@example/);
});

test('settings waits for policy verification and distinguishes acceptance needed from query failure', () => {
  for (const status of ['loading', 'required', 'error']) {
    const html = render(AccountSettings, { values: { 0: 'Changed bio', 3: status } });
    assert.match(button(html, 'Save profile'), /disabled=""/);
    if (status === 'loading') { assert.match(html, /Checking profile editing access/); assert.doesNotMatch(html, /role="alert"/); }
    if (status === 'required') assert(links(html).some(link => link.href === '/' && link.label === 'Review community terms to edit your profile'));
    if (status === 'error') assert(button(html, 'Try again'));
  }
  const accepted = render(AccountSettings, { values: { 0: 'Changed bio', 3: 'accepted' } });
  assert.doesNotMatch(button(accepted, 'Save profile'), /disabled=""/);
  assert.match(accepted, /maxLength="280"/);
  assert.doesNotMatch(accepted, /<input[^>]*name="username"/);
});

test('verified settings keep account email explicitly private and hide password action for phone-only identity', () => {
  const html = render(AccountSettings, { values: { 1: { email: 'private@example.invalid', providers: ['google'], emailVerified: true }, 3: 'accepted' } });
  assert.match(html, /Private to you/);
  assert.match(html, /private@example.invalid/);
  assert.match(html, /Google/);
  assert(links(html).some(link => link.href === '/account/update-password'));
  assert(links(html).some(link => link.href === '/privacy-choices'));
  assert(links(html).some(link => link.href === '/contact'));
  const phone = render(AccountSettings, { values: { 1: { email: null, providers: ['phone'], emailVerified: false } } });
  assert.match(phone, /No email linked/);
  assert.doesNotMatch(phone, /account\/update-password/);
  const failure = render(AccountSettings, { values: { 2: 'We could not verify your sign-in details.' } });
  assert.match(failure, /role="alert"/);
  assert(button(failure, 'Try again'));
});

test('each profile-menu link points to its implemented destination', () => {
  const html = render(SiteHeader, { values: { 0: true } });
  const menuLinks = links(html);
  for (const href of ['/account?tab=profile', '/account?tab=activity', '/account?tab=settings', '/messages', '/privacy-choices']) assert(menuLinks.some(link => link.href === href), `missing menu link ${href}`);
  assert(button(html, 'Use a different account'));
  assert(button(html, 'Sign out'));
  assert.match(html, /visible only to you/);
  const signedOut = render(SiteHeader, { auth: { user: null, profile: null } });
  assert.doesNotMatch(signedOut, /Account options|private@example/);
  assert(links(signedOut).some(link => link.href === '/login#sign-in'));
});

function elementText(element) {
  if (typeof element === 'string') return element;
  if (Array.isArray(element)) return element.map(elementText).join('');
  return element?.props ? elementText(element.props.children) : '';
}
function findButton(element, label) {
  if (!element) return null;
  if (Array.isArray(element)) return element.map(child => findButton(child, label)).find(Boolean);
  if (element.type === 'button' && elementText(element).includes(label)) return element;
  return findButton(element.props?.children, label);
}
function findAccountOptions(element) {
  if (!element) return null;
  if (Array.isArray(element)) return element.map(findAccountOptions).find(Boolean);
  if (element.type === 'nav' && element.props['aria-label'] === 'Account options') return element;
  return findAccountOptions(element.props?.children);
}
test('query-only navigation within account closes the profile-menu disclosure', () => {
  try {
    for (const tab of ['profile', 'activity', 'settings']) {
      const state = setup({ values: { 0: true }, query: 'tab=profile' });
      const options = findAccountOptions(SiteHeader());
      const choice = options.props.children.find(item => item.props.href === `/account?tab=${tab}`);
      assert(choice, `missing ${tab} account choice`);
      // The pathname stays /account; its nav click must close the menu itself.
      options.props.onClick({ target: choice });
      assert(state.updates.some(([index, value]) => index === 0 && value === false));
    }
  } finally { delete globalThis.__accountPresentation; }
});
test('switch-account and logout await successful sign-out before redirecting', async () => {
  try {
    for (const [label, path] of [['Use a different account', '/login'], ['Sign out', '/']]) {
      const state = setup({ values: { 0: true } });
      const tree = SiteHeader();
      findButton(tree, label).props.onClick();
      await Promise.resolve(); await Promise.resolve();
      assert.deepEqual(state.events, [['signOut'], ['redirect', path]]);
    }
    const failed = setup({ values: { 0: true }, auth: { signOut: async () => { throw new Error('Test failure'); } } });
    findButton(SiteHeader(), 'Sign out').props.onClick();
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(failed.events, []);
    assert(failed.updates.some(([, value]) => typeof value === 'string' && value.includes('Sign out failed')));
  } finally { delete globalThis.__accountPresentation; }
});

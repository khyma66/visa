import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import config from '../tailwind.config.mjs';
import './test-typography-pages.mjs';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('src/styles/globals.css', root), 'utf8');
// Check the real Tailwind output: layer reordering can break a rule that looks
// correct in the source stylesheet, especially the phone input font floor.
const output = await postcss([tailwindcss({ ...config, content: [{ extension: 'html', raw:
  '<div class="text-xs text-sm text-base text-lg text-xl text-2xl text-3xl text-4xl text-5xl text-thread-title header-search integrated-brand-logo header-secondary-action header-account site-brand feed-sort-button nav-item-active"></div>',
}] })]).process(source, { from: new URL('src/styles/globals.css', root).pathname });
const rules = [];
output.root.walkRules(rule => rules.push(rule));
const property = (rule, name) => rule.nodes.find(node => node.type === 'decl' && node.prop === name)?.value;
const base = rules.find(rule => rule.selector === ':root' && rule.parent.type === 'root');
const desktop = rules.find(rule => rule.selector === ':root' && rule.parent.params === '(min-width: 640px)');

test('all shared text utilities compile to the readable rem-based hierarchy', () => {
  const tokens = {
    '--type-meta': '0.75rem', '--type-ui': '1rem', '--type-body': '1rem',
    '--type-body-large': '1.125rem', '--type-body-title': '1.25rem', '--type-subheading': '1.25rem',
    '--type-title': '1.5rem', '--type-headline': '1.5rem', '--type-headline-large': '1.75rem', '--type-display': '1.75rem',
  };
  for (const [token, size] of Object.entries(tokens)) assert.equal(property(base, token), size, token);
  const aliases = { xs: 'meta', sm: 'ui', base: 'body', lg: 'body-large', xl: 'subheading', '2xl': 'title', '3xl': 'headline', '4xl': 'headline-large', '5xl': 'display', 'thread-title': 'body-title' };
  for (const [alias, token] of Object.entries(aliases)) {
    const rule = rules.find(rule => rule.selector === `.text-${alias}`);
    assert.equal(property(rule, 'font-size'), `var(--type-${token})`, alias);
  }
  const body = rules.filter(rule => rule.selector === 'body').at(-1);
  assert.equal(property(body, 'font-size'), 'var(--type-body)');
  assert.equal(property(body, 'line-height'), '1.5');
});

test('desktop headings stay restrained while reading, metadata and UI sizes stay stable', () => {
  assert.equal(property(desktop, '--type-headline'), '1.75rem');
  assert.equal(property(desktop, '--type-headline-large'), '2rem');
  assert.equal(property(desktop, '--type-display'), '2rem');
  for (const token of ['--type-body', '--type-ui', '--type-meta', '--type-body-title']) {
    assert.equal(property(desktop, token), undefined, `${token} must not shrink on phones`);
  }
  assert.equal(config.theme.extend.fontFamily.sans[0], '-apple-system');
  const body = rules.filter(rule => rule.selector === 'body').at(-1);
  assert.equal(property(body, 'font-family'), config.theme.extend.fontFamily.sans.join(', '));
  assert.doesNotMatch(source, /@import\s+url|@font-face/, 'No added font-download or privacy dependency');
});

test('sort controls match the reading font and respond without animation delay', () => {
  const sort = rules.find(rule => rule.selector === '.feed-sort-button');
  assert.equal(property(sort, 'font-size'), 'var(--type-body)');
  assert.equal(property(sort, 'font-weight'), '600');
  assert.equal(property(sort, 'line-height'), '1.5');
  assert.equal(property(sort, 'letter-spacing'), 'normal');
  assert.equal(property(sort, 'min-height'), '44px');
  assert.equal(property(sort, 'transition'), 'none');
  assert.equal(property(sort, 'cursor'), 'pointer');
  assert.equal(property(rules.find(rule => rule.selector === '.nav-item-active'), 'font-weight'), '600');
});

test('home uses a community heading and the same title scale in the discovery rail', async () => {
  const home = await readFile(new URL('src/components/CommunityHome.tsx', root), 'utf8');
  assert.match(home, /'U\.S\. Visa Community'/);
  assert.doesNotMatch(home, /'U\.S\. Visa Questions'/);
  for (const title of ['Find Your Community', 'Know the Source', 'Topics in This Feed']) {
    assert(home.includes(`text-thread-title font-semibold text-slate-900\">${title}</h2>`));
  }
  assert.doesNotMatch(home, /tracking-tight|tracking-\[0\.15em\]/);
});

test('compiled phone form floor wins against small utilities and the desktop header-search rule', () => {
  const floor = rules.find(rule => property(rule, 'font-size') === 'max(1rem, 16px)');
  assert(floor, 'Phone fields must remain at least 16px even with a smaller browser base font');
  assert.equal(floor.parent.params, '(max-width: 639px)');
  for (const selector of [":root input:not([type='checkbox']):not([type='radio'])", ':root textarea', ':root select', '.header-search input']) {
    assert(floor.selectors.includes(selector), `Missing cascade protection for ${selector}`);
  }
  for (const selector of ['.text-xs', '.text-sm', '.text-base', '.header-search input']) {
    const earlier = rules.find(rule => rule.selector === selector);
    assert(rules.indexOf(floor) > rules.indexOf(earlier), `${selector} must precede the phone override`);
  }
  assert.equal(property(floor, 'font-size'), 'max(1rem, 16px)');
});

test('post and assistant reading text use the shared body size with readable line spacing', async () => {
  const card = await readFile(new URL('src/components/QuestionCard.tsx', root), 'utf8');
  assert.match(card, /text-thread-title[^\n]+\n\s*\{question\.title\}/);
  assert.match(card, /text-base leading-6[^\n]+\{question\.body\}/);
  const detail = await readFile(new URL('src/components/QuestionDetail.tsx', root), 'utf8');
  assert.match(detail, /text-2xl font-semibold text-slate-950 sm:text-3xl">\{question.title\}/);
  assert.doesNotMatch(detail, /<h2 className="text-(?:2xl|xl) font-black/);
  for (const field of ['question', 'answer']) assert(detail.includes(`text-base leading-relaxed text-slate-800">{${field}.body}`));
  const assistant = await readFile(new URL('src/components/AssistantPanel.tsx', root), 'utf8');
  assert.match(assistant, /text-base leading-relaxed text-slate-800/);
  assert.match(assistant, /text-base leading-relaxed text-slate-700">\{post\.excerpt\}/);
  assert.match(assistant, /text-base leading-relaxed text-white" aria-label="Your message"/);
  assert.match(assistant, /text-xs leading-5 text-slate-600">Community experiences/);
});

test('component text never reintroduces unreadable arbitrary sizes below the 12px metadata floor', async () => {
  for (const filename of await readdir(new URL('src/components/', root))) {
    if (!filename.endsWith('.tsx')) continue;
    const content = await readFile(new URL(`src/components/${filename}`, root), 'utf8');
    for (const match of content.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
      assert(Number(match[1]) >= 12, `${filename}: ${match[0]} is below the metadata floor`);
    }
  }
});

test('logo geometry and narrow-screen behavior remain unchanged by typography', () => {
  const logo = rules.find(rule => rule.selector === '.integrated-brand-logo');
  assert.equal(property(logo, 'width'), '172px');
  assert.equal(property(logo, 'height'), '60px');
  assert.equal(property(logo, 'object-fit'), 'contain');
  assert.match(source, /\.site-brand:focus-visible\s*\{[^}]*outline:/);
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/);
});

test('phone header keeps account controls on the first row and the complete logo proportional', async () => {
  const phone = selector => rules.find(rule => rule.selector === selector && rule.parent.params === '(max-width: 639px)');
  assert.equal(property(phone('.site-brand'), 'min-width'), '130px');
  assert.equal(property(phone('.site-brand'), 'max-width'), '172px');
  assert.equal(property(phone('.site-brand'), 'flex'), '1 1 130px');
  assert.equal(property(phone('.integrated-brand-logo'), 'width'), '100%');
  assert.equal(property(phone('.integrated-brand-logo'), 'height'), 'auto');
  assert.equal(property(phone('.header-secondary-action'), 'display'), 'none');
  assert.equal(property(phone('.header-account, .header-login'), 'flex-shrink'), '0');
  const navigation = await readFile(new URL('src/components/CommunityNavigation.tsx', root), 'utf8');
  assert.match(navigation, /mobile \? \[\{ name: 'Create & Ask'/);
  assert.match(navigation, /href: '\/ask', label: 'Ask a Question'/);
  assert.match(navigation, /NEXT_PUBLIC_SITE_URL === 'https:\/\/visathreads\.com'[\s\S]*?href: '\/assistant'/);
});

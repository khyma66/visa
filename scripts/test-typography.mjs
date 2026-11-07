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
  '<div class="text-xs text-sm text-base text-lg text-xl text-2xl text-3xl text-4xl text-5xl text-thread-title site-header header-content header-search integrated-brand-logo header-action-group header-account header-account-panel header-auth-actions header-auth-button header-ask mobile-menu mobile-menu-panel mobile-menu-feedback community-shortcuts notification-icon site-brand feed-sort-button nav-item-active tab-row tab-row-centered"></div>',
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
  for (const title of ['Find Your Community', 'Member Discussions', 'Topics in This Feed']) {
    assert(home.includes(`text-thread-title font-semibold text-slate-900 capitalize\">${title}</h2>`));
  }
  assert.doesNotMatch(home, />Archive<|Community archive|Community Contributor/);
  assert.doesNotMatch(home, /identifies imported discussions|Member posts are created directly on VisaThreads|Topic tags work the same for both/);
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

test('post detail uses larger shared reading sizes while feed cards remain compact', async () => {
  const card = await readFile(new URL('src/components/QuestionCard.tsx', root), 'utf8');
  assert.match(card, /text-thread-title[^\n]+\n\s*\{question\.title\}/);
  assert.match(card, /text-base leading-6[^\n]+\{question\.body\}/);
  const detail = await readFile(new URL('src/components/QuestionDetail.tsx', root), 'utf8');
  assert.match(detail, /text-4xl font-semibold leading-tight text-slate-950">\{question.title\}/);
  assert.doesNotMatch(detail, /<h2 className="text-(?:2xl|xl) font-black/);
  for (const field of ['question', 'answer']) assert(detail.includes(`text-lg leading-relaxed text-slate-800">{${field}.body}`));
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
  assert.match(source, /\.integrated-brand-logo-frame\s*\{[^}]*width: 172px;[^}]*aspect-ratio: 3\.86 \/ 1;[^}]*overflow: hidden;/);
  assert.match(source, /\.integrated-brand-logo\s*\{[^}]*left: -17%;[^}]*width: 131%;[^}]*transform: translateY\(-50%\);/);
  assert.match(source, /\.site-brand:focus-visible\s*\{[^}]*outline:/);
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/);
});

test('phone header assigns stable rows for account, search and notifications without shrinking the logo out of its column', async () => {
  const phone = selector => rules.find(rule => rule.selector === selector && rule.parent.params === '(max-width: 639px)');
  const tablet = selector => rules.find(rule => rule.selector === selector && rule.parent.params === '(max-width: 1023px)');
  assert.equal(property(tablet('.header-content'), 'display'), 'grid');
  assert.equal(property(phone('.header-content'), 'grid-template-columns'), '44px minmax(0, 1fr) auto');
  assert.equal(property(phone('.site-brand'), 'min-width'), '0');
  assert.equal(property(phone('.site-brand'), 'max-width'), '172px');
  assert.equal(property(phone('.site-brand'), 'grid-row'), '1');
  assert.equal(property(phone('.site-brand'), 'grid-column'), '2');
  assert.equal(property(phone('.integrated-brand-logo-frame'), 'width'), '100%');
  assert.equal(property(phone('.integrated-brand-logo-frame'), 'max-width'), '172px');
  assert.equal(property(phone('.header-action-group'), 'display'), 'none');
  assert.equal(property(phone('.mobile-menu-feedback'), 'display'), 'block');
  assert.equal(property(tablet('.header-account, .header-auth-actions'), 'grid-row'), '1');
  assert.equal(property(phone('.header-account, .header-auth-actions'), 'grid-column'), '3');
  assert.equal(property(tablet('.header-search'), 'grid-column'), '1 / -1');
  assert.equal(property(phone('.header-content:has(.header-notifications) .header-search'), 'grid-column'), '1 / 3');
  assert.equal(property(phone('.header-notifications'), 'grid-row'), '2');
  assert.equal(property(phone('.header-auth-button'), 'white-space'), 'normal');
  assert.equal(property(phone('.header-auth-button'), 'max-width'), 'clamp(100px, 34vw, 160px)');
  assert.equal(property(tablet('.header-content .header-demo-badge'), 'display'), 'none');
  assert(rules.some(rule => rule.selector === '.header-auth-button' && property(rule, 'flex-shrink') === '0'));
  const navigation = await readFile(new URL('src/components/CommunityNavigation.tsx', root), 'utf8');
  assert.match(navigation, /mobile \? \[\{ name: 'Create & Ask'/);
  assert.match(navigation, /href: askHref, label: 'Ask a Question'/);
  assert(!navigation.includes('/assistant'));
});

test('navigation and account menus stay reachable on narrow and short viewports', async () => {
  const menu = rules.find(rule => rule.selector === '.mobile-menu-panel');
  const account = rules.find(rule => rule.selector === '.header-account-panel');
  for (const rule of [menu, account]) {
    assert.match(property(rule, 'max-height'), /100dvh/);
    assert.equal(property(rule, 'overflow-y'), 'auto');
    assert.equal(property(rule, 'overscroll-behavior'), 'contain');
  }
  assert.equal(property(menu, 'top'), 'calc(100% + 4px)');
  assert.equal(property(menu, 'z-index'), '60', 'Expanded navigation must cover header branding and its close control');
  const landscapeMenu=rules.find(rule=>rule.selector === '.mobile-menu-panel' && rule.parent.params === '(max-height: 500px) and (max-width: 1023px)');
  assert.equal(property(landscapeMenu,'position'),'fixed');
  assert.match(property(landscapeMenu,'max-height'),/100dvh/);
  assert(rules.some(rule=>rule.selector === '.mobile-menu-close' && property(rule,'position') === 'sticky' && property(rule,'min-height') === '44px'));
  assert.match(property(menu, 'max-height'), /100%/, 'Menu clearance follows actual header height, including larger text');
  assert(rules.some(rule => rule.selector === '.site-header' && rule.parent.params === '(max-height: 500px) and (max-width: 1023px)' && property(rule, 'position') === 'relative'));
  for (const selector of ['.header-auth-button', '.header-ask', '.notification-icon', '.header-account-panel :is(a, button)']) {
    assert(rules.some(rule => rule.selector === selector && property(rule, 'min-height') === '44px'), selector);
  }
  const shortcuts = rules.find(rule => rule.selector === '.community-shortcuts nav' && rule.parent.params === '(max-width: 639px)');
  assert.equal(property(shortcuts, 'display'), undefined, 'Mobile shortcuts retain the shared single-row layout');
  const header = await readFile(new URL('src/components/SiteHeader.tsx', root), 'utf8');
  assert.match(header, /<FeedbackLauncher mobileNavigation \/>/);
  const feedback = await readFile(new URL('src/components/FeedbackLauncher.tsx', root), 'utf8');
  assert.match(feedback, /mobileNavigation \? 'mobile-feedback-title' : 'feedback-title'/);
  assert.match(feedback, /open && createPortal\(<dialog/);
  assert.match(feedback, /<\/dialog>, document.body\)/);
  const row = rules.find(rule => rule.selector === '.tab-row');
  assert.equal(property(row, 'flex-wrap'), 'nowrap');
  assert.equal(property(row, 'min-width'), '0');
  assert.equal(property(row, 'max-width'), '100%');
  assert.equal(property(row, 'overflow-x'), 'auto', 'Controls remain reachable instead of overflowing the page');
  const labels = rules.find(rule => rule.selector === '.tab-row > *');
  assert.equal(property(labels, 'white-space'), 'nowrap');
  assert.equal(property(labels, 'flex-shrink'), '0');
  const targets = rules.find(rule => rule.selector === '.tab-row :is(a, button)');
  assert.equal(property(targets, 'min-height'), '44px');
  assert.match(property(targets, 'padding-inline'), /^clamp\(/);
  assert(!rules.some(rule => ['.news-tabs', '.account-sections'].includes(rule.selector) && property(rule, 'display') === 'grid'));

});

test('related heading is Also asked in feed, question and draft states', async () => {
  const related = await readFile(new URL('src/components/RelatedQuestions.tsx', root), 'utf8');
  assert.match(related, /aria-label="Also asked"/);
  assert.match(related, /<h2[^>]+>Also asked<\/h2>/);
  assert.doesNotMatch(related, /GitFork|Related to your draft/);
  assert.match(related, /Suggestions update as you type/);
  assert.match(related, /subscribeLive/);
});

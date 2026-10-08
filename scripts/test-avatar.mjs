import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

let source = ts.transpileModule(await readFile(new URL('../src/components/Avatar.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
source = source.replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime')));
const { Avatar } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const render = props => renderToStaticMarkup(React.createElement(Avatar, props));
const content = html => html.replace(/<[^>]*>/g, '');

test('avatar renders only the server-projected first-name initial, never the generated username', () => {
  const html = render({ name: 'clever-panda-1234', seed: 'initial:A:99ac-dead-beef' });
  assert.equal(content(html), 'A');
  assert.doesNotMatch(html, /99ac|dead|beef|<img|https?:/);
  assert.match(html, /aria-hidden="true"/); // Adjacent username/button supplies the accessible name.
});

test('missing or malformed initials never fall back to a pseudonym, email or internal ID', () => {
  for (const seed of ['private-email@example.test', 'clever-panda-1234', '99ac-dead-beef', 'initial:Alice:fixed', 'initial:🦊:fixed', 'initial:A:', 'initial:<:fixed', 'initial:?:fixed']) {
    assert.equal(content(render({ seed, name: 'generated-name' })), '?');
  }
});

test('first-name initials support Unicode and remain a single letter', () => {
  for (const initial of ['A', 'É', '李', 'श', 'ẞ']) {
    assert.equal(content(render({ seed: `initial:${initial}:fixed` })), initial);
  }
});

test('the same member keeps the same deterministic colors at every supported size', () => {
  const images = ['sm', 'md', 'lg'].map(size => render({ seed: 'initial:A:fixed', size }));
  assert.equal(new Set(images.map(html => html.match(/style="([^"]+)"/)[1])).size, 1);
  images.forEach(html => assert.equal(content(html), 'A'));
  const color = seed => render({ seed }).match(/style="([^"]+)"/)[1];
  assert.equal(color('initial:A:fixed'), color('initial:B:fixed'));
  assert.equal(color('initial:A:fixed'), color('fixed'), 'Migration preserves existing avatar color');
});

test('all default avatar colors retain readable small-text contrast', () => {
  const luminance = color => {
    const [r, g, b] = color.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  for (const seed of 'abcdefghijklmnopqrstuvwxyz') {
    const [, foreground, background] = render({ seed: `initial:A:${seed}`, size: 'sm' }).match(/color:(#[a-f0-9]+);background:(#[a-f0-9]+)/);
    assert((luminance(background) + 0.05) / (luminance(foreground) + 0.05) >= 4.5);
  }
});

test('every member avatar uses the public appearance field without passing private names', async () => {
  for (const file of ['SiteHeader', 'AccountClient', 'QuestionCard', 'QuestionDetail', 'MessagesClient']) {
    const component = await readFile(new URL(`../src/components/${file}.tsx`, import.meta.url), 'utf8');
    const usages = component.match(/<Avatar\s[^>]*\/>/g) ?? [];
    assert(usages.length, `${file}: avatar expected`);
    usages.forEach(usage => {
      assert.match(usage, /seed=\{/, `${file}: appearance seed missing`);
      assert.doesNotMatch(usage, /name=|username/);
      assert.doesNotMatch(usage, /metadata|\.email|full_name|first_name|avatar_url/);
    });
  }
});

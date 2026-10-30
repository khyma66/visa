import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const catalogURL = url(compile(await readFile(new URL('../src/lib/membership.ts', import.meta.url), 'utf8')));
const catalog = await import(catalogURL);
const source = await readFile(new URL('../src/components/AdvertisementSlot.tsx', import.meta.url), 'utf8');
const adURL = url(compile(source).replaceAll("'@/lib/membership'", JSON.stringify(catalogURL)).replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime'))));
const { AdvertisementSlot, FeedAdvertisementSlot } = await import(adURL);

test('member threshold never enables billing, tracking or entitlements', () => {
  for (const count of [-1, 0, 9999, 10000, 10001, NaN, Infinity, 10.5]) {
    const result = catalog.monetizationReview(count);
    assert.equal(result.reviewDue, Number.isSafeInteger(count) && count >= 10000);
    for (const key of ['checkout','advertising','paidEntitlements']) assert.equal(result[key], false);
  }
  assert.deepEqual(catalog.MEMBERSHIP_PLANS.map(plan => plan.id), ['free','premium','pro']);
});
test('feed slots are capped, separated and never first or last', () => {
  for (let count = 0; count <= 100; count++) {
    const positions = catalog.inlineAdPositions(count);
    assert(positions.length <= 2);
    for (const position of positions) assert(position >= 7 && position < count);
    if (positions.length === 2) assert(positions[1] - positions[0] >= 7);
  }
  for (const bad of [NaN, Infinity, -1, 2.5]) assert.deepEqual(catalog.inlineAdPositions(bad), []);
});
test('normal ad slots emit no markup, scripts, empty space or network resources', () => {
  for (const placement of ['feed','sidebar']) assert.equal(renderToStaticMarkup(React.createElement(AdvertisementSlot, { placement })), '');
  for (let afterPost = 1; afterPost <= 20; afterPost++) assert.equal(renderToStaticMarkup(React.createElement(FeedAdvertisementSlot, { afterPost, postCount: 20 })), '');
  const html = renderToStaticMarkup(React.createElement(AdvertisementSlot, { placement: 'sidebar', preview: true }));
  assert.match(html, /Advertisements/); assert.match(html, /No ad or tracking/);
  assert.doesNotMatch(html, /<script|<iframe|<img|href=/);
});
test('research links reject scripts, credentials and lookalike hosts', () => {
  for (const value of ['javascript:alert(1)','https://visathreads.com.evil.test/a','https://evil.test/','http://visathreads.com','https://a:b@visathreads.com','https://visathreads.com:444/']) assert.equal(catalog.researchItem('Resource', value), null);
  assert.equal(catalog.researchItem('', 'https://visathreads.com'), null);
  assert.equal(catalog.researchItem('  Official guidance  ', 'https://www.uscis.gov/').title, 'Official guidance');
});
test('membership preview is noindex and has no purchase action', async () => {
  const page = await readFile(new URL('../src/app/membership-preview/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /index: false/);
  const preview = await readFile(new URL('../src/components/MembershipPreview.tsx', import.meta.url), 'utf8');
  assert.match(preview, /Not for sale/);
  assert.doesNotMatch(preview, /fetch\(|localStorage|sessionStorage|stripe\.com|adsbygoogle/);
});

test('research preview supports add, duplicate rejection, reviewed state and removal', async () => {
  const slots = []; let cursor = 0;
  globalThis.__membershipState = initial => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  };
  const hooks = url('export const useState=(initial)=>globalThis.__membershipState(initial);');
  const source = compile(await readFile(new URL('../src/components/MembershipPreview.tsx', import.meta.url), 'utf8'))
    .replaceAll("'react'", JSON.stringify(hooks))
    .replaceAll("'@/lib/membership'", JSON.stringify(catalogURL))
    .replaceAll("'./AdvertisementSlot'", JSON.stringify(adURL))
    .replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime')));
  const { MembershipPreview } = await import(url(source));
  const render = () => { cursor = 0; return MembershipPreview(); };
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
  const find = (tree, predicate) => nodes(tree).find(predicate);
  try {
    let tree = render();
    find(tree, n => n.type === 'input' && n.props.maxLength === 160).props.onChange({ target: { value: 'Official resource' } });
    find(tree, n => n.type === 'input' && n.props.type === 'url').props.onChange({ target: { value: 'https://www.uscis.gov/' } });
    tree = render(); find(tree, n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.equal(slots[0].length, 1);
    tree = render(); find(tree, n => n.type === 'input' && n.props['aria-label']?.startsWith('Mark')).props.onChange();
    assert.equal(slots[0][0].checked, true);
    slots[1] = 'Duplicate'; slots[2] = 'https://www.uscis.gov/';
    tree = render(); find(tree, n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.equal(slots[0].length, 1); assert.match(slots[3], /already/);
    tree = render(); find(tree, n => n.type === 'button' && n.props['aria-label']?.startsWith('Remove')).props.onClick();
    assert.equal(slots[0].length, 0);
  } finally { delete globalThis.__membershipState; }
});

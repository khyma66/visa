import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const names = ['RelatedQuestions', 'TopicCollections', 'ExploreCommunities', 'NewsFeed', 'OfficialNewsFeed', 'TagDirectory'];
const components = new Map(await Promise.all(names.map(async name => {
  const source = await readFile(new URL(`../src/components/${name}.tsx`, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(`${name}.tsx`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes = [];
  const visit = node => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attribute = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(ast) === 'className');
      nodes.push({ tag: node.tagName.getText(ast), classes: attribute?.initializer?.getText(ast) ?? '', content: node.parent.getText(ast) });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return [name, { source, nodes }];
})));

test('discovery, related and news section/card headings share the question-title hierarchy', () => {
  let headings = 0;
  for (const [name, { nodes }] of components) {
    for (const node of nodes.filter(node => ['h2', 'h3'].includes(node.tag))) {
      headings++;
      assert.match(node.classes, /\btext-thread-title\b/, `${name}: ${node.content.slice(0, 160)}`);
      assert.match(node.classes, /\bfont-semibold\b/, `${name}: headings use the same weight as question titles`);
    }
  }
  assert(headings >= 12, 'The audit must cover the actual public-page headings');
});

test('news and discovery headings do not introduce a second letter-spacing style', () => {
  for (const [name, { nodes }] of components) {
    for (const node of nodes.filter(node => /^h[1-6]$/.test(node.tag))) {
      assert.doesNotMatch(node.classes, /tracking-/, `${name}: ${node.content.slice(0, 160)}`);
    }
  }
});

test('related question and community-card titles match the feed title size and weight', () => {
  const cases = [
    ['RelatedQuestions', 'p', '{item.title}'],
    ['ExploreCommunities', 'Link', '{community.display_name}'],
  ];
  for (const [name, tag, content] of cases) {
    const node = components.get(name).nodes.find(node => node.tag === tag && node.content.includes(content));
    assert(node, `${name}: title remains present`);
    assert.match(node.classes, /\btext-thread-title\b/);
    assert.match(node.classes, /\bfont-semibold\b/);
    assert.doesNotMatch(node.classes, /\bleading-5\b|\bleading-6\b/, 'Use the shared title line-height');
  }
});

test('tag examples and community descriptions use body text rather than metadata text', () => {
  for (const [name, content] of [['TagDirectory', '{row.example_title}'], ['TopicCollections', '{topic.description}'], ['ExploreCommunities', '{community.description}'], ['OfficialNewsFeed', '{resource.description}']]) {
    const node = components.get(name).nodes.find(node => node.tag === 'p' && node.content.includes(content));
    assert(node, `${name}: body remains present`);
    assert.match(node.classes, /\btext-base\b/);
    assert.match(node.classes, /\bleading-6\b/);
  }
});

test('public-page controls do not fall back to the 12px metadata utility', () => {
  for (const [name, { nodes }] of components) {
    for (const node of nodes.filter(node => ['button', 'input', 'select'].includes(node.tag))) {
      assert.doesNotMatch(node.classes, /\btext-xs\b/, `${name}: ${node.content.slice(0, 160)}`);
    }
  }
  for (const [name, tag, text] of [['ExploreCommunities', 'Link', 'U.S. Visa News'], ['ExploreCommunities', 'Link', 'Browse Tags'], ['TopicCollections', 'span', 'Browse Discussions →']]) {
    const node = components.get(name).nodes.find(node => node.tag === tag && node.content.includes(text));
    assert.match(node.classes, /\btext-sm\b/, `${name}: the navigation label uses the 16px UI token`);
  }
});

test('public-page titles share the home-page responsive title size and weight', () => {
  let count = 0;
  for (const [name, { nodes }] of components) {
    for (const node of nodes.filter(node => node.tag === 'h1')) {
      count++;
      assert.match(node.classes, /(?:\s|")text-2xl\b/, `${name}: 24px phone title`);
      assert.match(node.classes, /\bsm:text-3xl\b/, `${name}: 28px desktop title`);
      assert.match(node.classes, /\bfont-semibold\b/);
      assert.doesNotMatch(node.classes, /tracking-|text-4xl|font-medium/);
    }
  }
  assert.equal(count, 4);
});

test('dates, counts, publisher labels and badges retain the compact metadata hierarchy', () => {
  for (const [name, content] of [['TagDirectory', '{row.question_count}'], ['TopicCollections', 'existing discussions'], ['OfficialNewsFeed', "article.agencies.join(' · ')"]]) {
    const node = components.get(name).nodes.find(node => ['p', 'span'].includes(node.tag) && node.content.includes(content));
    assert(node, `${name}: metadata remains present`);
    assert.match(node.classes, /\btext-xs\b/);
  }
  assert.match(components.get('NewsFeed').source, /gap-y-1 text-xs leading-5/);
  assert.match(components.get('OfficialNewsFeed').source, /gap-y-2 text-xs/);
});

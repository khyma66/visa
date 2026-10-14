import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const braces = require('braces');
const nested = (n, open = '{', close = '}') => open.repeat(n) + 'a' + close.repeat(n);
const methods = ['parse', 'compile', 'expand', 'stringify'];
const rejected = error => error instanceof SyntaxError && /maximum depth/.test(error.message);

test('all actual transitive consumers resolve the reviewed fork and correct range dependency', () => {
  const expected = realpathSync(require.resolve('../vendor/braces'));
  for (const consumer of ['micromatch', 'chokidar']) {
    const consumerRequire = createRequire(require.resolve(consumer));
    assert.equal(realpathSync(consumerRequire.resolve('braces')), expected);
  }
  assert.equal(require('braces/package.json').name, '@visathreads/braces');
  const forkRequire = createRequire(require.resolve('braces'));
  assert.equal(forkRequire('fill-range/package.json').version, '7.1.1');
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
  assert.equal(lock.packages['node_modules/braces'].link, true);
  assert.equal(lock.packages['node_modules/braces'].resolved, 'vendor/braces');
  assert(!Object.values(lock.packages).some(pkg => /\/braces\/-\/braces-/.test(pkg.resolved || '')));
});

for (const method of methods) {
  test(`${method} rejects CVE patterns before stack exhaustion and accepts depth 100`, () => {
    for (const [open, close] of [['{', '}'], ['(', ')']]) {
      assert.doesNotThrow(() => braces[method](nested(100, open, close)));
      for (const depth of [101, 3500, 4900]) {
        assert.throws(() => braces[method](nested(depth, open, close)), rejected);
      }
    }
    assert.throws(() => braces[method]('{('.repeat(51) + 'a' + ')}'.repeat(51)), rejected);
    assert.throws(() => braces[method]('{'.repeat(101)), rejected);
  });

  test(`${method} honors stricter limits and cannot raise the hard ceiling`, () => {
    assert.doesNotThrow(() => braces[method](nested(2), { maxDepth: 2.9 }));
    assert.throws(() => braces[method](nested(3), { maxDepth: 2.9 }), rejected);
    assert.throws(() => braces[method](nested(1), { maxDepth: 0 }), rejected);
    for (const maxDepth of [101, 1000000, Infinity]) {
      assert.throws(() => braces[method](nested(101), { maxDepth }), rejected);
    }
    for (const maxDepth of [-1, NaN, '100', null]) {
      assert.throws(() => braces[method]('foo', { maxDepth }), TypeError);
    }
  });
}

for (const method of ['compile', 'expand', 'stringify']) {
  test(`${method} validates externally supplied AST depth and cycles`, () => {
    const ast = { type: 'root', nodes: [] };
    let node = ast;
    for (let i = 0; i < 3500; i++) {
      const child = { type: 'paren', nodes: [] };
      node.nodes.push(child);
      node = child;
    }
    assert.throws(() => braces[method](ast), rejected);
    const cyclic = { type: 'root', nodes: [] };
    cyclic.nodes.push(cyclic);
    assert.throws(() => braces[method](cyclic), /Cyclic brace AST/);
    const parentCycle = { type: 'root', nodes: [] };
    parentCycle.parent = parentCycle;
    assert.throws(() => braces[method](parentCycle), /parent chain/);
    let nestedValue = ['a'];
    for (let i = 0; i < 10000; i++) nestedValue = [nestedValue];
    assert.throws(() => braces[method]({ type: 'root', nodes: [{ type: 'text', value: nestedValue }] }), /string AST token/);
    const parsed = braces.parse('a/{b,c}/d');
    assert.doesNotThrow(() => braces[method](parsed));
  });
}

test('escaping, quotes, character classes, dollars, extglobs, and ranges preserve behavior', () => {
  assert.deepEqual(braces.expand('src/{app,components}/**/*.{ts,tsx}'), [
    'src/app/**/*.ts', 'src/app/**/*.tsx', 'src/components/**/*.ts', 'src/components/**/*.tsx'
  ]);
  assert.deepEqual(braces.expand('{a,@(b,c)}'), ['a', '@(b,c)']);
  assert.deepEqual(braces.expand('${a,b}'), ['${a,b}']);
  assert.deepEqual(braces.expand('{009..013..2}'), ['009', '011', '013']);
  assert.equal(braces.compile('{a,b}'), '(a|b)');
  for (const pattern of ['\\{'.repeat(500), '"' + '{'.repeat(500) + '"', '[' + '{'.repeat(500) + ']']) {
    assert.doesNotThrow(() => braces.compile(pattern));
  }
  assert.equal(braces.stringify(braces.parse('{a}'), { escapeInvalid: true }), '{a}');
});

test('recursive expansion flattening is iterative and rejects cycles', () => {
  const { flatten } = require('../vendor/braces/lib/utils');
  let array = ['a'];
  for (let i = 0; i < 20000; i++) array = [array];
  assert.deepEqual(flatten(array), ['a']);
  const cyclic = [];
  cyclic.push(cyclic);
  assert.throws(() => flatten(cyclic), /Cyclic brace expansion array/);
});

test('expand rejects external parent queues before recursive append', () => {
  let nestedQueue = 'x';
  for (let i = 0; i < 20000; i++) nestedQueue = [nestedQueue];
  const cyclicQueue = [];
  cyclicQueue.push(cyclicQueue);
  for (const queueItem of [nestedQueue, cyclicQueue]) {
    const externalParent = { type: 'root', queue: [queueItem] };
    const child = { type: 'paren', parent: externalParent, nodes: [{ type: 'text', value: 'a' }] };
    assert.throws(() => braces.expand({ type: 'root', nodes: [child] }), /parent must match tree structure/);
    assert.throws(() => braces.expand(child), /parent must match tree structure/);
  }
  assert.deepEqual(braces.expand({ type: 'root', nodes: [{ type: 'text', value: 'a' }] }), ['a']);
  assert.deepEqual(braces.expand(braces.parse('{a,@(b,c)}')), ['a', '@(b,c)']);
  const parsed = braces.parse('prefix/{a,b}/suffix');
  const subtree = parsed.nodes.find(node => node.type === 'brace');
  assert.equal(braces.compile(subtree), '(a|b)');
  assert.equal(braces.stringify(subtree), '{a,b}');
});

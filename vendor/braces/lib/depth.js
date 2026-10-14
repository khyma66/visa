'use strict';

// This local fork bounds every recursive walk, including caller-supplied ASTs.
// A larger caller option cannot raise the hard safety ceiling.
const MAX_DEPTH = 100;

const limit = (options = {}) => {
  const value = options.maxDepth;
  if (value === undefined || value === Infinity) return MAX_DEPTH;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError('maxDepth must be a non-negative number');
  }
  return Math.min(MAX_DEPTH, Math.floor(value));
};

const check = (depth, maximum) => {
  if (depth > maximum) {
    throw new SyntaxError(`Brace nesting exceeds maximum depth (${maximum})`);
  }
};

// Iterative validation cannot itself overflow on an adversarial tree. Only
// active ancestors are marked: repeated (non-cyclic) subtrees remain valid.
const validate = (ast, options = {}, treeParentsOnly = false) => {
  const maximum = limit(options);
  const ancestors = new WeakSet();
  const stack = [{ node: ast, depth: 0, leave: false, treeParent: undefined }];
  while (stack.length) {
    const { node, depth, leave, treeParent } = stack.pop();
    if (!node || typeof node !== 'object') {
      throw new TypeError('Expected an AST node');
    }
    if (leave) {
      ancestors.delete(node);
      continue;
    }
    if (ancestors.has(node)) throw new SyntaxError('Cyclic brace AST');
    check(depth, maximum);
    if (node.value !== undefined && typeof node.value !== 'string') {
      throw new TypeError('Expected a string AST token');
    }
    ancestors.add(node);
    stack.push({ node, depth, leave: true });

    // expand() also follows parent links; validate that separate graph before
    // entering its loops. A parsed node can have at most maximum + 1 parents.
    const parents = new WeakSet([node]);
    let parent = node.parent;
    let parentDepth = 0;
    while (parent) {
      if (typeof parent !== 'object' || parents.has(parent)) {
        throw new SyntaxError('Cyclic or invalid brace parent chain');
      }
      parents.add(parent);
      check(++parentDepth, MAX_DEPTH + 1);
      parent = parent.parent;
    }

    // expand() reads ancestor queues, so its parent links must stay inside
    // the validated tree. External parents can smuggle arbitrary arrays into
    // append() even when every child node and parent-chain depth is valid.
    if (treeParentsOnly && node.parent != null && node.parent !== treeParent) {
      throw new SyntaxError('Brace AST parent must match tree structure');
    }

    if (node.nodes !== undefined) {
      if (!Array.isArray(node.nodes)) throw new TypeError('Expected AST nodes array');
      for (let i = node.nodes.length - 1; i >= 0; i--) {
        const child = node.nodes[i];
        // Leaf tokens do not add a recursive container level.
        stack.push({ node: child, depth: depth + (child && child.nodes ? 1 : 0), leave: false, treeParent: node });
      }
    }
  }
};

module.exports = { limit, check, validate };

# VisaThreads bounded-depth braces fork

This directory is a **local source fork**, not a new upstream braces release.
It starts from the MIT-licensed npm `braces@3.0.3` distribution. Original source,
README, author attribution, and LICENSE are retained. The local package name is
`@visathreads/braces`, version `3.0.3-visathreads.1`; it is private and is installed
under the `braces` dependency name with an npm override. This prevents installing
the unpatched upstream package through micromatch, chokidar, or other consumers.

Upstream: https://github.com/micromatch/braces/tree/3.0.3

Original npm tarball integrity (from the pre-change lockfile):
`sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==`

Advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm

Issue and public patch discussion:
https://github.com/micromatch/braces/issues/70
https://github.com/micromatch/braces/pull/72

As checked on 2026-10-14, upstream has not published a patched release. This fork
implements its own guard; it does not claim the upstream maintainer accepted it.

## Changes and compatibility boundary

- Parsing limits combined brace/parenthesis container nesting to 100 before
  constructing deeper nodes. Escaped delimiters, quoted text and character
  classes retain their original parsing behavior.
- Compile, expand and stringify independently validate caller-supplied ASTs
  before recursion. Validation is iterative, rejects child and parent cycles,
  and bounds parent chains followed by expand.
- Expand additionally requires supplied parent pointers to match the traversed
  tree, with no external parent on its root. Missing parent links are allowed.
  This prevents an external parent's queue from injecting deep or cyclic
  arrays into append. Compile/stringify continue to accept parsed subtrees.
  When parsing promotes children out of an invalid block, their parent pointers
  are updated to the new container; existing malformed-pattern outputs remain
  covered by the upstream tests.
- `maxDepth` accepts stricter nonnegative numeric limits, rounded down. Values
  above 100, including positive infinity, cannot relax the hard ceiling.
- Expansion flattening uses an iterative traversal with cycle detection.
- Caller-supplied token values must be strings; nested arrays cannot reach the
  recursive append helper through a malformed AST.
- No regex/glob grammar or existing range-limit behavior is changed. Existing
  trusted patterns below the limit retain upstream semantics. Deep patterns
  now raise a deterministic SyntaxError rather than exhaust the runtime stack.

## Verification and maintenance

`npm run test:dependencies` runs exploit regressions, direct-AST/cycle tests,
dependency-resolution checks, and upstream 3.0.3 compatibility tests. The
upstream tests in `test/` only replace Mocha registration with Node's test runner
and `bash-path` with `/bin/bash`; assertions and inputs are unchanged.

The full `npm audit --audit-level=high` gate remains intact. **npm audit does not
inspect this fork's JavaScript implementation**, so a clean advisory lookup is
not proof that a local fork is secure. The source review and regression suite
are required alongside the audit. This fixes the reported recursion issue;
it does not make arbitrary user-controlled regex or unlimited expansion safe.

This adds maintenance responsibility to VisaThreads: track upstream security
advisories, review changes to this directory, retain the tests, and remove the
fork/override when a compatible reviewed upstream fix becomes available. Do
not merely change the version/name to silence a future advisory.

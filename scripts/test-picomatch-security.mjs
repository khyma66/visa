import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { checkUpstreamAdvisories } from './check-picomatch-advisories.mjs';

const require = createRequire(import.meta.url);
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
const forks = {
  2: { name: '@visathreads/picomatch-v2', archive: 'vendor/visathreads-picomatch-v2-2.3.2.tgz' },
  4: { name: '@visathreads/picomatch-v4', archive: 'vendor/visathreads-picomatch-v4-4.0.7-patched.tgz' },
};
const consumers = { anymatch: 2, micromatch: 2, readdirp: 2, vite: 4, tinyglobby: 4, fdir: 4 };
const fileNames = ['LICENSE', 'README.md', 'package.json', 'index.js', 'lib/constants.js', 'lib/parse.js', 'lib/picomatch.js', 'lib/scan.js', 'lib/utils.js'];

test('the upstream advisory gate allows only the reviewed finding and fails closed for new or changed serious findings', () => {
  const reviewed = { id: 1247710, url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf', title: 'picomatch vulnerable to ReDoS through single-branch repeated extglobs', severity: 'high', vulnerable_versions: '<=4.0.7' };
  assert.doesNotThrow(() => checkUpstreamAdvisories({ picomatch: [reviewed] }));
  assert.doesNotThrow(() => checkUpstreamAdvisories({}));
  assert.throws(() => checkUpstreamAdvisories({ picomatch: [{ ...reviewed, vulnerable_versions: '*' }] }));
  assert.throws(() => checkUpstreamAdvisories({ picomatch: [{ id: 9, url: 'https://example.test/new', severity: 'critical' }] }));
  assert.throws(() => checkUpstreamAdvisories({ picomatch: [null] }));
  assert.throws(() => checkUpstreamAdvisories({ picomatch: 'unexpected' }));
  assert.throws(() => checkUpstreamAdvisories({ error: 'registry unavailable' }));
});

test('all build consumers resolve the reviewed backport and no upstream package remains in the lockfile', () => {
  for (const [consumer, major] of Object.entries(consumers)) {
    const consumerRequire = createRequire(require.resolve(consumer));
    const manifestPath = consumerRequire.resolve('picomatch/package.json');
    const manifest = JSON.parse(readFileSync(manifestPath));
    assert.equal(manifest.name, forks[major].name, consumer);
    const files = major === 4 ? [...fileNames, 'posix.js'] : fileNames;
    for (const file of files) {
      assert.deepEqual(readFileSync(join(dirname(manifestPath), file)), readFileSync(new URL(`../vendor/picomatch-v${major}/${file}`, import.meta.url)), `${consumer}: ${file}`);
    }
  }
  const locked = Object.entries(lock.packages).filter(([path]) => /(?:^|\/)node_modules\/picomatch$/.test(path));
  assert(locked.length >= 4);
  for (const [path, info] of locked) {
    const fork = Object.values(forks).find(item => item.name === info.name);
    assert(fork, `${path} must not resolve the unpatched upstream package`);
    assert.equal(info.resolved, `file:${fork.archive}`);
    const bytes = readFileSync(new URL(`../${fork.archive}`, import.meta.url));
    assert.equal(info.integrity, `sha512-${createHash('sha512').update(bytes).digest('base64')}`);
  }
  assert(!Object.values(lock.packages).some(info => /registry\.npmjs\.org\/picomatch\/-\//.test(info.resolved || '')));
});

for (const major of [2, 4]) {
  const matcher = require(new URL(`../vendor/picomatch-v${major}/index.js`, import.meta.url).pathname);
  test(`picomatch v${major} preserves common project and extglob matching`, () => {
    for (const [pattern, input, expected] of [
      ['src/**/*.tsx', 'src/components/App.tsx', true],
      ['src/**/*.tsx', 'src/components/App.css', false],
      ['*(a*|b)', 'ax', true],
      ['*(a*|b)', 'bbb', true],
      ['*(a*|b)', 'cx', false],
      ['+(ab*|c)', 'ccabcc', true],
      ['+(a*b)', 'abab', true],
      ['*/*(W*, *)*', 'my/folder (Work, Accts)', true],
    ]) assert.equal(matcher(pattern)(input), expected, `${pattern} against ${input}`);
  });

  test(`picomatch v${major} bounds repeated-wildcard attacks through the public matching APIs`, { timeout: 180000 }, () => {
    const attacks = [
      ['+(*)', 'a', 60000, '/'], ['*(*a)', 'a', 60000, '!'],
      ['+(*a|b)', 'a', 60000, '!'], ['+(a*a*a*a*a*)', 'a', 60000, '/'],
      ['+([*a)', '[a', 10000, '!'], ['+([*a])', '[a]', 10000, '!'],
      ['+(W*, *)z', 'W, ', 10000, '!'],
    ];
    const options = [{}, { windows: true }, { bash: true }, { capture: true }, { nobracket: true }];
    const script = `const pm=require(process.argv[1]);const [pattern,prefix,count,suffix,options]=JSON.parse(process.argv[2]);const input=prefix.repeat(count)+suffix;pm(pattern,options)(input);pm.makeRe(pattern,options).test(input);pm.compileRe(pm.parse(pattern,options),options).test(input);`;
    const entry = new URL(`../vendor/picomatch-v${major}/index.js`, import.meta.url).pathname;
    for (const attack of attacks) for (const option of options) {
      const result = spawnSync(process.execPath, ['-e', script, entry, JSON.stringify([...attack, option])], { timeout: 4000, maxBuffer: 16384 });
      assert.equal(result.error?.code, undefined, `${attack[0]} ${JSON.stringify(option)}: ${result.error?.message}`);
      assert.equal(result.status, 0, `${attack[0]} ${JSON.stringify(option)}: ${result.stderr}`);
    }
  });
}

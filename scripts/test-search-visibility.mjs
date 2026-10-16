import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, readFile } from 'node:fs/promises';
import ts from 'typescript';

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = (source) => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
} }).outputText;
const helperUrl = moduleUrl(transpile(await readFile(new URL('../src/lib/search-visibility.ts', import.meta.url), 'utf8')));
const { publicSearchOrigin, publicSitemap, publicRobots, PUBLIC_SITEMAP_PATHS, PRIVATE_CRAWL_PATHS } = await import(helperUrl);
const approved = { APP_ENV: 'production', PUBLIC_LAUNCH_APPROVED: 'true', NEXT_PUBLIC_SITE_URL: 'https://visathreads.com' };

test('only a reviewed production deployment publishes a sitemap', () => {
  assert.equal(publicSearchOrigin(approved), 'https://visathreads.com');
  assert.equal(publicSearchOrigin({ ...approved, NEXT_PUBLIC_SITE_URL: 'https://www.visathreads.com/' }), 'https://visathreads.com');
  assert.deepEqual(publicSitemap(approved), PUBLIC_SITEMAP_PATHS.map((path) => ({ url: `https://visathreads.com${path}` })));
  assert.equal(new Set(publicSitemap(approved).map(({ url }) => url)).size, PUBLIC_SITEMAP_PATHS.length);
});

test('previews and unapproved releases neither enumerate pages nor advertise a production sitemap', () => {
  for (const env of [{},
    { ...approved, APP_ENV: 'development' },
    { ...approved, APP_ENV: undefined },
    { ...approved, PUBLIC_LAUNCH_APPROVED: undefined },
    { ...approved, PUBLIC_LAUNCH_APPROVED: 'false' },
    { ...approved, PUBLIC_LAUNCH_APPROVED: 'TRUE' },
    { ...approved, NEXT_PUBLIC_DEPLOYMENT_TARGET: 'sandbox' },
  ]) {
    assert.equal(publicSearchOrigin(env), null);
    assert.deepEqual(publicSitemap(env), []);
    assert.deepEqual(publicRobots(env), { rules: { userAgent: '*', disallow: '/' } });
  }
});

test('invalid, sensitive, local and sandbox canonical origins fail closed', () => {
  for (const origin of [undefined, '', 'not a URL', 'http://visathreads.com',
    ' https://visathreads.com', 'https://visa\nthreads.com', 'https://visathreads.com/\t',
    'https://user:password@visathreads.com', 'https://visathreads.com:8443',
    'https://visathreads.com/private', 'https://visathreads.com/?token=private',
    'https://visathreads.com/#fragment', 'https://localhost', 'https://test.localhost',
    'https://127.0.0.1', 'https://[::1]', 'https://visa-central.com',
    'https://www.visa-central.com', 'https://preview.workers.dev',
  ]) {
    const env = { ...approved, NEXT_PUBLIC_SITE_URL: origin };
    assert.equal(publicSearchOrigin(env), null, String(origin));
    assert.deepEqual(publicSitemap(env), []);
    assert.equal(publicRobots(env).sitemap, undefined);
  }
});

test('approved robots excludes all private areas and points at the canonical sitemap', () => {
  const robots = publicRobots(approved);
  assert.equal(robots.sitemap, 'https://visathreads.com/sitemap.xml');
  assert.equal(robots.rules.allow, '/');
  assert.deepEqual(robots.rules.disallow, [...PRIVATE_CRAWL_PATHS]);
  for (const path of ['/account', '/admin', '/owner', '/login', '/signup', '/messages', '/moderation', '/api/', '/ask', '/assistant', '/feedback', '/my-communities', '/communities/new', '/experiences/new']) {
    assert(robots.rules.disallow.includes(path), path);
    assert(!PUBLIC_SITEMAP_PATHS.includes(path), path);
  }
});

test('sitemap entries are existing public static destinations, not individual member or imported content', async () => {
  for (const path of PUBLIC_SITEMAP_PATHS) {
    await access(new URL(`../src/app${path === '/' ? '' : path}/page.tsx`, import.meta.url));
    assert(!/^\/(questions|c|experiences|api|admin|owner|account|messages|feedback)(\/|$)/.test(path));
  }
});

test('metadata routes use request-time environment gates, including after a prior approved request', async () => {
  const routes = {};
  for (const name of ['robots', 'sitemap']) {
    const source = transpile(await readFile(new URL(`../src/app/${name}.ts`, import.meta.url), 'utf8'))
      .replace("'@/lib/search-visibility'", JSON.stringify(helperUrl));
    routes[name] = await import(moduleUrl(source));
    assert.equal(routes[name].dynamic, 'force-dynamic');
  }
  const names = [...Object.keys(approved), 'NEXT_PUBLIC_DEPLOYMENT_TARGET'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    Object.assign(process.env, approved);
    delete process.env.NEXT_PUBLIC_DEPLOYMENT_TARGET;
    assert.deepEqual(routes.sitemap.default(), publicSitemap(approved));
    assert.deepEqual(routes.robots.default(), publicRobots(approved));
    process.env.APP_ENV = 'development';
    assert.deepEqual(routes.sitemap.default(), []);
    assert.deepEqual(routes.robots.default(), { rules: { userAgent: '*', disallow: '/' } });
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

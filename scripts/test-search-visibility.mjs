import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, readFile } from 'node:fs/promises';
import ts from 'typescript';

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = (source) => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
} }).outputText;
const guideUrl = moduleUrl(transpile(await readFile(new URL('../src/lib/visa-guides.ts', import.meta.url), 'utf8')));
const { VISA_GUIDES } = await import(guideUrl);
const helperUrl = moduleUrl(transpile(await readFile(new URL('../src/lib/search-visibility.ts', import.meta.url), 'utf8')).replace("'./visa-guides'", JSON.stringify(guideUrl)));
const { publicSearchOrigin, publicSitemap, publicRobots, PUBLIC_SITEMAP_PATHS, PRIVATE_CRAWL_PATHS, MODEL_USE_CRAWLERS } = await import(helperUrl);
const approved = { APP_ENV: 'production', PUBLIC_LAUNCH_APPROVED: 'true', NEXT_PUBLIC_SITE_URL: 'https://visathreads.com' };

test('only a reviewed production deployment publishes a sitemap', () => {
  assert.equal(publicSearchOrigin(approved), 'https://visathreads.com');
  assert.equal(publicSearchOrigin({ ...approved, NEXT_PUBLIC_SITE_URL: 'https://www.visathreads.com/' }), 'https://visathreads.com');
  assert.deepEqual(publicSitemap(approved), [...PUBLIC_SITEMAP_PATHS, ...VISA_GUIDES.map(guide => `/guides/${guide.slug}`)].map((path) => ({ url: `https://visathreads.com${path}` })));
  assert.equal(new Set(publicSitemap(approved).map(({ url }) => url)).size, PUBLIC_SITEMAP_PATHS.length + VISA_GUIDES.length);
});

test('previews and unapproved releases neither enumerate pages nor advertise a production sitemap', () => {
  for (const env of [{},
    { ...approved, APP_ENV: 'development' },
    { ...approved, APP_ENV: undefined },
    { ...approved, PUBLIC_LAUNCH_APPROVED: undefined },
    { ...approved, PUBLIC_LAUNCH_APPROVED: 'false' },
    { ...approved, PUBLIC_LAUNCH_APPROVED: 'TRUE' },
    { ...approved, NEXT_PUBLIC_DEPLOYMENT_TARGET: 'sandbox' },
    { ...approved, NEXT_PUBLIC_DEPLOYMENT_TARGET: 'development-sandbox' },
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
    'https://unowned-example.com', 'https://visathreads.com.unowned-example.com',
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
  assert.equal(robots.rules[0].allow, '/');
  assert.deepEqual(robots.rules[0].disallow, [...PRIVATE_CRAWL_PATHS]);
  assert.deepEqual(robots.rules[1], { userAgent: [...MODEL_USE_CRAWLERS], disallow: '/' });
  for (const crawler of ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot']) {
    assert(!MODEL_USE_CRAWLERS.includes(crawler));
  }
  for (const path of ['/account', '/admin', '/owner', '/login', '/signup', '/messages', '/moderation', '/api/', '/ask', '/assistant', '/feedback', '/my-communities', '/communities/new', '/experiences/new']) {
    assert(robots.rules[0].disallow.includes(path), path);
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
      .replace("'@/lib/search-visibility'", JSON.stringify(helperUrl))
      .replace("'@/lib/public-server'", JSON.stringify(moduleUrl('export async function publicThreadSitemap() { return []; }')));
    routes[name] = await import(moduleUrl(source));
    assert.equal(routes[name].dynamic, 'force-dynamic');
  }
  const names = [...Object.keys(approved), 'NEXT_PUBLIC_DEPLOYMENT_TARGET'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    Object.assign(process.env, approved);
    delete process.env.NEXT_PUBLIC_DEPLOYMENT_TARGET;
    assert.deepEqual(await routes.sitemap.default(), publicSitemap(approved));
    assert.deepEqual(routes.robots.default(), publicRobots(approved));
    process.env.NEXT_PUBLIC_DEPLOYMENT_TARGET = 'development-sandbox';
    assert.deepEqual(await routes.sitemap.default(), []);
    assert.deepEqual(routes.robots.default(), { rules: { userAgent: '*', disallow: '/' } });
    delete process.env.NEXT_PUBLIC_DEPLOYMENT_TARGET;
    process.env.APP_ENV = 'development';
    assert.deepEqual(await routes.sitemap.default(), []);
    assert.deepEqual(routes.robots.default(), { rules: { userAgent: '*', disallow: '/' } });
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

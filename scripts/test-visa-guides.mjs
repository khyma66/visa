import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Render the real server pages and metadata with only framework boundaries mocked.
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const jsx = pathToFileURL(require.resolve('react/jsx-runtime')).href;
const external = {
  'react/jsx-runtime': jsx,
  'next/link': moduleUrl(`import {jsx} from ${JSON.stringify(jsx)};export default props=>jsx('a',props);`),
  'next/navigation': moduleUrl('export function notFound(){throw new Error("NEXT_NOT_FOUND");}'),
  'lucide-react': moduleUrl('export function ArrowUpRight(){return null;}export function ChevronLeft(){return null;}export function ChevronRight(){return null;}export function BookOpen(){return null;}'),
};
const modules = new Map();
async function compile(file) {
  if (modules.has(file)) return modules.get(file);
  const source = await readFile(file, 'utf8');
  let code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const imports = [...code.matchAll(/(from\s+)(['"])([^'"]+)\2/g)];
  for (const [match, prefix, , name] of imports) {
    const dependency = external[name] ?? await compile(name.startsWith('@/')
      ? resolve(root, 'src', `${name.slice(2)}.ts`)
      : resolve(dirname(file), `${name}.ts`));
    code = code.replace(match, prefix + JSON.stringify(dependency));
  }
  const url = moduleUrl(code); modules.set(file, url); return url;
}
const load = async name => import(await compile(resolve(root, name)));
const { VISA_GUIDES, GUIDE_REFERENCE_CHECKED_ON, guideCommunityHref } = await load('src/lib/visa-guides.ts');
const { VISA_TYPES } = await load('src/lib/post-categories.ts');
const detail = await load('src/app/guides/[slug]/page.tsx');
const index = await load('src/app/guides/page.tsx');
const about = await load('src/app/about/page.tsx');
const props = (slug, query = {}) => ({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(query) });
const approved = { APP_ENV: 'production', PUBLIC_LAUNCH_APPROVED: 'true', NEXT_PUBLIC_SITE_URL: 'https://visathreads.com' };

async function withEnvironment(env, run) {
  const names = [...Object.keys(approved), 'NEXT_PUBLIC_DEPLOYMENT_TARGET'];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    Object.assign(process.env, env);
    await run();
  } finally {
    for (const name of names) if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name];
  }
}

test('curated guide routes have unique slugs and valid existing U.S. visa filters', () => {
  assert.equal(VISA_GUIDES.length, 3);
  assert.equal(new Set(VISA_GUIDES.map(guide => guide.slug)).size, 3);
  assert.deepEqual(detail.generateStaticParams(), VISA_GUIDES.map(({ slug }) => ({ slug })));
  for (const guide of VISA_GUIDES) {
    assert.match(guide.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert(VISA_TYPES.includes(guide.visaType));
    for (const experiences of [false, true]) {
      const url = new URL(guideCommunityHref(guide, experiences), 'https://visathreads.com');
      assert.equal(url.pathname, experiences ? '/experiences' : '/');
      assert.equal(url.searchParams.get('visa'), guide.visaType);
      assert.deepEqual([...url.searchParams.keys()], ['visa']);
    }
  }
});

test('server-rendered guides contain useful steps, official references, real check dates and corrections', async () => {
  assert.equal(GUIDE_REFERENCE_CHECKED_ON, '2026-10-18');
  for (const guide of VISA_GUIDES) {
    const html = renderToStaticMarkup(await detail.default(props(guide.slug)));
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
    assert.match(html, /Your preparation checklist/);
    assert.match(html, /Questions worth asking/);
    assert.match(html, /Editorial reference check:/);
    assert.match(html, /Not a legal review/);
    assert(html.includes(`dateTime="${GUIDE_REFERENCE_CHECKED_ON}"`));
    assert(html.includes('href="/contact"'));
    assert(html.includes(`href="${guideCommunityHref(guide)}"`));
    assert(html.includes(`href="${guideCommunityHref(guide, true)}"`));
    for (const step of guide.steps) {
      assert(html.includes(step.title));
      if (step.source !== undefined) assert(guide.references[step.source]);
    }
    for (const reference of [...guide.references, ...(guide.furtherReading ?? [])]) {
      const url = new URL(reference.url);
      assert.equal(url.protocol, 'https:');
      assert(['travel.state.gov', 'www.uscis.gov', 'studyinthestates.dhs.gov'].includes(url.hostname));
      assert.equal(url.username, ''); assert.equal(url.password, '');
      assert(html.includes(`href="${reference.url}"`));
    }
    assert.doesNotMatch(html, /href="undefined"|application\/ld\+json|<form\b|<script\b/);
  }
});

test('guides and about remain noindex in preview, sandbox and unapproved environments', async () => {
  for (const env of [{}, { ...approved, APP_ENV: 'development' }, { ...approved, PUBLIC_LAUNCH_APPROVED: 'false' }, { ...approved, NEXT_PUBLIC_DEPLOYMENT_TARGET: 'sandbox' }]) {
    await withEnvironment(env, async () => {
      for (const page of [index, about]) assert.deepEqual((await page.generateMetadata(props(''))).robots, { index: false, follow: false });
      for (const guide of VISA_GUIDES) {
        const meta = await detail.generateMetadata(props(guide.slug));
        assert.deepEqual(meta.robots, { index: false, follow: false });
        assert.equal(meta.alternates.canonical, `https://visathreads.com/guides/${guide.slug}`);
        assert.equal(meta.description, guide.description);
      }
    });
  }
});

test('approved canonical guides can be indexed but query variants never become separate landing pages', async () => {
  await withEnvironment(approved, async () => {
    for (const guide of VISA_GUIDES) {
      const ordinary = await detail.generateMetadata(props(guide.slug));
      const filtered = await detail.generateMetadata(props(guide.slug, { q: 'private case query' }));
      assert.equal(ordinary.robots.index, true);
      assert.deepEqual(filtered.robots, { index: false, follow: true });
      assert.equal(filtered.alternates.canonical, ordinary.alternates.canonical);
      assert(!JSON.stringify(filtered).includes('private case query'));
    }
    for (const page of [index, about]) {
      assert.equal((await page.generateMetadata(props(''))).robots.index, true);
      assert.equal((await page.generateMetadata(props('', { utm_source: 'example' }))).robots.index, false);
    }
  });
});

test('unknown guide slugs return not-found rather than a thin or indexed generic page', async () => {
  await withEnvironment(approved, async () => {
    for (const slug of ['unknown', 'h1b', '../private', 'h1b-petition-visa-status-extra']) {
      await assert.rejects(detail.default(props(slug)), /NEXT_NOT_FOUND/);
      assert.equal((await detail.generateMetadata(props(slug))).robots.index, false);
    }
  });
});

test('guide index and about connect all actual pages and disclose community/source limitations', () => {
  const indexHtml = renderToStaticMarkup(createElement(index.default));
  for (const guide of VISA_GUIDES) assert(indexHtml.includes(`href="/guides/${guide.slug}"`));
  assert(indexHtml.includes('href="/about"'));
  const aboutHtml = renderToStaticMarkup(createElement(about.default));
  for (const path of ['/guides', '/contact', '/privacy', '/terms', '/community-safety']) assert(aboutHtml.includes(`href="${path}"`));
  assert.match(aboutHtml, /independent community/);
  assert.match(aboutHtml, /not a government service/);
  assert.match(aboutHtml, /not mean an attorney reviewed/);
  assert.doesNotMatch(aboutHtml, /guaranteed approval|government approved|expert-reviewed/i);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const url = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const jsx = pathToFileURL(require.resolve('react/jsx-runtime')).href;
const link = url(`import {jsx} from ${JSON.stringify(jsx)}; export default function Link(props) { return jsx('a',props); }`);
async function component(path, dependencies = {}) {
  const source = (await readFile(new URL(path,import.meta.url),'utf8')).replace(/^import ['"][^'"]+\.css['"];$/gm, '');
  let code = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
    .replaceAll('"react/jsx-runtime"',JSON.stringify(jsx)).replaceAll("'next/link'",JSON.stringify(link));
  for (const [name, replacement] of Object.entries(dependencies)) code = code.replaceAll(`'${name}'`, JSON.stringify(replacement));
  return { ...await import(url(code)), moduleUrl: url(code) };
}
test('one compact footer reminder preserves essential safety facts without a warning banner',async()=>{
  const { SafetyNotice } = await component('../src/components/SafetyNotice.tsx');
  const html = renderToStaticMarkup(createElement(SafetyNotice));
  for (const phrase of ['Never share passwords', 'verification codes', 'passport or case IDs', 'private documents', 'Questions and replies are public', 'do not guarantee anonymity', 'not end-to-end encrypted', 'moderators may review reported messages', 'administrators can access stored data', 'not a government service or legal adviser']) {
    assert(html.includes(phrase), phrase);
  }
  assert(html.includes('href="/community-safety"'));
  assert.doesNotMatch(html, /bg-amber|border-amber|role="alert"/);
  assert.equal((html.match(/<p>/g) ?? []).length, 2);
});
test('safety and early-preview disclosures appear once in the footer, not above each page', async () => {
  const safety = await component('../src/components/SafetyNotice.tsx');
  const { default: Layout } = await component('../src/app/layout.tsx', {
    '@/components/SafetyNotice': safety.moduleUrl,
    '@/components/AuthProvider': url('export const AuthProvider=({children})=>children;'),
    '@/components/PolicyAcceptance': url('export const PolicyAcceptance=({children})=>children;'),
    '@/components/SiteHeader': url(`import {jsx} from ${JSON.stringify(jsx)};export const SiteHeader=()=>jsx('header',{children:'Header'});`),
  });
  const originalEnvironment = process.env.NEXT_PUBLIC_APP_ENV;
  try {
    for (const environment of ['development', 'production']) {
      process.env.NEXT_PUBLIC_APP_ENV = environment;
      const html = renderToStaticMarkup(createElement(Layout, null, createElement('main', null, 'Page content')));
      assert.equal((html.match(/Community safety reminders/g) ?? []).length, 1);
      assert(html.indexOf('<footer') < html.indexOf('Community safety reminders'));
      assert(html.includes('href="/contact"'));
      assert(html.includes('href="/privacy"'));
      if (environment === 'production') assert(!html.includes('Early preview'));
      else {
        assert.equal((html.match(/Early preview/g) ?? []).length, 1);
        assert(html.indexOf('<footer') < html.indexOf('Early preview'));
      }
    }
  } finally {
    if (originalEnvironment === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
    else process.env.NEXT_PUBLIC_APP_ENV = originalEnvironment;
  }
  for (const name of ['AskQuestionForm', 'QuestionDetail', 'MessagesClient', 'CommunityHome']) {
    const source = await readFile(new URL(`../src/components/${name}.tsx`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /SafetyNotice|Before you publish|Protect yourself in messages|Peer experiences, not legal advice/, `${name} relies on the single shared footer`);
    assert.doesNotMatch(source, /answer anonymously|anonymous profile|anonymous handle/i, `${name} must not imply guaranteed anonymity`);
  }
});
test('policy pages clearly disclose missing operator processes rather than pretending compliance',async()=>{
  for(const [page,phrase] of Object.entries({privacy:'not a finalized production policy',terms:'not finalized production Terms',contact:'does not submit a request'})) {
    const {default:Page}=await component(`../src/app/${page}/page.tsx`);
    const html=renderToStaticMarkup(createElement(Page));
    assert(html.includes(phrase),page);
    if (page === 'contact') assert(html.includes('href="mailto:varunchinna5966@gmail.com"'), 'Use only the approved temporary contact');
    else assert(!html.includes('mailto:'),'Do not invent a support mailbox');
  }
});

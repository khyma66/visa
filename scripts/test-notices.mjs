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
async function component(path) {
  const source = await readFile(new URL(path,import.meta.url),'utf8');
  const code = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
    .replaceAll('"react/jsx-runtime"',JSON.stringify(jsx)).replaceAll("'next/link'",JSON.stringify(link));
  return import(url(code));
}
test('contextual safety notices render truthful warnings and working internal destinations',async()=>{
  const { SafetyNotice } = await component('../src/components/SafetyNotice.tsx');
  for(const [kind,phrase] of Object.entries({advice:'not affiliated',publishing:'public and may be copied',messaging:'not end-to-end encrypted',imported:'not a current official answer'})) {
    const html=renderToStaticMarkup(createElement(SafetyNotice,{kind}));
    assert(html.includes(phrase),kind); assert(html.includes('href="/contact"')); assert(html.includes('href="/community-safety"'));
  }
  for (const name of ['AskQuestionForm', 'QuestionDetail', 'MessagesClient']) {
    const source = await readFile(new URL(`../src/components/${name}.tsx`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /answer anonymously|anonymous profile|anonymous handle/i, `${name} must not imply guaranteed anonymity`);
  }
});
test('policy pages clearly disclose missing operator processes rather than pretending compliance',async()=>{
  for(const [page,phrase] of Object.entries({privacy:'not a finalized production policy',terms:'not finalized production Terms',contact:'does not submit a request'})) {
    const {default:Page}=await component(`../src/app/${page}/page.tsx`);
    const html=renderToStaticMarkup(createElement(Page));
    assert(html.includes(phrase),page); assert(!html.includes('mailto:'),'Do not invent a support mailbox');
  }
});

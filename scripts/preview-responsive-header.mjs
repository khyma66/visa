// Isolated, render-only header fixtures for browser viewport/text-resize QA.
// No app server, credentials, authentication requests, or database access.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import config from '../tailwind.config.mjs';

const root = new URL('../', import.meta.url);
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const react = import.meta.resolve('react');
const dependencies = {
  'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'),
  'react-dom': import.meta.resolve('react-dom'),
  react: moduleUrl(`import * as React from ${JSON.stringify(react)};
    export const {useEffect,useRef}=React;
    export function useState(initial){const s=globalThis.headerFixture;return React.useState(s.index++===0&&s.open?true:initial);}`),
  'next/link': moduleUrl(`import React from ${JSON.stringify(react)};export default function Link({prefetch,...props}){return React.createElement('a',props);}`),
  'next/navigation': moduleUrl(`export const usePathname=()=>'/contact',useSearchParams=()=>new URLSearchParams(),useRouter=()=>({});`),
  'lucide-react': import.meta.resolve('lucide-react'),
  './AuthProvider': moduleUrl('export const useAuth=()=>globalThis.headerFixture.auth;'),
  './NotificationProvider': moduleUrl('export const useNotifications=()=>({data:{unreadNotifications:2,unreadMessages:3},error:false});'),
  './FeedbackForm': moduleUrl('export const FeedbackForm=()=>null;'),
  '@/lib/feedback': moduleUrl('export const feedbackSection=()=>"contact",isFeedbackOwner=async()=>false;'),
};
async function load(name) {
  const source = await readFile(new URL(`src/components/${name}.tsx`, root), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText.replace(/from (['"])([^'"]+)\1/g, (_match, _quote, specifier) => {
    if (!dependencies[specifier]) throw new Error(`Unmapped fixture dependency: ${specifier}`);
    return `from ${JSON.stringify(dependencies[specifier])}`;
  });
  dependencies[`./${name}`] = moduleUrl(code);
  return import(dependencies[`./${name}`]);
}
for (const name of ['Avatar', 'CommunityNavigation', 'FeedbackLauncher', 'NotificationLinks']) await load(name);
const { SiteHeader } = await load('SiteHeader');
const css = (await postcss([tailwindcss(config)]).process(await readFile(new URL('src/styles/globals.css', root), 'utf8'), { from: new URL('src/styles/globals.css', root).pathname })).css;
const logo = await readFile(new URL('public/assets/brand/visathreads-integrated-logo.png', root));
createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:3013');
  if (url.pathname === '/assets/brand/visathreads-integrated-logo.png') {
    response.writeHead(200, { 'Content-Type': 'image/png' }).end(logo); return;
  }
  const state = ['guest', 'loading', 'member', 'member-open'].includes(url.searchParams.get('state')) ? url.searchParams.get('state') : 'guest';
  const member = state.startsWith('member');
  globalThis.headerFixture = { index: 0, open: state === 'member-open', auth: {
    user: member ? { id: 'fixture', email: 'layout-test@example.invalid' } : null,
    profile: member ? { username: 'long-public-test-username', avatar_seed: 'initial:T:fixture', reputation: 10 } : null,
    loading: state === 'loading', demoMode: false,
  } };
  const html = renderToStaticMarkup(React.createElement(SiteHeader));
  delete globalThis.headerFixture;
  response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
  response.end(`<!doctype html><html lang="en" style="font-size:${url.searchParams.get('text') === '200' ? '200%' : '100%'}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Isolated header fixture</title><style>${css}</style></head><body>${html}<main id="main-content" style="padding:1rem"><h1>Responsive header fixture: ${state}</h1><p>Render-only test. No account or service is connected.</p></main></body></html>`);
}).listen(3013, '127.0.0.1', () => console.log('Render-only header fixtures: http://127.0.0.1:3013/?state=guest (guest/loading/member/member-open; text=200)'));

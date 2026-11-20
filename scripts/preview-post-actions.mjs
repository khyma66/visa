// Render-only phone QA: actual vote/disclosure components and compiled site CSS.
// No authentication, API calls, or live votes. Open / for the viewport matrix.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageCircle, Ellipsis } from 'lucide-react';
import ts from 'typescript';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import config from '../tailwind.config.mjs';

const root = new URL('../', import.meta.url);
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const dependencies = {
  react: import.meta.resolve('react'),
  'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'),
  'react-dom': import.meta.resolve('react-dom'),
  'lucide-react': import.meta.resolve('lucide-react'),
  './AuthProvider': moduleUrl('export const useAuth=()=>({user:null,demoMode:true});'),
  '@/lib/voting': moduleUrl('export const readArchiveVote=()=>{},readVote=()=>{},writeVote=()=>{throw Error("Render-only fixture");};'),
};
async function load(name) {
  const source = await readFile(new URL(`src/components/${name}.tsx`, root), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText.replace(/from (['"])([^'"]+)\1/g, (_match, _quote, specifier) => {
    if (!dependencies[specifier]) throw Error(`Unmapped fixture dependency: ${specifier}`);
    return `from ${JSON.stringify(dependencies[specifier])}`;
  });
  return import(moduleUrl(code));
}
const { VoteControls } = await load('VoteControls');
const { ActionPopover } = await load('ActionPopover');
const h = React.createElement;
function toolbar(score, comment = false) {
  const replies = score < 0 ? '12.5K' : '12';
  return h('div', { className: comment ? 'post-toolbar mt-4' : 'feed-post-toolbar mt-3' },
    h(VoteControls, { id: `fixture-${score}`, kind: comment ? 'answer' : 'question', score, authorId: null, path: '#fixture' }),
    !comment && h('a', { className: 'post-reply-action', href: '#reply', 'aria-label': `${replies} replies` }, h(MessageCircle, { size: 20 }), h('span', { className: 'post-reply-count' }, replies)),
    !comment && h('a', { className: 'post-related-action', href: '#related' }, 'Similar'),
    h(ActionPopover, { label: 'More post options', trigger: h(Ellipsis, { size: 20 }) }, 'Render-only fixture'));
}
createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:3125');
  const css = (await postcss([tailwindcss(config)]).process(await readFile(new URL('src/styles/globals.css', root), 'utf8'), { from: new URL('src/styles/globals.css', root).pathname })).css;
  const matrix = url.pathname === '/';
  const body = matrix
    ? `<h1>Mobile action sizing — isolated rendering</h1><p>Actual vote components and site stylesheet. No live data or voting.</p><div style="display:flex;flex-wrap:wrap;gap:16px">${[320, 360, 390, 430, 768].map(width => `<section><h2>${width}px viewport</h2><iframe title="${width}px viewport" width="${width}" height="700" src="/phone"></iframe></section>`).join('')}<section><h2>320px · 200% text</h2><iframe title="320px enlarged text" width="320" height="900" src="/phone?text=200"></iframe></section></div>`
    : renderToStaticMarkup(h('main', { style: { padding: 16 } },
      h('header', { className: 'mb-4 text-lg font-semibold' }, 'VisaThreads · Post actions'),
      ...[0, 12500, -12500].map(score => h('article', { key: score, className: 'feed-card bg-white border-b border-slate-200 px-3 py-4' },
        h('h2', { className: 'text-thread-title font-semibold' }, score === 0 ? 'Preparing for a visa interview' : 'A discussion with a larger vote count'),
        h('p', { className: 'mt-2 text-base text-slate-600' }, 'Sample content for checking mobile spacing.'), toolbar(score))),
      h('section', { className: 'px-3 py-4' }, h('h2', { className: 'font-semibold' }, 'Reply actions'), toolbar(8, true))));
  const measurements = matrix ? `<pre id="measurements" style="white-space:pre-wrap"></pre><script>
    const reports = new Map();
    addEventListener('message', event => {
      if(event.origin !== location.origin || event.data?.type !== 'action-measurements') return;
      reports.set(event.data.label,event.data);
      document.querySelector('#measurements').textContent=JSON.stringify([...reports.values()],null,2);
    });</script>` : `<script>
    const rows=[...document.querySelectorAll('.feed-post-toolbar,.post-toolbar')].map(row=>({
      controls:[...row.querySelectorAll('button,a')].map(el=>{
        const rect=el.getBoundingClientRect(), icon=el.querySelector('svg')?.getBoundingClientRect();
        return {name:el.className,width:rect.width,height:rect.height,top:rect.top,icon:icon&&[icon.width,icon.height]};
      }),singleRow:new Set([...row.querySelectorAll('button,a')].map(el=>el.getBoundingClientRect().top)).size===1,overflow:row.scrollWidth>row.clientWidth
    }));
    parent.postMessage({type:'action-measurements',label:innerWidth+'px / '+getComputedStyle(document.documentElement).fontSize,rows,pageOverflow:document.documentElement.scrollWidth>innerWidth},location.origin);
  </script>`;
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(`<!doctype html><html lang="en" style="font-size:${url.searchParams.get('text') === '200' ? '200%' : '100%'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Post action viewport QA</title><style>${css}iframe{box-sizing:content-box;border:1px solid #cbd5e1}body{background:#f7f9fb}${matrix ? 'body{padding:16px}' : ''}</style></head><body>${body}${measurements}</body></html>`);
}).listen(3125, '127.0.0.1', () => console.log('Render-only post actions: http://127.0.0.1:3125/'));

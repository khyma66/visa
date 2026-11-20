import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

// Render the real "Notify me" button and Also asked panel with deterministic
// hooks; the network boundary (RPCs) is replaced by an in-memory recorder.
const url=s=>`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const react=import.meta.resolve('react');
const harness=()=>globalThis.__issueTest;
const dependencies={
  'react':url(`export * from ${JSON.stringify(react)};
    export function useState(v){const h=globalThis.__issueTest;const i=h.slot++;if(!(i in h.state))h.state[i]=v;return [h.state[i],n=>{h.state[i]=typeof n==='function'?n(h.state[i]):n;}];}
    export function useEffect(){}export function useCallback(fn){return fn;}`),
  'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),
  'next/link':url(`import React from ${JSON.stringify(react)};export default p=>React.createElement('a',p,p.children);`),
  'next/navigation':url('export const usePathname=()=>globalThis.__issueTest.pathname;'),
  'lucide-react':import.meta.resolve('lucide-react'),
  './AuthProvider':url('export const useAuth=()=>globalThis.__issueTest.auth;'),
  './useIssueFollows':url('export const useIssueFollows=()=>globalThis.__issueTest.issues;'),
  './PostOriginBadge':url(`import React from ${JSON.stringify(react)};export const PostOriginBadge=()=>React.createElement('span',null,'Earlier discussion');`),
  '@/lib/post-presentation':url("export const isImportedPost=p=>String(p.id).startsWith('apify-'),topicLabel=t=>t;"),
  '@/lib/community':url('export const discoverQuestions=async()=>[];'),
  '@/lib/discovery':url("export const contextTags=c=>c.tags??[];"),
  '@/lib/realtime':url('export const subscribeLive=()=>()=>{};'),
};
async function load(file,extra={}){
  let source=ts.transpileModule(await readFile(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  for(const [key,value] of Object.entries({...dependencies,...extra})) source=source.replaceAll(`from '${key}'`,`from ${JSON.stringify(value)}`).replaceAll(`from "${key}"`,`from ${JSON.stringify(value)}`);
  assert.doesNotMatch(source,/from ['"](\.|@\/)/,`Unmocked dependency in ${file}`);
  return import(url(source));
}
const lib=await load('../src/lib/issue-follows.ts',{'./supabase/client':url('export const getSupabase=()=>globalThis.__issueTest.supabase;')});
const {FollowIssueButton}=await load('../src/components/FollowIssueButton.tsx',{'@/lib/issue-follows':url(`export const followTopics=${lib.followTopics.toString()},loginHref=${lib.loginHref.toString()};`)});
const {RelatedQuestions}=await load('../src/components/RelatedQuestions.tsx',{'./FollowIssueButton':url(`import React from ${JSON.stringify(react)};export const FollowIssueButton=p=>React.createElement('notify-me',{'data-anchor':p.anchorId,'data-path':p.path,'data-tags':p.tags.join(',')});`)});

function setup({auth={},issues={},state={},items}={}){
  const calls=[];
  globalThis.__issueTest={slot:0,state,pathname:'/us/en/questions/q1',calls,
    auth:{user:{id:'member'},loading:false,demoMode:false,...auth},
    issues:{follows:[],error:'',refresh(){},follow:async(...a)=>{calls.push(['follow',...a]);},unfollow:async(...a)=>{calls.push(['unfollow',...a]);},...issues}};
  if(items)globalThis.__issueTest.state={0:items};
  return calls;
}
const render=(component,props)=>{harness().slot=0;return renderToStaticMarkup(React.createElement(component,props));};
const post={anchorId:'apify-reddit_1',title:'OPT unemployment days',tags:['OPT','unemployment-days','visa-question'],path:'/us/en/questions/q1?tab=x'};

test('followTopics keeps the post tags, normalized, without the generic fallback tag',()=>{
  assert.deepEqual(lib.followTopics(['OPT',' opt ','visa-question','h1b','cap-gap','rfe','stem-opt','extra']),['opt','h1b','cap-gap','rfe','stem-opt']);
  assert.deepEqual(lib.followTopics(undefined),[]);
  assert.equal(lib.loginHref('/us/en/questions/q1?tab=x'),'/login?next=%2Fus%2Fen%2Fquestions%2Fq1%3Ftab%3Dx#sign-in');
});
test('signed-out visitors get a login link that returns to the page',()=>{
  setup({auth:{user:null}});const html=render(FollowIssueButton,post);
  assert.match(html,/<a [^>]*href="\/login\?next=%2Fus%2Fen%2Fquestions%2Fq1%3Ftab%3Dx#sign-in"/);
  assert.match(html,/Notify me/);assert.doesNotMatch(html,/<button/);
});
test('no button in demo mode, while auth loads, or for posts without topics',()=>{
  setup({auth:{demoMode:true}});assert.equal(render(FollowIssueButton,post),'');
  setup({auth:{loading:true}});assert.equal(render(FollowIssueButton,post),'');
  setup();assert.equal(render(FollowIssueButton,{...post,tags:['visa-question']}),'');
});
test('signed-in members see Notify me, a pressed Following state, and a disabled button while loading',()=>{
  setup();let html=render(FollowIssueButton,post);
  assert.match(html,/aria-pressed="false"/);assert.match(html,/Notify me/);assert.match(html,/aria-label="Notify me when others post about OPT unemployment days"/);
  setup({issues:{follows:[{anchor_id:'apify-reddit_1'}]}});html=render(FollowIssueButton,post);
  assert.match(html,/aria-pressed="true"/);assert.match(html,/Following/);assert.match(html,/Unfollow OPT unemployment days/);
  setup({issues:{follows:null}});assert.match(render(FollowIssueButton,post),/disabled=""/);
});
test('clicking follows with the post id and normalized topics, and clicking again unfollows',async()=>{
  const find=(el,type)=>{if(!el||typeof el!=='object')return null;if(el.type===type)return el;const kids=[].concat(el.props?.children??[]);for(const k of kids){const f=find(k,type);if(f)return f;}return null;};
  let calls=setup();harness().slot=0;
  let button=find(FollowIssueButton(post),'button');button.props.onClick();await new Promise(r=>setTimeout(r));
  assert.deepEqual(calls,[['follow','apify-reddit_1','OPT unemployment days',['opt','unemployment-days']]]);
  calls=setup({issues:{follows:[{anchor_id:'apify-reddit_1'}]}});harness().slot=0;
  button=find(FollowIssueButton(post),'button');button.props.onClick();await new Promise(r=>setTimeout(r));
  assert.deepEqual(calls,[['unfollow','apify-reddit_1']]);
});
test('follow errors are announced instead of failing silently',async()=>{
  const find=(el,type)=>{if(!el||typeof el!=='object')return null;if(el.type===type)return el;for(const k of [].concat(el.props?.children??[])){const f=find(k,type);if(f)return f;}return null;};
  const state={};setup({state,issues:{follow:async()=>{throw new Error('You can follow up to 50 issues.');}}});harness().slot=0;
  find(FollowIssueButton(post),'button').props.onClick();await new Promise(r=>setTimeout(r,5));
  harness().slot=0;assert.match(renderToStaticMarkup(FollowIssueButton(post)),/role="alert"[^>]*>You can follow up to 50 issues\./);
});
test('Also asked offers Notify me on every similar post, anchored on that post and returning to this page',()=>{
  setup({items:[{id:'apify-1',title:'Earlier OPT thread',tags:['opt','stem-opt'],answer_count:3,matched_tags:['opt']},{id:'q2',title:'Member OPT question',tags:['opt'],answer_count:0}]});
  const html=render(RelatedQuestions,{context:{id:'q1',tags:['opt']}});
  assert.equal((html.match(/<notify-me/g)||[]).length,2);
  assert.match(html,/data-anchor="apify-1" data-path="\/us\/en\/questions\/q1" data-tags="opt,stem-opt"/);
  assert.match(html,/Same situation\? Use Notify me/);
  assert.doesNotMatch(html,/<a [^>]*>(?:(?!<\/a>).)*<notify-me/s,'button must not be nested inside the post link');
});

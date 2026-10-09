import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = (source) => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const reactUrl = import.meta.resolve('react');
const link = moduleUrl(`import React from ${JSON.stringify(reactUrl)}; export default function Link(props){return React.createElement('a',props,props.children);}`);
// Render loaded states without running effects, opening a browser or contacting a backend.
const hooks = moduleUrl(`import * as React from ${JSON.stringify(reactUrl)};
  export const {useCallback,useEffect,useMemo,useRef}=React;
  export function useState(initial){const state=globalThis.__presentation;
    const index=state.index++; return React.useState(Object.hasOwn(state.values,index)?state.values[index]:initial);}`);
const dependencies = {
  'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'), react: hooks,
  'next/link': link, 'next/navigation': moduleUrl('export const useSearchParams=()=>new URLSearchParams();export const useParams=()=>({id:globalThis.__presentation.question?.id});'),
  'lucide-react': import.meta.resolve('lucide-react'), 'date-fns': import.meta.resolve('date-fns'),
  '@/lib/community': moduleUrl('export const acceptAnswer=()=>{},createAnswer=()=>{},getAnswerPage=()=>{},getDiscussionContext=()=>{},getQuestion=()=>{},sortAnswers=x=>x,voteAnswer=()=>{},voteQuestion=()=>{},getCommunitySource=()=>{},getQuestionPage=()=>{},discoverQuestions=()=>{};'),
  '@/lib/realtime': moduleUrl('export const subscribeLive=()=>()=>{};'),
  '@/lib/supabase/client': moduleUrl('export const isSupabaseConfigured=false,getSupabase=()=>{throw new Error("Network not permitted in presentation test")};'),
  '@/lib/tag-directory': moduleUrl('export const archiveDirectoryPage=()=>{},directoryPage=()=>{};'),
  '@/lib/discovery': moduleUrl('export const contextTags=context=>context.tags??[];'),
  './AuthProvider': moduleUrl('export const useAuth=()=>({user:globalThis.__presentation.user,demoMode:false});'),
  './Avatar': moduleUrl(`import React from ${JSON.stringify(reactUrl)};export const Avatar=()=>React.createElement('span',{'aria-label':'Member avatar'});`),
  './ReportButton': moduleUrl('export const ReportButton=()=>null;'),
  './RelatedQuestions': moduleUrl('export const RelatedQuestions=()=>null;'),
};
dependencies['@/lib/messaging-state'] = moduleUrl(transpile(await readFile(new URL('../src/lib/messaging-state.ts',import.meta.url),'utf8')));
dependencies['@/lib/post-categories'] = moduleUrl(transpile(await readFile(new URL('../src/lib/post-categories.ts',import.meta.url),'utf8')));
dependencies['@/lib/post-presentation'] = moduleUrl(transpile(await readFile(new URL('../src/lib/post-presentation.ts',import.meta.url),'utf8')));
async function component(name) {
  let code = transpile(await readFile(new URL(`../src/components/${name}.tsx`,import.meta.url),'utf8'));
  for(const [specifier,replacement] of Object.entries(dependencies)) {
    code=code.replaceAll(`from '${specifier}'`,`from ${JSON.stringify(replacement)}`).replaceAll(`from "${specifier}"`,`from ${JSON.stringify(replacement)}`);
  }
  return { url:moduleUrl(code), value:await import(moduleUrl(code)) };
}
const {value:{QuestionCard},url:cardUrl} = await component('QuestionCard');
dependencies['./QuestionCard']=cardUrl;
const {value:{QuestionDetail}} = await component('QuestionDetail');
const {value:{CommunityHome}} = await component('CommunityHome');
const {value:{TagDirectory}} = await component('TagDirectory');
const {value:{RelatedQuestions}} = await component('RelatedQuestions');
const alice='11111111-1111-4111-8111-111111111111';
const bob='22222222-2222-4222-8222-222222222222';
const native={id:'33333333-3333-4333-8333-333333333333',author_id:alice,author_username:'alice-test',author_avatar_seed:'alice',
  title:'H1B transfer timeline experiences',body:'A detailed question about a recent transfer application.',visa_type:'H-1B',destination_country:'United States',
  tags:['h1b','transfer'],status:'open',vote_score:12,answer_count:3,view_count:45,accepted_answer_id:null,
  created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-01T00:00:00Z',source:'visaflow'};
const source={...native,id:'apify-fixture',author_id:'source-not-an-account',author_username:'generated-source-label',source:'apify',
  source_url:'https://www.facebook.com/groups/example/posts/123',source_group:'Visa experience group'};
const reply={id:'44444444-4444-4444-8444-444444444444',question_id:native.id,author_id:bob,author_username:'bob-test',author_avatar_seed:'bob',
  body:'This was my experience with the same application process.',vote_score:2,is_accepted:false,status:'active',created_at:native.created_at,updated_at:native.updated_at};
function render(Component, props={}, {values={},user=null,question=props.initialQuestion}={}) {
  globalThis.__presentation={index:0,values,user,question};
  try{return renderToStaticMarkup(React.createElement(Component,props));}
  finally{delete globalThis.__presentation;}
}
const text = (html) => html.replace(/<[^>]*>/g,' ');
const noPipelineLabels = (html) => assert.doesNotMatch(text(html),/imported|apify|collected archive|source records|completed runs|duplicate records|group question|group comment/i);

test('source question cards use normal discussion layout without fake member identities or changed reaction semantics',()=>{
  const html=render(QuestionCard,{question:source});
  noPipelineLabels(html);
  assert(html.includes(source.title));assert(html.includes(source.body));
  assert(html.includes('reactions'));assert(html.includes('replies'));assert(!html.includes('views'));
  assert(html.includes('Community Contributor'));assert(!html.includes(source.author_username));assert(!html.includes('Member avatar'));
  assert(!html.includes(source.source_url));assert(!html.includes('/messages?'));
});
test('native cards preserve public usernames, member avatars, votes and normal question links',()=>{
  const html=render(QuestionCard,{question:native});
  assert(html.includes('u/alice-test'));assert(html.includes('Member avatar'));assert(html.includes('votes'));
  assert(html.includes(`/questions/${native.id}`));assert(!html.includes('Community Contributor'));
});
test('selected archive experiences retain their working canonical question links',()=>{
  const html=render(QuestionCard,{question:{...source,post_kind:'experience',experience_category:'Visa interview'}});
  assert(html.includes(`/questions/${source.id}`)); assert(!html.includes(`/experiences/${source.id}`));
  assert(html.includes('Experience · Visa interview')); assert(html.includes('Community Contributor'));
});
test('experience cards and details expose category and discussion actions without answer acceptance',()=>{
  const experience={...native,post_kind:'experience',experience_category:'Other',visa_type:'Other'};
  const card=render(QuestionCard,{question:experience});
  assert(card.includes(`/experiences/${native.id}`)); assert(card.includes('Experience · Other'));
  assert(card.toLowerCase().includes(`datetime="${native.created_at.toLowerCase()}"`));
  const detail=render(QuestionDetail,{initialQuestion:experience,initialAnswers:[reply]},{user:{id:alice}});
  assert(detail.includes('Join the discussion')); assert(detail.includes('Post reply'));
  assert(!detail.includes('Accept this answer')); assert(!detail.includes('Accepted answers and highest votes first'));
});
test('experience feed excludes questions, includes Other, and defaults to newest',()=>{
  const older={...native,id:'older',post_kind:'experience',experience_category:'Other',created_at:'2026-09-01T00:00:00Z'};
  const newer={...older,id:'newer',title:'A newer visa experience',created_at:'2026-10-01T00:00:00Z'};
  const html=render(CommunityHome,{experience:true},{values:{0:[older,native,newer],3:false}});
  assert(html.includes('Share Your Experience')); assert(html.includes('/experiences/new'));
  assert(html.includes('All Experience Categories')); assert(html.includes('Other</option>'));
  assert(html.indexOf('/experiences/newer') < html.indexOf('/experiences/older'));
  assert(!html.includes(`/questions/${native.id}`));
  assert.match(html,/aria-pressed="true"[^>]*>New/);
  const filtered=render(CommunityHome,{experience:true},{values:{0:[older,newer],3:false,15:'Visa interview'}});
  assert(filtered.includes('No matching experiences')); assert(!filtered.includes('/experiences/newer'));
});
test('discussion and promotion labels describe content rather than where it came from',()=>{
  for(const sourceKind of ['apify','visaflow']) {
    assert(render(QuestionCard,{question:{...native,source:sourceKind,post_kind:'discussion'}}).includes('Discussion'));
    assert(render(QuestionCard,{question:{...native,source:sourceKind,post_kind:'promotion'}}).includes('Promotional post'));
  }
});
test('source detail uses neutral presentation with no source-author messaging or voting affordance',()=>{
  const html=render(QuestionDetail,{initialQuestion:source},{user:{id:bob}});
  noPipelineLabels(html);assert(!html.includes('Originally shared in'));
  assert(!html.includes(source.source_url));assert(html.includes('Community Contributor'));
  assert(html.includes('Join the discussion'));assert(!html.includes('Original discussion'));
  assert(!html.includes('Message author'));assert(!html.includes('/messages?'));assert(!html.includes('aria-label="Upvote"'));
  assert(!html.includes(source.author_username));assert(!html.includes('Peer experiences, not legal advice'));
});
test('an apify ID remains source-only even when its source flag/link are absent and author fields resemble a member',()=>{
  const malformed={...source,source:undefined,source_url:null,author_id:alice,author_username:'alice-test'};
  const html=render(QuestionDetail,{initialQuestion:malformed},{user:{id:bob}});
  assert(!html.includes('/messages?'));assert(!html.includes('u/alice-test'));assert(!html.includes('aria-label="Upvote"'));
  assert(html.includes('Community Contributor'));
});
test('native post messaging binds both public username and registered profile ID for guests and other members',()=>{
  for(const user of [null,{id:bob}]) {
    const html=render(QuestionDetail,{initialQuestion:native},{user});
    assert(html.includes(`/messages?to=alice-test&amp;member=${alice}`));assert(html.includes('Message author'));
    assert(html.includes('aria-label="Upvote"'));assert(html.includes('u/alice-test'));
  }
  assert(!render(QuestionDetail,{initialQuestion:native},{user:{id:alice}}).includes('Message author'));
});
test('source comments cannot become member identities or message targets through missing provenance or matching handles',()=>{
  const comment={...reply,id:'apify-comment-fixture',source:undefined,author_username:'bob-test',source_url:source.source_url};
  const html=render(QuestionDetail,{initialQuestion:source,initialAnswers:[comment]},{user:{id:alice}});
  noPipelineLabels(html);assert(!html.includes('Original comment'));assert(html.includes(comment.body));
  assert(!html.includes('u/bob-test'));assert(!html.includes('/messages?'));assert(!html.includes('aria-label="Upvote"'));
});
test('registered member replies on source discussions retain their own message action',()=>{
  const html=render(QuestionDetail,{initialQuestion:source,initialAnswers:[reply]},{user:{id:alice}});
  assert(html.includes('u/bob-test'));assert(html.includes(`/messages?to=bob-test&amp;member=${bob}`));
  assert(!html.includes('Message author'));assert(html.includes('aria-label="Message bob-test"'));
  assert(!html.includes('Accept this answer'));
});
test('home renders community-first copy and no ingestion diagnostics while preserving filters and post text',()=>{
  const html=render(CommunityHome,{}, {values:{0:[source,native],3:false}});
  noPipelineLabels(html);assert(html.includes('All Post Types'));assert(html.includes('All Tags'));
  assert(html.includes(source.title));assert(html.includes('Top'));assert(html.includes('Ask a Question'));
  assert(!html.includes('Privacy-aware import'));
});
test('partial feed failures remain visible without exposing ingestion diagnostics',()=>{
  const html=render(CommunityHome,{}, {values:{0:[native],3:false,9:true}});
  assert(html.includes('Some discussions are temporarily unavailable.'));noPipelineLabels(html);
});
test('tag directory presents combined discussion counts without splitting people into imported and native sources',()=>{
  const html=render(TagDirectory,{}, {values:{0:[{tag:'h1b',question_count:12,native_count:2,archive_count:10,example_title:'Transfer timelines'}],5:false}});
  noPipelineLabels(html);assert(html.includes('12 posts'));assert(html.includes('/?tag=h1b'));assert(html.includes('Transfer timelines'));
  assert(!html.includes('member-created'));
});
test('related questions use source-neutral accessible reply counts and shared-topic navigation',()=>{
  const html=render(RelatedQuestions,{context:{tags:['h1b']}},{values:{0:[{...source,matched_tags:['h1b']}]}});
  noPipelineLabels(html);assert(html.includes('aria-label="3 replies"'));assert(html.includes('/questions/apify-fixture'));
  assert(html.includes('Shared topics: h1b'));assert(!html.includes('/messages?'));
});

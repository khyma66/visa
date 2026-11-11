import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestDecision, readRpcUrl, VisitBudget, ORIGIN, DATABASE, SITE_URL } from '../lib/policy.mjs';
const post = {url:ORIGIN+'/us/en/questions/apify-fixture',title:'A designated public test post',body:'Test content with no private personal information.',designated_test_post:true};
test('fixed site configuration needs no post list or account',()=>{
  assert.equal(SITE_URL,'https://visathreads.com/us/en');
  assert.equal(requestDecision({url:SITE_URL,method:'GET',resourceType:'document'},[{url:SITE_URL}]),'document');
  assert.equal(requestDecision({url:SITE_URL+'?test=true',method:'GET',resourceType:'document'},[{url:SITE_URL}]),'deny');
});
test('every mutation is blocked, and view-count POST is acknowledged locally only',()=>{
  for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS','CONNECT'])
    assert.equal(requestDecision({url:ORIGIN+'/api/messages',method,resourceType:'fetch'},[post]),'deny-write');
  assert.equal(requestDecision({url:ORIGIN+'/api/post-views?id=apify-fixture',method:'POST',resourceType:'fetch'},[post]),'suppress-view');
  assert.equal(requestDecision({url:ORIGIN+'/api/post-views?id=apify-fixture',method:'GET',resourceType:'fetch'},[post]),'read');
});
test('the guard rejects arbitrary navigation, auth/admin, trackers and upstream RPC writes',()=>{
  for(const url of [ORIGIN+'/login',ORIGIN+'/api/admin/analytics',ORIGIN+'/api/auth/callback',
    'https://tracker.invalid/pixel',DATABASE+'/rest/v1/rpc/record_event'])
    assert.equal(requestDecision({url,method:'GET',resourceType:'fetch'},[post]),'deny');
  assert.equal(requestDecision({url:post.url,method:'GET',resourceType:'document'},[post]),'document');
  assert.equal(requestDecision({url:ORIGIN+'/us/en/questions/apify-other',method:'GET',resourceType:'document'},[post]),'deny');
  assert.equal(requestDecision({url:DATABASE+'/rest/v1/question_feed?id=eq.fixture',method:'GET',resourceType:'fetch'},[post]),'read');
});
test('budget cannot exceed two openings, rerun without a gap, or shorten the minimum gap',()=>{
  assert.throws(()=>new VisitBudget(3));assert.throws(()=>new VisitBudget(1,9999));
  const b = new VisitBudget();b.take(0);assert.throws(()=>b.take(9999));
  b.take(10_000);
  assert.equal(b.used,2);assert.throws(()=>b.take(20_000));
});
test('only reviewed read RPCs convert to GET; defaults, arrays and write functions remain bounded',()=>{
  const input=DATABASE+'/rest/v1/rpc/platform_post_page';
  assert.equal(requestDecision({url:input,method:'POST',resourceType:'fetch'},[post]),'rpc-read');
  const url=new URL(readRpcUrl(input,JSON.stringify({query_text:'visa & renewal',before_time:null,before_score:0})));
  assert.equal(url.searchParams.get('query_text'),'visa & renewal');
  assert.equal(url.searchParams.has('before_time'),false);assert.equal(url.searchParams.get('before_score'),'0');
  const tags=new URL(readRpcUrl(DATABASE+'/rest/v1/rpc/platform_related_posts',JSON.stringify({query_tags:['h1b','h4']})));
  assert.equal(tags.searchParams.get('query_tags'),'{"h1b","h4"}');
  assert.throws(()=>readRpcUrl(DATABASE+'/rest/v1/rpc/vote_question','{}'));
  assert.throws(()=>readRpcUrl(input,'{"unexpected":true}'));
  assert.throws(()=>readRpcUrl(input,'{"query_text":{}}'));
  assert.throws(()=>readRpcUrl('https://attacker.invalid/rest/v1/rpc/platform_post_page','{}'));
});

import assert from 'node:assert/strict';

export const ORIGIN = 'https://visathreads.com';
export const SITE_URL = ORIGIN + '/us/en';
export const DATABASE = 'https://cycnichledvqbxevrwnt.supabase.co';
export const LIMITS = Object.freeze({ visits: 2, gapMs: 10_000, requests: 500 });
export const POST_ID = '(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|apify-[A-Za-z0-9_-]{1,160})';
const postPath = new RegExp(`^/us/en/(?:questions|experiences)/${POST_ID}$`);
const readRpc = Object.freeze({
  platform_post_page:['query_text','filter_tag','filter_visa','sort_mode','before_time','before_id','before_score','filter_kind','filter_category','filter_origin'],
  platform_related_posts:['source_id','query_tags','query_text','filter_visa'],
});
/** Only these inspected STABLE read functions may be converted to GET. */
export function readRpcUrl(target, body) {
  const url=new URL(target), name=url.pathname.split('/').at(-1),keys=readRpc[name];
  assert(url.origin===DATABASE && url.pathname===`/rest/v1/rpc/${name}` && !url.search && Object.hasOwn(readRpc,name),'Unapproved read function.');
  assert(typeof body==='string' && body.length<=16_384,'Invalid read parameters.');
  const args=JSON.parse(body);
  assert(args && !Array.isArray(args) && typeof args==='object','Invalid read parameters.');
  for(const [key,value] of Object.entries(args)){
    assert(keys.includes(key),'Unknown read parameter.');
    if(value===null)continue; // All nullable arguments have SQL NULL defaults.
    if(key==='query_tags'){
      assert(Array.isArray(value)&&value.length<=20&&value.every(v=>typeof v==='string'&&v.length<=40),'Invalid tags.');
      url.searchParams.set(key,'{'+value.map(v=>'"'+v.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"').join(',')+'}');
    }else{
      assert((typeof value==='string'&&value.length<=10_000)||(typeof value==='number'&&Number.isSafeInteger(value)),'Invalid read argument.');
      url.searchParams.set(key,String(value));
    }
  }
  return url.href;
}

/** This policy grants no application permissions. It only narrows outbound reads. */
export function requestDecision({ url: target, method, resourceType }, posts, origin = ORIGIN) {
  const url = new URL(target);
  if (url.username || url.password || !['https:','http:'].includes(url.protocol)) return 'deny';
  if (method === 'POST' && url.origin === origin && url.pathname === '/api/post-views') return 'suppress-view';
  if (method==='POST' && url.origin===DATABASE && Object.keys(readRpc).some(name=>url.pathname===`/rest/v1/rpc/${name}`)) return 'rpc-read';
  if (!['GET','HEAD'].includes(method)) return 'deny-write';
  if (url.origin === origin) {
    if (resourceType === 'document') return posts.some(p => new URL(p.url).pathname === url.pathname) && !url.search && !url.hash ? 'document' : 'deny';
    if (postPath.test(url.pathname)) return posts.some(p => new URL(p.url).pathname === url.pathname) ? 'read' : 'deny';
    if (url.pathname.startsWith('/api/') && !['/api/post-views','/api/community','/api/archive/status'].includes(url.pathname)) return 'deny';
    if (url.pathname === '/api/post-views' || url.pathname === '/api/community' || url.pathname === '/api/archive/status'
      || url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/assets/')
      || /\.(?:png|jpg|jpeg|webp|svg|ico|woff2?)$/.test(url.pathname)) return 'read';
    return 'deny';
  }
  if (url.origin === DATABASE && /^\/rest\/v1\/(?:question_feed|answer_feed|archive_posts|imported_answer_feed|imported_reply_counts|public_question_tags|tag_directory)$/.test(url.pathname)) return 'read';
  return 'deny';
}

export class VisitBudget {
  constructor(limit = LIMITS.visits, gapMs = LIMITS.gapMs) {
    assert(Number.isInteger(limit) && limit >= 1 && limit <= LIMITS.visits, 'Invalid visit budget.');
    assert(gapMs >= LIMITS.gapMs, 'The production minimum gap is ten seconds.');
    this.limit = limit; this.gapMs = gapMs; this.used = 0; this.previous = null;
  }
  take(now = Date.now()) {
    assert(this.used < this.limit, 'Visit budget exhausted.');
    assert(this.previous === null || now - this.previous >= this.gapMs, 'Visit minimum gap not met.');
    this.previous = now; this.used++;
  }
}

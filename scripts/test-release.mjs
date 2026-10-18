import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseProblems as releaseProblemsWithSource, requiredReviews } from './release-check.mjs';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { archiveSource } from './archive-source.mjs';
import { resolve } from 'node:path';
import { checkPrivateExperiences } from './check-private-experiences.mjs';

test('private experience release check fails closed without the reviewed source archive', async () => {
  await assert.rejects(() => checkPrivateExperiences(new URL('../src/data/required-private-archive-not-provisioned.json', import.meta.url)), /Required private experience archive is missing/);
  await assert.rejects(() => checkPrivateExperiences(new URL('../src/data/archive-fixture.json', import.meta.url)), /all four reviewed/);
});

test('production release and build retain the required real-archive integration gate', async () => {
  const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(scripts['check:private-experiences'], 'node scripts/check-private-experiences.mjs');
  assert(scripts['check:release'].startsWith('npm run check:private-experiences && '));
  assert(scripts['build:prod'].startsWith('npm run check:release && '));
});

test('CI and production never include the private development archive', () => {
  for (const environment of [{ CI: 'true' }, { NEXT_PUBLIC_APP_ENV: 'production' }, { CLOUDFLARE_ENV: 'production' }]) {
    assert.equal(archiveSource(process.cwd(), environment), resolve('src/data/archive-fixture.json'));
  }
});

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = (source) => ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;

const env = { NEXT_PUBLIC_SUPABASE_URL:'https://fixture.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:`sb_publishable_${'x'.repeat(30)}`, NEXT_PUBLIC_APP_ENV:'production', NEXT_PUBLIC_SITE_URL:'https://visaflow.example.org' };
const source = { gitSha: 'a'.repeat(40), gitTree: 'b'.repeat(40), sourceSha256: 'c'.repeat(64), dirty: false };
const releaseProblems = (env, review, config) => releaseProblemsWithSource(env, review, config, source);
const review = { siteOrigin:env.NEXT_PUBLIC_SITE_URL, databaseOrigin:env.NEXT_PUBLIC_SUPABASE_URL, checks:Object.fromEntries(requiredReviews.map((name) => [name,{status:'verified',evidence:'Test fixture only',verifiedBy:'Test', ...(name === 'source_parity' ? { sourceSha256: source.sourceSha256 } : {})}])) };
const config = { env:{production:{vars:{APP_ENV:'production',PUBLIC_LAUNCH_APPROVED:'true',IMPORTED_CONTENT_APPROVED:'false'}}} };
test('release accepts an explicitly reviewed matching configuration', () => assert.deepEqual(releaseProblems(env,review,config),[]));
test('release rejects missing config, service role keys, mismatched evidence and unsafe public variables', () => {
  assert(releaseProblems({},review,config).length>=4);
  assert(releaseProblems({...env,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_secret_do_not_publish'},review,config).some((p) => p.includes('publishable')));
  const serviceJWT = `header.${Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')}.signature`;
  assert(releaseProblems({...env,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:serviceJWT},review,config).some((p) => p.includes('publishable')));
  assert(releaseProblems({...env,NEXT_PUBLIC_SECRET:'private'},review,config).some((p) => p.includes('unexpected')));
  assert(releaseProblems(env,{...review,siteOrigin:'https://different.example.org'},config).some((p) => p.includes('match')));
});
test('release refuses unreviewed operations and imported distribution', () => {
  assert(releaseProblems(env,{...review,checks:{}},config).length>=requiredReviews.length);
  assert(releaseProblems(env,review,{env:{production:{vars:{...config.env.production.vars,IMPORTED_CONTENT_APPROVED:'true'}}}}).some((p) => p.includes('Imported')));
  assert(releaseProblems(env,review,{env:{production:{vars:{...config.env.production.vars,PUBLIC_LAUNCH_APPROVED:'false'}}}}).some((p) => p.includes('closed')));
});

test('each human/security review is required and import approval needs attributable evidence', () => {
  for (const name of requiredReviews) {
    const checks = {...review.checks, [name]:{status:'pending',evidence:'',verifiedBy:''}};
    assert(releaseProblems(env,{...review,checks},config).some((p)=>p.includes(name)),name);
  }
  const enabled = {env:{production:{vars:{...config.env.production.vars,IMPORTED_CONTENT_APPROVED:'true'}}}};
  assert(releaseProblems(env,{...review,checks:{...review.checks,imported_content_rights:{status:'verified'}}},enabled).some((p)=>p.includes('Imported')));
});

test('public HTML reads never forward sessions and fail on backend errors', async () => {
  const presentation = moduleUrl(transpile(await readFile(new URL('../src/lib/post-presentation.ts', import.meta.url), 'utf8')));
  const source = transpile(await readFile(new URL('../src/lib/public-server.ts',import.meta.url),'utf8'))
    .replace("'react'",JSON.stringify(moduleUrl('export const cache = (fn) => fn;')))
    .replace("'@visa/archive'", JSON.stringify(moduleUrl('export default {questions:[],answersByQuestionId:{}};')))
    .replace("'./archive-presentation'", JSON.stringify(moduleUrl('export const normalizeArchiveFeed = value => value;')))
    .replace("'./post-presentation'", JSON.stringify(presentation))
    .replace("'./search-metadata'", JSON.stringify(moduleUrl('export const NATIVE_THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;')))
    .replace("'./search-visibility'", JSON.stringify(moduleUrl('export const publicSearchOrigin = () => null;')));
  const { publicQuestion } = await import(moduleUrl(source));
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL=env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let calls=0;
  try {
    globalThis.fetch = async (url,options) => {
      calls++;
      assert.equal(url.pathname,'/rest/v1/question_feed');
      assert.equal(options.headers.Authorization,undefined);
      assert.equal(options.headers.Cookie,undefined);
      assert.equal(options.cache,'no-store');
      return Response.json([{id:'fixture'}]);
    };
    assert.equal(await publicQuestion('invalid-or-imported-id'),null);
    assert.equal(calls,0);
    assert.equal((await publicQuestion('11111111-1111-4111-8111-111111111111')).id,'fixture');
    globalThis.fetch = async () => new Response('',{status:503});
    await assert.rejects(() => publicQuestion('11111111-1111-4111-8111-111111111111'),/temporarily unavailable/);
  } finally {
    globalThis.fetch=previousFetch;
    if (previousUrl===undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL=previousUrl;
    if (previousKey===undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=previousKey;
  }
});

test('production stays closed unless approved; private pages remain uncached and unindexed', async () => {
  const stub = moduleUrl('export class NextResponse extends Response { static next() { return new NextResponse(null); } }');
  const source = transpile(await readFile(new URL('../src/middleware.ts',import.meta.url),'utf8')).replace("'next/server'",JSON.stringify(stub));
  const { middleware } = await import(moduleUrl(source));
  const oldEnv=process.env.APP_ENV, oldApproval=process.env.PUBLIC_LAUNCH_APPROVED;
  try {
    process.env.APP_ENV='production'; process.env.PUBLIC_LAUNCH_APPROVED='false';
    let response=middleware({nextUrl:new URL('https://visaflow.example.org/login')});
    assert.equal(response.status,503);
    assert.equal(response.headers.get('x-frame-options'),'DENY');
    process.env.PUBLIC_LAUNCH_APPROVED='true';
    response=middleware({nextUrl:new URL('https://visaflow.example.org/messages')});
    assert.equal(response.status,200);
    assert(response.headers.get('cache-control').includes('no-store'));
    assert(response.headers.get('x-robots-tag').includes('noindex'));
    assert(response.headers.get('content-security-policy').includes("script-src-attr 'none'"));
    assert.match(response.headers.get('content-security-policy'),/'nonce-[A-Za-z0-9+/=]+'/);
    const scriptPolicy=response.headers.get('content-security-policy').split(';').find((part)=>part.trim().startsWith('script-src '));
    assert(!scriptPolicy.includes('unsafe-inline'));
  } finally {
    if (oldEnv===undefined) delete process.env.APP_ENV; else process.env.APP_ENV=oldEnv;
    if (oldApproval===undefined) delete process.env.PUBLIC_LAUNCH_APPROVED; else process.env.PUBLIC_LAUNCH_APPROVED=oldApproval;
  }
});

test('www canonicalization preserves the destination on the owned VisaThreads domain', async () => {
  const stub = moduleUrl('export class NextResponse extends Response { static next() { return new NextResponse(null); } }');
  const source = transpile(await readFile(new URL('../src/middleware.ts',import.meta.url),'utf8')).replace("'next/server'",JSON.stringify(stub));
  const { middleware } = await import(moduleUrl(source));
  const response = middleware({nextUrl:new URL('https://www.visathreads.com/login?next=%2Fmessages')});
  assert.equal(response.status,308);
  assert.equal(response.headers.get('location'),'https://visathreads.com/login?next=%2Fmessages');
});

test('import source selects only successful runs and stays disabled in production', async () => {
  const stub=moduleUrl('export class NextResponse extends Response {}');
  const tags=moduleUrl(transpile(await readFile(new URL('../src/lib/tagging.ts',import.meta.url),'utf8')));
  const presentation=moduleUrl(transpile(await readFile(new URL('../src/lib/post-presentation.ts',import.meta.url),'utf8')));
  const normalization=moduleUrl(transpile(await readFile(new URL('../src/lib/archive-presentation.ts',import.meta.url),'utf8')).replace("'./post-presentation'",JSON.stringify(presentation)));
  const source=transpile(await readFile(new URL('../src/app/api/community/route.ts',import.meta.url),'utf8'))
    .replace("'next/server'",JSON.stringify(stub)).replace("'@/lib/tagging'",JSON.stringify(tags))
    .replace("'@/lib/archive-presentation'",JSON.stringify(normalization))
.replace("'@visa/archive'",JSON.stringify(moduleUrl('export default {questions:[{id:"snapshot-test",source:"apify",answer_count:12}],answersByQuestionId:{"snapshot-test":[{id:"reply",question_id:"snapshot-test",status:"active"}]},source:{status:"snapshot"}};')));
  const { GET }=await import(moduleUrl(source));
  const old={APP_ENV:process.env.APP_ENV,APIFY_TOKEN:process.env.APIFY_TOKEN,APIFY_USE_LATEST_RUN:process.env.APIFY_USE_LATEST_RUN,IMPORTED_CONTENT_APPROVED:process.env.IMPORTED_CONTENT_APPROVED,COMMUNITY_SOURCE_MODE:process.env.COMMUNITY_SOURCE_MODE,APIFY_LIVE_FETCH_ENABLED:process.env.APIFY_LIVE_FETCH_ENABLED,APIFY_API_BASE_URL:process.env.APIFY_API_BASE_URL};
  const previousFetch=globalThis.fetch;
  let calls=0;
  try {
    process.env.APP_ENV='production'; process.env.IMPORTED_CONTENT_APPROVED='false'; process.env.COMMUNITY_SOURCE_MODE='snapshot';
    globalThis.fetch=async () => { throw new Error('Must not fetch unapproved imports'); };
    assert.equal((await GET()).status,503);
    process.env.APP_ENV='development'; delete process.env.APIFY_TOKEN;
    const snapshot=(await (await GET()).json());
    assert.equal(snapshot.questions[0].id,'snapshot-test');
    assert.equal(snapshot.questions[0].answer_count,1);
    assert.equal(snapshot.questions[0].source_comment_count,12);
    delete process.env.COMMUNITY_SOURCE_MODE;
    process.env.APIFY_LIVE_FETCH_ENABLED='true'; delete process.env.APIFY_API_BASE_URL;
    process.env.APP_ENV='development'; process.env.APIFY_TOKEN='test-only-not-a-real-credential'; process.env.APIFY_USE_LATEST_RUN='true';
    globalThis.fetch=async (target) => {
      const url=new URL(target); calls++;
      if (url.pathname.endsWith('/runs/last')) {
        assert.equal(url.searchParams.get('status'),'SUCCEEDED');
        return Response.json({data:{id:'test-successful-run',status:'SUCCEEDED'}});
      }
      assert(url.pathname.includes('test-successful-run'));
      return Response.json([{id:'live-test',text:'What documents are needed for an H1B interview?',commentsCount:12,
        topComments:[{id:'captured',text:'Check the official appointment instructions.'},{id:'captured',text:'Check the official appointment instructions.'}]}],{headers:{'x-apify-pagination-total':'1'}});
    };
    const liveResponse=await GET();
    assert.equal(liveResponse.status,200);
    const live=await liveResponse.json();
    assert.equal(live.questions[0].answer_count,1);
    assert.equal(live.questions[0].source_comment_count,12);
    assert.equal(live.answersByQuestionId['apify-live-test'].length,1);
    assert.equal(calls,2);
  } finally {
    globalThis.fetch=previousFetch;
    for (const [name,value] of Object.entries(old)) if (value===undefined) delete process.env[name]; else process.env[name]=value;
  }
});

test('Turnstile adds only its exact script and frame origin when configured and leaves connect policy unchanged', async () => {
  const stub = moduleUrl('export class NextResponse extends Response { static next() { return new NextResponse(null); } }');
  const source = transpile(await readFile(new URL('../src/middleware.ts',import.meta.url),'utf8')).replace("'next/server'",JSON.stringify(stub));
  const { middleware } = await import(moduleUrl(source));
  const previous = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const policy = () => middleware({ nextUrl: new URL('https://visathreads.com/') }).headers.get('content-security-policy');
  try {
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    const disabled = policy();
    assert(!disabled.includes('challenges.cloudflare.com'));
    assert(disabled.includes("frame-src 'none'"));
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'public-fixture';
    const enabled = policy();
    assert.equal(enabled.match(/https:\/\/challenges.cloudflare.com/g)?.length, 2);
    assert(enabled.includes('frame-src https://challenges.cloudflare.com;'));
    const connect = csp => csp.split(';').find(d => d.trim().startsWith('connect-src'));
    assert.equal(connect(enabled), connect(disabled));
    assert(!enabled.includes('*.cloudflare.com'));
    assert.deepEqual(releaseProblems({...env,NEXT_PUBLIC_TURNSTILE_SITE_KEY:'public-fixture'},review,config),[]);
    assert(releaseProblems({...env,NEXT_PUBLIC_TURNSTILE_SITE_KEY:'https://untrusted.example'},review,config).some(p=>p.includes('Turnstile')));
  } finally { if (previous === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY; else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = previous; }
});

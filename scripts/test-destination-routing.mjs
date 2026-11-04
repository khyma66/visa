import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, access } from 'node:fs/promises';
import ts from 'typescript';
import { destinationModule } from './destination-test-module.mjs';
const { DESTINATIONS, destinationPath, legacyDestinationRedirect } = await import(destinationModule);
const dataUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const flow = await import(dataUrl(compile(await read('src/lib/auth-flow.ts'))));
const source = compile(await read('src/middleware.ts'))
  .replace("'./lib/destination-routing'", JSON.stringify(destinationModule))
  .replace("'./lib/search-visibility'", JSON.stringify(dataUrl('export const discoveryOrigin=()=>null; export const discoveryPath=()=>false;')))
  .replace("'next/server'", JSON.stringify(dataUrl(`export class NextResponse extends Response {
    static next(){return new NextResponse(null);}
    static redirect(url,status){return new NextResponse(null,{status,headers:{Location:String(url)}});}
  }`)));
const { middleware } = await import(dataUrl(source));
const request = (path, method = 'GET', origin = 'https://visathreads.com') => ({ nextUrl: new URL(path, origin), method, headers: new Headers() });

test('every migrated content route has an explicit implemented US English destination', async () => {
  for (const [old, route] of [['/us',''],['/news','news'],['/tags','tags'],['/explore','explore'],['/experiences','experiences'],['/guides','guides'],['/guides/h1b','guides/[slug]'],['/questions/123','questions/[id]'],['/experiences/123','experiences/[id]'],['/c/h1b','c/[slug]']]) {
    assert.equal(legacyDestinationRedirect(old), '/us/en' + (old === '/us' ? '' : old));
    await access(new URL(`../src/app/us/en/${route ? route + '/' : ''}page.tsx`, import.meta.url));
  }
  assert.equal(destinationPath('/?tag=h1b#results'), '/us/en?tag=h1b#results');
  assert.equal(destinationPath('/questions/abc?view=all#answer-1'), '/us/en/questions/abc?view=all#answer-1');
});

test('shared identity, support, APIs, creation, assets and global root keep their URLs', () => {
  for (const path of ['/', '/login', '/signup', '/account/recovery', '/account/update-password', '/messages', '/account', '/ask', '/experiences/new', '/communities/new', '/my-communities', '/contact', '/privacy', '/security', '/terms', '/countries', '/api/community', '/api/health', '/assets/brand/logo.png', '/sitemap.xml', '/robots.txt']) {
    assert.equal(legacyDestinationRedirect(path), null, path);
  }
});

test('canonical URLs are idempotent and unsupported countries/languages never alias US content', () => {
  assert.deepEqual(DESTINATIONS.filter(item=>item.status==='available').map(item=>[item.code,...item.languages]), [['us','en']]);
  for (const path of ['/us/en', '/us/en/news', '/us/fr/news', '/gb/en', '/ca/fr', '/au/en', '/zz/en', '//external.invalid', 'https://external.invalid/news', '/api/news', '/news/missing', '/questions/a/b', '/news\\evil']) {
    assert.equal(legacyDestinationRedirect(path), null, path);
  }
  assert.equal(destinationPath(destinationPath('/news?q=test')), '/us/en/news?q=test');
});

test('GET and HEAD legacy links preserve every query parameter on the same environment', () => {
  const before = process.env.APP_ENV; process.env.APP_ENV = 'development';
  try {
    for (const origin of ['https://visathreads.com','https://visa-central.com','http://localhost:3000']) {
      for (const method of ['GET','HEAD']) {
        const response = middleware(request('/questions/abc?view=all&tag=h1b&tag=f1',method,origin));
        assert.equal(response.status,308);
        assert.equal(response.headers.get('location'),origin+'/us/en/questions/abc?view=all&tag=h1b&tag=f1');
        assert.equal(response.headers.get('cache-control'),'private, no-store');
      }
    }
    assert.equal(middleware(request('/news','POST')).headers.get('location'),null);
    for (const path of ['/login?auth=callback&code=fixture&next=%2Fus%2Fen%2Fnews','/account/update-password?code=fixture','/api/community','/us/en/news']) {
      assert.equal(middleware(request(path)).headers.get('location'),null);
    }
  } finally { if(before===undefined) delete process.env.APP_ENV; else process.env.APP_ENV=before; }
});

test('country routing cannot bypass the existing public launch gate', () => {
  const before = { app:process.env.APP_ENV, approved:process.env.PUBLIC_LAUNCH_APPROVED };
  process.env.APP_ENV='production';process.env.PUBLIC_LAUNCH_APPROVED='false';
  try { for(const path of ['/news','/us/en/news','/us/en']) assert.equal(middleware(request(path)).status,503); }
  finally { for(const [key,value] of [['APP_ENV',before.app],['PUBLIC_LAUNCH_APPROVED',before.approved]]) if(value===undefined) delete process.env[key];else process.env[key]=value; }
});

test('Google/email callback remains global and safely returns to a destination deep link', () => {
  const next='/us/en/questions/abc?view=all#reply';
  for(const origin of ['https://visathreads.com','https://visa-central.com']) {
    const callback = new URL(flow.authCallbackUrl(origin,next));
    assert.equal(callback.origin,origin);assert.equal(callback.pathname,'/login');
    assert.equal(callback.searchParams.get('auth'),'callback');assert.equal(callback.searchParams.get('next'),next);
  }
  for(const bad of ['//external.invalid','/\\external.invalid','https://external.invalid','/login','/signup','/account/recovery','/%2fexternal.invalid']) assert.equal(flow.safeAuthNext(bad),'/');
});

test('published support mailboxes and recovery endpoint are preserved', async () => {
  const contact=await read('src/app/contact/page.tsx');
  for(const mailbox of ['support','privacy','security']) assert(contact.includes(`mailto:${mailbox}@visathreads.com`));
  assert((await read('src/components/PasswordRecovery.tsx')).includes('${window.location.origin}/account/update-password'));
  assert(!(await read('src/lib/destination-routing.ts')).includes('supabase'));
});

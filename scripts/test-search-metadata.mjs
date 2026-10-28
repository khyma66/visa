import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const read = name => readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
const guides = moduleUrl(compile(await read('visa-guides')));
const { VISA_GUIDES } = await import(guides);
const visibility = moduleUrl(compile(await read('search-visibility')).replace("'./visa-guides'", JSON.stringify(guides)));
const presentation = moduleUrl(compile(await read('post-presentation')));
const metadataUrl = moduleUrl(compile(await read('search-metadata')).replace("'./search-visibility'", JSON.stringify(visibility)).replace("'./post-presentation'", JSON.stringify(presentation)));
const { publicPageMetadata, eligibleNativeThread, threadStructuredData, serializeStructuredData } = await import(metadataUrl);
const approved = { APP_ENV: 'production', PUBLIC_LAUNCH_APPROVED: 'true', NEXT_PUBLIC_SITE_URL: 'https://visathreads.com' };

test('editorial discovery indexes canonical resources but not filters or individual discussions', () => {
  const env = { ...approved, APP_ENV: 'development', PUBLIC_LAUNCH_APPROVED: 'false', SEARCH_DISCOVERY_ENABLED: 'true' };
  for (const path of ['/', '/about', '/guides', `/guides/${VISA_GUIDES[0].slug}`]) {
    assert.equal(publicPageMetadata(path, 'Title', 'Description', {}, true, env).robots.index, true);
    assert.equal(publicPageMetadata(path, 'Title', 'Description', { sort: 'unanswered' }, true, env).robots.index, false);
  }
  for (const path of ['/questions/apify-123', '/questions/11111111-1111-4111-8111-111111111111', '/admin/analytics']) {
    assert.equal(publicPageMetadata(path, 'Title', 'Description', {}, true, env).robots.index, false);
  }
});
const qid = '11111111-1111-4111-8111-111111111111';
const aid = '22222222-2222-4222-8222-222222222222';
const uid = '33333333-3333-4333-8333-333333333333';
const question = { id: qid, title: 'When did your interview take place?', body: 'Please share your own interview timeline.', status: 'open',
  destination_country: 'United States', visa_type: 'H-1B', author_id: uid, author_username: 'bluebird',
  answer_count: 1, accepted_answer_id: aid, created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-18T00:00:00Z', post_kind: 'question' };
const answer = { id: aid, question_id: qid, author_id: uid, author_username: 'bluebird', body: 'My interview was on September 30.',
  status: 'active', is_accepted: true, created_at: '2026-10-02T12:00:00Z' };

test('canonical metadata drops filters and rejects indexing of every parameter variant', () => {
  assert.equal(publicPageMetadata('/', 'Community', 'Description', {}, true, approved).robots.index, true);
  for (const parameters of [{ sort: 'unanswered' }, { q: 'personal question' }, { tag: ['h1b','f1'] }, { utm_source: 'search' }, { unknown: '' }]) {
    const metadata = publicPageMetadata('/', 'Community', 'Description', parameters, true, approved);
    assert.deepEqual(metadata.robots, { index: false, follow: true });
    assert.equal(metadata.alternates.canonical, 'https://visathreads.com/');
    assert.equal(metadata.openGraph.url, 'https://visathreads.com/');
    assert(!JSON.stringify(metadata).includes('personal question'));
  }
});

test('preview remains noindex and nofollow regardless of public content eligibility', () => {
  for (const env of [{}, { ...approved, APP_ENV: 'development' }, { ...approved, PUBLIC_LAUNCH_APPROVED: 'false' }, { ...approved, NEXT_PUBLIC_DEPLOYMENT_TARGET: 'sandbox' }, { ...approved, NEXT_PUBLIC_DEPLOYMENT_TARGET: 'development-sandbox' }]) {
    assert.deepEqual(publicPageMetadata('/us', 'U.S.', 'Description', {}, true, env).robots, { index: false, follow: false });
    assert.equal(threadStructuredData(question, [answer], env), null);
  }
});

test('sandbox marker blocks guide indexing even with falsely approved production variables', () => {
  const env = { ...approved, NEXT_PUBLIC_DEPLOYMENT_TARGET: 'development-sandbox' };
  for (const path of ['/guides', ...VISA_GUIDES.map(({ slug }) => `/guides/${slug}`)]) {
    const metadata = publicPageMetadata(path, 'Guide', 'Description', {}, true, env);
    assert.deepEqual(metadata.robots, { index: false, follow: false });
    assert.equal(metadata.alternates.canonical, `https://visathreads.com${path}`);
  }
});

test('native schema reflects real visible pseudonyms, answers, dates and acceptance', () => {
  const schema = threadStructuredData(question, [answer], approved);
  assert.equal(schema['@type'], 'QAPage');
  assert.equal(schema.mainEntity.author.name, 'u/bluebird');
  assert.equal(schema.mainEntity.acceptedAnswer.url, `https://visathreads.com/questions/${qid}#answer-${aid}`);
  assert.equal(schema.mainEntity.acceptedAnswer.text, answer.body);
  assert.equal(schema.mainEntity.datePublished, question.created_at);
  assert.equal(schema.mainEntity.dateModified, undefined);
  assert.equal(schema.mainEntity.upvoteCount, undefined);
  assert.equal(schema.mainEntity.acceptedAnswer.author.url, undefined);
  const unaccepted = threadStructuredData({ ...question, accepted_answer_id: null }, [answer], approved);
  assert.equal(unaccepted.mainEntity.acceptedAnswer, undefined);
  assert.equal(unaccepted.mainEntity.suggestedAnswer.length, 1);
});

test('schema never fabricates authors or answers for imported, absent, removed or unrelated records', () => {
  for (const changed of [{ id: 'apify-123', source: 'apify' }, { source: 'apify' }, { status: 'archived' }, { author_id: null },
    { author_username: '' }, { created_at: 'invalid' }, { destination_country: 'Canada', visa_type: 'Study permit' }]) {
    assert.equal(threadStructuredData({ ...question, ...changed }, [answer], approved), null);
  }
  for (const answers of [[], [{ ...answer, status: 'archived' }], [{ ...answer, question_id: aid }], [{ ...answer, source: 'apify' }], [{ ...answer, author_id: null }]]) {
    assert.equal(threadStructuredData(question, answers, approved), null);
  }
  assert.equal(eligibleNativeThread({ ...question, id: 'demo-question' }), false);
});

test('native experiences use discussion markup and embedded JSON cannot close its script', () => {
  const schema = threadStructuredData({ ...question, post_kind: 'experience', body: 'My story </script><script>alert(1)</script>' }, [answer], approved);
  assert.equal(schema['@type'], 'DiscussionForumPosting');
  assert.equal(schema.comment[0]['@type'], 'Comment');
  assert.equal(schema.mainEntity, undefined);
  assert.equal(schema.author.name, 'u/bluebird');
  assert(!serializeStructuredData(schema).includes('<'));
  assert.deepEqual(JSON.parse(serializeStructuredData(schema)), schema);
});

const archive = { questions: [{ ...question, id: 'apify-123', source: 'apify', answer_count: 9 }],
  answersByQuestionId: { 'apify-123': [{ ...answer, id: 'apify-comment-123', question_id: 'apify-123', source: 'apify' }] } };
const archivePresentation = moduleUrl(compile(await read('archive-presentation')).replace("'./post-presentation'", JSON.stringify(presentation)));
const serverSource = compile(await read('public-server'));
const server = await import(moduleUrl(serverSource
  .replace("'react'", JSON.stringify(moduleUrl('export const cache = fn => fn;')))
  .replace("'@visa/archive'", JSON.stringify(moduleUrl(`export default ${JSON.stringify(archive)};`)))
  .replace("'./archive-presentation'", JSON.stringify(archivePresentation))
  .replace("'./post-presentation'", JSON.stringify(presentation))
  .replace("'./search-metadata'", JSON.stringify(metadataUrl))
  .replace("'./search-visibility'", JSON.stringify(visibility))));

async function withEnvironment(env, run) {
  const names = [...new Set([...Object.keys(approved), 'NEXT_PUBLIC_DEPLOYMENT_TARGET', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'COMMUNITY_SOURCE_MODE', 'IMPORTED_CONTENT_APPROVED'])];
  const old = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try { for (const name of names) delete process.env[name]; Object.assign(process.env, env); await run(); }
  finally { for (const name of names) { if (old[name] === undefined) delete process.env[name]; else process.env[name] = old[name]; } }
}

test('anonymous server reads do not forward sessions and reject malformed IDs without querying', async () => {
  await withEnvironment({ NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-test-key' }, async () => {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, options) => { calls.push({ url: new URL(url), options }); return Response.json([question]); };
    try {
      assert.equal((await server.publicQuestion(qid)).id, qid);
      assert.equal(calls[0].options.headers.apikey, 'public-test-key');
      assert.equal(calls[0].options.headers.Authorization, undefined);
      assert.equal(calls[0].options.headers.Cookie, undefined);
      assert.equal(calls[0].options.cache, 'no-store');
      assert.equal(calls[0].options.redirect, 'manual');
      assert.equal(await server.publicQuestion('anything?private=true'), null);
      assert.deepEqual(await server.publicAnswers('anything?private=true'), []);
      assert.equal(calls.length, 1);
    } finally { globalThis.fetch = original; }
  });
});

test('Workers accepts public read options and rejects redirect destinations without following them', { timeout: 20_000 }, async () => {
  const fetchFunction = serverSource.slice(serverSource.indexOf('async function publicRows'), serverSource.indexOf('export const publicQuestion'))
    .replaceAll('process.env.', 'fixtureEnv.');
  const script = `
    const fixtureEnv = { NEXT_PUBLIC_SUPABASE_URL: 'https://database.example', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-test-key' };
    let fetch;
    ${fetchFunction}
    export default { async fetch() {
      const results = [];
      for (const mode of ['success', 'redirect', 'unavailable']) {
        let calls = 0, cancelled = false;
        fetch = async (url, options) => {
          calls++;
          const outgoing = new Request(url, options);
          if (outgoing.redirect !== 'manual' || outgoing.headers.has('Cookie') || outgoing.headers.has('Authorization')
            || outgoing.headers.get('apikey') !== fixtureEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
            || new URL(outgoing.url).origin !== fixtureEnv.NEXT_PUBLIC_SUPABASE_URL) throw new Error('Unsafe public read');
          if (mode !== 'success') return new Response(new ReadableStream({ cancel() { cancelled = true; } }),
            { status: mode === 'redirect' ? 302 : 503, headers: { Location: 'https://external.invalid/private-destination' } });
          return Response.json([{id:'fixture'}]);
        };
        let value = null, error = null;
        try { value = await publicRows('question_feed', { select:'id', limit:'1' }); }
        catch (reason) { error = reason.message; }
        results.push({mode,calls,cancelled,value,error});
      }
      return Response.json(results);
    }};
  `;
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, compatibilityDate: '2026-09-09', script }));
  try {
    const response = await runtime.dispatchFetch('http://localhost/');
    assert.equal(response.status, 200);
    const results = await response.json();
    assert.deepEqual(results, [
      { mode: 'success', calls: 1, cancelled: false, value: [{ id: 'fixture' }], error: null },
      { mode: 'redirect', calls: 1, cancelled: true, value: null, error: 'Community data is temporarily unavailable.' },
      { mode: 'unavailable', calls: 1, cancelled: true, value: null, error: 'Community data is temporarily unavailable.' },
    ]);
    assert(!JSON.stringify(results).includes('external.invalid'));
  } finally { await runtime.dispose(); }
});

test('imported server rendering follows snapshot and production publication gates', async () => {
  for (const env of [{ APP_ENV: 'production', COMMUNITY_SOURCE_MODE: 'snapshot' }, { APP_ENV: 'development', COMMUNITY_SOURCE_MODE: 'live' }]) {
    await withEnvironment(env, async () => {
      assert.equal(await server.publicQuestion('apify-123'), null);
      assert.deepEqual(await server.publicAnswers('apify-123'), []);
    });
  }
  await withEnvironment({ APP_ENV: 'development', COMMUNITY_SOURCE_MODE: 'snapshot' }, async () => {
    const record = await server.publicQuestion('apify-123');
    assert.equal(record.answer_count, 1);
    assert.equal(record.source_comment_count, 9);
    assert.equal((await server.publicAnswers('apify-123')).length, 1);
  });
});

test('sitemap queries only approved anonymous native public rows, excluding archive and invented freshness', async () => {
  await withEnvironment({}, async () => assert.deepEqual(await server.publicThreadSitemap(), []));
  await withEnvironment({ ...approved, NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-test-key' }, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      assert.equal(new URL(url).pathname, '/rest/v1/question_feed');
      assert.equal(new URL(url).searchParams.get('destination_country'), 'eq.United States');
      assert.equal(options.headers.Authorization, undefined);
      return Response.json([{ id: qid, post_kind: 'question' }, { id: aid, post_kind: 'experience' }, { id: 'apify-123' }]);
    };
    try { assert.deepEqual(await server.publicThreadSitemap(), [{ url: `https://visathreads.com/questions/${qid}` }, { url: `https://visathreads.com/experiences/${aid}` }]); }
    finally { globalThis.fetch = original; }
  });
});

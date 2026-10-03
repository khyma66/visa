import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const helperUrl = moduleUrl(transpile(await readFile(new URL('../src/lib/tag-directory.ts', import.meta.url), 'utf8')));
const { summarizeArchiveTags, archiveDirectoryPage, directoryPage } = await import(helperUrl);
const fixtures = [
  { tags: ['h1b', 'h1b', 'rfe'], title: 'Visible archive title', body: 'Never transferred to tag directory', status: 'open' },
  { tags: ['h1b', 'hidden'], title: 'Archived title', status: 'archived' },
  { tags: ['h1b'], title: 'Closed but visible', status: 'closed' },
];

test('archive summary counts visible unique tags without post bodies or private fields', () => {
  const tags = summarizeArchiveTags(fixtures);
  assert.deepEqual(tags.map(({ tag, count }) => [tag, count]), [['h1b', 2], ['rfe', 1]]);
  assert(tags.every((row) => Object.keys(row).sort().join(',') === 'count,example,tag'));
  assert(!JSON.stringify(tags).includes('Never transferred'));
});

test('directory reads summaries, exposes continuation and refreshes after returning to the page', async () => {
  const source = await readFile(new URL('../src/components/TagDirectory.tsx', import.meta.url), 'utf8');
  assert(source.includes("fetch('/api/tags'"));
  assert(source.includes("rpc('community_tag_page'"));
  assert(!source.includes("fetch('/api/community'"));
  assert(!source.includes("from('questions')"));
  assert(source.includes('Load more tags'));
  assert(source.includes("addEventListener('visibilitychange'"));
});

test('directory continuation exposes all tags beyond first page in both sort orders', () => {
  const summary = Array.from({ length: 125 }, (_, i) => ({ tag: `tag-${String(i).padStart(3, '0')}`, count: i % 4 + 1, example: 'Example' }));
  for (const sort of ['name', 'popular']) {
    const collected = []; let cursor;
    for (let page = 0; page < 10; page++) {
      const result = archiveDirectoryPage(summary, '', sort, cursor);
      collected.push(...result.tags);
      if (!result.hasMore) break;
      cursor = result.tags.at(-1);
    }
    assert.equal(collected.length, 125);
    assert.equal(new Set(collected.map((row) => row.tag)).size, 125);
  }
  assert.equal(directoryPage(Array.from({ length: 50 }, (_, i) => ({ tag: `tag-${i}` }))).hasMore, false);
  assert.equal(archiveDirectoryPage(summary, 'TAG-124', 'name').tags.length, 1);
});

test('archive tag endpoint preserves production approval and snapshot gates', async () => {
  const env = { APP_ENV: process.env.APP_ENV, IMPORTED_CONTENT_APPROVED: process.env.IMPORTED_CONTENT_APPROVED, COMMUNITY_SOURCE_MODE: process.env.COMMUNITY_SOURCE_MODE };
  const nextUrl = moduleUrl('export const NextResponse={json:(data,init)=>Response.json(data,init)};');
  const archiveUrl = moduleUrl(`export default ${JSON.stringify({ questions: fixtures })};`);
  const source = transpile(await readFile(new URL('../src/app/api/tags/route.ts', import.meta.url), 'utf8'))
    .replace("'next/server'", JSON.stringify(nextUrl)).replace("'@visa/archive'", JSON.stringify(archiveUrl)).replace("'@/lib/tag-directory'", JSON.stringify(helperUrl));
  const { GET } = await import(moduleUrl(source));
  try {
    process.env.APP_ENV = 'production'; process.env.IMPORTED_CONTENT_APPROVED = 'false'; process.env.COMMUNITY_SOURCE_MODE = 'snapshot';
    assert.equal(GET().status, 503);
    process.env.APP_ENV = 'development'; process.env.COMMUNITY_SOURCE_MODE = 'live';
    assert.equal(GET().status, 503);
    process.env.COMMUNITY_SOURCE_MODE = 'snapshot';
    const response = GET();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).tags[0].count, 2);
    assert.match(response.headers.get('cache-control'), /max-age=60/);
  } finally {
    for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('native tag RPC aggregates under caller RLS, combines counts, filters hidden rows and pages beyond 50', async () => {
  const db = new PGlite();
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  try {
    await db.exec(`create role anon; create role authenticated;
      create table public.questions(id uuid primary key default gen_random_uuid(),author_id uuid,title text,tags text[],status text);
      alter table public.questions enable row level security;
      create policy public_question_read on public.questions for select to anon,authenticated using(status<>'archived');
      grant select on public.questions to anon,authenticated;`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261003180857_native_tag_directory.sql', import.meta.url), 'utf8'));
    await db.query("insert into public.questions(author_id,title,tags,status) select $1,'Native question '||n,array['tag-'||lpad(n::text,3,'0')],'open' from generate_series(1,125) n", [alice]);
    await db.query("insert into public.questions(author_id,title,tags,status) values($1,'Visible native H1B question',array['h1b','h1b'],'open'),($2,'Hidden archived content',array['hidden','h1b'],'archived'),($2,'Restricted native question',array['restricted'],'open')", [alice, bob]);
    await db.exec('set role anon');
    const summary = JSON.stringify([{ tag: 'h1b', count: 10, example: 'Archive H1B question' }, { tag: 'archive-only', count: 2, example: 'Archive only' }]);
    for (const sort of ['popular', 'name']) {
      let cursor; const collected = [];
      for (let page = 0; page < 10; page++) {
        const rows = (await db.query('select * from public.community_tag_page($1,$2,$3,$4,$5)', ['', sort, cursor?.tag ?? null, cursor?.question_count ?? null, summary])).rows;
        const result = directoryPage(rows);
        collected.push(...result.tags);
        if (!result.hasMore) break;
        cursor = result.tags.at(-1);
      }
      assert.equal(collected.length, 128);
      assert.equal(new Set(collected.map((row) => row.tag)).size, 128);
      assert(!collected.some((row) => row.tag === 'hidden'));
      const h1b = collected.find((row) => row.tag === 'h1b');
      assert.equal(Number(h1b.question_count), 11); assert.equal(Number(h1b.native_count), 1); assert.equal(Number(h1b.archive_count), 10);
    }
    assert.equal((await db.query("select * from public.community_tag_page('TAG-125','name')")).rows.length, 1);
    await assert.rejects(() => db.query("select * from public.community_tag_page('','popular',null,null,'{}')"), /Invalid archive/);
    await db.exec('reset role');
    await db.query(`create policy restricted_fixture on public.questions as restrictive for select to anon using(author_id='${alice}'::uuid)`);
    await db.exec('set role anon');
    assert.equal((await db.query("select * from public.community_tag_page('restricted')")).rows.length, 0, 'Invoker aggregate must not count RLS-hidden questions');
    await db.exec('reset role');
    await db.query("update public.questions set status='archived' where tags @> array['tag-125']");
    await db.exec('set role authenticated');
    assert.equal((await db.query("select * from public.community_tag_page('tag-125')")).rows.length, 0, 'Moderation is reflected on next aggregate');
  } finally { await db.close(); }
});

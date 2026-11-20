import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

// Exercise the real similar-post search with a stubbed backend: no live data is read.
const moduleUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const calls = [];
let backend = { related: () => [], page: () => [] };
globalThis.__similarBackend = { rpc(name, params) { calls.push({ name, params }); const data = name === 'platform_related_posts' ? backend.related(params) : backend.page(params); return { abortSignal: async () => ({ data, error: null }) }; } };
const dependencies = {
  './supabase/client': moduleUrl('export const isSupabaseConfigured=true;export const getSupabase=()=>globalThis.__similarBackend;'),
};
async function compile(name) {
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
    .replace(/(from\s+)(['"])([^'"]+)\2/g, (_m, prefix, _q, dep) => { assert(dependencies[dep], `Unmapped dependency ${dep}`); return prefix + JSON.stringify(dependencies[dep]); });
  return moduleUrl(code);
}
for (const name of ['post-presentation', 'demo-data', 'tagging', 'discovery', 'messaging-state']) dependencies[`./${name}`] = await compile(`lib/${name}`);
const community = await import(await compile('lib/community'));
const { rareSearchTerms } = await import(dependencies['./discovery']);
const { inferVisaType } = await import(await compile('lib/post-categories'));

const post = (id, title, extra = {}) => ({ id, title, body: extra.body ?? title, tags: extra.tags ?? ['stamping'], visa_type: extra.visa ?? 'H-1B', destination_country: 'United States', status: 'open', vote_score: 0, answer_count: 0, created_at: '2026-10-01T00:00:00Z', ...extra });

test('rare identifiers are extracted; visa class names are not', () => {
  assert.deepEqual(rareSearchTerms('H-1B stamping 221g administrative processing delay'), ['221g']);
  assert.deepEqual(rareSearchTerms('I-140 approved, waiting on DS-160 and 214(b) after F-1 and H4'), ['i-140', 'ds-160', '214(b)']);
  assert.deepEqual(rareSearchTerms('STEM OPT extension pending, can I travel to India in 2026?'), []);
});

test('visa type is inferred from the words, with student status taking priority', () => {
  assert.equal(inferVisaType('STEM OPT extension pending, can I travel to India?'), 'F-1 / OPT');
  assert.equal(inferVisaType('STEM OPT pending and my H-1B was approved, can I travel?'), 'F-1 / OPT');
  assert.equal(inferVisaType('H4 EAD renewal stuck'), 'H-4 / EAD');
  assert.equal(inferVisaType('Premium processing for my H1B transfer'), 'H-1B');
  assert.equal(inferVisaType('B1/B2 tourist visa interview'), 'B1/B2');
  assert.equal(inferVisaType('What should I do now?'), '');
});

test('exact identifier hits come first, ahead of generic topic matches', async () => {
  calls.length = 0;
  backend = {
    page: ({ query_text }) => query_text === '221g' ? [post('exact', 'Stuck in 221g administrative processing'), post('noise', 'Unrelated stamping slots', { body: 'no identifier here' })] : [],
    related: () => ['g1', 'g2', 'g3', 'g4', 'g5'].map(id => post(id, `Generic stamping slot thread ${id}`)),
  };
  const rows = await community.discoverSimilarQuestions({ title: 'H-1B stamping 221g administrative processing delay', visa_type: 'H-1B', tags: ['stamping'] });
  assert.deepEqual(rows.map(r => r.id), ['exact', 'g1', 'g2', 'g3', 'g4']);
  assert.equal(rows[0].match_reason, 'Mentions 221g');
  const search = calls.find(c => c.name === 'platform_post_page');
  assert.equal(search.params.query_text, '221g'); assert.equal(search.params.filter_visa, '', 'Exact hits are not limited by visa');
});

test('a visa filter that finds too few matches widens to all visas instead of showing nothing', async () => {
  calls.length = 0;
  backend = { page: () => [], related: ({ filter_visa }) => filter_visa === 'H-1B' ? [] : [post('opt', 'STEM OPT pending, can I travel to India?', { visa: 'F-1 / OPT' })] };
  const rows = await community.discoverSimilarQuestions({ title: 'STEM OPT extension pending, can I travel to India?', visa_type: 'H-1B' });
  assert.deepEqual(rows.map(r => r.id), ['opt']);
  assert.deepEqual(calls.filter(c => c.name === 'platform_related_posts').map(c => c.params.filter_visa), ['H-1B', '']);
});

test('a visa with enough matches is not widened, and an exact-search failure keeps topic results', async () => {
  calls.length = 0;
  backend = { page: () => { throw new Error('search down'); }, related: () => ['a', 'b', 'c', 'd', 'e'].map(id => post(id, `Thread ${id}`)) };
  const rows = await community.discoverSimilarQuestions({ title: 'I-140 approved, H-1B transfer', visa_type: 'H-1B' });
  assert.equal(rows.length, 5);
  assert.equal(calls.filter(c => c.name === 'platform_related_posts').length, 1);
});

test('amounts, years and words before numbers are not identifiers', () => {
  assert.deepEqual(rareSearchTerms('The $100K fee and $800 a month rent since 2026'), []);
  assert.deepEqual(rareSearchTerms('Got 221 (g) slip, then 221g again; ds160 done'), ['221g', 'ds160']);
});

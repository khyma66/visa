import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

// Exercise the real local-storage, paging and discovery code. Backend calls are
// forbidden; this verifies demo behavior without reading or changing live data.
const moduleUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const dependencies = {
  './supabase/client': moduleUrl('export const isSupabaseConfigured=false;export const getSupabase=()=>{throw new Error("No backend access allowed in demo tests");};'),
};
async function compile(name, suffix = '') {
  const source = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source + suffix, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
  } }).outputText.replace(/(from\s+)(['"])([^'"]+)\2/g, (_match, prefix, _quote, name) => {
    assert(dependencies[name], `Unmapped dependency ${name}`);
    return prefix + JSON.stringify(dependencies[name]);
  });
  return moduleUrl(code);
}
for (const name of ['post-presentation', 'demo-data', 'tagging', 'discovery', 'messaging-state']) dependencies[`./${name}`] = await compile(name);
const community = await import(await compile('community', '\nexport { applyLocalActivity };'));

const question = {
  id: 'apify-demo-counts', source: 'apify', author_id: null, author_username: 'archive-contributor', author_avatar_seed: 'archive',
  title: 'H1B transfer documents and timeline', body: 'Which documents are needed for an H1B transfer application?',
  destination_country: 'United States', visa_type: 'H-1B', tags: ['h1b', 'transfer'], status: 'open',
  vote_score: 4, answer_count: 1, source_comment_count: 12, view_count: 0, accepted_answer_id: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};
const sourceReply = {
  id: 'apify-comment-original', question_id: question.id, source: 'apify', author_id: null,
  author_username: 'archive-contributor', author_avatar_seed: 'archive', body: 'Read the official transfer instructions.',
  vote_score: 0, is_accepted: false, status: 'active', created_at: question.created_at, updated_at: question.updated_at,
};
const localReply = { ...sourceReply, id: 'a-local-reply', source: undefined, author_id: 'member-demo', author_username: 'demo-member' };
const feed = { questions: [question], answersByQuestionId: { [question.id]: [sourceReply] }, fetchedAt: question.created_at,
  source: { name: 'Apify', runId: 'demo-test', status: 'snapshot', totalItems: 1, importedItems: 1, emptyItems: 0, duplicateItems: 0 } };
function demoState() {
  return { questions: [], answers: [
    localReply, { ...localReply, body: 'Latest saved version of the same local reply.' },
    { ...localReply, id: 'a-removed', status: 'archived' },
    { ...localReply, id: 'a-another-question', question_id: 'apify-other' },
    sourceReply,
  ], conversations: [], messages: [], externalQuestionVotes: {}, externalAnswerVotes: {} };
}

test('demo archive counts only unique active local replies and does not mutate cached archive records', () => {
  const state = demoState();
  const beforeFeed = structuredClone(feed), beforeState = structuredClone(state);
  for (let attempt = 0; attempt < 3; attempt++) {
    const adjusted = community.applyLocalActivity(feed, state);
    assert.equal(adjusted.questions[0].answer_count, 2);
    assert.equal(adjusted.questions[0].source_comment_count, 12);
    assert.equal(adjusted.answersByQuestionId[question.id].length, 1, 'Local replies remain in their separate paginated store');
  }
  assert.deepEqual(feed, beforeFeed);
  assert.deepEqual(state, beforeState);
});

test('new demo replies update card, detail, paging and related counts together without cache accumulation', async () => {
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch;
  const storage = new Map([['visaflow-demo-v4', JSON.stringify(demoState())]]);
  const events = [];
  let fetches = 0;
  globalThis.window = {
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    dispatchEvent: (event) => { events.push(event.type); return true; },
  };
  globalThis.fetch = async (url) => {
    assert.equal(url, '/api/community');
    fetches++;
    return Response.json(feed);
  };
  async function assertCounts(expected) {
    const card = (await community.listQuestions()).find(row => row.id === question.id);
    const detail = await community.getQuestion(question.id);
    const related = (await community.discoverQuestions({ tags: ['h1b', 'transfer'] })).find(row => row.id === question.id);
    const page = await community.getAnswerPage(question.id);
    assert(card && detail && related, 'Fixture must be visible in all three surfaces');
    assert.equal(card.answer_count, expected, 'Feed card count');
    assert.equal(detail.answer_count, expected, 'Question detail count');
    assert.equal(related.answer_count, expected, 'Related question count');
    assert.equal(page.answers.length, expected, 'All available replies');
    assert.equal(new Set(page.answers.map(row => row.id)).size, expected);
    assert.equal(page.more, false);
  }
  try {
    await assertCounts(2);
    await assertCounts(2);
    await community.createAnswer(question.id, 'member-demo', 'Here is a new reply about the transfer application timeline.');
    assert.deepEqual(events, ['visaflow-demo-change']);
    await assertCounts(3);
    await assertCounts(3);
    assert.equal(fetches, 1, 'Local discovery invalidation must not refetch the cached archive');
    assert.equal(feed.questions[0].answer_count, 1, 'Cached source count must not accumulate local replies');
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});

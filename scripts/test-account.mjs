import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/account.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const account = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

function database(data, error = null) {
  const calls = [];
  const query = {};
  for (const method of ['from', 'select', 'eq', 'order', 'range', 'update', 'abortSignal']) query[method] = (...args) => { calls.push([method, ...args]); return query; };
  query.then = (resolve, reject) => Promise.resolve({ data, error }).then(resolve, reject);
  // single/maybeSingle end the filter-builder chain in the installed SDK.
  for (const method of ['single', 'maybeSingle']) query[method] = () => { calls.push([method]); return { then: query.then }; };
  return { client: query, calls };
}

test('activity pages remain author-scoped and bounded, using one lookahead row', async () => {
  const rows = Array.from({ length: 21 }, (_, id) => ({ id: String(id) }));
  const db = database(rows);
  const page = await account.getAccountActivity(db.client, 'member-one', 'answers', 2);
  assert.equal(page.items.length, 20);
  assert.equal(page.more, true);
  assert(db.calls.some(call => JSON.stringify(call) === JSON.stringify(['eq', 'author_id', 'member-one'])));
  assert(db.calls.some(call => JSON.stringify(call) === JSON.stringify(['range', 40, 60])));
  assert(db.calls.some(call => JSON.stringify(call) === JSON.stringify(['from', 'answer_feed'])));
  assert(db.calls.find(call => call[0] === 'abortSignal')[1] instanceof AbortSignal);
  assert.equal((await account.getAccountActivity(database(rows.slice(0, 2)).client, 'member-one', 'questions')).more, false);
  for (const page of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER]) await assert.rejects(() => account.getAccountActivity(db.client, 'member-one', 'questions', page));
});

test('bio update writes only bio for the current profile and rejects zero-row success', async () => {
  const db = database({ id: 'member-one', username: 'calm-heron', bio: 'Hello' });
  const result = await account.saveProfileBio(db.client, 'member-one', ' Hello ');
  assert.equal(result.bio, 'Hello');
  assert.deepEqual(db.calls.filter(call => call[0] === 'update'), [['update', { bio: 'Hello' }]]);
  assert.deepEqual(db.calls.filter(call => call[0] === 'eq'), [['eq', 'id', 'member-one']]);
  assert(db.calls.find(call => call[0] === 'abortSignal')[1] instanceof AbortSignal);
  await assert.rejects(() => account.saveProfileBio(database(null).client, 'member-one', 'Hello'), /could not be saved/);
  await assert.rejects(() => account.saveProfileBio(database({ id: 'other' }).client, 'member-one', 'Hello'), /could not be saved/);
  await assert.rejects(() => account.saveProfileBio(db.client, 'member-one', 'x'.repeat(281)), /280/);
  const clear = database({ id: 'member-one', bio: null });
  await account.saveProfileBio(clear.client, 'member-one', ' ');
  assert.deepEqual(clear.calls.find(call => call[0] === 'update'), ['update', { bio: null }]);
});

test('private identity rejects stale sessions and returns no token or provider metadata', async () => {
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'member-one', email: 'private@example.invalid', email_confirmed_at: '2026-10-05', identities: [{ provider: 'google', identity_data: { secret: 'never-output' } }, { provider: 'google' }] } }, error: null }) } };
  assert.deepEqual(await account.getAccountIdentity(client, 'member-one'), { email: 'private@example.invalid', providers: ['google'], emailVerified: true });
  await assert.rejects(() => account.getAccountIdentity(client, 'other-member'), /could not be verified/);
});

test('profile editing acceptance is scoped to this account and current policy version', async () => {
  const db = database({ policy_version: 'current-version' });
  assert.equal(await account.hasAccountPolicyAcceptance(db.client, 'member-one', 'current-version'), true);
  assert.deepEqual(db.calls.filter(call => call[0] === 'eq'), [['eq', 'user_id', 'member-one'], ['eq', 'policy_version', 'current-version']]);
  assert(db.calls.find(call => call[0] === 'abortSignal')[1] instanceof AbortSignal);
  assert.equal(await account.hasAccountPolicyAcceptance(database(null).client, 'member-one', 'current-version'), false);
  assert.equal(await account.hasAccountPolicyAcceptance(database({ policy_version: 'old-version' }).client, 'member-one', 'current-version'), false);
  await assert.rejects(() => account.hasAccountPolicyAcceptance(database(null, { message: 'private failure' }).client, 'member-one', 'current-version'), /could not check/);
});

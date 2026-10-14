import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const url = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const transpile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const tagsUrl = url(transpile(await readFile(new URL('../src/lib/tagging.ts', import.meta.url), 'utf8')));
const discoveryCode = transpile(await readFile(new URL('../src/lib/discovery.ts', import.meta.url), 'utf8')).replace("'./tagging'", JSON.stringify(tagsUrl));
const { createDiscoveryIndex } = await import(url(discoveryCode));
const q = (id, tags, body = '') => ({ id, title: `Discussion about ${tags.join(' ')}`, body,
  tags, visa_type: 'H-1B', destination_country: 'United States', status: 'open', vote_score: 0,
  answer_count: 0, created_at: '2026-09-01T00:00:00Z' });

test('live subscription pooling keeps other consumers connected and cleans up', async () => {
  const created = [];
  const removed = [];
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  globalThis.__testSupabase = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'alice' }, access_token: 'fixture' } } }) },
    realtime: { setAuth: async () => {} },
    channel(topic) {
      const c = { topic, on(_type,_filter,listener) { this.listener = listener; return this; },
        subscribe(callback) { this.status = callback; return this; } };
      created.push(c); return c;
    },
    removeChannel: async (c) => { removed.push(c); },
  };
  try {
    const stub = url('export const isSupabaseConfigured = true; export const getSupabase = () => globalThis.__testSupabase;');
    const source = transpile(await readFile(new URL('../src/lib/realtime.ts',import.meta.url),'utf8')).replace("'./supabase/client'",JSON.stringify(stub));
    const { subscribeLive } = await import(url(source));
    let first = 0, second = 0;
    const stop1 = subscribeLive(['discovery:rfe'], () => first++);
    const stop2 = subscribeLive(['discovery:rfe'], () => second++);
    await new Promise((r) => setTimeout(r,0));
    assert.equal(created.length,1);
    created[0].status('SUBSCRIBED');
    await new Promise((r) => setTimeout(r,120));
    assert.equal(first,1); assert.equal(second,1);
    stop1(); assert.equal(removed.length,0);
    created[0].listener();
    await new Promise((r) => setTimeout(r,120));
    assert.equal(first,1); assert.equal(second,2);
    stop2(); assert.equal(removed.length,1);
    const cancelled = subscribeLive(['discovery:h1b'], () => {});
    cancelled();
    await new Promise((r) => setTimeout(r,0));
    assert.equal(created.length,1);
  } finally {
    delete globalThis.__testSupabase; delete globalThis.window; delete globalThis.document;
  }
});

test('discovery responds to draft topics, archived comments and new posts', () => {
  const rows = [q('transfer', ['h1b','transfer']), q('rfe', ['rfe']), q('schengen', ['schengen']),
    { ...q('promo', ['rfe']), post_kind: 'promotion' }, { ...q('hidden', ['rfe']), status: 'archived' }];
  const index = createDiscoveryIndex(rows);
  const base = { id: 'current', title: 'H1B transfer', tags: ['h1b', 'transfer'] };
  assert.equal(index.search(base)[0].id, 'transfer');
  assert.equal(index.search({ ...base, commentText: 'Request for evidence RFE response' })[0].id, 'rfe');
  assert(!index.search({ ...base, commentText: 'RFE response' }).some((r) => ['promo','hidden'].includes(r.id)));
  assert(!index.search({ id: 'transfer', tags: ['h-1b'] }).some((r) => r.id === 'transfer'));
  assert.equal(createDiscoveryIndex([q('past', ['timeline'])], { past: 'Received an RFE last week' }).search({ commentText: 'request for evidence' })[0].id, 'past');
  assert.equal(createDiscoveryIndex([...rows,q('just-posted',['biometrics'])]).search({ title: 'Biometrics appointment' })[0].id, 'just-posted');
  assert.deepEqual(index.search({ title: 'Thank you please help' }), []);
  assert.equal(createDiscoveryIndex([q('imported', ['timeline'])]).search({ commentText: 'RFE response' },5,{imported:['rfe']})[0].id,'imported');
});

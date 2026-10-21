import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TARGET } from './free-tier.mjs';
import { checkEvidence, newManifest, checkManifest, checkOwned, seal, unseal, networkBudget } from './multiuser-core.mjs';
import { cleanup } from './multiuser-cleanup.mjs';
import { hostedRun } from './multiuser.mjs';

const evidence = () => ({ schemaVersion: 1, target: TARGET, supabasePlan: 'free', checkedAt: new Date().toISOString(),
  existingConnections: 0, backgroundEventsPerSecond: 0, databaseMB: 10, remainingEgressMB: 100,
  remainingRealtimeMessages: 100000, remainingMAU: 1000, noConcurrentLoad: true, outboundHooksDisabled: true,
  passwordAuthVerified: true, schemaVerified: true });
test('only supported cohorts and recently verified Free quota evidence pass', () => {
  checkEvidence(evidence(), 10);
  for (const count of [0, 2, 99, 101, 150, 200, 10000, NaN]) assert.throws(() => checkEvidence(evidence(), count));
  for (const replacement of [
    { supabasePlan: 'pro' }, { remainingMAU: 0 }, { existingConnections: 141 }, { remainingEgressMB: 49 },
    { databaseMB: 401 }, { backgroundEventsPerSecond: 21 }, { remainingRealtimeMessages: 19999 },
    { noConcurrentLoad: false }, { outboundHooksDisabled: false }, { checkedAt: '2020-01-01' },
    { passwordAuthVerified: false }, { schemaVerified: false }, { databaseMB: NaN },
    { target: { ...TARGET, projectRef: 'cycnichledvqbxevrwnt' } },
  ]) assert.throws(() => checkEvidence({ ...evidence(), ...replacement }, 10));
});
test('larger stages require successful smaller hosted stage including cleanup', () => {
  assert.throws(() => checkEvidence(evidence(), 50));
  checkEvidence({ ...evidence(), previousStage: { users: 10, passed: true, cleanupVerified: true } }, 50);
  assert.throws(() => checkEvidence({ ...evidence(), previousStage: { users: 10, passed: true, cleanupVerified: true } }, 100));
  checkEvidence({ ...evidence(), previousStage: { users: 50, passed: true, cleanupVerified: true } }, 100);
});
test('manifests are unique, expiring and pinned to synthetic emails and exact dev target', () => {
  const m = newManifest(100); checkManifest(m); assert.equal(new Set(m.users.map(u => u.id)).size, 100);
  for (const alter of [m => m.users[0].email = 'person@example.com', m => m.users[0].id = m.users[1].id,
    m => m.target = { ...TARGET, origin: 'https://visathreads.com' }, m => m.expiresAt = m.createdAt]) {
    const copy = structuredClone(m); alter(copy); assert.throws(() => checkManifest(copy));
  }
});
test('ownership requires admin metadata, exact email, UUID and ordinary role', () => {
  const m = newManifest(10), u = { ...m.users[0], role: 'authenticated', app_metadata: { visaflow_test_run: m.runId, visaflow_test_purpose: 'free-tier-multiuser' } };
  checkOwned(u, m.users[0], m.runId);
  assert.throws(() => checkOwned({ ...u, role: 'service_role' }, m.users[0], m.runId));
  assert.throws(() => checkOwned({ ...u, app_metadata: {}, user_metadata: u.app_metadata }, m.users[0], m.runId));
  assert.throws(() => checkOwned(u, m.users[1], m.runId));
});
test('credentials are encrypted and bound to the run; wrong keys and tampering fail', () => {
  const key = 'ab'.repeat(32), value = { password: 'secret-only-in-memory' };
  const encrypted = seal(value, key, 'one'); assert(!JSON.stringify(encrypted).includes(value.password));
  assert.deepEqual(unseal(encrypted, key, 'one'), value);
  assert.throws(() => unseal(encrypted, key, 'two'));
  assert.throws(() => unseal(encrypted, 'cd'.repeat(32), 'one'));
  assert.throws(() => unseal({ ...encrypted, tag: '00'.repeat(16) }, key, 'one'));
});
test('request wrapper denies production, redirect and exhausted request budget', async () => {
  let calls = 0;
  const budget = networkBudget({ intervalMs: 0, maxRequests: 1, fetcher: async (_url, init) => {
    calls++; assert.equal(init.redirect, 'error'); return Response.json({ ok: true });
  } });
  await assert.rejects(budget.fetch('https://cycnichledvqbxevrwnt.supabase.co/rest/v1/profiles')); assert.equal(calls, 0);
  await budget.fetch(TARGET.databaseOrigin + '/rest/v1/profiles');
  await assert.rejects(budget.fetch(TARGET.databaseOrigin + '/rest/v1/profiles')); assert.equal(calls, 1);
  const redirects = networkBudget({ fetcher: async () => new Response('', { status: 302 }) });
  await assert.rejects(redirects.fetch(TARGET.databaseOrigin));
});
test('429, server failures, aborted and stopped tests do not retry', async () => {
  for (const status of [429, 500, 503]) {
    let calls = 0;
    const b = networkBudget({ fetcher: async () => { calls++; return new Response('', { status }); } });
    await assert.rejects(b.fetch(TARGET.databaseOrigin)); assert.equal(calls, 1);
  }
  for (const settings of [{ signal: AbortSignal.abort() }, { stopped: () => true }]) {
    let calls = 0;
    await assert.rejects(networkBudget({ ...settings, fetcher: () => { calls++; } }).fetch(TARGET.databaseOrigin));
    assert.equal(calls, 0);
  }
});
function fakeAdmin(m, { foreign = false, foreignReply = false } = {}) {
  const users = new Map(m.users.map(u => [u.id, { ...u, role: 'authenticated', app_metadata: { visaflow_test_run: m.runId, visaflow_test_purpose: 'free-tier-multiuser' } }]));
  if (foreign) users.get(m.users[0].id).app_metadata = {};
  let mutations = 0;
  const missing = { data: null, error: { code: 'user_not_found', status: 404 } };
  return { get mutations() { return mutations; },
    auth: { admin: {
      getUserById: async id => users.has(id) ? { data: { user: users.get(id) }, error: null } : missing,
      updateUserById: async () => { mutations++; return { data: {}, error: null }; },
      deleteUser: async id => { mutations++; users.delete(id); return { data: {}, error: null }; },
    } },
    from(table) {
      return { select() { return this; }, in(column) { this.column = column; return this; },
        limit: async function() {
          if (foreignReply && table === 'answers' && this.column === 'question_id') return { data: [{ author_id: 'outsider', body: 'real content' }] };
          if (foreignReply && table === 'questions') return { data: [{ id: 'q', title: `[SYNTHETIC TEST — NOT IMMIGRATION ADVICE] ${m.runId}`, body: `[SYNTHETIC TEST — NOT IMMIGRATION ADVICE] ${m.runId}` }] };
          return { data: [] };
        },
        delete() { mutations++; return { in: async () => ({ data: [] }) }; },
        update() { mutations++; return { in: async () => ({ data: [] }) }; },
      };
    },
  };
}
test('cleanup refuses untrusted ownership and foreign replies before mutations', async () => {
  const m = newManifest(10);
  for (const settings of [{ foreign: true }, { foreignReply: true }]) {
    const admin = fakeAdmin(m, settings), result = await cleanup(admin, m);
    assert.equal(result.passed, false); assert.equal(admin.mutations, 0);
  }
});
test('cleanup verifies missing users and is idempotent for empty fixtures', async () => {
  const m = newManifest(10), admin = fakeAdmin(m);
  assert.equal((await cleanup(admin, m)).passed, true);
  const again = await cleanup(admin, m); assert.equal(again.passed, true); assert.equal(again.absentUsers, 10);
});
test('hosted runner fails closed on lost subscriptions and closes its actor connection', async () => {
  const old = process.env.VISAFLOW_MULTIUSER_PUBLIC_KEY;
  process.env.VISAFLOW_MULTIUSER_PUBLIC_KEY = 'sb_publishable_' + 'a'.repeat(30);
  const manifest = newManifest(10), fixture = manifest.users[0], controller = new AbortController();
  let disconnected = 0, stopped = 0;
  try {
    const result = await hostedRun({ manifest, passwords: { [fixture.id]: 'p'.repeat(30) }, signal: controller.signal,
      stop: () => { stopped++; controller.abort(); }, budget: { stats: {}, fetch: () => { throw new Error('No network in test'); } },
      createClient: (url, key, options) => {
        assert.equal(url, TARGET.databaseOrigin); assert(key.startsWith('sb_publishable_'));
        assert.equal(options.auth.autoRefreshToken, false); assert.equal(options.auth.persistSession, false);
        return {
          auth: { signInWithPassword: async () => ({ data: { user: { ...fixture, role: 'authenticated',
            app_metadata: { visaflow_test_run: manifest.runId, visaflow_test_purpose: 'free-tier-multiuser' } },
            session: { access_token: 'test-only', expires_at: Date.now()/1000 + 3600 } } }),
          signOut: async () => ({ error: null }), stopAutoRefresh() {} },
          realtime: { setAuth: async () => {}, disconnect: () => { disconnected++; } },
          rpc: async () => ({ data: [] }),
          from: () => ({ select() { return this; }, eq() { return this; }, single: async () => ({ data: { id: fixture.id, username: 'synthetic-user' } }), insert: async () => ({ data: null }) }),
          channel: () => ({ on() { return this; }, subscribe(callback) { queueMicrotask(() => callback('CHANNEL_ERROR')); return this; } }),
        };
      },
    });
    assert.equal(result.passed, false); assert.equal(result.authenticated, 1); assert.equal(result.peakSubscribed, 0);
    assert.equal(disconnected, 1); assert.equal(stopped, 1); assert.equal(result.sessionsRevoked, 1);
  } finally { if (old === undefined) delete process.env.VISAFLOW_MULTIUSER_PUBLIC_KEY; else process.env.VISAFLOW_MULTIUSER_PUBLIC_KEY = old; }
});

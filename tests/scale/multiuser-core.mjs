import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { TARGET, validateTarget, boundedBody } from './free-tier.mjs';

export const COHORTS = Object.freeze([10, 50, 100, 150]);
export const POLICY = '2026-10-06-preview-v2';
export const MARKER = '[SYNTHETIC TEST — NOT IMMIGRATION ADVICE]';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function checkCount(count) { assert(COHORTS.includes(count), 'Only 10, 50, 100 or 150 users; Free has a 200-connection ceiling.'); }
export function checkEvidence(e, count, now = Date.now()) {
  checkCount(count); validateTarget(e?.target);
  assert(e.schemaVersion === 1 && e.supabasePlan === 'free', 'Verify the actual Free plan');
  const age = now - Date.parse(e.checkedAt);
  assert(Number.isFinite(age) && age >= 0 && age <= 3600000, 'Quota evidence must be less than one hour old');
  for (const key of ['existingConnections', 'backgroundEventsPerSecond', 'databaseMB', 'remainingEgressMB', 'remainingRealtimeMessages', 'remainingMAU', 'tokenRequestsPer5Min', 'accessTokenSeconds'])
    assert(Number.isFinite(e[key]) && e[key] >= 0, `Missing quota evidence: ${key}`);
  assert(e.existingConnections + count <= (count === 150 ? 180 : 150),
    'Reserve at least 50 connections through 100 users or 20 connections at 150 users');
  assert(e.backgroundEventsPerSecond <= 20 && e.databaseMB <= 400, 'Insufficient operating headroom');
  assert(e.remainingEgressMB >= 50 && e.remainingRealtimeMessages >= 20000 && e.remainingMAU >= count, 'Insufficient remaining quota');
  assert(e.tokenRequestsPer5Min >= 100 && e.accessTokenSeconds >= 3600,
    'Token-endpoint allowance or access-token lifetime is too low for the paced test');
  assert(e.noConcurrentLoad === true && e.outboundHooksDisabled === true && e.passwordAuthVerified === true && e.schemaVerified === true,
    'Verify exclusive test window, disabled outbound hooks, password/CAPTCHA compatibility and deployed schema');
  if (count > 10) assert(e.previousStage?.users === COHORTS[COHORTS.indexOf(count) - 1] && e.previousStage?.passed === true && e.previousStage?.cleanupVerified === true,
    'Previous smaller hosted stage and cleanup must pass first');
}
export function newManifest(count, { serverAssignedIds = false } = {}) {
  checkCount(count);
  const runId = randomUUID(), createdAt = new Date().toISOString();
  return { schemaVersion: 1, target: TARGET, runId, createdAt, expiresAt: new Date(Date.now() + 86400000).toISOString(),
    state: 'provisioning', users: Array.from({ length: count }, (_, i) => ({ id: serverAssignedIds ? null : randomUUID(), email: `vf-${runId}-${i}@example.invalid` })) };
}
export function checkManifest(m, { expired = false } = {}) {
  validateTarget(m?.target); assert(m.schemaVersion === 1 && UUID.test(m.runId)); checkCount(m.users?.length);
  assert(Number.isFinite(Date.parse(m.createdAt)) && Date.parse(m.createdAt) <= Date.now());
  assert(Date.parse(m.expiresAt) > Date.parse(m.createdAt) && Date.parse(m.expiresAt) - Date.parse(m.createdAt) <= 86400000);
  if (!expired) assert(Date.parse(m.expiresAt) > Date.now(), 'Fixture expiry reached');
  const ids = new Set();
  for (const [i, u] of m.users.entries()) {
    assert(u.id === null && ['provisioning', 'provisioning-failed'].includes(m.state) || UUID.test(u.id));
    if (u.id) ids.add(u.id);
    assert.equal(u.email, `vf-${m.runId}-${i}@example.invalid`);
  }
  assert.equal(ids.size, m.users.filter(u => u.id).length);
  if (!['provisioning', 'provisioning-failed'].includes(m.state)) assert.equal(ids.size, m.users.length);
}
export function checkOwned(user, fixture, runId) {
  assert(UUID.test(user?.id));
  if (fixture.id) assert.equal(user.id, fixture.id);
  assert.equal(user?.email, fixture.email);
  assert.equal(user?.app_metadata?.visaflow_test_run, runId);
  assert.equal(user?.app_metadata?.visaflow_test_purpose, 'free-tier-multiuser');
  assert.equal(user?.role, 'authenticated', 'Test accounts must be ordinary users');
}
function keyBytes(key) { assert(/^[a-f0-9]{64}$/i.test(key ?? ''), 'Use a separate 32-byte hex credential encryption key'); return Buffer.from(key, 'hex'); }
export function seal(value, key, runId) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  cipher.setAAD(Buffer.from(runId));
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('base64') };
}
export function unseal(value, key, runId) {
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), Buffer.from(value.iv, 'hex'));
  decipher.setAAD(Buffer.from(runId)); decipher.setAuthTag(Buffer.from(value.tag, 'hex'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString());
}

// Shared across all actor clients, including SDK authentication requests.
export function networkBudget({ signal, stopped = () => false, fetcher = fetch, maxRequests = 3000, intervalMs = 300, authIntervalMs = 4000 } = {}) {
  let next = 0, authNext = 0, tail = Promise.resolve();
  const stats = { requests: 0, responseBytes: 0 };
  const guarded = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, TARGET.databaseOrigin); assert(!url.username && !url.password);
    assert(!new Headers(init.headers).has('X-Retry-Count'), 'Automatic retry refused');
    const turn = tail.then(async () => {
      signal?.throwIfAborted(); assert(!stopped(), 'Stopped');
      assert(stats.requests < maxRequests, 'Request budget exhausted');
      const auth = url.pathname === '/auth/v1/token';
      await delay(Math.max(0, next - Date.now(), auth ? authNext - Date.now() : 0), undefined, { signal });
      assert(!stopped(), 'Stopped'); signal?.throwIfAborted();
      stats.requests++; next = Date.now() + intervalMs;
      if (auth) authNext = Date.now() + authIntervalMs;
    });
    tail = turn.catch(() => {}); await turn;
    const signals = [AbortSignal.timeout(15000), signal, init.signal].filter(Boolean);
    const response = await fetcher(input, { ...init, redirect: 'error', signal: AbortSignal.any(signals) });
    if (response.status === 429 || response.status >= 500 || response.status >= 300 && response.status < 400) {
      await response.body?.cancel(); throw new Error('Service limit or failure; no retries');
    }
    if (response.status === 204) return response;
    const body = await boundedBody(response); stats.responseBytes += body.bytes;
    assert(stats.responseBytes <= 20 * 1024 * 1024, 'Response byte budget exhausted');
    const mediaType = response.headers.get('content-type') ?? '';
    assert(/^application\/(?:json|vnd\.pgrst\.(?:object|array)\+json)(?:\s*;|$)/i.test(mediaType), 'Non-JSON service response');
    return new Response(body.text, { status: response.status, headers: { 'content-type': mediaType } });
  };
  return { fetch: guarded, stats };
}

// Adapter contract is deliberately shared by local PostgreSQL and hosted tests.
// The local adapter does not implement subscribe: only the hosted runner counts delivery.
export async function pairJourney(a, b, outsider, runId, observe = async (_recipient, send) => send()) {
  const rpc = (actor, name, args) => actor.rpc(name, args);
  const denied = pattern => error => ['42501', 'P0001'].includes(error?.code) && pattern.test(error.reason ?? error.message);
  const conversation = await rpc(a, 'start_direct_conversation', { other_username: b.username });
  const first = randomUUID(), reply = randomUUID();
  const body = `${MARKER} ${runId} question ${first}`;
  await observe(b, () => rpc(a, 'send_direct_message', { target_conversation: conversation, message_body: body, message_id: first }), conversation, first);
  const received = await rpc(b, 'message_page', { target_conversation: conversation });
  assert(received.some(m => m.id === first && m.sender_id === a.id && m.body === body), 'Recipient must read the persisted message');
  await rpc(a, 'send_direct_message', { target_conversation: conversation, message_body: body, message_id: first });
  assert.equal((await rpc(b, 'message_page', { target_conversation: conversation })).filter(m => m.id === first).length, 1, 'Retry must not duplicate');
  await assert.rejects(() => rpc(a, 'send_direct_message', { target_conversation: conversation, message_body: body + 'conflict', message_id: first }), denied(/identifier already used/i));
  assert.deepEqual(await rpc(outsider, 'message_page', { target_conversation: conversation }), []);
  await assert.rejects(() => rpc(outsider, 'send_direct_message', { target_conversation: conversation, message_body: body, message_id: randomUUID() }), denied(/conversation unavailable/i));
  await rpc(b, 'respond_to_conversation', { target_conversation: conversation, decision: 'accepted' });
  const replyBody = `${MARKER} ${runId} response to ${received.find(m => m.id === first).id}`;
  await observe(a, () => rpc(b, 'send_direct_message', { target_conversation: conversation, message_body: replyBody, message_id: reply }), conversation, reply);
  for (const actor of [a, b]) {
    const history = await rpc(actor, 'message_page', { target_conversation: conversation });
    assert.equal(history.length, 2); assert(history.some(m => m.id === reply && m.sender_id === b.id && m.body === replyBody));
  }
  await rpc(b, 'mark_direct_messages_read', { target_conversation: conversation, message_ids: [first] });
  assert((await rpc(a, 'message_page', { target_conversation: conversation })).find(m => m.id === first).read_at);
  await rpc(b, 'respond_to_conversation', { target_conversation: conversation, decision: 'blocked' });
  await assert.rejects(() => rpc(a, 'send_direct_message', { target_conversation: conversation, message_body: body, message_id: randomUUID() }), denied(/conversation is closed/i));
  return { conversation, messages: [first, reply], sender: a.id, recipient: b.id, persisted: 2, outsiderDenied: true, idempotencyVerified: true, blockedSendDenied: true };
}

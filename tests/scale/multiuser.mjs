import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, open, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { TARGET, canary } from './free-tier.mjs';
import { COHORTS, checkEvidence, newManifest, checkManifest, checkOwned, seal, unseal, networkBudget, pairJourney, POLICY, MARKER, UUID } from './multiuser-core.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const base = resolve(root, '.local/multiuser');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
async function save(path, value) {
  await writeFile(path + '.tmp', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(path + '.tmp', path);
}
function ok(result) {
  if (result.error) throw Object.assign(new Error('Application request rejected'), { code: result.error.code, reason: result.error.message });
  return result.data;
}
function publicKey() {
  const key = process.env.VISAFLOW_MULTIUSER_PUBLIC_KEY;
  assert(/^sb_publishable_[\w-]{20,}$/.test(key ?? ''), 'Dedicated dev publishable key required'); return key;
}
function adminKey() {
  const key = process.env.VISAFLOW_MULTIUSER_ADMIN_KEY;
  assert(/^sb_secret_[\w-]{20,}$/.test(key ?? ''), 'Dedicated dev secret key required for provisioning/cleanup only'); return key;
}

export async function hostedRun({ manifest, passwords, createClient, budget, signal, progress = () => {}, stop,
  clientOrigin = TARGET.databaseOrigin, clientPublicKey = publicKey() }) {
  checkManifest(manifest);
  if (clientOrigin !== TARGET.databaseOrigin)
    assert(process.env.VISAFLOW_LOCAL_PROTOCOL_TEST === '1' && /^http:\/\/127\.0\.0\.1:\d+$/.test(clientOrigin), 'Only an explicitly enabled loopback test may override the dev origin');
  const clients = [], actors = [];
  const ready = new Set(), sent = new Set(), received = new Set();
  let closing = false, events = 0;
  let phase = 'starting';
  const result = { schemaVersion: 1, kind: 'hosted-multiuser', target: TARGET, runId: manifest.runId, users: manifest.users.length,
    passed: false, startedAt: new Date().toISOString(), authenticated: 0, peakSubscribed: 0,
    readiness: [], pairs: [], deliveries: [], posts: 0, replies: 0, votes: 0, cleanupVerified: false };
  const checkpoint = () => {
    result.readiness.push({ at: new Date().toISOString(), subscribed: ready.size });
    result.peakSubscribed = Math.max(result.peakSubscribed, ready.size);
    progress({ authenticated: result.authenticated, subscribed: ready.size, completedPairs: result.pairs.length });
  };
  const timer = setInterval(checkpoint, 1000);
  async function subscribe(actor, topic) {
    const state = { count: 0 };
    const channel = actor.client.channel(topic, { config: { private: true } });
    await new Promise((resolveReady, reject) => {
      const cancelled = () => { clearTimeout(timeout); reject(new Error('Subscription cancelled')); };
      const timeout = setTimeout(() => { signal.removeEventListener('abort', cancelled); reject(new Error('Subscription timeout')); }, 15000);
      signal.addEventListener('abort', cancelled, { once: true });
      if (signal.aborted) { cancelled(); return; }
      channel.on('broadcast', { event: 'changed' }, () => {
        state.count++; if (++events > 20000) stop();
      }).subscribe(status => {
        if (status === 'SUBSCRIBED') { clearTimeout(timeout); signal.removeEventListener('abort', cancelled); resolveReady(); }
        else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status) && !closing) {
          ready.delete(actor.id); clearTimeout(timeout); signal.removeEventListener('abort', cancelled); stop(); reject(new Error('Subscription lost'));
        }
      });
    });
    return state;
  }
  try {
    for (const fixture of manifest.users) {
      signal.throwIfAborted();
      phase = 'sign-in';
      const client = createClient(clientOrigin, clientPublicKey, {
        global: { fetch: budget.fetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        realtime: { timeout: 12000, reconnectAfterMs: () => 3600000 },
      });
      clients.push(client);
      const password = passwords[fixture.email]; assert(typeof password === 'string' && password.length >= 24);
      const auth = ok(await client.auth.signInWithPassword({ email: fixture.email, password }));
      checkOwned(auth.user, fixture, manifest.runId);
      assert(auth.session.expires_at * 1000 > Date.now() + 1200000, 'Session too short for bounded test');
      result.authenticated++;
      phase = 'profile';
      const profile = ok(await client.from('profiles').select('id,username').eq('id', fixture.id).single());
      assert.equal(profile.id, fixture.id);
      phase = 'fresh-conversations';
      assert.equal(ok(await client.rpc('conversation_page', {})).length, 0, 'Fresh fixtures required');
      phase = 'policy-acceptance';
      ok(await client.from('policy_acceptances').insert({ user_id: fixture.id, policy_version: POLICY, market: 'US', terms_accepted: true, privacy_acknowledged: true, adult_confirmed: true }));
      phase = 'realtime-auth';
      await client.realtime.setAuth(auth.session.access_token);
      const actor = { id: fixture.id, username: profile.username, client, rpc: async (name, args) => ok(await client.rpc(name, args)) };
      phase = 'inbox-subscription';
      actors.push(actor); await subscribe(actor, `inbox:${actor.id}`); ready.add(actor.id);
    }
    checkpoint(); assert.equal(ready.size, actors.length);
    result.allInboxesReadyAt = new Date().toISOString();
    // All users stay signed in and subscribed while pairs exercise their own conversations.
    phase = 'all-inboxes-hold';
    await delay(30000, undefined, { signal });
    const observation = async (recipient, send, conversation, messageId) => {
      signal.throwIfAborted();
      const state = await subscribe(recipient, `conversation:${conversation}`);
      const before = state.count, start = performance.now();
      await send();
      const deadline = Date.now() + 15000;
      while (state.count === before) { assert(Date.now() < deadline, 'Missing realtime invalidation'); await delay(100, undefined, { signal }); }
      const history = await recipient.rpc('message_page', { target_conversation: conversation });
      assert(history.some(m => m.id === messageId), 'Invalidation without persisted delivery');
      result.deliveries.push({ messageId, recipient: recipient.id, observedAndReadMs: Math.round(performance.now() - start) });
      received.add(recipient.id);
    };
    for (let i = 0; i < actors.length; i += 2) {
      result.activePair = i / 2 + 1;
      phase = 'pair-readiness';
      signal.throwIfAborted(); assert.equal(ready.size, actors.length);
      const [a, b] = [actors[i], actors[i + 1]], outsider = actors[(i + 2) % actors.length];
      phase = 'pair-messaging';
      const pair = await pairJourney(a, b, outsider, manifest.runId, observation);
      result.pairs.push(pair); sent.add(a.id); sent.add(b.id);
      phase = 'question-insert';
      const q = ok(await a.client.from('questions').insert({ author_id: a.id, title: `${MARKER} ${manifest.runId}`, body: `${MARKER} ${manifest.runId} Synthetic visa timeline question for testing only.`, tags: ['timeline'] }).select('id').single());
      result.posts++;
      phase = 'answer-insert';
      const answer = ok(await b.client.from('answers').insert({ author_id: b.id, question_id: q.id, body: `${MARKER} ${manifest.runId} Synthetic reply for testing only.` }).select('id').single()); result.replies++;
      phase = 'answer-vote';
      await a.rpc('vote_answer', { target_answer_id: answer.id, vote_value: 1 });
      phase = 'question-vote';
      await b.rpc('vote_question', { target_question_id: q.id, vote_value: 1 }); result.votes += 2;
      phase = 'answer-acceptance';
      await a.rpc('accept_answer', { target_answer_id: answer.id });
      phase = 'answer-acceptance-read';
      const persisted = ok(await b.client.from('answers').select('id,is_accepted').eq('id', answer.id).single());
      assert.equal(persisted.is_accepted, true);
    }
    delete result.activePair;
    phase = 'final-checks';
    assert.equal(sent.size, actors.length); assert.equal(received.size, actors.length);
    assert.equal(ready.size, actors.length); result.passed = true;
    result.allInboxesReadyThrough = new Date().toISOString();
  } catch (error) {
    result.failure = 'Authentication, subscription, budget, persistence or permission assertion failed; no retries.';
    result.failurePhase = phase;
    result.failureKind = error?.name === 'AssertionError' ? 'assertion' :
      error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'timeout-or-abort' :
      error?.message === 'Application request rejected' ? 'application-request' :
      error?.name === 'TypeError' ? 'network-or-type' : 'other';
    if (result.failureKind === 'assertion' && typeof error.actual === 'boolean' && typeof error.expected === 'boolean') {
      result.assertionActual = error.actual;
      result.assertionExpected = error.expected;
    }
    if (typeof error?.code === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(error.code)) result.failureCode = error.code;
    if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 600) result.failureStatus = error.status;
  }
  finally {
    checkpoint(); clearInterval(timer); closing = true;
    // Disconnect immediately, including on stop; do not wait for a failed network.
    const closed = await Promise.allSettled(clients.map(async client => {
      await client.realtime.disconnect(); await client.auth.stopAutoRefresh();
    }));
    result.disconnectFailures = closed.filter(item => item.status === 'rejected').length;
    if (result.disconnectFailures) result.passed = false;
    // Best-effort session revocation; an exhausted/aborted budget can prevent it.
    // Report the count and require the separate administrative cleanup command.
    result.sessionsRevoked = 0;
    for (const client of clients) {
      try { const logout = await client.auth.signOut({ scope: 'global' }); if (!logout.error) result.sessionsRevoked++; } catch {}
    }
    result.eventsObserved = events; result.distinctSenders = sent.size; result.distinctRecipients = received.size;
    result.finishedAt = new Date().toISOString(); result.http = { ...budget.stats };
  }
  return result;
}

async function main([command, arg, ...extra]) {
  assert(!extra.length && ['provision', 'run', 'cleanup'].includes(command));
  await mkdir(base, { recursive: true, mode: 0o700 });
  // A single global lock also fences provisioning against active runs and cleanup.
  const lock = await open(resolve(base, 'active.lock'), 'wx', 0o600);
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  const stopWatcher = setInterval(() => {
    if (command !== 'cleanup' && existsSync(resolve(base, 'STOP'))) abort();
  }, 250);
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(1800000)]);
  const budget = networkBudget({ signal, stopped: () => command !== 'cleanup' && existsSync(resolve(base, 'STOP')) });
  let manifest, dir;
  try {
    // No ordinary client has access to an administrative credential.
    if (command === 'run') assert(!process.env.VISAFLOW_MULTIUSER_ADMIN_KEY, 'Unset admin key in actor process');
    const { createClient } = await import('@supabase/supabase-js');
    let evidence;
    if (command !== 'cleanup') {
      evidence = await json(resolve(base, 'limits.json'));
      if (command === 'run') {
        assert(UUID.test(arg ?? '')); manifest = await json(resolve(base, arg, 'manifest.json')); checkManifest(manifest);
        assert.equal(manifest.state, 'provisioned');
      }
      checkEvidence(evidence, command === 'provision' ? Number(arg) : manifest.users.length);
      const count = command === 'provision' ? Number(arg) : manifest.users.length;
      if (count > 10) {
        assert(UUID.test(evidence.previousRunId ?? ''), 'Previous hosted run artifacts required');
        const previousDir = resolve(base, evidence.previousRunId);
        const previous = await json(resolve(previousDir, 'manifest.json')); checkManifest(previous, { expired: true });
        assert.equal(previous.state, 'cleaned'); assert.equal(previous.users.length, COHORTS[COHORTS.indexOf(count) - 1]);
        const previousResult = await json(resolve(previousDir, 'result.json'));
        const previousCleanup = await json(resolve(previousDir, 'cleanup.json'));
        assert.equal(previousResult.runId, evidence.previousRunId); assert.equal(previousCleanup.runId, evidence.previousRunId);
        assert.equal(previousResult.passed, true); assert.equal(previousCleanup.passed, true);
        assert.equal(previousResult.applicationCommit, evidence.applicationCommit, 'Revalidate smaller stage after app changes');
      }
      assert(/^[0-9a-f]{40}$/.test(evidence.applicationCommit ?? ''), 'Record the independently verified dev commit');
      assert.equal((await canary({ expectedCommit: evidence.applicationCommit, signal,
        stopped: () => existsSync(resolve(base, 'STOP')) })).passed, true, 'Dev canary must pass before authenticated work');
    }
    if (command === 'provision') {
      const count = Number(arg); checkEvidence(evidence, count);
      manifest = newManifest(count, { serverAssignedIds: true }); dir = resolve(base, manifest.runId); await mkdir(dir, { mode: 0o700 });
      const passwords = Object.fromEntries(manifest.users.map(u => [u.email, randomBytes(24).toString('base64url')]));
      await save(resolve(dir, 'credentials.enc.json'), seal(passwords, process.env.VISAFLOW_MULTIUSER_ENCRYPTION_KEY, manifest.runId));
      await save(resolve(dir, 'manifest.json'), manifest); // Record every UUID BEFORE any creation request.
      const admin = createClient(TARGET.databaseOrigin, adminKey(), { global: { fetch: budget.fetch }, auth: { persistSession: false, autoRefreshToken: false } });
      try {
        for (const user of manifest.users) {
          const created = ok(await admin.auth.admin.createUser({ email: user.email, password: passwords[user.email], email_confirm: true,
            user_metadata: { first_name: 'Synthetic', last_name: 'Tester' },
            app_metadata: { visaflow_test_run: manifest.runId, visaflow_test_purpose: 'free-tier-multiuser' } }));
          checkOwned(created.user, user, manifest.runId);
          user.id = created.user.id;
          await save(resolve(dir, 'manifest.json'), manifest);
        }
        manifest.state = 'provisioned';
      } catch { manifest.state = 'provisioning-failed'; process.exitCode = 1; }
      await save(resolve(dir, 'manifest.json'), manifest);
      console.log(JSON.stringify({ runId: manifest.runId, state: manifest.state, cleanupRequired: true }));
    } else {
      assert(UUID.test(arg ?? ''), 'Run UUID required'); dir = resolve(base, arg);
      manifest = await json(resolve(dir, 'manifest.json')); checkManifest(manifest, { expired: command === 'cleanup' });
      assert.equal(manifest.runId, arg);
      if (command === 'cleanup') {
        const { cleanup } = await import('./multiuser-cleanup.mjs');
        const admin = createClient(TARGET.databaseOrigin, adminKey(), { global: { fetch: budget.fetch }, auth: { persistSession: false, autoRefreshToken: false } });
        const result = await cleanup(admin, manifest);
        await save(resolve(dir, 'cleanup.json'), result);
        if (result.passed) { manifest.state = 'cleaned'; await save(resolve(dir, 'manifest.json'), manifest); await unlink(resolve(dir, 'credentials.enc.json')).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
        else process.exitCode = 1;
        console.log(JSON.stringify({ runId: arg, cleanupVerified: result.passed }));
      } else {
        checkEvidence(evidence, manifest.users.length);
        assert.equal(manifest.state, 'provisioned', 'Actors are single-use; cleanup partial runs');
        const policy = await readFile(resolve(root, 'src/lib/policy.ts'), 'utf8'); assert(policy.includes(`'${POLICY}'`));
        const passwords = unseal(await json(resolve(dir, 'credentials.enc.json')), process.env.VISAFLOW_MULTIUSER_ENCRYPTION_KEY, arg);
        manifest.state = 'running'; await save(resolve(dir, 'manifest.json'), manifest);
        const result = await hostedRun({ manifest, passwords, createClient, budget, signal, stop: abort });
        if (result.passed) {
          result.finalCanaryPassed = (await canary({ expectedCommit: evidence.applicationCommit, signal,
            stopped: () => existsSync(resolve(base, 'STOP')) })).passed;
          if (!result.finalCanaryPassed) { result.passed = false; result.failure = 'Development deployment changed or final canary failed'; }
        }
        result.applicationCommit = evidence.applicationCommit;
        result.quotaEvidence = evidence;
        result.harnessCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
        result.configHash = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
        await save(resolve(dir, 'result.json'), result);
        manifest.state = result.passed ? 'passed-needs-cleanup' : 'failed-needs-cleanup'; await save(resolve(dir, 'manifest.json'), manifest);
        console.log(JSON.stringify({ runId: arg, passed: result.passed, authenticated: result.authenticated, peakSubscribed: result.peakSubscribed, cleanupRequired: true }));
        if (!result.passed) process.exitCode = 1;
      }
    }
  } finally {
    clearInterval(stopWatcher);
    process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
    await lock.close(); await unlink(resolve(base, 'active.lock'));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch(() => { console.error('Multi-user test refused or stopped. Check dev-only credentials, recent limits.json, fixture state and active.lock. No provider details logged.'); process.exitCode = 1; });

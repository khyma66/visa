// Optional Docker-backed protocol test. It never contacts the hosted dev project.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { newManifest, checkOwned, networkBudget } from './multiuser-core.mjs';
import { hostedRun } from './multiuser.mjs';
import { cleanup } from './multiuser-cleanup.mjs';

process.env.VISAFLOW_LOCAL_PROTOCOL_TEST = '1';
const env = Object.fromEntries(execFileSync(process.env.VISAFLOW_LOCAL_SUPABASE_CLI ?? 'supabase', ['status', '--workdir', '.local/supabase-protocol', '-o', 'env'],
  { encoding: 'utf8' }).trim().split('\n').map(line => {
  const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).replace(/^"|"$/g, '')];
}));
const origin = env.API_URL;
assert.equal(origin, 'http://127.0.0.1:55431', 'Isolated local stack required');
assert(/^sb_publishable_/.test(env.PUBLISHABLE_KEY) && /^sb_secret_/.test(env.SECRET_KEY));
const controller = new AbortController();
const budget = networkBudget({ signal: controller.signal, expectedOrigin: origin,
  intervalMs: 20, authIntervalMs: 100, maxRequests: 1000 });
const admin = createClient(origin, env.SECRET_KEY, { global: { fetch: budget.fetch },
  auth: { persistSession: false, autoRefreshToken: false } });
const cleanupBudget = networkBudget({ expectedOrigin: origin, intervalMs: 20,
  authIntervalMs: 100, maxRequests: 1000 });
const cleanupAdmin = createClient(origin, env.SECRET_KEY, { global: { fetch: cleanupBudget.fetch },
  auth: { persistSession: false, autoRefreshToken: false } });
const manifest = newManifest(4, { serverAssignedIds: true });
const passwords = Object.fromEntries(manifest.users.map(u => [u.email, randomBytes(24).toString('base64url')]));
let result, cleaned;
try {
  for (const fixture of manifest.users) {
    const created = await admin.auth.admin.createUser({ email: fixture.email, password: passwords[fixture.email], email_confirm: true,
      user_metadata: { first_name: 'Synthetic', last_name: 'Tester' },
      app_metadata: { visaflow_test_run: manifest.runId, visaflow_test_purpose: 'free-tier-multiuser' } });
    if (created.error) throw new Error(`Local Auth create failed: ${created.error.code ?? created.error.status}`);
    checkOwned(created.data.user, fixture, manifest.runId);
    fixture.id = created.data.user.id;
  }
  manifest.state = 'provisioned';
  result = await hostedRun({ manifest, passwords, createClient, budget, signal: controller.signal,
    stop: () => controller.abort(), clientOrigin: origin, clientPublicKey: env.PUBLISHABLE_KEY });
} finally {
  manifest.state ??= 'provisioning-failed';
  cleaned = await cleanup(cleanupAdmin, manifest);
}
console.log(JSON.stringify({ localProtocol: true, passed: result?.passed === true, authenticated: result?.authenticated ?? 0,
  peakSubscribed: result?.peakSubscribed ?? 0, pairs: result?.pairs.length ?? 0, deliveries: result?.deliveries.length ?? 0,
  posts: result?.posts ?? 0, replies: result?.replies ?? 0, votes: result?.votes ?? 0,
  failurePhase: result?.failurePhase, failureCode: result?.failureCode,
  cleanupVerified: cleaned?.passed === true, cleanupFailurePhase: cleaned?.failurePhase }));
if (!result?.passed || !cleaned?.passed) process.exitCode = 1;

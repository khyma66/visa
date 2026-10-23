// Prepare two ordinary synthetic accounts for dev-website browser checks.
// The administrative credential is never available to this process.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { TARGET } from './free-tier.mjs';
import { checkManifest, networkBudget, POLICY, unseal, MARKER } from './multiuser-core.mjs';

assert(!process.env.VISAFLOW_MULTIUSER_ADMIN_KEY, 'Browser fixture process cannot hold admin key');
const runId = process.argv[2];
assert(/^[0-9a-f-]{36}$/.test(runId ?? ''), 'Run UUID required');
const dir = resolve('.local/multiuser', runId);
const manifest = JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8'));
checkManifest(manifest);
assert.equal(manifest.users.length, 4);
assert.equal(manifest.state, 'provisioned');
const passwords = unseal(JSON.parse(await readFile(resolve(dir, 'credentials.enc.json'), 'utf8')),
  process.env.VISAFLOW_MULTIUSER_ENCRYPTION_KEY, runId);
const key = process.env.VISAFLOW_MULTIUSER_PUBLIC_KEY;
assert(/^sb_publishable_[\w-]{20,}$/.test(key ?? ''));
const budget = networkBudget();
const users = [];
for (const fixture of manifest.users.slice(0, 2)) {
  const client = createClient(TARGET.databaseOrigin, key, { global: { fetch: budget.fetch },
    auth: { persistSession: false, autoRefreshToken: false } });
  const auth = await client.auth.signInWithPassword({ email: fixture.email, password: passwords[fixture.email] });
  assert(!auth.error && auth.data.user?.id === fixture.id, 'Synthetic user sign-in failed');
  const policy = await client.from('policy_acceptances').insert({ user_id: fixture.id, policy_version: POLICY,
    market: 'US', terms_accepted: true, privacy_acknowledged: true, adult_confirmed: true });
  assert(!policy.error, 'Synthetic policy acceptance failed');
  const profile = await client.from('profiles').select('id,username').eq('id', fixture.id).single();
  assert(!profile.error && profile.data?.id === fixture.id, 'Synthetic profile missing');
  users.push({ id: fixture.id, email: fixture.email, password: passwords[fixture.email], username: profile.data.username });
  await client.auth.signOut({ scope: 'global' });
}
await writeFile(resolve(dir, 'browser-fixtures.json'), JSON.stringify({ runId, origin: TARGET.origin,
  marker: `${MARKER} ${runId}`, users }, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ runId, browserFixturesReady: users.length }));

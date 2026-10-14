// Test-only policy. This module is deliberately not imported by the application,
// its preview deployment, or production release paths.
export const PRODUCTION_PROJECT_REF = 'cycnichledvqbxevrwnt';
export const PRODUCTION_DATABASE_ORIGIN = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;

function fail(message) { throw new Error(`Live test blocked: ${message}`); }

/** Refuse production even if every disposable-test acknowledgment is supplied. */
export function liveTestTarget(env) {
  let url;
  try { url = new URL(env.VISAFLOW_TEST_SUPABASE_URL); } catch { fail('Set a dedicated VISAFLOW_TEST_SUPABASE_URL; application credentials are never reused.'); }
  if (url.hostname.replace(/\.$/, '') === `${PRODUCTION_PROJECT_REF}.supabase.co`) {
    fail('The elected VisaFlow production database can never be a mutation-test target. Use a separate disposable project.');
  }
  if (['APP_ENV', 'NEXT_PUBLIC_APP_ENV', 'CLOUDFLARE_ENV'].some((name) => env[name] === 'production')) {
    fail('Run mutation tests outside a production environment.');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail('The test database must be a bare origin without credentials, paths or query parameters.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const remoteRef = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname)?.[1];
  if (local ? !['http:', 'https:'].includes(url.protocol) || !url.port : url.protocol !== 'https:' || !remoteRef || Boolean(url.port)) {
    fail('Use an explicit loopback port or a direct HTTPS disposable Supabase project; aliases and proxies are not accepted.');
  }
  const expectedRef = local ? 'local' : remoteRef;
  if (env.VISAFLOW_TEST_PROJECT_REF !== expectedRef) fail('VISAFLOW_TEST_PROJECT_REF must explicitly match the disposable target (local for loopback).');
  if (env.VISAFLOW_TEST_ENV !== 'disposable' || env.VISAFLOW_TEST_ALLOW_WRITES !== 'disposable-fixtures-only') {
    fail('A disposable environment and explicit disposable-fixtures-only write acknowledgment are required.');
  }
  const key = env.VISAFLOW_TEST_PUBLISHABLE_KEY ?? '';
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key);
  if (!publicKey && key.split('.').length === 3) {
    try {
      const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
      publicKey = claims.role === 'anon' && claims.ref !== PRODUCTION_PROJECT_REF
        && (local ? !claims.ref : claims.ref === remoteRef);
    } catch { publicKey = false; }
  }
  if (!publicKey) fail('Use only a publishable/anon key belonging to the disposable target; privileged keys are forbidden.');
  return Object.freeze({ origin: url.origin, projectRef: expectedRef, publishableKey: key, local });
}

/** Old shared-preview fixture files intentionally fail this schema check. */
export function liveTestFixtures(manifest, target, now = Date.now()) {
  if (manifest?.schemaVersion !== 1 || manifest?.purpose !== 'visaflow-live-tests' || manifest?.disposable !== true
    || manifest?.databaseOrigin !== target.origin) fail('Fixture manifest must explicitly identify this exact disposable test database.');
  const created = Date.parse(manifest.createdAt), expires = Date.parse(manifest.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || created > now + 60_000 || expires <= now
    || expires <= created || expires - created > 86_400_000) fail('Use fresh disposable fixtures with a maximum 24-hour validity window.');
  const users = manifest.users;
  if (!Array.isArray(users) || users.length !== 3) fail('Exactly three independently provisioned disposable test users are required.');
  const ids = new Set(), emails = new Set();
  for (const user of users) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user?.id ?? '')
      || typeof user?.email !== 'string' || !/^[a-z0-9._+-]+@(?:[a-z0-9-]+\.)*example\.invalid$/i.test(user.email)
      || typeof user?.password !== 'string' || user.password.length < 12) fail('Fixture users must have unique IDs, reserved example.invalid emails and test passwords.');
    ids.add(user.id.toLowerCase()); emails.add(user.email.toLowerCase());
  }
  if (ids.size !== 3 || emails.size !== 3) fail('Disposable test identities must be distinct.');
  return users.map(({ id, email, password }) => ({ id, email, password }));
}

/** Do not let credentials follow redirects or escape to a different origin. */
export function liveTestFetch(target, fetcher = fetch) {
  return async (input, init = {}) => {
    let url;
    try { url = new URL(input instanceof Request ? input.url : input); } catch { fail('Invalid test request destination.'); }
    if (url.origin !== target.origin || url.username || url.password) fail('A test request attempted to leave its approved disposable origin.');
    try {
      return await fetcher(input, { ...init, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(20_000) });
    } catch { fail('Disposable test request failed; inspect staging logs. No credentials or response bodies are logged.'); }
  };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { safeReturnPath, callbackUrl, authErrorMessage, login, requestSignupCode, verifySignupCode, finishSignup, googleLogin, exchangeCallback, requestPasswordReset, updatePassword, logout } from '../../src/lib/auth/flow.ts';
import { readPublicAuthConfig } from '../../src/lib/auth/config.ts';

const user = { id: 'test-user', email_confirmed_at: '2026-10-01T00:00:00Z' };
const success = () => ({ data: { user, session: { access_token: 'test-only' } }, error: null });
const callback = params => new URL(`https://visaflow.example/auth/callback?${new URLSearchParams(params)}`);

test('return paths retain local navigation including a local query', () => {
  assert.equal(safeReturnPath('/communities/usa?q=h1b#answers'), '/communities/usa?q=h1b#answers');
  assert.equal(safeReturnPath('/foo/../questions'), '/questions');
});
for (const value of ['https://evil.example', '//evil.example', '/\\evil.example', '/%5cevil.example', '/%2fevil.example', '/%252fevil.example', '/%0a/evil', '/%250d/evil', '/auth/callback', '/login', '/signup', '/reset-password', '/auth/../login', '/%ZZ', '']) {
  test(`unsafe or recursive redirect rejected: ${value}`, () => assert.equal(safeReturnPath(value), '/'));
}
test('callback URL is origin-bound and sanitizes its next target', () => {
  const url = new URL(callbackUrl('https://visaflow.example', '//evil.example'));
  assert.equal(url.origin, 'https://visaflow.example');
  assert.equal(url.pathname, '/auth/callback');
  assert.equal(url.searchParams.get('next'), '/');
  assert.throws(() => callbackUrl('http://visaflow.example', '/'));
  assert.doesNotThrow(() => callbackUrl('http://localhost:3000', '/'));
});
test('missing public auth config fails closed', () => {
  assert.equal(readPublicAuthConfig(), null);
  assert.equal(readPublicAuthConfig('https://project.supabase.co'), null);
  assert.equal(readPublicAuthConfig('not a url', 'sb_publishable_test'), null);
  assert.equal(readPublicAuthConfig('http://project.supabase.co', 'sb_publishable_test'), null);
});
test('privileged and malformed frontend keys are rejected', () => {
  const jwt = role => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  assert.equal(readPublicAuthConfig('https://project.supabase.co', 'sb_secret_test'), null);
  assert.equal(readPublicAuthConfig('https://project.supabase.co', jwt('service_role')), null);
  assert.equal(readPublicAuthConfig('https://project.supabase.co', jwt('authenticated')), null);
  assert.equal(readPublicAuthConfig('https://project.supabase.co', 'garbage'), null);
  assert.ok(readPublicAuthConfig('https://project.supabase.co', jwt('anon')));
  assert.ok(readPublicAuthConfig('https://project.supabase.co', 'sb_publishable_test'));
});
test('password login passes CAPTCHA and requires a returned session', async () => {
  const api = { signInWithPassword: async args => { assert.deepEqual(args, { email: 'member@example.com', password: 'test-password', options: { captchaToken: 'captcha' } }); return success(); } };
  assert.equal((await login(api, ' member@example.com ', 'test-password', 'captcha')).id, user.id);
  await assert.rejects(login({ signInWithPassword: async () => ({ data: { user, session: null }, error: null }) }, 'member@example.com', 'test-password'), /session/);
});
test('email signup sends a code with explicit create-user permission and CAPTCHA', async () => {
  await requestSignupCode({ signInWithOtp: async args => { assert.deepEqual(args, { email: 'member@example.com', options: { shouldCreateUser: true, captchaToken: 'captcha' } }); return { error: null }; } }, 'member@example.com', 'captcha');
});
test('verification blocks malformed code before contacting auth service', async () => {
  let called = false;
  await assert.rejects(verifySignupCode({ verifyOtp: async () => { called = true; return success(); } }, 'member@example.com', '12345'), /six-digit/);
  assert.equal(called, false);
});
test('email verification cannot progress on a response without verified email or session', async () => {
  await assert.rejects(verifySignupCode({ verifyOtp: async () => ({ data: { user: { id: user.id }, session: {} }, error: null }) }, 'member@example.com', '123456'), /did not complete/);
  await assert.rejects(verifySignupCode({ verifyOtp: async () => ({ data: { user, session: null }, error: null }) }, 'member@example.com', '123456'), /did not complete/);
});
test('verified OTP enters the password step', async () => {
  const result = await verifySignupCode({ verifyOtp: async args => { assert.equal(args.type, 'email'); assert.equal(args.token, '123456'); return success(); } }, 'member@example.com', '123456');
  assert.equal(result.id, user.id);
});
test('finishing signup revalidates user and never writes client roles or a fake username', async () => {
  let update;
  await finishSignup({ getUser: async () => success(), updateUser: async value => { update = value; return success(); } }, 'long-test-passphrase');
  assert.deepEqual(update, { password: 'long-test-passphrase' });
});
test('unverified or expired sessions cannot finish signup', async () => {
  let changed = false;
  await assert.rejects(finishSignup({ getUser: async () => ({ data: { user: { id: user.id } }, error: null }), updateUser: async () => { changed = true; return success(); } }, 'long-test-passphrase'), /Verify your email/);
  assert.equal(changed, false);
});
test('Google is the only social provider requested and callback is PKCE destination', async () => {
  await googleLogin({ signInWithOAuth: async args => { assert.equal(args.provider, 'google'); assert.equal(new URL(args.options.redirectTo).pathname, '/auth/callback'); return { error: null }; } }, 'https://visaflow.example', '/questions');
});
test('callback exchanges code and preserves safe return target', async () => {
  assert.equal(await exchangeCallback({ exchangeCodeForSession: async code => { assert.equal(code, 'test-code'); return success(); } }, callback({ code: 'test-code', next: '/questions' })), '/questions');
});
test('callback cannot fall back to an already cached session on missing/expired codes', async () => {
  let calls = 0;
  const api = { exchangeCodeForSession: async () => { calls++; return { data: { user, session: {} }, error: { message: 'expired' } }; } };
  await assert.rejects(exchangeCallback(api, callback({ next: '/' })), /missing or expired/);
  assert.equal(calls, 0);
  await assert.rejects(exchangeCallback(api, callback({ code: 'expired' })), /invalid or expired/);
  assert.equal(calls, 1);
});
test('OAuth error is handled before exchange without reflecting provider text', async () => {
  const raw = '<script>secret</script>';
  await assert.rejects(exchangeCallback({}, callback({ error: raw, code: 'code' })), error => !error.message.includes(raw));
});
test('recovery callback uses the fixed password route and ignores hostile return location', async () => {
  assert.equal(await exchangeCallback({ exchangeCodeForSession: async () => success() }, callback({ code: 'recovery-code', recovery: '1', next: 'https://evil.example' })), '/reset-password?update=1');
});
test('password recovery binds to same browser callback with CAPTCHA', async () => {
  await requestPasswordReset({ resetPasswordForEmail: async (email, options) => { assert.equal(email, 'member@example.com'); assert.equal(new URL(options.redirectTo).searchParams.get('recovery'), '1'); assert.equal(options.captchaToken, 'captcha'); return { error: null }; } }, 'member@example.com', 'https://visaflow.example', 'captcha');
});
test('password update rejects unverified cached state and too-short passwords', async () => {
  let changed = false;
  const api = { getUser: async () => ({ data: { user: null }, error: new Error('expired') }), updateUser: async () => { changed = true; return success(); } };
  await assert.rejects(updatePassword(api, 'short'), /12 and 128/);
  await assert.rejects(updatePassword(api, 'long-test-passphrase'), /session expired/);
  assert.equal(changed, false);
});
test('public errors never disclose raw provider details or email existence', () => {
  const message = authErrorMessage({ code: 'email_exists', message: 'private@example.com exists in tenant x' });
  assert.equal(message, authErrorMessage({ code: 'invalid_credentials' }));
  assert.ok(!message.includes('private@example.com'));
  assert.match(authErrorMessage({ code: 'over_request_rate_limit' }), /Too many attempts/);
});
test('logout explicitly closes this browser session and never reports provider failure as success', async () => {
  await logout({ signOut: async args => { assert.deepEqual(args, { scope: 'local' }); return { error: null }; } });
  await assert.rejects(logout({ signOut: async () => ({ error: new Error('transport unavailable') }) }), /could not finish/);
});

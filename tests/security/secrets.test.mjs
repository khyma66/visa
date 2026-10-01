import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanContent } from '../../scripts/check-secrets.mjs';

const jwt = (role) => [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ role })).toString('base64url'),
  'synthetic-signature-not-a-real-secret',
].join('.');

test('privileged and user JWT findings contain locations only', () => {
  for (const role of ['service_role', 'authenticated']) {
    const value = jwt(role);
    const result = scanContent(`\nKEY=${value}`, 'fixture.env');
    assert.deepEqual(result, [{ file: 'fixture.env', line: 2, type: 'privileged-or-user-jwt' }]);
    assert.ok(!JSON.stringify(result).includes(value));
  }
});

test('public anon tokens are not misclassified as privileged tokens', () => {
  assert.deepEqual(scanContent(`PUBLIC_KEY=${jwt('anon')}`, 'fixture.env'), []);
});

test('malformed JWT is handled without leaking content or crashing', () => {
  assert.deepEqual(scanContent('eyJmalformedheader.e30.synthetic-signature', 'fixture.env'), []);
});

test('literal R2 secret and access key are detected with metadata only', () => {
  for (const name of ['CF_R2_ACCESS_KEY_SECRET', 'CF_R2_ACCESS_KEY_ID']) {
    const value = 'a1b2c3d4'.repeat(8);
    const result = scanContent(`${name}=${value}`, 'fixture.env');
    assert.deepEqual(result, [{ file: 'fixture.env', line: 1, type: 'literal-secret-assignment' }]);
    assert.ok(!JSON.stringify(result).includes(value));
  }
});

test('environment references and explicit placeholders are allowed', () => {
  for (const value of ['import.meta.env.CF_R2_ACCESS_KEY_SECRET', 'process.env.WORKER_SECRET', 'self.env.CF_API_TOKEN', 'env.CF_R2_ACCESS_KEY_SECRET', 'your-replacement-secret-goes-here']) {
    assert.deepEqual(scanContent(`const workerSecret = ${value};`, 'fixture.ts'), []);
  }
});

test('provider secret and private key patterns produce metadata only', () => {
  const secret = ['sb', 'secret', 'synthetic'.repeat(5)].join('_');
  const key = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
  assert.deepEqual(scanContent(`${secret}\n${key}`, 'fixture.txt'), [
    { file: 'fixture.txt', line: 1, type: 'provider-secret' },
    { file: 'fixture.txt', line: 2, type: 'private-key' },
  ]);
});

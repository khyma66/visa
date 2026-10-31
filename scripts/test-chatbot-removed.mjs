import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';

test('retired API permanently rejects old clients without any upstream dependency', async () => {
  const source = await readFile(new URL('../src/app/api/assistant/route.ts', import.meta.url), 'utf8');
  assert(!/\bimport\b|\bfetch\s*\(|process\.env|\.rpc\(/.test(source));
  const route = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  for (const method of ['GET', 'POST']) for (const accept of ['application/json', 'application/x-ndjson']) {
    const response = route[method](new Request('https://visathreads.com/api/assistant', { method, headers: { Accept: accept, Authorization: 'Bearer stale-session' } }));
    assert.equal(response.status, 410);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), { posts: false, communities: false, catchup: false, code: 'removed' });
  }
});

test('no chatbot page, UI component, provider or runtime library remains', async () => {
  const root = new URL('../', import.meta.url);
  for (const file of ['src/app/assistant/page.tsx', 'src/components/AssistantPanel.tsx']) {
    await assert.rejects(readFile(new URL(file, root)), { code: 'ENOENT' });
  }
  assert(!(await readdir(new URL('src/lib/', root))).some(file => file.startsWith('assistant-')));
  for (const file of await readdir(new URL('src/components/', root))) {
    if (!file.endsWith('.tsx')) continue;
    const source = await readFile(new URL('src/components/' + file, root), 'utf8');
    assert(!/AssistantPanel|["']\/assistant["']|Ask VisaThreads|VisaThreads AI/.test(source), file);
  }
});

test('all current release workflows keep AI disabled and do not run model evaluations', async () => {
  const directory = new URL('../.github/workflows/', import.meta.url);
  for (const file of await readdir(directory)) {
    const source = await readFile(new URL(file, directory), 'utf8');
    assert(!/ASSISTANT_ENABLED: 'true'|evaluate-(groq|hosted)-assistant/.test(source), file);
  }
});

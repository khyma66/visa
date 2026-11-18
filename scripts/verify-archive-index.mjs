import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { archiveRecords } from './archive-database-records.mjs';
import { LIVE_DATABASE } from './live-preview-archive.mjs';

// A feature release must not replay an older Worker snapshot into the index:
// the index can contain newer edits or moderation decisions. Verify only.
export async function verifyArchiveIndex(records, config, request = fetch) {
  assert.equal(config.NEXT_PUBLIC_SUPABASE_URL, LIVE_DATABASE, 'Unexpected archive index origin');
  const key = config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  assert(/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key ?? ''), 'Archive index requires a publishable key');
  const visible = records.filter(row => row.status !== 'archived').map(row => row.id);
  assert(visible.length > 0 && visible.length <= 5000, 'Unexpected visible archive size');
  assert.equal(new Set(visible).size, visible.length, 'Duplicate archive IDs');
  assert(visible.every(id => /^apify-[A-Za-z0-9_-]{1,160}$/.test(id)), 'Invalid archive ID');

  for (let offset = 0; offset < visible.length; offset += 50) {
    const batch = visible.slice(offset, offset + 50);
    const url = new URL('/rest/v1/archive_posts', LIVE_DATABASE);
    url.searchParams.set('select', 'id');
    url.searchParams.set('id', `in.(${batch.join(',')})`);
    url.searchParams.set('status', 'neq.archived');
    url.searchParams.set('limit', '50');
    const response = await request(url, { headers: { apikey: key, authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    assert(response.ok, `Archive index check failed (${response.status}); no content was logged`);
    assert(/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? ''), 'Archive index returned an unexpected response');
    const reader = response.body.getReader(); const chunks = []; let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength; assert(bytes <= 65536, 'Archive index response exceeds limit');
        chunks.push(part.value);
      }
      const rows = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert(Array.isArray(rows) && rows.length === batch.length, 'Archive index is missing visible posts; refresh the index separately before releasing');
      const returned = rows.map(row => row?.id);
      assert.equal(new Set(returned).size, batch.length, 'Archive index returned duplicate IDs');
      assert(returned.every(id => batch.includes(id)), 'Archive index returned unexpected IDs');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  return visible.length;
}

async function main() {
  assert.equal(process.argv.length, 4, 'Expected archive and public-build-values paths');
  const feed = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const config = JSON.parse(await readFile(process.argv[3], 'utf8'));
  const checked = await verifyArchiveIndex(archiveRecords(feed), config);
  console.log(JSON.stringify({ operation: 'verified-visible-archive-index', checked }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

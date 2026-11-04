// Read completed runs for the project's existing source groups. Never starts Actors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseArgs, parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';

export const hash = value => createHash('sha256').update(value).digest('hex');
export function postDate(value) {
  if (typeof value === 'number') value = new Date(value < 1e12 ? value * 1000 : value).toISOString();
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
export function sourceGroups(input) {
  const groups = (input.startUrls ?? []).map(item => typeof item === 'string' ? item : item.url).map(value => {
    const url = new URL(value);
    assert(['www.facebook.com', 'facebook.com'].includes(url.hostname) && /^\/groups\/[^/]+\/?$/.test(url.pathname), 'Unrecognized source group');
    return `https://www.facebook.com${url.pathname.replace(/\/$/, '')}`;
  });
  assert(groups.length, 'Source groups missing');
  return [...new Set(groups)].sort();
}
export async function apifyRead(path, token, fetcher = fetch) {
  assert(!path.startsWith('/') && !path.includes('..'), 'Invalid API path');
  const response = await fetcher(`https://api.apify.com/v2/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Apify read failed: HTTP ${response.status}`);
  const reader = response.body.getReader(); const chunks = []; let bytes = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > 8 * 1024 * 1024) { await reader.cancel(); throw new Error('Dataset page too large'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function selectPosts(raw, { from, until }) {
  assert(Number.isFinite(Date.parse(from)) && Number.isFinite(Date.parse(until)) && from < until, 'Invalid date window');
  const posts = new Map(); const counts = { fetched: raw.length, duplicates: 0, missing_date: 0, outside_window: 0, empty: 0, invalid_source: 0 };
  // Latest completed snapshot wins. Preserve the actual posting date, never the scrape date.
  for (const item of [...raw].sort((a,b) => b.captured_at.localeCompare(a.captured_at))) {
    const date = postDate(item.post.time);
    const text = item.post.text?.trim();
    if (!text) { counts.empty++; continue; }
    if (!date) { counts.missing_date++; continue; }
    if (date < from || date >= until) { counts.outside_window++; continue; }
    let url;
    try { url = new URL(item.post.url); } catch { counts.invalid_source++; continue; }
    if (!['facebook.com','www.facebook.com'].includes(url.hostname) || !/^\/groups\/[^/]+\/(?:posts|permalink)\/[^/]+/.test(url.pathname)) { counts.invalid_source++; continue; }
    url.search = ''; url.hash = '';
    const canonical = `https://www.facebook.com${url.pathname.replace(/\/$/, '')}`;
    const sourceId = String(item.post.legacyId ?? item.post.id ?? canonical);
    const id = hash(canonical);
    if (posts.has(id)) { counts.duplicates++; continue; }
    posts.set(id, { id, source_id: sourceId, source_url: canonical, source_key: canonical.split(/\/(?:posts|permalink)\//)[0],
      source_posted_at: date, original_text: text, source_hash: hash(text), run_id: item.run_id,
      dataset_id: item.dataset_id, captured_at: item.captured_at });
  }
  return { counts, posts: [...posts.values()].sort((a,b) => b.source_posted_at.localeCompare(a.source_posted_at) || a.id.localeCompare(b.id)) };
}
export async function collect({ token, baseline, from, until, read = path => apifyRead(path, token) }) {
  assert(/^[a-zA-Z0-9]{17}$/.test(baseline), 'Invalid baseline run');
  const original = (await read(`actor-runs/${baseline}`)).data;
  assert(original?.status === 'SUCCEEDED', 'Baseline run must have succeeded');
  const groups = sourceGroups(await read(`key-value-stores/${original.defaultKeyValueStoreId}/records/INPUT`));
  const allowed = JSON.stringify(groups); const runs = []; let otherSources = 0;
  for (let offset = 0; ; offset += 100) {
    assert(offset < 10000, 'Run safety limit reached; no partial export');
    const { data } = await read(`actors/${original.actId}/runs?desc=1&status=SUCCEEDED&limit=100&offset=${offset}`);
    assert(data && Array.isArray(data.items), 'Invalid run page');
    runs.push(...data.items);
    if (offset + data.items.length >= data.total) break;
    assert(data.items.length === 100, 'Incomplete run inventory');
  }
  if (!runs.some(run => run.id === baseline)) runs.push(original);
  const matching = [];
  for (const run of runs) {
    // Earlier runs cannot contain posts in this window. No change is made to source schedules.
    if (run.finishedAt < from) continue;
    const input = await read(`key-value-stores/${run.defaultKeyValueStoreId}/records/INPUT`);
    if (JSON.stringify(sourceGroups(input)) !== allowed) { otherSources++; continue; }
    const dataset = (await read(`datasets/${run.defaultDatasetId}`)).data;
    assert(Number.isSafeInteger(dataset.itemCount) && dataset.itemCount >= 0, 'Invalid dataset count');
    matching.push({ ...run, itemCount: dataset.itemCount });
  }
  assert(matching.reduce((sum,run) => sum + run.itemCount, 0) <= 100000, 'Backfill exceeds safety bound; no partial export');
  const raw = [];
  for (const run of matching) {
    let count = 0;
    for (let offset = 0; offset < run.itemCount; offset += 100) {
      const page = await read(`datasets/${run.defaultDatasetId}/items?limit=100&offset=${offset}&fields=id,legacyId,url,time,text,groupTitle`);
      assert(Array.isArray(page) && page.length === Math.min(100, run.itemCount - offset), 'Incomplete dataset page');
      for (const post of page) raw.push({ post, run_id: run.id, dataset_id: run.defaultDatasetId, captured_at: run.finishedAt });
      count += page.length;
    }
    assert.equal(count, run.itemCount);
    const after = (await read(`datasets/${run.defaultDatasetId}`)).data;
    assert.equal(after.itemCount, count, 'Dataset changed while exporting');
  }
  const selected = selectPosts(raw, { from, until });
  return { ...selected, manifest: { schema_version: 1, exported_at: new Date().toISOString(), from, until,
    source_groups: groups, successful_runs: runs.length, other_sources: otherSources,
    runs: matching.map(run => ({ id: run.id, dataset_id: run.defaultDatasetId, finished_at: run.finishedAt, item_count: run.itemCount })),
    ...selected.counts, selected: selected.posts.length, publishing_enabled: false } };
}
async function main() {
  const { values } = parseArgs({ options: { baseline: { type: 'string', default: 'I0AI56pOzxvFHTz40' },
    from: { type: 'string' }, until: { type: 'string' }, out: { type: 'string' } } });
  assert(values.from && values.until && values.out, 'Supply --from ISO --until ISO --out DIRECTORY');
  const token = process.env.APIFY_TOKEN ?? parseEnv(await readFile(process.env.APIFY_CREDENTIAL_FILE ?? '.dev.vars', 'utf8')).APIFY_TOKEN;
  assert(token && !token.includes('replace_'), 'Configure APIFY_TOKEN in a local credential file');
  const result = await collect({ token, ...values });
  const serialized = JSON.stringify(result);
  assert(!serialized.includes(token), 'Credential detected in export');
  await mkdir(values.out, { recursive: true, mode: 0o700 });
  await writeFile(`${values.out}/source-posts.json`, JSON.stringify(result.posts, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await writeFile(`${values.out}/manifest.json`, JSON.stringify(result.manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify(result.manifest, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });

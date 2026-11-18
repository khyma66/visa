// Prepare existing, explicitly reviewed source results. Never starts an Actor.
// Publication uses the existing scoped ingestion path or the connected DB operator.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { archiveRecords } from './archive-database-records.mjs';

export const textHash = text => createHash('sha256').update(text).digest('hex');

export function reviewedTelegramRecords(rows, source, run) {
  assert.equal(run.actId, source.actorId, 'Unexpected actor');
  assert.equal(run.status, 'SUCCEEDED', 'Run must be complete');
  const byId = new Map();
  for (const row of rows) {
    assert.equal(row.channel, `@${source.channel}`, 'Dataset contains another channel');
    assert(Number.isSafeInteger(row.postId), 'Invalid Telegram post ID');
    assert(!byId.has(row.postId), 'Duplicate Telegram post ID');
    byId.set(row.postId, row);
  }
  return source.reviewedExperiences.map(review => {
    const row = byId.get(review.postId);
    assert(row && typeof row.text === 'string', 'Reviewed experience missing from this run');
    assert.equal(textHash(row.text), review.sourceHash, 'Source text changed; review before publishing');
    assert.equal(row.postUrl, `${source.channelUrl}/${row.postId}`, 'Unexpected source URL');
    assert(!row.replyToMsgId && !row.isForward, 'Only reviewed standalone first-person accounts');
    assert(row.text.length >= 80 && row.text.length <= 10000, 'Experience length outside bounds');
    assert(!/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:EAC|WAC|LIN|SRC|NBC|MSC|IOE|YSC)\d{10}\b|\bN\d{10}\b/i.test(row.text), 'Private identifier needs review');
    const date = new Date(row.date).toISOString();
    assert(date <= run.finishedAt, 'Source post cannot be newer than capture');
    const id = `apify-telegram-${source.channel}-${row.postId}`;
    const payload = {
      id, author_id: null, author_username: '', author_avatar_seed: id,
      title: review.title, body: row.text, destination_country: 'United States',
      visa_type: 'F-1 / OPT', tags: review.tags, status: 'open', post_kind: 'experience',
      experience_category: review.category, vote_score: 0, answer_count: 0,
      view_count: null, accepted_answer_id: null, created_at: date,
      updated_at: row.editDate ? new Date(row.editDate).toISOString() : date,
      source: 'apify', source_url: row.postUrl, source_group: row.channelTitle,
      source_label: 'Telegram', source_comment_count: 0,
      source_actor_id: run.actId, source_run_id: run.id,
      source_dataset_id: run.defaultDatasetId, source_text_sha256: review.sourceHash,
    };
    const [record] = archiveRecords({ source: { name: 'Apify' }, questions: [payload], answersByQuestionId: { [id]: [] } });
    // The legacy four-post selection is separate; this batch is reviewed above.
    return { ...record, experience: { ...payload } };
  });
}

export async function readApify(path, token, fetcher = fetch) {
  assert(!path.includes('..') && !path.startsWith('/'));
  const response = await fetcher(`https://api.apify.com/v2/${path}`, {
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) { const error = new Error(`Apify read HTTP ${response.status}`); error.status = response.status; throw error; }
  const reader = response.body.getReader(); const chunks = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength; assert(bytes <= 8 * 1024 * 1024, 'Dataset page exceeds bounds'); chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' }, run: { type: 'string' } } });
  assert(values.out, 'Supply --out PRIVATE_DIRECTORY');
  const source = JSON.parse(await readFile(new URL('../config/telegram-experience-source.json', import.meta.url), 'utf8'));
  let token = process.env.APIFY_TOKEN;
  const read = async path => {
    try { return await readApify(path, token); }
    catch (error) {
      if (error.status !== 401 || !token) throw error;
      // Shared run output stays readable when an old local credential expires.
      token = undefined; return readApify(path);
    }
  };
  let runId = values.run ?? source.referenceRunId, latestVerified = false;
  if (!values.run) {
    try {
      const result = await read(`actors/${source.actorId}/runs?desc=1&status=SUCCEEDED&limit=100`);
      for (const candidate of result.data.items) {
        const input = await read(`key-value-stores/${candidate.defaultKeyValueStoreId}/records/INPUT`);
        if (String(input.channels).replace(/\/$/, '') === source.channelUrl) {
          runId = candidate.id; latestVerified = true; break;
        }
      }
    } catch (error) { if (error.status !== 401) throw error; }
  }
  const { data: run } = await read(`actor-runs/${runId}`);
  const input = await read(`key-value-stores/${run.defaultKeyValueStoreId}/records/INPUT`);
  assert.equal(String(input.channels).replace(/\/$/, ''), source.channelUrl, 'Run used another source');
  assert.equal(input.includeText, true, 'Source text was not requested');
  const { data: dataset } = await read(`datasets/${run.defaultDatasetId}`);
  assert(Number.isSafeInteger(dataset.itemCount) && dataset.itemCount <= 10000, 'Dataset exceeds review bounds');
  const rows = [];
  for (let offset = 0; offset < dataset.itemCount; offset += 100) {
    const page = await read(`datasets/${run.defaultDatasetId}/items?limit=100&offset=${offset}&clean=true`);
    assert.equal(page.length, Math.min(100, dataset.itemCount - offset), 'Incomplete dataset'); rows.push(...page);
  }
  assert.equal((await read(`datasets/${run.defaultDatasetId}`)).data.itemCount, rows.length, 'Dataset changed while reading');
  const records = reviewedTelegramRecords(rows, source, run);
  const manifest = { actorId: source.actorId, actorName: source.actorName, runId: run.id,
    datasetId: run.defaultDatasetId, finishedAt: run.finishedAt, latestVerified,
    sourceRows: rows.length, selected: records.length, excluded: rows.length - records.length,
    posts: records.map(row => ({ id: row.id, sourceUrl: row.payload.source_url, bodyHash: textHash(row.payload.body) })),
    bodyFormat: 'Original text and line breaks', publication: 'prepared' };
  await mkdir(values.out, { recursive: true, mode: 0o700 });
  await writeFile(`${values.out}/records.json`, JSON.stringify(records, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await writeFile(`${values.out}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify(manifest, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });

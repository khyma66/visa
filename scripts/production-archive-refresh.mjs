// One-time additive content release. The existing Worker remains the trusted
// baseline; an Apify export is only a candidate until every old ID survives.
import assert from 'node:assert/strict';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LIVE_SITE, sha256 } from './live-preview-archive.mjs';
import { canonicalJson, publishedArchive } from './recover-worker-archive.mjs';

const receiptPath = '.cache/visaflow/live-preview/receipt.json';
const archivePath = 'src/data/api-archive.json';

function ids(rows, kind) {
  assert(Array.isArray(rows), `Missing ${kind} rows.`);
  const values = rows.map(row => row?.id);
  assert(values.every(id => typeof id === 'string' && id.length > 0), `Invalid ${kind} ID.`);
  assert.equal(new Set(values).size, values.length, `Duplicate ${kind} ID.`);
  return new Set(values);
}

function replyIds(archive) {
  const result = [];
  for (const [parent, replies] of Object.entries(archive.answersByQuestionId ?? {})) {
    assert(Array.isArray(replies), 'Invalid reply collection.');
    for (const reply of replies) {
      assert.equal(reply?.question_id, parent, 'Reply belongs to another discussion.');
      result.push(`${parent}:${reply.id}`);
    }
  }
  return ids(result.map(id => ({ id })), 'reply');
}

export function planArchiveRefresh(current, candidate) {
  const oldPosts = ids(current.questions, 'current post');
  const newPosts = ids(candidate.questions, 'candidate post');
  const oldReplies = replyIds(current);
  const newReplies = replyIds(candidate);
  assert([...oldPosts].every(id => newPosts.has(id)), 'Candidate would remove a published post.');
  assert([...oldReplies].every(id => newReplies.has(id)), 'Candidate would remove a published reply.');
  assert(newPosts.size > oldPosts.size, 'No new posts were found in the Apify export.');
  assert.equal(candidate.source?.importedItems, newPosts.size, 'Candidate post metadata differs from content.');
  assert.equal(candidate.source?.commentCount, newReplies.size, 'Candidate reply metadata differs from content.');
  assert.equal(candidate.source?.totalItems, candidate.source.importedItems + candidate.source.emptyItems + candidate.source.duplicateItems, 'Candidate run inventory does not reconcile.');
  assert(Array.isArray(current.source?.runIds) && current.source.runIds.length > 0, 'Published source-run history is missing.');
  assert(Array.isArray(candidate.source?.runIds) && current.source.runIds.every(id => candidate.source.runIds.includes(id)), 'Candidate omits a published source run.');
  assert(Date.parse(candidate.source.newestRunAt) > Date.parse(current.source.newestRunAt), 'Candidate has no newer completed source run.');
  return {
    status: 'additive-verified', previousQuestionCount: oldPosts.size, previousReplyCount: oldReplies.size,
    questionCount: newPosts.size, replyCount: newReplies.size,
    addedPosts: newPosts.size - oldPosts.size, addedReplies: newReplies.size - oldReplies.size,
    newestRunAt: candidate.source.newestRunAt,
    newestPostAt: candidate.questions.reduce((date, row) => row.created_at > date ? row.created_at : date, ''),
  };
}

export async function prepareArchiveRefresh(root = process.cwd(), fetchImpl = fetch) {
  const receiptFile = resolve(root, receiptPath);
  const receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
  assert.equal(receipt.siteOrigin, LIVE_SITE, 'Archive refresh targets the wrong site.');
  assert(!receipt.archiveRefresh, 'Archive refresh was already prepared.');
  const response = await fetchImpl(`${LIVE_SITE}/api/community?archive-refresh=${Date.now()}`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) });
  assert(response.ok && /^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? ''), 'Live archive could not be rechecked.');
  const current = await response.json();
  assert.equal(sha256(canonicalJson(current)), receipt.publishedArchiveSha256, 'Live archive changed since capture.');
  const bytes = await readFile(resolve(root, archivePath));
  assert(bytes.length <= 12 * 1024 * 1024, 'Candidate archive is too large.');
  const candidate = JSON.parse(bytes.toString('utf8'));
  const plan = planArchiveRefresh(current, candidate);
  assert.equal(plan.previousQuestionCount, receipt.questionCount, 'Captured post baseline differs from live content.');
  assert.equal(plan.previousReplyCount, receipt.replyCount, 'Captured reply baseline differs from live content.');
  const updated = {
    ...receipt,
    archiveSha256: sha256(bytes), publishedArchiveSha256: sha256(canonicalJson(publishedArchive(candidate))),
    questionCount: plan.questionCount, replyCount: plan.replyCount,
    archiveRefresh: plan,
  };
  const temporary = `${receiptFile}.tmp`;
  await writeFile(temporary, JSON.stringify(updated), { mode: 0o600 });
  await rename(temporary, receiptFile);
  console.log(JSON.stringify({ operation: 'prepared-additive-archive-refresh', ...plan }));
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] !== 'prepare') throw new Error('Use prepare after capture and Apify export.');
  await prepareArchiveRefresh();
}

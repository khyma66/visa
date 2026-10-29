import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { planArchiveRefresh, prepareArchiveRefresh } from './production-archive-refresh.mjs';
import { LIVE_SITE, sha256 } from './live-preview-archive.mjs';
import { canonicalJson, publishedArchive } from './recover-worker-archive.mjs';

const question = id => ({ id, created_at: '2026-10-07T12:00:00Z', answer_count: 0, source: 'apify' });
const reply = (id, parent) => ({ id, question_id: parent, status: 'active' });
const current = () => ({ questions: [question('apify-one')], answersByQuestionId: { 'apify-one': [reply('apify-reply-one', 'apify-one')] },
  source: { runIds: ['old-run'], newestRunAt: '2026-09-12T00:00:00Z', importedItems: 1, commentCount: 1, totalItems: 1, emptyItems: 0, duplicateItems: 0 } });
const candidate = () => ({ questions: [question('apify-two'), question('apify-one')], answersByQuestionId: {
  'apify-one': [reply('apify-reply-one', 'apify-one')], 'apify-two': [reply('apify-reply-two', 'apify-two')],
}, source: { runIds: ['new-run', 'old-run'], newestRunAt: '2026-10-08T00:00:00Z', importedItems: 2, commentCount: 2, totalItems: 2, emptyItems: 0, duplicateItems: 0 } });

test('additive archive plan retains every published post, reply and source run', () => {
  assert.deepEqual(planArchiveRefresh(current(), candidate()), {
    status: 'additive-verified', previousQuestionCount: 1, previousReplyCount: 1, questionCount: 2, replyCount: 2,
    addedPosts: 1, addedReplies: 1, newestRunAt: '2026-10-08T00:00:00Z', newestPostAt: '2026-10-07T12:00:00Z',
  });
  for (const mutate of [
    value => { value.questions = [question('apify-two')]; value.source.importedItems = 1; },
    value => { value.answersByQuestionId['apify-one'] = []; value.source.commentCount = 1; },
    value => { value.source.runIds = ['new-run']; },
    value => { value.source.newestRunAt = '2026-09-11T00:00:00Z'; },
    value => { value.source.totalItems = 3; },
    value => { value.questions.push(question('apify-two')); value.source.importedItems = 3; },
  ]) { const altered = candidate(); mutate(altered); assert.throws(() => planArchiveRefresh(current(), altered)); }
});

test('refresh preparation rechecks live baseline and binds candidate to exact bytes', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'visa-archive-refresh-test-'));
  try {
    await mkdir(resolve(root, '.cache/visaflow/live-preview'), { recursive: true });
    await mkdir(resolve(root, 'src/data'), { recursive: true });
    const before = current(), after = candidate();
    const receipt = { siteOrigin: LIVE_SITE, publishedArchiveSha256: sha256(canonicalJson(before)), questionCount: 1, replyCount: 1 };
    const receiptPath = resolve(root, '.cache/visaflow/live-preview/receipt.json');
    await writeFile(receiptPath, JSON.stringify(receipt));
    const bytes = `${JSON.stringify(after)}\n`;
    await writeFile(resolve(root, 'src/data/api-archive.json'), bytes);
    const fetchImpl = async () => Response.json(before);
    const plan = await prepareArchiveRefresh(root, fetchImpl);
    assert.equal(plan.addedPosts, 1);
    const updated = JSON.parse(await readFile(receiptPath, 'utf8'));
    assert.equal(updated.archiveSha256, sha256(bytes));
    assert.equal(updated.publishedArchiveSha256, sha256(canonicalJson(publishedArchive(after))));
    assert.equal(updated.archiveRefresh.status, 'additive-verified');
    await assert.rejects(prepareArchiveRefresh(root, fetchImpl), /already prepared/);
    await writeFile(receiptPath, JSON.stringify({ ...receipt, publishedArchiveSha256: 'a'.repeat(64) }));
    await assert.rejects(prepareArchiveRefresh(root, fetchImpl), /changed since capture/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

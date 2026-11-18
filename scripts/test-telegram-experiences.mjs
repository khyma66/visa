import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewedTelegramRecords, textHash } from './import-telegram-experiences.mjs';

const body = 'My first F-1 visa attempt was refused.\n\nI completed my engineering degree and have four years of work experience.\n\nMy language test score was 110.';
const source = { actorId: 'fixture-actor', channel: 'fixture_channel', channelUrl: 'https://t.me/fixture_channel', reviewedExperiences: [
  { postId: 123, sourceHash: textHash(body), title: 'F-1 Refusal and Applicant Profile', category: 'Visa interview', tags: ['f1', 'visa-refusal'] },
] };
const run = { id: 'fixture-run', actId: 'fixture-actor', status: 'SUCCEEDED', finishedAt: '2026-11-17T20:00:00.000Z', defaultDatasetId: 'fixture-dataset' };
const row = { channel: '@fixture_channel', postId: 123, postUrl: 'https://t.me/fixture_channel/123', text: body, date: '2026-11-16T12:00:00.000Z', replyToMsgId: 0, isForward: false };

test('reviewed import retains exact paragraphs and source date without creating identities or engagement', () => {
  const [record] = reviewedTelegramRecords([row], source, run);
  assert.equal(record.payload.body, body);
  assert.equal(record.experience.body, body);
  assert.equal(record.created_at, row.date);
  assert.equal(record.payload.created_at, row.date);
  assert.equal(record.payload.author_id, null);
  assert.equal(record.payload.vote_score, 0);
  assert.equal(record.payload.answer_count, 0);
  assert.equal(record.payload.view_count, null);
  assert.deepEqual(record.source_answers, []);
  assert.equal(record.experience.post_kind, 'experience');
  assert.equal(record.visa_type, 'F-1 / OPT', 'Use the public F1 tab filter value');
  assert.equal(record.experience.visa_type, record.visa_type);
  assert.equal(record.payload.source_url, row.postUrl);
  assert.equal(record.payload.source_run_id, run.id);
  assert.equal(record.payload.source_dataset_id, run.defaultDatasetId);
});

test('wrong source, edited text, replies, forwards and incomplete runs cannot enter the import', () => {
  for (const changed of [{ channel: '@other' }, { text: body + ' changed' }, { replyToMsgId: 1 }, { isForward: true }, { postUrl: 'https://example.org/123' }]) {
    assert.throws(() => reviewedTelegramRecords([{ ...row, ...changed }], source, run));
  }
  assert.throws(() => reviewedTelegramRecords([row], source, { ...run, actId: 'other' }));
  assert.throws(() => reviewedTelegramRecords([row], source, { ...run, status: 'RUNNING' }));
  assert.throws(() => reviewedTelegramRecords([], source, run));
  assert.throws(() => reviewedTelegramRecords([row, row], source, run));
});

test('unreviewed questions and announcements are excluded without keyword-based publication', () => {
  const records = reviewedTelegramRecords([row, { ...row, postId: 456, text: 'Approved! Can someone share an experience?' }], source, run);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'apify-telegram-fixture_channel-123');
});
